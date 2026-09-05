# Log Freestyle Workout MCP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `log_freestyle_workout`, a scoped MCP write tool for completed workouts that are not tied to an existing routine.

**Architecture:** Keep the existing strict `log_workout` routine-bound and add a separate freestyle tool with its own schema and validation. Reuse shared workout helpers for timestamps, set normalization, summaries, volume, PRs, `exWeights`, dry-run, revision conflicts and audit-backed commits. Store freestyle history in the frontend-compatible shape with `routineId: null`.

**Tech Stack:** Node.js ESM, Zod, Vitest, existing `api/state-service.js`, existing MCP token/auth/write services, existing frontend helpers from `frontend/src/lib/history.js`, `frontend/src/lib/exercises.js` and `frontend/src/lib/format.js`.

---

## File Structure

- Modify `mcp/test/tools.test.js`: add contract tests for `log_freestyle_workout`, custom exercise summary behavior, validation, auth/conflict and no-state registry coverage.
- Modify `mcp/src/tools.js`: add freestyle schemas/helpers, state-aware workout summaries, builder/apply functions and tool registration.
- Modify `mcp/README.md`: document the new tool, update test counts and roadmap status.
- Modify `docs/MCP_WRITE_ARCHITECTURE.md`: mark freestyle workout logging done and document the separate tool contract.
- Modify `docs/openGym_AI_Coach_MCP_dokumentace.md`: update Czech docs and roadmap.
- Modify `docs/superpowers/plans/2026-09-04-log-freestyle-workout-mcp.md`: mark checklist progress while executing.

## Chunk 1: Contract Tests

### Task 1: Add Failing Tests For `log_freestyle_workout`

**Files:**
- Modify: `mcp/test/tools.test.js`

- [ ] **Step 1: Add a freestyle fixture**

Add after `workoutWriteState()`:

```js
function freestyleWorkoutWriteState() {
  return {
    ...workoutWriteState(),
    customEx: [
      { id: 'c_ring_row', n: 'Ring row', bp: 'back', desc: 'Strict ring row.', tg: '', eq: 'custom', custom: true }
    ]
  }
}
```

- [ ] **Step 2: Add dry-run preview test**

Add a `describe('log_freestyle_workout', ...)` block after the existing `describe('log_workout', ...)` block:

```js
test('previews a freestyle workout without writing or auditing', () => {
  withWriteToolEnv({ scopes: ['workout:write'], state: freestyleWorkoutWriteState() }, ({ dataDir }) => {
    const r = call('log_freestyle_workout', {
      name: '  Hotel gym  ',
      date: '2026-09-04',
      duration_min: 45,
      bodyweight: 78.4,
      entries: [
        { exercise_id: '1323', target: { mode: 'time', sets: 2, sec: 60, weight: 0 }, sets: [{ sec: 60, w: 0 }, { sec: 45, w: 0 }] },
        { exercise_id: '0426', target: { mode: 'reps', sets: 2, reps: 10, weight: 25 }, sets: [{ w: 25, r: 10 }, { w: 25, r: 8 }] }
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
        date: '2026-09-04',
        routine_id: null,
        name: 'Hotel gym',
        sets_done: 4,
        volume: 450,
        prs: ['0426'],
        bodyweight: 78.4
      },
      changes: [
        { path: 'workouts', before: 1, after: 2 },
        { path: 'exWeights.0426', before: 20, after: 25 }
      ]
    })
    expect(readDiskState(dataDir).workouts).toHaveLength(1)
    expect(readAuditEvents(dataDir)).toEqual([])
  })
})
```

- [ ] **Step 3: Add commit test**

Add:

```js
test('commits a freestyle workout with routineId null and audit details', () => {
  withWriteToolEnv({ scopes: ['workout:write'], state: freestyleWorkoutWriteState() }, ({ dataDir, token }) => {
    const r = call('log_freestyle_workout', {
      name: 'Hotel gym',
      date: '2026-09-04',
      duration_min: 45,
      entries: [
        { exercise_id: '0426', target: { mode: 'reps', sets: 2, reps: 10, weight: 25 }, sets: [{ w: 25, r: 10 }, { w: 25, r: 8 }] },
        { exercise_id: '1323', target: { mode: 'time', sets: 1, sec: 60, weight: 0 }, sets: [{ sec: 60, w: 0 }] }
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
        date: '2026-09-04',
        routine_id: null,
        name: 'Hotel gym',
        sets_done: 3,
        volume: 450,
        prs: ['0426']
      }
    })
    expect(typeof r.workout.id).toBe('string')

    const saved = readDiskState(dataDir)
    expect(saved._revision).toBe(8)
    expect(saved.workouts[1]).toMatchObject({
      id: r.workout.id,
      d: '2026-09-04',
      routineId: null,
      name: 'Hotel gym',
      vol: 450,
      prs: ['0426']
    })
    expect(saved.workouts[1].entries.map(e => e.id)).toEqual(['0426', '1323'])
    expect(saved.workouts[1].entries[0].sets).toEqual([
      { w: 25, r: 10, done: true },
      { w: 25, r: 8, done: true }
    ])
    expect(saved.workouts[1].entries[1].sets).toEqual([{ sec: 60, w: 0, done: true }])
    expect(saved.exWeights['0426']).toEqual({ w: 25, d: '2026-09-04' })
    expect(readAuditEvents(dataDir)).toMatchObject([{
      actor: `mcp-token:${token.id}`,
      token_id: token.id,
      action: 'log_freestyle_workout',
      details: { date: '2026-09-04', name: 'Hotel gym', workout_id: r.workout.id, sets_done: 3, volume: 450 }
    }])
  })
})
```

- [ ] **Step 4: Add omitted target normalization tests**

Add one test that covers reps, time and cardio target inference:

```js
test('normalizes omitted targets from set shape for reps time and cardio entries', () => {
  withWriteToolEnv({ scopes: ['workout:write'], state: freestyleWorkoutWriteState() }, ({ dataDir }) => {
    call('log_freestyle_workout', {
      date: '2026-09-04',
      duration_min: 30,
      entries: [
        { exercise_id: '0426', sets: [{ w: 22.5, r: 12 }, { w: 20, r: 10 }] },
        { exercise_id: '1323', sets: [{ sec: 75, w: 0 }] },
        { exercise_id: '3220', sets: [{ min: 18, speed: 9.5 }] }
      ],
      expected_revision: 7,
      dry_run: false
    })

    const entries = readDiskState(dataDir).workouts[1].entries
    expect(entries[0].target).toMatchObject({ id: '0426', mode: 'reps', sets: 2, reps: 12, weight: 22.5 })
    expect(entries[1].target).toMatchObject({ id: '1323', mode: 'time', sets: 1, sec: 75, weight: 0 })
    expect(entries[2].target).toMatchObject({ id: '3220', mode: 'cardio', sets: 1, min: 18, speed: 9.5 })
  })
})
```

Add an explicit override case:

```js
test('explicit freestyle target values override inferred set values', () => {
  withWriteToolEnv({ scopes: ['workout:write'], state: freestyleWorkoutWriteState() }, ({ dataDir }) => {
    call('log_freestyle_workout', {
      date: '2026-09-04',
      duration_min: 30,
      entries: [
        { exercise_id: '0426', target: { mode: 'reps', sets: 3, reps: 10, weight: 25 }, sets: [{ w: 25, r: 8 }] }
      ],
      expected_revision: 7,
      dry_run: false
    })

    expect(readDiskState(dataDir).workouts[1].entries[0].target).toMatchObject({ id: '0426', mode: 'reps', sets: 3, reps: 10, weight: 25 })
  })
})
```

- [ ] **Step 5: Add custom exercise test**

Add:

```js
test('accepts custom exercise ids and shows custom names in the summary', () => {
  withWriteToolEnv({ scopes: ['workout:write'], state: freestyleWorkoutWriteState() }, ({ dataDir }) => {
    const r = call('log_freestyle_workout', {
      date: '2026-09-04',
      duration_min: 20,
      entries: [{ exercise_id: 'c_ring_row', sets: [{ w: 0, r: 12 }] }],
      expected_revision: 7,
      dry_run: true
    })

    expect(r.workout.entries[0]).toMatchObject({
      id: 'c_ring_row',
      name: 'Ring row',
      mode: 'reps'
    })
    expect(readDiskState(dataDir).workouts).toHaveLength(1)
  })
})
```

- [ ] **Step 6: Add validation, conflict and auth tests**

Add tests asserting:

```js
expect(() => call('log_freestyle_workout', {
  name: '   ',
  date: '2026-09-04',
  duration_min: 20,
  entries: [{ exercise_id: '0426', sets: [{ w: 20, r: 10 }] }],
  expected_revision: 7,
  dry_run: true
})).toThrow(/name must be a non-empty string/)
```

Also assert:

- `date: '2026-02-30'` throws `/date must be a valid YYYY-MM-DD date/`;
- non-string `name` throws `/name must be a string/`;
- unknown exercise id throws `/unknown exercise id "missing-ex"/`;
- duplicate exercise entries throw `/duplicate workout entry for exercise "0426"/`;
- `target: { mode: 'time', reps: 10 }` throws `/reps is not valid for time mode/`;
- `target: { mode: 'reps', inc: 2.5 }` throws `/unsupported freestyle target field "inc"/`;
- `target: { mode: 'reps', prog: 'linear' }` throws `/unsupported freestyle target field "prog"/`;
- `target: { mode: 'reps', policy: 'linear' }` throws `/unsupported freestyle target field "policy"/`;
- cardio exercise `3220` with `target: { mode: 'reps' }` throws `/cardio exercise "3220" must use mode "cardio"/`;
- `target: { mode: 'cardio', reps: 10 }` throws `/reps is not valid for cardio mode/`;
- a reps-mode set for `1323` with `target: { mode: 'time' }` throws the existing time-set error.

Add stale revision test:

```js
test('returns conflict without writing when freestyle revision is stale', () => {
  withWriteToolEnv({ scopes: ['workout:write'], state: freestyleWorkoutWriteState() }, ({ dataDir }) => {
    const r = call('log_freestyle_workout', {
      date: '2026-09-04',
      duration_min: 20,
      entries: [{ exercise_id: '0426', sets: [{ w: 20, r: 10 }] }],
      expected_revision: 6,
      dry_run: false
    })

    expect(r).toEqual({
      ok: false,
      error: {
        code: 'STATE_CONFLICT',
        message: 'State changed since the tool read it.',
        current_revision: 7
      }
    })
    expect(readDiskState(dataDir).workouts).toHaveLength(1)
    expect(readDiskState(dataDir)._revision).toBe(7)
    expect(readAuditEvents(dataDir)).toEqual([])
  })
})
```

Add auth test:

```js
test('requires workout write scope for freestyle logging', () => {
  withWriteToolEnv({ scopes: ['routine:write'], state: freestyleWorkoutWriteState() }, () => {
    const r = call('log_freestyle_workout', {
      date: '2026-09-04',
      duration_min: 20,
      entries: [{ exercise_id: '0426', sets: [{ w: 20, r: 10 }] }],
      expected_revision: 7,
      dry_run: true
    })

    expect(r).toEqual({
      ok: false,
      error: {
        code: 'TOKEN_FORBIDDEN',
        message: 'Token missing required scope.',
        required_scope: 'workout:write'
      }
    })
  })
})
```

Add defaulting test:

```js
test('defaults freestyle name and date', () => {
  withWriteToolEnv({ scopes: ['workout:write'], state: freestyleWorkoutWriteState() }, () => {
    const r = call('log_freestyle_workout', {
      duration_min: 20,
      entries: [{ exercise_id: '0426', sets: [{ w: 20, r: 10 }] }],
      expected_revision: 7,
      dry_run: true
    })

    expect(r.workout).toMatchObject({ date: FAKE_TODAY_ISO, routine_id: null, name: 'Freestyle' })
  })
})
```

- [ ] **Step 7: Update the no-state registry smoke test**

Add the minimum schema payload to the existing `calls` object:

```js
log_freestyle_workout: {
  duration_min: 30,
  entries: [{ exercise_id: 'exercise', sets: [{ w: 10, r: 10 }] }],
  expected_revision: 0,
  dry_run: true
}
```

- [ ] **Step 8: Run tests to verify RED**

Run: `cd mcp && npm test -- tools.test.js`

Expected: FAIL because `log_freestyle_workout` is not registered yet.

## Chunk 2: Implementation

### Task 2: Implement Freestyle Workout Logging

**Files:**
- Modify: `mcp/src/tools.js`

- [ ] **Step 1: Add a reusable calendar date helper**

Add near `currentISO()`:

```js
function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(value + 'T12:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}
```

- [ ] **Step 2: Add freestyle schemas**

Add:

```js
const ISO_DATE_SCHEMA = z.string().refine(isValidISODate, 'date must be a valid YYYY-MM-DD date')
const freestyleTargetSchema = z.object({
  mode: z.enum(['reps', 'time', 'cardio']).optional(),
  sets: z.number().int().min(1).optional(),
  reps: z.number().int().min(1).optional(),
  weight: z.number().min(0).optional(),
  repsMin: z.number().int().min(1).optional(),
  repsMax: z.number().int().min(1).optional(),
  sec: z.number().int().min(1).optional(),
  min: z.number().min(1).optional(),
  speed: z.number().min(0).optional(),
  bodyweight: z.boolean().optional(),
  side: z.boolean().optional()
}).strict()
const freestyleWorkoutEntrySchema = z.object({
  exercise_id: z.string().min(1),
  target: freestyleTargetSchema.optional(),
  sets: z.array(z.union([repsWorkoutSetSchema, timeWorkoutSetSchema, cardioWorkoutSetSchema])).min(1).max(50)
}).strict()
```

Use `ISO_DATE_SCHEMA.optional()` for the new tool date. Do not change existing tool schemas in this chunk. Handler tests call tool handlers directly, so the builder must still validate dates manually.

- [ ] **Step 3: Make workout summary custom-exercise aware**

Add a resolver before `workoutSummary`:

```js
function exerciseForSummary(S, exerciseId) {
  return (S ? exerciseFromLibrary(S, exerciseId) : null) || exOr(exerciseId)
}
```

Change the function signature:

```js
function workoutSummary(workout, S = null) {
```

Inside `workoutSummary`, replace:

```js
const ex = exOr(entry.id)
```

with:

```js
const ex = exerciseForSummary(S, entry.id)
```

Update existing calls inside `logWorkout`:

```js
const summary = workoutSummary(workout, S)
```

- [ ] **Step 4: Add freestyle target normalization helpers**

Add after `normalizeWorkoutSets`:

```js
function inferFreestyleMode(S, exerciseId, target, sets) {
  if (target?.mode) return target.mode
  const ex = requireLibraryExercise(S, exerciseId)
  if (ex.bp === 'cardio') return 'cardio'
  const first = sets[0] || {}
  if (first.sec != null) return 'time'
  if (first.min != null) return 'cardio'
  return 'reps'
}

function inferredTargetFromSets(mode, sets) {
  const first = sets[0] || {}
  if (mode === 'cardio') return { mode: 'cardio', sets: sets.length, min: first.min, speed: first.speed || 0 }
  if (mode === 'time') return { sets: sets.length, sec: first.sec, weight: first.w || 0 }
  return { sets: sets.length, reps: first.r, weight: first.w || 0 }
}

const FREESTYLE_NUMERIC_TARGET_FIELDS = new Set(['sets', 'reps', 'weight', 'repsMin', 'repsMax', 'sec', 'min', 'speed'])

function validateFreestyleTargetValues(target = {}) {
  for (const [field, value] of Object.entries(target)) {
    if (FREESTYLE_NUMERIC_TARGET_FIELDS.has(field)) {
      validateTargetField(field, value)
      continue
    }
    if (field === 'mode') {
      if (!['reps', 'time', 'cardio'].includes(value)) fail('EINVAL', `unknown exercise mode ${JSON.stringify(value)}`)
      continue
    }
    if (field === 'bodyweight' || field === 'side') {
      if (typeof value !== 'boolean') fail('EINVAL', `${field} must be a boolean`)
      continue
    }
    fail('EINVAL', `unsupported freestyle target field ${JSON.stringify(field)}`)
  }
}

function validateFreestyleTargetForMode(mode, target = {}) {
  const allowed = {
    reps: new Set(['mode', 'sets', 'reps', 'repsMin', 'repsMax', 'weight', 'bodyweight', 'side']),
    time: new Set(['mode', 'sets', 'sec', 'weight', 'bodyweight', 'side']),
    cardio: new Set(['mode', 'sets', 'min', 'speed'])
  }[mode]
  for (const field of Object.keys(target)) {
    if (!allowed.has(field)) fail('EINVAL', `${field} is not valid for ${mode} mode`)
  }
  if (target.repsMin != null && target.repsMax != null && target.repsMax < target.repsMin) {
    fail('EINVAL', 'repsMax must be >= repsMin')
  }
}

function normalizeFreestyleTarget(S, exerciseId, target = {}, sets) {
  const ex = requireLibraryExercise(S, exerciseId)
  const mode = inferFreestyleMode(S, exerciseId, target, sets)
  if (ex.bp === 'cardio' && mode !== 'cardio') fail('EINVAL', `cardio exercise ${JSON.stringify(exerciseId)} must use mode "cardio"`)
  validateFreestyleTargetValues(target)
  validateFreestyleTargetForMode(mode, target)
  const normalized = {
    id: exerciseId,
    ...defaultConfig(exerciseId, mode),
    ...inferredTargetFromSets(mode, sets),
    ...target
  }
  return { ...normalized, mode }
}
```

- [ ] **Step 5: Add freestyle workout builder**

Add after `buildLoggedWorkout`:

```js
function normalizeFreestyleWorkoutName(name) {
  if (name == null) return 'Freestyle'
  if (typeof name !== 'string') fail('EINVAL', 'name must be a string')
  const trimmed = name.trim()
  if (!trimmed) fail('EINVAL', 'name must be a non-empty string')
  return trimmed.slice(0, 120)
}

function validateFreestyleWorkoutInput(S, durationMin, entries) {
  const duration = requireInteger(durationMin, 'duration_min must be an integer between 1 and 1440')
  if (duration < 1 || duration > 1440) fail('EINVAL', 'duration_min must be an integer between 1 and 1440')
  if (!Array.isArray(entries) || !entries.length) fail('EINVAL', 'log_freestyle_workout needs at least one entry')
  if (entries.length > 50) fail('EINVAL', 'log_freestyle_workout accepts at most 50 entries')

  const seen = new Set()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') fail('EINVAL', 'workout entry must be an object')
    if (!entry.exercise_id) fail('EINVAL', 'workout entry needs exercise_id')
    if (seen.has(entry.exercise_id)) fail('EINVAL', `duplicate workout entry for exercise ${JSON.stringify(entry.exercise_id)}`)
    seen.add(entry.exercise_id)
    requireLibraryExercise(S, entry.exercise_id)
    const target = normalizeFreestyleTarget(S, entry.exercise_id, entry.target || {}, entry.sets)
    normalizeWorkoutSets(entry.exercise_id, target, entry.sets)
  }
  return duration
}

function buildFreestyleWorkout(S, { name, date, duration_min, bodyweight, entries }) {
  if (!isValidISODate(date)) fail('EINVAL', 'date must be a valid YYYY-MM-DD date')
  const duration = validateFreestyleWorkoutInput(S, duration_min, entries)
  const start = workoutTimestamp(date)
  const workoutEntries = entries.map(entry => {
    const target = normalizeFreestyleTarget(S, entry.exercise_id, entry.target || {}, entry.sets)
    const sets = normalizeWorkoutSets(entry.exercise_id, target, entry.sets)
    const result = { id: entry.exercise_id, sets, topW: null, target }
    const topW = topWeightForEntry(result)
    if (topW > 0) result.topW = topW
    return result
  })

  const prs = workoutEntries
    .filter(entry => topWeightForEntry(entry) > bestWeightFor({ ...S, workouts: S.workouts || [] }, entry.id))
    .map(entry => entry.id)

  const workout = {
    id: makeWorkoutId(),
    d: date,
    start,
    end: start + duration * 60000,
    routineId: null,
    name: normalizeFreestyleWorkoutName(name),
    bw: normalizeWorkoutBodyweight(bodyweight),
    entries: workoutEntries,
    prs
  }
  workout.vol = workoutVolume(workout)
  return workout
}
```

- [ ] **Step 6: Add and register the tool**

Add after `logWorkout`:

```js
export const logFreestyleWorkout = {
  name: 'log_freestyle_workout',
  description: 'Log a completed freestyle workout from structured JSON. Requires OPENGYM_MCP_TOKEN with workout:write. Use dry_run=true first to preview before committing.',
  schema: {
    name: z.string().optional().describe('Optional workout name. Trimmed, defaults to Freestyle, capped at 120 characters.'),
    date: ISO_DATE_SCHEMA.optional().describe('Workout date as YYYY-MM-DD. Defaults to today.'),
    duration_min: z.number().int().min(1).max(1440).describe('Completed workout duration in minutes.'),
    bodyweight: z.number().positive().optional().describe('Optional body weight at workout time, in the profile unit. Rounded to one decimal.'),
    entries: z.array(freestyleWorkoutEntrySchema).min(1).max(50).describe('Completed freestyle entries keyed by catalog or custom exercise ids.'),
    expected_revision: z.number().int().min(0).describe('State _revision observed before proposing the write. Prevents lost updates.'),
    dry_run: z.boolean().optional().describe('When true, preview the finished workout without writing. Defaults to true.')
  },
  handler: ({ name, date = currentISO(), duration_min, bodyweight, entries, expected_revision, dry_run = true }) => {
    const auth = verifyMcpWriteToken({ requiredScope: 'workout:write' })
    if (!auth.ok) return auth

    const dataDir = process.env.OPENGYM_DATA
    const states = writeStateServices(dataDir)
    const S = states.readUserState(auth.token.uid)
    if (!S) return noState()

    const workout = buildFreestyleWorkout(S, { name, date, duration_min, bodyweight, entries })
    const changes = loggedWorkoutChanges(S, workout)
    const revision = revisionOf(S)
    const unit = S.unit || 'kg'
    const summary = workoutSummary(workout, S)

    if (dry_run) {
      return { ok: true, dry_run: true, would_change: true, revision, unit, workout: summary, changes }
    }

    const result = states.updateUserState(auth.token.uid, current => {
      return applyLoggedWorkout(current, workout)
    }, {
      actor: `mcp-token:${auth.token.id}`,
      tokenId: auth.token.id,
      operation: 'log_freestyle_workout',
      expectedRevision: expected_revision,
      details: {
        date,
        name: workout.name,
        workout_id: workout.id,
        sets_done: summary.sets_done,
        volume: summary.volume
      }
    })
    if (!result.ok) return result

    return { ok: true, dry_run: false, changed: true, revision_before: revision, revision_after: result.revision, unit, workout: summary, changes }
  }
}
```

Add `logFreestyleWorkout` to the exported `TOOLS` array.

- [ ] **Step 7: Run targeted MCP tests**

Run: `cd mcp && npm test -- tools.test.js`

Expected: PASS.

## Chunk 3: Docs, Verification And Commit

### Task 3: Document, Verify And Commit

**Files:**
- Modify: `mcp/README.md`
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `docs/superpowers/plans/2026-09-04-log-freestyle-workout-mcp.md`

- [ ] **Step 1: Update MCP README tool docs**

In `mcp/README.md`, change the introductory write-tool count text from:

```text
Twelve read-only tools and six scoped write tools in this fork:
```

to:

```text
Twelve read-only tools and seven scoped write tools in this fork:
```

In the Phase 2 note near the top, change the shipped write-tool list from:

```text
structured `log_workout` and `create_custom_exercise`.
```

to:

```text
structured `log_workout`, `log_freestyle_workout` and `create_custom_exercise`.
```

Add this tool-table row after `log_workout`:

```md
| `log_freestyle_workout` | Log a completed freestyle workout from structured JSON. Requires `workout:write`, `dry_run`, and `expected_revision`; entries may use catalog or custom exercise ids. |
```

In the roadmap paragraph, change:

```text
Remaining tools: freestyle workout logging.
```

to:

```text
Remaining work: deeper shared workout/set validation.
```

- [ ] **Step 2: Update architecture docs**

In `docs/MCP_WRITE_ARCHITECTURE.md`, update the status list:

```md
- Done: `log_freestyle_workout` stores a completed freestyle workout with `routineId: null`, catalog/custom exercise ids, per-entry targets, `workout:write`, dry-run, revision checks and audit-backed commits.
- Not done: deeper shared workout/set validation.
```

Update the scope table line to:

```text
workout:write    log_workout, log_freestyle_workout
```

Add this paragraph after the existing `log_workout` contract paragraph:

```md
`log_freestyle_workout` writes a finished workout that is not tied to a routine. It stores `routineId: null`, defaults the name to `Freestyle`, preserves input entry order, accepts catalog or `customEx` exercise ids, normalizes per-entry targets from submitted sets plus explicit target overrides, forces supplied sets to `done: true`, computes `vol`, `prs` and `exWeights`, and records compact audit details without logging full set payloads.
```

In the recommendation list, replace:

```text
future: freestyle workout logging
```

with:

```text
log_freestyle_workout
future: deeper shared workout/set validation
```

- [ ] **Step 3: Update Czech MCP docs**

In `docs/openGym_AI_Coach_MCP_dokumentace.md`, change the `log_workout` limitation sentence to:

```md
Neumí freestyle workout, fuzzy matching názvů cviků, přidání nového cviku ani editaci už existujícího workoutu; freestyle zápis řeší samostatný `log_freestyle_workout`.
```

Add this section after `## 11.5 log_workout` and before `## 11.6 add_bodyweight`; if the document already has numbered headings after that point, increment only the local new heading to `## 11.5.1` to avoid a broad renumbering:

````md
## 11.5.1 `log_freestyle_workout`

Slouží pro zápis hotového freestyle workoutu, který není navázaný na existující rutinu.

MCP payload je pořád strukturovaný. LLM musí dodat konkrétní `exercise_id`; pokud cvik neexistuje, nejdřív se vytvoří přes `create_custom_exercise`.

```json
{
  "name": "Hotel gym",
  "date": "2026-09-04",
  "duration_min": 45,
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

Tool ukládá `routineId: null`, defaultní název `Freestyle`, zachová pořadí cviků z payloadu, přijímá katalogové i `customEx` cviky, normalizuje `target` pro každý cvik, sety ukládá jako `done: true`, spočítá `vol`, `prs`, `exWeights` a používá stejný `workout:write`, dry-run, revision check a audit model jako `log_workout`.

Neřeší fuzzy matching názvů, nevytváří cviky a needituje existující workouty.
````

Update Phase 2 status bullet to include:

```md
- hotovo: `log_freestyle_workout` pro zapsání hotového freestyle workoutu se `workout:write`, dry-run, revision checkem a audit commitem,
```

Change the remaining status line to:

```md
- zbývá: hlubší sdílená validace workout setů.
```

Update the summary sentence from six to seven scoped write tools and include `log_freestyle_workout`.

- [ ] **Step 4: Mark checklist progress**

Change completed plan items from `- [ ]` to `- [x]` as they are completed.

- [ ] **Step 5: Run MCP suite**

Run: `cd mcp && npm test`

Expected: PASS.

- [ ] **Step 6: Run MCP loadability check**

Run: `cd mcp && npm run check:node-loadable`

Expected: PASS.

- [ ] **Step 7: Run API suite**

Run: `cd api && npm test`

Expected: PASS.

- [ ] **Step 8: Finalize README test counts**

After the final `cd mcp && npm test` output is known, update `mcp/README.md` test count text from the current values to the observed values. If `tools.test.js` reports 104 tests and total MCP reports 108 tests, write those exact numbers; otherwise use the actual observed output.

- [ ] **Step 9: Check whitespace**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 10: Check intended files before commit**

Run: `git status --short`

Expected: only these files are modified:

```text
docs/MCP_WRITE_ARCHITECTURE.md
docs/openGym_AI_Coach_MCP_dokumentace.md
docs/superpowers/plans/2026-09-04-log-freestyle-workout-mcp.md
mcp/README.md
mcp/src/tools.js
mcp/test/tools.test.js
```

- [ ] **Step 11: Commit**

```bash
git add mcp/src/tools.js mcp/test/tools.test.js mcp/README.md docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-09-04-log-freestyle-workout-mcp.md
git commit -m "feat: add freestyle workout mcp tool"
```

- [ ] **Step 12: Report final state**

Report:

- commit hash;
- tests run;
- remaining MCP roadmap item: deeper shared workout/set validation, plus later remote MCP.
