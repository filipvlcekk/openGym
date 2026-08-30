# Log Workout Write Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a scoped MCP `log_workout` write tool that stores a completed workout for an existing routine from structured JSON.

**Architecture:** The LLM remains the natural-language parser and sends deterministic JSON to MCP. The MCP tool validates routine/exercise/set shape, computes the finished workout using openGym-compatible history fields, writes through `api/state-service.js`, and records one audit event. No freestyle logging, exercise-name matching, or active workout mutation is included.

**Tech Stack:** Node.js ESM, Zod, Vitest, existing `frontend/src/lib/history.js` helpers, existing MCP token/auth/write-state services.

---

## Chunk 1: MCP Contract And Tests

### Task 1: Add Failing Tests For `log_workout`

**Files:**
- Modify: `mcp/test/tools.test.js`

- [x] **Step 1: Add a focused workout write fixture**

Add a `workoutWriteState()` helper near the existing write fixtures:

```js
function workoutWriteState() {
  const push = {
    id: 'push',
    name: 'Push Day',
    emoji: 'P',
    prog: 'linear',
    ex: [
      { id: '0426', sets: 3, reps: 10, weight: 25, mode: 'reps', inc: 2.5 },
      { id: 'plank', sets: 2, sec: 45, weight: 0, mode: 'time' }
    ]
  }
  return {
    ...writeToolState(),
    routines: [push],
    workouts: [
      workout('old1', '2026-08-01', 'push', 'Push Day', [
        entry('0426', push.ex[0], [{ w: 20, r: 10 }])
      ])
    ],
    exWeights: { '0426': { w: 20, d: '2026-08-01' } },
    bodyweight: []
  }
}
```

- [x] **Step 2: Add dry-run test**

Add a `describe('log_workout')` block before the registry smoke test:

```js
test('previews a structured workout without writing or auditing', () => {
  withWriteToolEnv({ scopes: ['workout:write'], state: workoutWriteState() }, ({ dataDir }) => {
    const r = call('log_workout', {
      routine_id: 'push',
      date: '2026-08-30',
      duration_min: 60,
      bodyweight: 78.4,
      entries: [
        { exercise_id: '0426', sets: [{ w: 25, r: 10 }, { w: 25, r: 8 }] },
        { exercise_id: 'plank', sets: [{ sec: 60, w: 0 }] }
      ],
      expected_revision: 7,
      dry_run: true
    })

    expect(r).toMatchObject({
      ok: true,
      dry_run: true,
      would_change: true,
      revision: 7,
      unit: 'kg',
      workout: {
        date: '2026-08-30',
        routine_id: 'push',
        name: 'Push Day',
        sets_done: 3,
        volume: 450,
        prs: ['0426'],
        bodyweight: 78.4
      },
      changes: [
        { path: 'workouts', before: 1, after: 2 },
        { path: 'exWeights.0426', before: 20, after: 25 }
      ]
    })
    expect(readDiskState(dataDir)._revision).toBe(7)
    expect(readDiskState(dataDir).workouts).toHaveLength(1)
    expect(readAuditEvents(dataDir)).toEqual([])
  })
})
```

- [x] **Step 3: Add commit test**

```js
test('commits a finished workout and updates PR weights through state-service', () => {
  withWriteToolEnv({ scopes: ['workout:write'], state: workoutWriteState() }, ({ dataDir, token }) => {
    const r = call('log_workout', {
      routine_id: 'push',
      date: '2026-08-30',
      duration_min: 60,
      bodyweight: 78.4,
      entries: [
        { exercise_id: '0426', sets: [{ w: 25, r: 10 }, { w: 25, r: 8 }] },
        { exercise_id: 'plank', sets: [{ sec: 60, w: 0 }] }
      ],
      expected_revision: 7,
      dry_run: false
    })

    expect(r).toMatchObject({
      ok: true,
      dry_run: false,
      changed: true,
      revision_before: 7,
      revision_after: 8,
      workout: {
        date: '2026-08-30',
        routine_id: 'push',
        name: 'Push Day',
        sets_done: 3,
        volume: 450,
        prs: ['0426'],
        bodyweight: 78.4
      }
    })
    expect(typeof r.workout.id).toBe('string')

    const saved = readDiskState(dataDir)
    expect(saved._revision).toBe(8)
    expect(saved.workouts).toHaveLength(2)
    expect(saved.workouts[1]).toMatchObject({
      id: r.workout.id,
      d: '2026-08-30',
      routineId: 'push',
      name: 'Push Day',
      bw: 78.4,
      vol: 450,
      prs: ['0426']
    })
    expect(saved.workouts[1].entries[0].target).toMatchObject({ id: '0426', sets: 3, reps: 10, weight: 25 })
    expect(saved.workouts[1].entries[0].sets).toEqual([
      { w: 25, r: 10, done: true },
      { w: 25, r: 8, done: true }
    ])
    expect(saved.workouts[1].entries[1].sets).toEqual([{ sec: 60, w: 0, done: true }])
    expect(saved.exWeights['0426']).toEqual({ w: 25, d: '2026-08-30' })

    expect(readAuditEvents(dataDir)).toMatchObject([{
      actor: `mcp-token:${token.id}`,
      token_id: token.id,
      action: 'log_workout',
      details: { date: '2026-08-30', routine_id: 'push', workout_id: r.workout.id, sets_done: 3, volume: 450 }
    }])
  })
})
```

- [x] **Step 4: Add safety tests**

Cover:

```js
test('returns conflict without writing when revision is stale', ...)
test('requires workout:write scope', ...)
test('rejects missing routine and exercises outside the routine', ...)
test('rejects mode-specific invalid sets', ...)
```

- [x] **Step 5: Run tests to verify RED**

Run: `cd mcp && npm test -- tools.test.js`

Expected: FAIL because `log_workout` is not registered.

## Chunk 2: Tool Implementation

### Task 2: Implement `log_workout`

**Files:**
- Modify: `mcp/src/tools.js`
- Modify: `mcp/test/tools.test.js`
- Modify: `mcp/README.md`

- [x] **Step 1: Add schemas**

Add Zod schemas for set payloads and `log_workout` inputs:

```js
const repsWorkoutSetSchema = z.object({ w: z.number().min(0), r: z.number().int().min(1), done: z.boolean().optional() }).strict()
const timeWorkoutSetSchema = z.object({ sec: z.number().int().min(1), w: z.number().min(0).optional(), done: z.boolean().optional() }).strict()
const cardioWorkoutSetSchema = z.object({ min: z.number().min(1), speed: z.number().min(0).optional(), done: z.boolean().optional() }).strict()
const workoutEntrySchema = z.object({
  exercise_id: z.string().min(1),
  sets: z.array(z.union([repsWorkoutSetSchema, timeWorkoutSetSchema, cardioWorkoutSetSchema])).min(1).max(50)
}).strict()
```

- [x] **Step 2: Add helper functions**

Add helpers near existing write helpers:

```js
function workoutTimestamp(date, hour = 18) { ... }
function makeWorkoutId() { ... }
function normalizeWorkoutBodyweight(weight) { ... }
function normalizeWorkoutSets(cfg, sets) { ... }
function buildLoggedWorkout(S, { routine_id, date, duration_min, bodyweight, entries }) { ... }
function applyLoggedWorkout(current, workout) { ... }
function workoutSummary(S, workout) { ... }
```

Rules:
- require routine by `routine_id`;
- reject duplicate `exercise_id` entries;
- reject exercises not present in the routine;
- normalize output entries in routine order;
- force `done: true`;
- copy routine config as `target`;
- compute `topW`, `prs`, `vol`, `start`, `end`, and `bw`;
- update `exWeights` only when new completed max weight is greater than current best.

- [x] **Step 3: Add `logWorkout` tool**

Implement:

```js
export const logWorkout = {
  name: 'log_workout',
  description: 'Log a completed workout for an existing routine from structured JSON. Requires OPENGYM_MCP_TOKEN with workout:write. Use dry_run=true first.',
  schema: { ... },
  handler: ({ routine_id, date = currentISO(), duration_min, bodyweight, entries, expected_revision, dry_run = true }) => { ... }
}
```

Behavior:
- verify `workout:write`;
- read user state;
- return dry-run preview without write/audit;
- on commit use `states.updateUserState`;
- pass `expectedRevision`;
- audit details: `{ date, routine_id, workout_id, sets_done, volume }`;
- return summary and changes.

- [x] **Step 4: Register the tool and smoke sample**

Add `logWorkout` to `TOOLS`.

Update the registry smoke test sample map with:

```js
log_workout: {
  routine_id: 'routine',
  duration_min: 60,
  entries: [{ exercise_id: 'exercise', sets: [{ w: 10, r: 10 }] }],
  expected_revision: 0,
  dry_run: true
}
```

- [x] **Step 5: Run targeted MCP tests**

Run: `cd mcp && npm test -- tools.test.js`

Expected: PASS.

- [x] **Step 6: Update docs**

Update:
- `mcp/README.md` tool count and write-tool list;
- `docs/MCP_WRITE_ARCHITECTURE.md` Phase 2 status if it has a roadmap checklist;
- the Czech project documentation if it lists MCP write tools.

## Chunk 3: Verification And Commit

### Task 3: Verify And Commit

**Files:**
- Modified files from prior tasks.

- [x] **Step 1: Run MCP suite**

Run: `cd mcp && npm test`

Expected: PASS.

- [x] **Step 2: Run MCP loadability check**

Run: `cd mcp && npm run check:node-loadable`

Expected: PASS.

- [x] **Step 3: Run API suite**

Run: `cd api && npm test`

Expected: PASS.

- [x] **Step 4: Check whitespace**

Run: `git diff --check`

Expected: no output.

- [x] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-08-30-log-workout-write-tool.md mcp/src/tools.js mcp/test/tools.test.js mcp/README.md docs/MCP_WRITE_ARCHITECTURE.md
git commit -m "feat: add log workout mcp tool"
```

- [x] **Step 6: Report final state**

Report:
- commit hash;
- tests run;
- whether `main` is ahead of `origin/main`.
