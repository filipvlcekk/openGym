# Workout And Set State Validation Design

## Goal

Add deeper shared validation for persisted workout and set data without turning validation into a breaking migration for historical openGym state files.

The validator should catch obvious state corruption before API or MCP writes are committed, while continuing to accept older, imported or partially shaped workout history that the frontend already knows how to read.

## Current Context

`api/state-service.js` is already the shared write boundary for API and MCP writes. It clones the current state, applies a narrow mutation, strips `active`, increments `_revision`, validates the resulting state through `api/state-validation.js`, writes atomically and appends audit.

`api/state-validation.js` currently validates:

- root state object shape;
- `_revision`;
- routine ids and routine array shape;
- `week` and `dayPlan` references;
- bodyweight entries;
- basic workout shape: `workouts` array, each workout object, optional workout date, optional `entries` array.

It does not validate workout ids, timestamps, `routineId`, names, bodyweight-at-workout, volume, PR ids, entry objects, set objects, target shape or mode-specific set fields.

MCP write tools already do stricter input validation for newly logged workouts. `log_workout` and `log_freestyle_workout` normalize submitted sets, force them to `done: true`, compute `vol`, `prs` and `exWeights`, and write through the shared state service. That tool-level validation is still needed because it protects the public MCP payload contract.

## Recommended Approach

Use a conservative shared guardrail.

Shared state validation should reject data that is structurally unsafe or numerically corrupt. It should not require every historical workout to match the newest MCP write schema. This keeps `PUT /api/data` and existing self-hosted histories working while still preventing bad writes from damaging the state file.

The validator should remain dependency-light and local to `api/state-validation.js`. It should not import frontend helpers, exercise databases or MCP code. State validation runs inside the API write path, so it should stay deterministic and avoid coupling to UI display logic.

## Accepted Compatibility Rules

The following historical shapes must remain valid:

- workouts without `target` on entries;
- entries without explicit `mode`;
- entries whose exercise id is no longer present in `EXDB` or `customEx`;
- workouts whose `routineId` references a deleted routine;
- routine-less workouts with `routineId: null`;
- imported history with zero values such as reps `0`, cardio minutes `0` or speed `0`;
- read-only fallback behavior where unknown exercise ids can still be listed and inspected.

Because of those compatibility rules, shared validation must not require:

- `entry.id` to exist in the built-in catalogue or `customEx`;
- `routineId` to exist in `routines`;
- workout entries to belong to the referenced routine;
- every entry to have a `target`;
- every set to match a fully inferred reps/time/cardio mode;
- `vol` to exactly match a recomputation from sets;
- `prs` to exactly match best-weight logic.

Those are either semantic checks owned by write tools, or future migration/audit checks that should not block ordinary sync.

## Workout Validation Contract

`validateWorkouts(state, issues)` should continue to accept a missing `workouts` field. When `workouts` is present:

- `workouts` must be an array.
- each workout must be an object.
- `workout.id`, if present, must be a non-empty string.
- `workout.d`, if present, must be a valid calendar date in exact `YYYY-MM-DD` form.
- `workout.routineId`, if present, must be either `null` or a non-empty string.
- `workout.name`, if present, must be a string.
- `workout.start`, if present, must be a finite number.
- `workout.end`, if present, must be a finite number.
- if both `start` and `end` are finite numbers, `end` must be greater than or equal to `start`.
- `workout.bw`, if present and not `null`, must be a positive finite number.
- `workout.vol`, if present, must be a finite number greater than or equal to `0`.
- `workout.prs`, if present, must be an array of strings.
- `workout.entries`, if present, must be an array.

The validator should not require `id`, `d`, `routineId`, `name`, `start`, `end`, `bw`, `vol`, `prs` or `entries` to exist on every historical workout. It should validate fields when they are present.

## Entry Validation Contract

For each `workout.entries[*]`:

- entry must be an object.
- `entry.id`, if present, must be a non-empty string.
- `entry.topW`, if present and not `null`, must be a finite number greater than or equal to `0`.
- `entry.target`, if present, must be an object.
- `entry.sets`, if present, must be an array.

The validator should not require `entry.id`, `entry.target` or `entry.sets` on historical entries, but it should reject wrong types when those fields are present.

Duplicate entry ids should not be rejected in shared validation. MCP write tools reject duplicates for new writes, but older imported data or manual edits may have odd repeated rows. Blocking all sync for that is too aggressive for this guardrail.

## Set Validation Contract

For each `entry.sets[*]`:

- set must be an object.
- `done`, if present, must be boolean.
- `w`, if present, must be a finite number greater than or equal to `0`.
- `r`, if present, must be a finite number greater than or equal to `0`.
- `sec`, if present, must be a finite number greater than or equal to `0`.
- `min`, if present, must be a finite number greater than or equal to `0`.
- `speed`, if present, must be a finite number greater than or equal to `0`.
- `rir`, if present, must be a finite number greater than or equal to `0`.
- `rpe`, if present, must be a finite number greater than or equal to `0`.

Do not require reps to be integers in shared validation. The current MCP write tools require integer reps for new writes, but shared validation should tolerate older or imported state until there is a dedicated migration path.

Do not require a set to contain a mode-specific field. Missing `w`, `r`, `sec`, `min` or `speed` should remain valid; wrong types or negative values should not.

## Target Validation Contract

For each `entry.target`, when present:

- target must be an object.
- `mode`, if present, must be one of `reps`, `time` or `cardio`.
- `id`, if present, must be a non-empty string.
- `sets`, if present, must be a finite number greater than or equal to `0`.
- `reps`, if present, must be a finite number greater than or equal to `0`.
- `weight`, if present, must be a finite number greater than or equal to `0`.
- `repsMin`, if present, must be a finite number greater than or equal to `0`.
- `repsMax`, if present, must be a finite number greater than or equal to `0`.
- if both `repsMin` and `repsMax` are finite numbers, `repsMax` must be greater than or equal to `repsMin`.
- `sec`, if present, must be a finite number greater than or equal to `0`.
- `min`, if present, must be a finite number greater than or equal to `0`.
- `speed`, if present, must be a finite number greater than or equal to `0`.
- `inc`, if present, must be a finite number greater than or equal to `0`.
- `bodyweight`, if present, must be boolean.
- `side`, if present, must be boolean.
- `prog` and `policy`, if present, must be strings.
- `sg`, if present, must be a non-empty string.

Shared validation should not reject unknown target keys. This is a state guardrail, not a closed schema for all future frontend fields. MCP tool payload schemas can stay strict at the edge.

Shared validation should not reject mode-incompatible target fields. That remains the responsibility of write-tool input validation. Historical entries may have incomplete or unusual target data, and read helpers already use forgiving fallback behavior.

## Error Reporting

Use the existing issue format:

```js
{ path: 'workouts.0.entries.1.sets.2.w', message: 'must be a finite number >= 0' }
```

`api/state-service.js` should continue returning:

```js
{
  ok: false,
  error: {
    code: 'STATE_VALIDATION_FAILED',
    message: 'State validation failed.',
    issues
  }
}
```

Validation failures must not write the state file and must not append audit events.

## Testing Strategy

Add focused tests in `api/test/state-service.test.js` because that exercises the real shared write boundary.

The tests should cover:

- valid legacy workout without targets still passes;
- valid freestyle workout with `routineId: null` still passes;
- unknown historical exercise id still passes;
- deleted historical routine id still passes;
- zero-valued imported set fields still pass;
- invalid workout metadata fails without writing;
- invalid entry/set object shape fails without writing;
- invalid set numeric fields fail without writing or audit;
- invalid target metadata fails without writing;
- `active` continues to be stripped before validation.

Keep MCP write-tool tests focused on MCP payload behavior. Add MCP tests only if the shared validator exposes a regression in commit behavior that API tests cannot observe.

## Out Of Scope

- migration of historical workout data;
- rejecting unknown exercise ids;
- rejecting deleted routine ids in old workouts;
- recomputing and enforcing `vol`, `prs` or `exWeights`;
- strict mode-specific set schema for all persisted history;
- changes to frontend rendering or import behavior;
- new MCP tools;
- remote HTTP MCP transport.

## Documentation Updates

After implementation, update:

- `docs/MCP_WRITE_ARCHITECTURE.md` to mark deeper shared workout/set validation done and document the conservative guardrail boundary;
- `docs/openGym_AI_Coach_MCP_dokumentace.md` to update the Czech Phase 2 roadmap;
- `mcp/README.md` only if test counts or roadmap wording change.

## Success Criteria

- Existing API and MCP suites still pass.
- New API tests prove corrupt workout/set data is rejected through `state-service`.
- Existing seeded demo state remains accepted.
- Freestyle and routine workout commits still pass through shared validation.
- The docs clearly state that this is deeper structural validation, not a strict historical workout migration.
