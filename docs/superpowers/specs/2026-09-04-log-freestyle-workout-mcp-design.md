# Log Freestyle Workout MCP Design

## Goal

Add a scoped MCP write tool named `log_freestyle_workout` that logs a completed workout which is not tied to an existing routine.

The tool keeps natural-language parsing outside MCP. The LLM client sends structured JSON with explicit exercise ids, targets and completed sets. MCP validates that shape, builds the same finished-workout state shape the frontend uses for freestyle sessions, and commits through the existing state-service, revision and audit path.

## Current Context

`log_workout` already writes completed workouts for an existing routine. It requires `routine_id`, validates that every entry belongs to that routine, stores entries in routine order, copies each routine target into the workout, computes `vol`, `prs` and `exWeights`, and writes through `updateUserState`.

The frontend already represents freestyle workouts as normal workout history rows with:

```js
{
  routineId: null,
  name: 'Freestyle',
  entries: [
    { id, sets, topW, target }
  ]
}
```

So the MCP freestyle tool should reuse that state shape instead of creating a new domain model.

## Recommended Approach

Create a separate `log_freestyle_workout` tool rather than expanding `log_workout`.

Reasons:

- `log_workout` can remain strict and routine-bound.
- Freestyle logging has a different contract: entries may be any catalog or custom exercise id, and each entry needs its own target.
- The audit surface is clearer: `log_workout` means routine workout, `log_freestyle_workout` means ad hoc workout.
- The implementation can reuse the existing workout helper functions while keeping validation paths explicit.

## Tool Contract

Input:

```json
{
  "name": "Freestyle",
  "date": "2026-09-04",
  "duration_min": 45,
  "bodyweight": 78.4,
  "entries": [
    {
      "exercise_id": "0426",
      "target": { "mode": "reps", "sets": 3, "reps": 10, "weight": 25 },
      "sets": [
        { "w": 25, "r": 10 },
        { "w": 25, "r": 8 }
      ]
    }
  ],
  "expected_revision": 184,
  "dry_run": true
}
```

Fields:

- `name`: optional workout name, trimmed, defaults to `Freestyle`.
- `name` must be a string when supplied. Empty-after-trim names are rejected with `EINVAL`; stored names are capped at 120 characters.
- `date`: optional valid calendar date in exact `YYYY-MM-DD` form, defaults to today using the same local-time `currentISO()` helper as existing MCP write tools.
- `duration_min`: required integer from 1 to 1440.
- `bodyweight`: optional positive number, rounded to one decimal in the profile unit.
- `entries`: required, 1 to 50 entries.
- `expected_revision`: required integer for commits and returned in dry-run context.
- `dry_run`: optional boolean, defaults to true.

Each entry:

- `exercise_id`: required id from `EXDB` or `S.customEx`.
- `target`: optional target config. If omitted, MCP builds a default target from the exercise and set shape.
- `sets`: required, 1 to 50 completed sets.

## Set And Target Rules

The tool supports the same modes as `log_workout`:

- reps set: `{ "w": 25, "r": 10 }`
- time set: `{ "sec": 60, "w": 0 }`
- cardio set: `{ "min": 20, "speed": 9.5 }`

Mode resolution:

1. If `entry.target.mode` is present, use it.
2. Else if the exercise body part is `cardio`, use `cardio`.
3. Else infer from the first set:
   - `sec` means `time`;
   - `min` means `cardio`;
   - otherwise `reps`.

MCP normalizes the stored `target` by combining three layers:

```text
defaultConfig(exercise_id, mode)
  + target fields inferred from the submitted sets
  + explicit entry.target fields
```

The inferred layer makes a no-target freestyle entry read back as what was logged:

- reps: `{ sets: set_count, reps: first_set.r, weight: first_set.w }`
- time: `{ sets: set_count, sec: first_set.sec, weight: first_set.w || 0 }`
- cardio: `{ sets: set_count, min: first_set.min, speed: first_set.speed || 0 }`

Explicit `entry.target` values win over inferred values. This lets the caller say, for example, that 8 logged reps were part of a 10-rep target.

Validation:

- exercise id must exist in the built-in catalogue or `customEx`;
- duplicate exercise entries are rejected;
- entry target fields use a freestyle-specific schema: `mode`, `sets`, `reps`, `weight`, `repsMin`, `repsMax`, `sec`, `min`, `speed`, `bodyweight` and `side`;
- cardio exercises must use `mode: "cardio"` if a mode is supplied;
- routine progression fields such as `prog`, `policy` and `inc` are rejected because a freestyle workout is not a routine template;
- mode-incompatible target fields are rejected:
  - reps mode accepts `sets`, `reps`, `repsMin`, `repsMax`, `weight`, `bodyweight` and `side`;
  - time mode accepts `sets`, `sec`, `weight`, `bodyweight` and `side`;
  - cardio mode accepts `sets`, `min` and `speed`;
- set payloads must match the resolved mode;
- all stored sets get `done: true`.

No fuzzy matching or exercise creation happens inside this tool. If the user names an unknown exercise, the LLM should call `create_custom_exercise` first, then use the returned id in `log_freestyle_workout`.

## Stored Workout Shape

The committed workout should be:

```js
{
  id: makeWorkoutId(),
  d: date,
  start: workoutTimestamp(date),
  end: start + duration_min * 60000,
  routineId: null,
  name,
  bw,
  entries,
  prs,
  vol
}
```

Entries preserve input order because freestyle workouts have no routine order to normalize against.

Each stored entry should be:

```js
{
  id: exercise_id,
  sets: normalizedDoneSets,
  topW: highestCompletedWeightOrNull,
  target: normalizedTarget
}
```

`prs`, `vol` and `exWeights` use the same semantics as `log_workout`.

Workout summaries must resolve custom exercise names from `S.customEx`, not only from `EXDB`. This can be done by making the existing summary helper state-aware while preserving current built-in exercise behavior.

## Dry Run, Commit And Audit

Dry-run returns:

- `ok: true`;
- `dry_run: true`;
- `would_change: true`;
- current `revision`;
- `unit`;
- compact `workout` summary from the existing `workoutSummary`;
- `changes` from `loggedWorkoutChanges`.

Commit:

- requires `OPENGYM_MCP_TOKEN` with `workout:write`;
- rejects stale `expected_revision` through `updateUserState`;
- appends one audit event with action `log_freestyle_workout`;
- audit details include date, workout id, workout name, sets done and volume;
- audit details do not include raw token, full state snapshots or the complete set log.

## Error Handling

Use the existing MCP error style:

- `TOKEN_FORBIDDEN` for missing `workout:write`;
- `STATE_CONFLICT` for stale revision;
- `ENOENT` for unknown exercise ids;
- `EINVAL` for invalid duration, invalid date, invalid name, duplicate entries, unsupported mode, invalid target fields, mode-incompatible target fields or mode-specific invalid set shapes.

## Out Of Scope

- natural-language parsing inside MCP;
- fuzzy exercise-name matching;
- creating exercises inside the freestyle logging tool;
- editing existing workouts;
- mutating `S.active`;
- partial or draft workout state;
- remote HTTP MCP transport.

## Testing

Add contract tests around `mcp/src/tools.js`:

- dry-run previews a freestyle workout without writing state or audit;
- commit writes `routineId: null`, preserves entry order, computes `vol`, `prs`, `exWeights` and audit details;
- custom exercise ids from `S.customEx` are accepted;
- custom exercise summaries use the custom exercise name;
- omitted targets are normalized from mode/set shape;
- invalid names and invalid calendar dates are rejected;
- mode-incompatible target fields are rejected;
- duplicate entries, unknown exercises and invalid mode-specific sets are rejected;
- stale revision returns `STATE_CONFLICT`;
- missing `workout:write` returns `TOKEN_FORBIDDEN`;
- no-state fallback includes the new tool in the registry smoke test.

Update docs and counts after the implementation.
