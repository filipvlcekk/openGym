# Edit Routine Superset MCP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend MCP `edit_routine` with safe patch ops for linking and unlinking adjacent routine exercises as supersets.

**Architecture:** Keep superset writes inside the existing `edit_routine` boundary because supersets live on routine exercise configs as `sg` fields. Add narrow `link_superset` and `unlink_superset` ops that mirror the frontend link button, generate `sg` ids server-side, run `cleanupSg`, and commit through the existing state-service, revision and audit path.

**Tech Stack:** Node.js ESM, Zod, Vitest, existing `frontend/src/lib/history.js` helpers `cleanupSg`, existing `frontend/src/lib/format.js` `uid`, existing MCP token/auth/write-state services.

---

## File Structure

- Modify `mcp/src/tools.js`: add superset op schemas, helper functions, `edit_routine` validation/change/apply support and tool description text.
- Modify `mcp/test/tools.test.js`: add contract tests for link/unlink behavior and keep no-state sample valid.
- Modify `mcp/README.md`: document the expanded `edit_routine` ops and update Phase 2.5 status.
- Modify `docs/MCP_WRITE_ARCHITECTURE.md`: update implementation status and future list.
- Modify `docs/openGym_AI_Coach_MCP_dokumentace.md`: update Czech write tool docs and Phase 2.5 status.
- Modify `docs/superpowers/plans/2026-09-04-edit-routine-superset-mcp.md`: mark checklist items while executing.

## Chunk 1: Contract Tests

### Task 1: Add Failing Tests For Superset Ops

**Files:**
- Modify: `mcp/test/tools.test.js`

- [ ] **Step 1: Add a superset edit fixture**

Add after `routineEditState()`:

```js
function supersetEditState() {
  return {
    ...writeToolState(),
    routines: [{
      id: 'push',
      name: 'Push Day',
      emoji: 'P',
      prog: 'linear',
      ex: [
        { id: '0426', sets: 3, reps: 10, weight: 25, mode: 'reps' },
        { id: 'plank', sets: 3, sec: 60, mode: 'time' },
        { id: '1323', sets: 3, reps: 10, weight: 55, mode: 'reps', sg: 'A' },
        { id: '0739', sets: 4, reps: 8, weight: 120, mode: 'reps', sg: 'A' }
      ]
    }]
  }
}
```

- [ ] **Step 2: Add dry-run link test**

Add inside `describe('edit_routine', ...)`:

```js
test('dry_run previews linking an exercise to the previous exercise without writing state or audit', () => {
  withWriteToolEnv({ scopes: ['routine:write'], state: supersetEditState() }, ({ dataDir }) => {
    const r = call('edit_routine', {
      routine_id: 'push',
      ops: [{ op: 'link_superset', exercise_id: 'plank' }],
      expected_revision: 7,
      dry_run: true
    })

    expect(r).toEqual({
      ok: true,
      dry_run: true,
      would_change: true,
      revision: 7,
      changes: [{
        path: 'routines.push.ex.plank.sg',
        op: 'link_superset',
        exercise_id: 'plank',
        with_previous_id: '0426',
        before: null,
        after: 'sg_preview'
      }]
    })
    expect(readDiskState(dataDir).routines[0].ex.map(e => e.sg || null)).toEqual([null, null, 'A', 'A'])
    expect(readAuditEvents(dataDir)).toEqual([])
  })
})
```

- [ ] **Step 3: Add commit link test for a new group**

```js
test('commit links an exercise to the previous exercise with a generated group id', () => {
  withWriteToolEnv({ scopes: ['routine:write'], state: supersetEditState() }, ({ dataDir }) => {
    const r = call('edit_routine', {
      routine_id: 'push',
      ops: [{ op: 'link_superset', exercise_id: 'plank' }],
      expected_revision: 7,
      dry_run: false
    })

    expect(r).toMatchObject({
      ok: true,
      dry_run: false,
      changed: true,
      revision_before: 7,
      revision_after: 8,
      changes: [{
        path: 'routines.push.ex.plank.sg',
        op: 'link_superset',
        exercise_id: 'plank',
        with_previous_id: '0426',
        before: null
      }]
    })
    expect(r.changes[0].after).toMatch(/^sg[a-z0-9]+$/)
    const saved = readDiskState(dataDir)
    expect(saved.routines[0].ex[0].sg).toBe(r.changes[0].after)
    expect(saved.routines[0].ex[1].sg).toBe(r.changes[0].after)
    expect(saved._revision).toBe(8)
  })
})
```

- [ ] **Step 4: Add commit link test that reuses previous group**

```js
test('link_superset reuses the previous exercise group when extending a superset', () => {
  withWriteToolEnv({ scopes: ['routine:write'], state: supersetEditState() }, ({ dataDir }) => {
    const r = call('edit_routine', {
      routine_id: 'push',
      ops: [{ op: 'link_superset', exercise_id: '0739' }],
      expected_revision: 7,
      dry_run: false
    })

    expect(r).toMatchObject({
      ok: true,
      dry_run: false,
      changed: false,
      revision_before: 7,
      revision_after: 7,
      changes: []
    })
    expect(readDiskState(dataDir)._revision).toBe(7)
    expect(readAuditEvents(dataDir)).toEqual([])
  })
})
```

Then add a second assertion path with a state where only the previous exercise has `sg`:

```js
const state = supersetEditState()
delete state.routines[0].ex[3].sg
```

Commit `link_superset` for `0739` and assert `0739.sg === 'A'`, revision increments, and the change after is `'A'`.

- [ ] **Step 5: Add unlink tests**

Add tests asserting:

```js
call('edit_routine', {
  routine_id: 'push',
  ops: [{ op: 'unlink_superset', exercise_id: '1323' }],
  expected_revision: 7,
  dry_run: false
})
```

results in:

- `1323.sg` removed;
- `0739.sg` also removed by `cleanupSg`;
- `_revision` increments;
- change has `before: 'A'` and `after: null`.

Also assert unlinking `plank` when it has no `sg` returns `changed: false`, unchanged revision and no audit.

- [ ] **Step 6: Add validation tests**

Assert:

- `link_superset` on first exercise throws `/cannot link the first exercise/`;
- missing exercise throws the existing missing exercise message;
- stale revision still returns `STATE_CONFLICT`;
- missing `routine:write` still returns `TOKEN_FORBIDDEN`.

- [ ] **Step 7: Run tests to verify RED**

Run: `cd mcp && npm test -- tools.test.js`

Expected: FAIL because `link_superset` and `unlink_superset` are not supported yet.

## Chunk 2: Implementation

### Task 2: Implement Superset Ops In `edit_routine`

**Files:**
- Modify: `mcp/src/tools.js`

- [ ] **Step 1: Import `uid`**

Change the existing format import or add a new one:

```js
import { uid } from '../../frontend/src/lib/format.js'
```

- [ ] **Step 2: Add op schemas**

Add:

```js
const linkSupersetOpSchema = z.object({
  op: z.literal('link_superset'),
  exercise_id: z.string().min(1)
}).strict()

const unlinkSupersetOpSchema = z.object({
  op: z.literal('unlink_superset'),
  exercise_id: z.string().min(1)
}).strict()
```

Add both schemas to the `edit_routine` discriminated union.

- [ ] **Step 3: Add superset helpers**

Add near routine edit helpers:

```js
function requireLinkableSupersetExercise(routine, exerciseId) {
  const index = routineExerciseIndex(routine, exerciseId)
  if (index === -1) requireRoutineExercise(routine, exerciseId)
  if (index === 0) fail('EINVAL', 'cannot link the first exercise to a previous exercise')
  return index
}

function makeSupersetId(existing = []) {
  const used = new Set(existing.map(ex => ex.sg).filter(Boolean))
  for (let i = 0; i < 20; i += 1) {
    const id = `sg${uid()}`
    if (!used.has(id)) return id
  }
  fail('EINVAL', 'could not generate unique superset id')
}

function applyLinkSuperset(routine, exerciseId, forcedGroupId) {
  const index = requireLinkableSupersetExercise(routine, exerciseId)
  const prev = routine.ex[index - 1]
  const cur = routine.ex[index]
  if (cur.sg && prev.sg && cur.sg === prev.sg) return null
  const before = cur.sg || null
  const groupId = prev.sg || forcedGroupId || makeSupersetId(routine.ex)
  prev.sg = groupId
  cur.sg = groupId
  cleanupSg(routine.ex)
  return {
    path: `routines.${routine.id}.ex.${cur.id}.sg`,
    op: 'link_superset',
    exercise_id: cur.id,
    with_previous_id: prev.id,
    before,
    after: groupId
  }
}

function applyUnlinkSuperset(routine, exerciseId) {
  const index = routineExerciseIndex(routine, exerciseId)
  if (index === -1) requireRoutineExercise(routine, exerciseId)
  const cur = routine.ex[index]
  if (!cur.sg) return null
  const before = cur.sg
  delete cur.sg
  cleanupSg(routine.ex)
  return {
    path: `routines.${routine.id}.ex.${cur.id}.sg`,
    op: 'unlink_superset',
    exercise_id: cur.id,
    before,
    after: null
  }
}
```

- [ ] **Step 4: Expand `validateEditRoutineOps`**

In the sequential validation copy:

- for `link_superset`, call `applyLinkSuperset(next, op.exercise_id, 'sg_preview')`;
- for `unlink_superset`, call `applyUnlinkSuperset(next, op.exercise_id)`.

This validates multi-op sequences as they will apply.

- [ ] **Step 5: Expand `editRoutineChanges`**

In the change pass:

- for `link_superset`, call `applyLinkSuperset(next, op.exercise_id, 'sg_preview')` and push the returned change if non-null;
- for `unlink_superset`, call `applyUnlinkSuperset(next, op.exercise_id)` and push the returned change if non-null.

- [ ] **Step 6: Expand `applyEditRoutineOps`**

In the commit pass:

- for `link_superset`, call `applyLinkSuperset(next, op.exercise_id)`;
- for `unlink_superset`, call `applyUnlinkSuperset(next, op.exercise_id)`.

- [ ] **Step 7: Update tool description**

Mention `link_superset` and `unlink_superset` in the `edit_routine` description.

- [ ] **Step 8: Run targeted MCP tests**

Run: `cd mcp && npm test -- tools.test.js`

Expected: PASS.

## Chunk 3: Docs, Verification And Commit

### Task 3: Document, Verify And Commit

**Files:**
- Modify: `mcp/README.md`
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `docs/superpowers/plans/2026-09-04-edit-routine-superset-mcp.md`

- [ ] **Step 1: Update MCP README**

Document that `edit_routine` now supports:

- `set_policy`;
- `set_exercise_target`;
- `add_exercise`;
- `remove_exercise`;
- `reorder_exercise`;
- `link_superset`;
- `unlink_superset`.

Update Phase 2.5 status so direct superset editing is done.

- [ ] **Step 2: Update architecture docs**

Update implementation status and recommendation list in `docs/MCP_WRITE_ARCHITECTURE.md`.

- [ ] **Step 3: Update Czech MCP docs**

Add `link_superset` and `unlink_superset` to the `edit_routine` section and update Phase 2.5 status.

- [ ] **Step 4: Mark checklist progress**

Change completed plan items from `- [ ]` to `- [x]`.

- [ ] **Step 5: Run MCP suite**

Run: `cd mcp && npm test`

Expected: PASS.

- [ ] **Step 6: Run MCP loadability check**

Run: `cd mcp && npm run check:node-loadable`

Expected: PASS.

- [ ] **Step 7: Run API suite**

Run: `cd api && npm test`

Expected: PASS.

- [ ] **Step 8: Check whitespace**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add mcp/src/tools.js mcp/test/tools.test.js mcp/README.md docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-09-04-edit-routine-superset-mcp.md
git commit -m "feat: add superset routine mcp ops"
```

- [ ] **Step 10: Report final state**

Report:

- commit hash;
- tests run;
- remaining MCP roadmap item: freestyle workout logging, plus later remote MCP.
