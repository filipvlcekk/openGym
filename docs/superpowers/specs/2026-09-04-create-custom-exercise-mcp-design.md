# Create Custom Exercise MCP Design

## Context

MCP Phase 2 can already edit schedules, routine targets, routine structure, body weight and
completed workouts. Routine structure edits can add an exercise only when the exercise id already
exists in the built-in catalogue or `S.customEx`.

The next Phase 2.5 gap is creating a custom exercise through MCP, so a user can say:

```text
Vytvor mi cvik Ring support hold na core.
```

The LLM should translate that into one narrow, audited write. Adding the new exercise to a routine
remains a separate `edit_routine.add_exercise` call.

## Recommended Approach

Add a standalone MCP write tool:

```text
create_custom_exercise
```

The tool writes one entry to `S.customEx` and uses the same safety path as the other Phase 2 write
tools:

- scoped MCP token;
- `dry_run`;
- `expected_revision`;
- state-service lock and `_revision` conflict checks;
- shared state validation;
- scrubbed JSONL audit events.

Use a new `exercise:write` token scope. Creating a catalogue item is related to routine editing,
but it is not the same permission as changing a routine prescription.

## Tool Contract

Input:

```json
{
  "name": "Ring support hold",
  "body_part": "waist",
  "description": "Hold top position on rings.",
  "expected_revision": 184,
  "dry_run": true
}
```

Rules:

- `name` is trimmed and must be non-empty;
- `body_part` must be one of the frontend catalogue `BODYPARTS`;
- `description` is optional, trimmed and capped at 1000 characters;
- duplicate names are rejected case-insensitively across built-in `EXDB` and `S.customEx`;
- the tool generates the custom exercise id server-side;
- committed state shape matches the frontend custom exercise form:

```json
{
  "id": "c...",
  "n": "Ring support hold",
  "bp": "waist",
  "desc": "Hold top position on rings.",
  "tg": "",
  "eq": "custom",
  "custom": true
}
```

The id should be stable for the commit response and audit event. The LLM must not provide it.

## Responses

Dry-run response:

```json
{
  "ok": true,
  "dry_run": true,
  "would_change": true,
  "revision": 184,
  "exercise": {
    "id": "c_preview",
    "name": "Ring support hold",
    "body_part": "waist",
    "description": "Hold top position on rings."
  },
  "changes": [
    {
      "path": "customEx",
      "op": "create_custom_exercise",
      "before": null,
      "after": {
        "n": "Ring support hold",
        "bp": "waist",
        "desc": "Hold top position on rings.",
        "tg": "",
        "eq": "custom",
        "custom": true
      }
    }
  ]
}
```

Commit response follows existing write tool shape:

```json
{
  "ok": true,
  "dry_run": false,
  "changed": true,
  "revision_before": 184,
  "revision_after": 185,
  "exercise": {
    "id": "cabc123",
    "name": "Ring support hold",
    "body_part": "waist",
    "description": "Hold top position on rings."
  },
  "changes": [...]
}
```

## Non-Goals

Not in this step:

- adding the created exercise to a routine automatically;
- editing existing custom exercises;
- deleting custom exercises;
- fuzzy matching exercise names inside MCP;
- accepting an LLM-provided id;
- changing frontend custom exercise behavior.

## Testing

MCP contract tests should cover:

- dry-run previews a custom exercise without writing state or audit;
- commit creates one custom exercise, increments `_revision` and appends audit;
- duplicate name is rejected against built-in catalogue names;
- duplicate name is rejected against existing custom exercises;
- invalid body part is rejected;
- blank name is rejected after trimming;
- stale revision returns `STATE_CONFLICT` without writing;
- token without `exercise:write` returns `TOKEN_FORBIDDEN`;
- registry/no-state smoke test includes a valid sample for the new tool.
