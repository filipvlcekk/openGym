# Edit Routine Superset MCP Design

## Context

MCP can already patch routine policy, exercise targets and routine structure through
`edit_routine`. The last Phase 2.5 routine-editor gap is direct superset editing.

In openGym state, a superset is stored as an `sg` string on adjacent routine exercise configs.
The frontend links one exercise to the exercise directly above it. If the previous exercise
already has an `sg`, the current exercise joins that group; otherwise the frontend creates a new
`sg...` id and assigns it to both. After remove and reorder operations, `cleanupSg` removes any
superset id that no longer has an adjacent partner.

The MCP surface should keep those same rules and avoid accepting arbitrary `sg` ids from the LLM.

## Recommended Approach

Extend the existing `edit_routine` patch tool with two new ops:

```json
{ "op": "link_superset", "exercise_id": "1323" }
{ "op": "unlink_superset", "exercise_id": "1323" }
```

This keeps superset editing inside the existing routine-edit write boundary:

- same `routine:write` scope;
- same `dry_run`;
- same `expected_revision`;
- same state-service lock, revision and audit path;
- same `edit_routine` audit action with explicit ops.

## Alternatives Considered

### Separate `edit_superset_groups` Tool

A standalone tool would make the feature name explicit, but it would duplicate the same auth,
dry-run, revision and audit behavior that `edit_routine` already owns. Since supersets are stored
directly on routine exercise configs, the existing routine patch tool is the narrower boundary.

### Replace All Superset Groups In One Payload

Accepting the complete desired `sg` layout is compact, but a malformed LLM payload could break
several groups at once. It also makes previews less useful because the diff is a whole-layout
replacement instead of one intentional link/unlink.

## Operation Semantics

### `link_superset`

Links one routine exercise with the exercise immediately above it, matching the frontend link
button.

Rules:

- `exercise_id` must exist inside the target routine;
- the exercise must not be at position 1;
- if the previous exercise has `sg`, reuse that group id;
- otherwise generate a new `sg...` id server-side and assign it to both exercises;
- if the current exercise is already linked to the previous exercise with the same `sg`, the op
  is a no-op;
- after applying, run `cleanupSg` for consistency;
- the LLM cannot provide an `sg` id.

Example:

```json
{
  "routine_id": "push",
  "ops": [
    { "op": "link_superset", "exercise_id": "1323" }
  ],
  "expected_revision": 184,
  "dry_run": true
}
```

### `unlink_superset`

Removes the direct link for one routine exercise.

Rules:

- `exercise_id` must exist inside the target routine;
- if the exercise has no `sg`, the op is a no-op;
- delete `sg` from the target exercise;
- run `cleanupSg` so orphaned ids are removed from former partners;
- logged workouts are not changed.

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
      "path": "routines.push.ex.1323.sg",
      "op": "link_superset",
      "exercise_id": "1323",
      "with_previous_id": "plank",
      "before": null,
      "after": "sg_preview"
    }
  ]
}
```

Commit response keeps the same `edit_routine` shape with `revision_before`, `revision_after`,
`changed` and `changes`. Generated ids use the same `sg` + `uid()` style as the frontend.

## Non-Goals

Not in this step:

- accepting arbitrary `sg` ids from MCP clients;
- grouping non-adjacent exercises;
- replacing all superset groups at once;
- changing workout history;
- changing active workout state;
- changing frontend routine editor behavior.

## Testing

MCP contract tests should cover:

- dry-run `link_superset` previews changes without writing state or audit;
- commit `link_superset` creates a new group when the previous exercise has no `sg`;
- commit `link_superset` reuses the previous exercise's `sg` to extend an existing group;
- `link_superset` is a no-op when the exercise is already linked to the previous exercise;
- `unlink_superset` removes the target `sg` and runs `cleanupSg`;
- `unlink_superset` is a no-op when the target exercise has no `sg`;
- `link_superset` rejects the first routine exercise;
- missing routine and missing exercise behavior stays consistent with existing `edit_routine`;
- stale revision and missing `routine:write` behavior stays unchanged;
- registry/no-state smoke sample remains valid for expanded `edit_routine` schema.
