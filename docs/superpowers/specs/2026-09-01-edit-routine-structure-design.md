# Edit Routine Structure MCP Design

## Context

The AI Coach can already patch a routine policy and existing exercise targets through `edit_routine`. The next useful step is allowing the user to build and maintain the routine itself through natural language, while keeping MCP writes narrow and auditable.

The user should be able to say things like:

```text
Přidej mi do Push Day lateral raises 3x12 s 8 kg za bench.
Odeber plank z Push Day.
Přesuň bench na začátek rutiny.
```

The LLM translates those requests into explicit `edit_routine` ops. MCP validates the current state and applies only the approved structured mutation.

## Recommended Approach

Extend the existing `edit_routine` patch tool with three structural ops:

```json
{ "op": "add_exercise", "exercise_id": "0426", "target": { "sets": 3, "reps": 10, "weight": 25 }, "position": 2 }
{ "op": "remove_exercise", "exercise_id": "0426" }
{ "op": "reorder_exercise", "exercise_id": "0426", "position": 1 }
```

This keeps one routine-editing write boundary:

- same `routine:write` token scope;
- same `dry_run`;
- same `expected_revision`;
- same state-service lock, revision and audit path;
- same `edit_routine` audit action with explicit ops.

## Alternatives Considered

### Separate Tools

Create `add_exercise_to_routine`, `remove_exercise_from_routine` and `reorder_routine_exercises`.

This gives a very explicit MCP surface, but it expands the tool list and duplicates write/auth/dry-run patterns. It is a reasonable future split if `edit_routine` becomes too large, but not needed for the first structural patch.

### Whole Routine Replacement

Accept a full routine JSON payload and replace `r.ex`.

This is simpler to implement but riskier. A malformed LLM output could silently drop exercises, superset ids or progression fields. It also makes dry-run diffs less useful.

## Operation Semantics

### `add_exercise`

Adds one exercise config to the target routine.

Rules:

- `exercise_id` must exist in the built-in catalog or in `S.customEx`;
- the routine must not already contain the exercise;
- `position` is optional and 1-based;
- omitted `position` appends to the end;
- supplied `position` is clamped to the valid insertion range `1..length+1`;
- `target` is optional and patch-like;
- base config comes from `defaultConfig(exercise_id, target.mode)`;
- allowed target fields match the existing `set_exercise_target` numeric fields plus `mode`, `bodyweight`, `side`, `prog`;
- final target fields are validated with the same numeric target rules used by `set_exercise_target`;
- cardio exercises must stay cardio.

Example:

```json
{
  "op": "add_exercise",
  "exercise_id": "0426",
  "position": 2,
  "target": {
    "sets": 3,
    "mode": "reps",
    "reps": 12,
    "weight": 8
  }
}
```

### `remove_exercise`

Removes one exercise from the target routine.

Rules:

- `exercise_id` must exist inside the routine;
- only the routine config is removed;
- already logged workouts are not changed;
- `S.exWeights` is not touched because the exercise may exist in history or other routines;
- after removal, `cleanupSg` runs on the routine exercise list.

### `reorder_exercise`

Moves one exercise to a new 1-based position inside the same routine.

Rules:

- `exercise_id` must exist inside the routine;
- `position` is required and 1-based;
- supplied `position` is clamped to `1..length`;
- after moving, `cleanupSg` runs on the routine exercise list.

## Dry Run Response

Dry-run remains change-based:

```json
{
  "ok": true,
  "dry_run": true,
  "would_change": true,
  "revision": 184,
  "changes": [
    {
      "path": "routines.push.ex",
      "op": "add_exercise",
      "exercise_id": "0426",
      "before": null,
      "after": { "id": "0426", "sets": 3, "mode": "reps", "reps": 12, "weight": 8 },
      "position": 2
    }
  ]
}
```

Commit response keeps the same shape as current `edit_routine`, with `revision_before`, `revision_after`, `changed` and `changes`.

## Non-Goals

Not in this step:

- creating custom exercises;
- fuzzy matching exercise names inside MCP;
- replacing entire routines;
- editing workout history;
- editing superset groups directly;
- deleting catalog/custom exercise definitions.

## Testing

MCP contract tests should cover:

- dry-run add without writing or audit;
- commit add with revision increment and audit;
- add rejects unknown exercise ids;
- add rejects duplicate routine exercise ids;
- commit remove keeps workouts and `exWeights`;
- remove/reorder call `cleanupSg` so orphan superset ids are removed;
- reorder moves to the expected 1-based position;
- stale revision still returns `STATE_CONFLICT`;
- token without `routine:write` still returns `TOKEN_FORBIDDEN`;
- registry/no-state smoke test includes a valid sample for the expanded schema.
