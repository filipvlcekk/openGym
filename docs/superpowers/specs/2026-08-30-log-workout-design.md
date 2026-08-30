# Log Workout MCP Tool Design

## Context

The AI Coach integration should let the user describe a completed workout naturally while keeping the write boundary deterministic and auditable.

The user should not have to write JSON. The LLM client acts as the natural-language parser and planner. The MCP server receives only a structured, validated tool payload and writes through `api/state-service.js`.

## User Flow

```text
User
  -> speaks naturally to the LLM
LLM
  -> reads openGym context through MCP read tools
  -> converts the user's text into a structured workout proposal
  -> shows the user the proposed workout
User
  -> confirms
LLM
  -> calls log_workout with dry_run=false and expected_revision
MCP
  -> verifies workout:write token
  -> locks state
  -> checks revision
  -> validates and writes state
  -> appends audit
openGym UI
  -> sees the new workout in normal history
```

## First Version Scope

The first `log_workout` version writes a finished workout for an existing routine.

It does not parse natural language inside MCP, create freestyle workouts, add unknown exercises, or edit `S.active`.

The LLM can still accept natural language from the user, but it must translate that into a structured proposal before calling MCP.

## Proposed Tool Contract

```json
{
  "routine_id": "push",
  "date": "2026-08-30",
  "duration_min": 62,
  "bodyweight": 78.4,
  "entries": [
    {
      "exercise_id": "0426",
      "sets": [
        { "w": 25, "r": 10, "done": true },
        { "w": 25, "r": 10, "done": true },
        { "w": 25, "r": 8, "done": true }
      ]
    }
  ],
  "expected_revision": 184,
  "dry_run": true
}
```

Rules:

- `routine_id` must reference an existing routine;
- every `exercise_id` must exist inside that routine;
- `entries` must use routine exercises, not arbitrary names;
- target config is copied from the routine entry into each finished workout entry;
- set shapes follow openGym's existing modes:
  - reps: `{ "w": number, "r": number, "done": true }`
  - time: `{ "sec": number, "w": number, "done": true }`
  - cardio: `{ "min": number, "speed": number, "done": true }`
- unchecked sets are not needed in the first version;
- the tool computes `vol`, `prs`, and `exWeights` using the same frontend helper functions as the UI where possible;
- `bodyweight` is optional and stored as workout `bw`;
- the tool supports `dry_run`, `expected_revision`, audit logging, and `workout:write`.

## Why No MCP Natural-Language Parser

Natural language is ambiguous. Exercise names can be misspelled, abbreviated, translated, or refer to several catalog entries. Keeping parsing in the LLM layer lets the assistant ask follow-up questions before writing.

MCP should be a strict execution boundary. It should accept structured data, validate it against the current openGym state, and either preview or commit the exact mutation.

## Dry Run

`dry_run: true` should return the computed workout summary without writing:

```json
{
  "ok": true,
  "dry_run": true,
  "would_change": true,
  "revision": 184,
  "workout": {
    "date": "2026-08-30",
    "routine_id": "push",
    "name": "Push Day",
    "sets_done": 3,
    "volume": 750,
    "prs": []
  },
  "changes": [
    { "path": "workouts", "before": 12, "after": 13 }
  ]
}
```

The LLM should show this to the user and ask for explicit confirmation before committing.

## Commit

`dry_run: false` should:

- verify `workout:write`;
- check `expected_revision`;
- build a finished workout object compatible with openGym history;
- append it to `S.workouts`;
- update `S.exWeights` for heavier completed loads;
- clear no `active` workout manually because `state-service` strips `active` before write;
- validate state through `api/state-validation.js`;
- append one audit event with action `log_workout`.

## Non-Goals

Not in the first version:

- parsing natural language inside MCP;
- matching exercise names to catalog ids;
- freestyle workouts;
- adding custom exercises;
- replacing or editing existing workouts;
- creating an active in-progress workout;
- deep workout set validation beyond the first structured contract.

## Testing

MCP tests should cover:

- dry-run preview without writing or audit;
- commit appends a workout and increments revision;
- target is copied from the routine entry;
- volume and PR/exWeights updates are computed;
- stale revision returns `STATE_CONFLICT`;
- token without `workout:write` returns `TOKEN_FORBIDDEN`;
- missing routine or exercise outside the routine throws before writing;
- invalid mode-specific set shape is rejected.
