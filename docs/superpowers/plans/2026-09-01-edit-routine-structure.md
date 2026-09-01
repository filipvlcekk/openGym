# Edit Routine Structure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Extend MCP `edit_routine` with safe structural ops for adding, removing and reordering exercises inside an existing routine.

**Architecture:** Keep the current `edit_routine` write boundary and add narrow patch ops instead of replacing full routines. The LLM chooses existing exercise ids and structured target fields; MCP validates the ids, target shape and routine membership, applies the mutation through `api/state-service.js`, and records explicit audit details.

**Tech Stack:** Node.js ESM, Zod, Vitest, existing `frontend/src/lib/history.js` helpers `defaultConfig` and `cleanupSg`, existing MCP token/auth/write-state services.

---

## Chunk 1: Contract Tests

### Task 1: Add Failing Tests For Structural Routine Ops

**Files:**
- Modify: `mcp/test/tools.test.js`

- [x] **Step 1: Expand `routineEditState()` fixture**

Add a third exercise and stable superset ids:

```js
ex: [
  { id: '0426', sets: 3, reps: 10, weight: 25, mode: 'reps', inc: 2.5 },
  { id: 'plank', sets: 3, sec: 60, mode: 'time', sg: 'A' },
  { id: '1323', sets: 3, reps: 10, weight: 55, mode: 'reps', sg: 'A' }
]
```

- [x] **Step 2: Add dry-run add test**

Call `edit_routine` with:

```js
ops: [{
  op: 'add_exercise',
  exercise_id: '0739',
  position: 2,
  target: { sets: 4, mode: 'reps', reps: 8, weight: 120 }
}]
```

Assert:
- returned change path `routines.push.ex`;
- returned op `add_exercise`;
- `before: null`;
- `after` includes `{ id: '0739', sets: 4, mode: 'reps', reps: 8, weight: 120 }`;
- saved routine still has original exercise ids;
- no audit event.

- [x] **Step 3: Add commit add test**

Commit the same op and assert:
- `_revision` increments;
- new exercise is inserted at index `1`;
- audit action is `edit_routine`;
- audit details include the explicit `add_exercise` op.

- [x] **Step 4: Add remove test**

Seed workouts and `exWeights`, remove `plank`, and assert:
- routine no longer contains `plank`;
- already logged workouts are unchanged;
- `exWeights` is unchanged;
- orphan superset ids are cleaned after removal.

- [x] **Step 5: Add reorder test**

Move `1323` to position `1` and assert:
- order becomes `['1323', '0426', 'plank']`;
- orphan superset ids are cleaned because `plank` and `1323` are no longer adjacent.

- [x] **Step 6: Add validation tests**

Assert:
- unknown add exercise id throws;
- duplicate add exercise id throws;
- remove missing routine exercise throws;
- stale revision still returns `STATE_CONFLICT`.

- [x] **Step 7: Update no-state smoke sample**

Keep `edit_routine` sample valid with one of the old supported ops.

- [x] **Step 8: Run tests to verify RED**

Run: `cd mcp && npm test -- tools.test.js`

Expected: FAIL because `add_exercise`, `remove_exercise` and `reorder_exercise` are not supported yet.

## Chunk 2: Implementation

### Task 2: Implement Structural Ops In `edit_routine`

**Files:**
- Modify: `mcp/src/tools.js`

- [x] **Step 1: Import helpers**

Import `defaultConfig` and `cleanupSg` from `frontend/src/lib/history.js`.

- [x] **Step 2: Add schemas**

Add Zod schemas for:

```js
addExerciseOpSchema
removeExerciseOpSchema
reorderExerciseOpSchema
```

`target` should accept only the allowed target patch fields:
`sets`, `reps`, `weight`, `inc`, `repsMin`, `repsMax`, `sec`, `min`, `speed`, `mode`, `bodyweight`, `side`, `prog`.

- [x] **Step 3: Add validation helpers**

Add:

```js
function exerciseExistsInLibrary(S, exerciseId) { ... }
function normalizeAddExerciseTarget(S, exerciseId, target) { ... }
function normalizePosition(position, min, max, fallback) { ... }
function routineExerciseIndex(routine, exerciseId) { ... }
```

Rules:
- library means `EXIDX[exerciseId]` or `(S.customEx || []).some(e => e.id === exerciseId)`;
- add rejects duplicate ids inside the routine;
- cardio catalog exercises stay cardio;
- numeric target fields reuse `validateTargetField`;
- boolean fields must be booleans;
- `mode` must be `reps`, `time` or `cardio`;
- `prog` must be one of `POLICIES`.

- [x] **Step 4: Expand `validateEditRoutineOps`**

Validate all five ops:
- `set_policy`;
- `set_exercise_target`;
- `add_exercise`;
- `remove_exercise`;
- `reorder_exercise`.

- [x] **Step 5: Expand `editRoutineChanges`**

Return compact changes:
- add: `{ path: 'routines.<id>.ex', op: 'add_exercise', exercise_id, before: null, after: normalizedConfig, position }`;
- remove: `{ path: 'routines.<id>.ex.<exercise_id>', op: 'remove_exercise', exercise_id, before: existingConfig, after: null }`;
- reorder: `{ path: 'routines.<id>.ex', op: 'reorder_exercise', exercise_id, before: oldPosition, after: newPosition }`.

- [x] **Step 6: Expand `applyEditRoutineOps`**

Apply operations in order:
- add inserts normalized config at 1-based position or appends;
- remove filters the exercise and calls `cleanupSg`;
- reorder removes and reinserts the config and calls `cleanupSg`;
- existing policy/target ops keep current behavior.

- [x] **Step 7: Run targeted MCP tests**

Run: `cd mcp && npm test -- tools.test.js`

Expected: PASS.

## Chunk 3: Docs, Verification, Commit

### Task 3: Document And Commit

**Files:**
- Modify: `mcp/README.md`
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `docs/superpowers/plans/2026-09-01-edit-routine-structure.md`

- [x] **Step 1: Update docs**

Document that `edit_routine` now supports:
- `set_policy`;
- `set_exercise_target`;
- `add_exercise`;
- `remove_exercise`;
- `reorder_exercise`.

Keep custom exercise creation and direct superset editing as future work.

- [x] **Step 2: Mark checklist complete**

Change completed plan items from `- [x]` to `- [x]`.

- [x] **Step 3: Run MCP suite**

Run: `cd mcp && npm test`

Expected: PASS.

- [x] **Step 4: Run MCP loadability check**

Run: `cd mcp && npm run check:node-loadable`

Expected: PASS.

- [x] **Step 5: Run API suite**

Run: `cd api && npm test`

Expected: PASS.

- [x] **Step 6: Check whitespace**

Run: `git diff --check`

Expected: no output.

- [x] **Step 7: Commit**

```bash
git add mcp/src/tools.js mcp/test/tools.test.js mcp/README.md docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-09-01-edit-routine-structure.md
git commit -m "feat: add routine structure mcp ops"
```

- [x] **Step 8: Report final state**

Report:
- commit hash;
- tests run;
- whether `main` is ahead of `origin/main`.
