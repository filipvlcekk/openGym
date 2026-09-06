# Workout And Set State Validation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deeper shared validation for persisted workout, set, target and `exWeights` state while preserving legacy/imported workout compatibility.

**Architecture:** Keep validation centralized in `api/state-validation.js`, which is already called by `api/state-service.js` before state writes and audit events. Add conservative guardrails that validate present fields and reject corrupt types/numbers, but do not require historical workouts to match the latest MCP write schemas or current exercise/routine catalog. Preserve strict MCP payload validation separately at the tool edge.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, existing `api/state-service.js`, existing `api/state-validation.js`, existing MCP/API test commands.

---

## Source Spec

- `docs/superpowers/specs/2026-09-06-workout-set-validation-design.md`

Key rule: this is a conservative state guardrail, not a migration and not a complete workout schema.

## File Structure

- Modify `api/test/state-service.test.js`: add RED tests through the real shared write boundary.
- Modify `api/state-validation.js`: add workout, entry, set, target and `exWeights` validation helpers.
- Modify `docs/MCP_WRITE_ARCHITECTURE.md`: mark deeper shared workout/set validation done and describe the conservative boundary.
- Modify `docs/openGym_AI_Coach_MCP_dokumentace.md`: update Czech Phase 2 roadmap/status.
- Modify `docs/superpowers/plans/2026-09-06-workout-set-validation.md`: mark checklist progress.
- Do not modify MCP write tool payload validation unless a failing test proves the shared validator broke a commit path.

## Chunk 1: API Contract Tests

### Task 1: Add Failing State-Service Tests For Deeper Workout Validation

**Files:**
- Modify: `api/test/state-service.test.js`

- [x] **Step 1: Add local test helpers**

Add after `readStored()`:

```js
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function issueText(result) {
  return result.error.issues.map(i => `${i.path}: ${i.message}`).join('\n');
}
```

- [x] **Step 2: Add a passing compatibility fixture test**

Add after `replaceUserState accepts a valid minimal openGym state shape`:

```js
test('replaceUserState accepts conservative legacy imported and freestyle workout shapes', () => {
  withTempStateService(states => {
    const input = validState();
    input.exWeights = {
      'deleted-ex': { w: 0, d: '2026-08-29' },
      '0426': { w: 25 }
    };
    input.workouts = [
      {
        id: 'legacy',
        d: '2026-08-29',
        routineId: 'deleted-routine',
        name: 'Deleted Routine',
        start: 1788000000000,
        end: 1788003600000,
        bw: null,
        vol: 0,
        prs: ['deleted-ex'],
        entries: [{
          id: 'deleted-ex',
          topW: null,
          sets: [
            { w: 0, r: 0, done: true, rir: 0 },
            { min: 0, speed: 0, done: false, rpe: 0 }
          ]
        }]
      },
      {
        id: 'freestyle',
        d: '2026-09-04',
        routineId: null,
        name: 'Freestyle',
        start: 1788544800000,
        end: 1788547500000,
        bw: 78.4,
        vol: 450,
        prs: ['0426'],
        entries: [{
          id: 'c_ring_row',
          topW: 25,
          target: {
            id: 'c_ring_row',
            mode: 'reps',
            sets: 0,
            reps: 0,
            weight: 0,
            repsMin: 0,
            repsMax: 0,
            sec: 0,
            min: 0,
            speed: 0,
            inc: 0,
            bodyweight: true,
            side: false,
            prog: 'off',
            policy: 'linear',
            sg: 'A'
          },
          sets: [{ w: 25, r: 8, done: true }]
        }]
      }
    ];

    const result = states.replaceUserState('u1', input);

    assert.equal(result.ok, true);
    const stored = readStored(states, 'u1');
    assert.equal(stored.workouts.length, 2);
    assert.equal(stored.workouts[1].routineId, null);
    assert.deepEqual(stored.exWeights['deleted-ex'], { w: 0, d: '2026-08-29' });
  });
});
```

This test must pass both before and after implementation. It pins the compatibility boundary.

- [x] **Step 3: Add invalid workout metadata test**

Add:

```js
test('replaceUserState rejects invalid workout metadata without writing', () => {
  withTempStateService(states => {
    const input = validState();
    input.workouts = [{
      id: '',
      d: '2026-02-30',
      routineId: 42,
      name: 42,
      start: 20,
      end: 10,
      bw: -1,
      vol: -1,
      prs: ['ok', 42],
      entries: []
    }];

    const result = states.replaceUserState('u1', input);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STATE_VALIDATION_FAILED');
    const text = issueText(result);
    assert.match(text, /workouts\.0\.id: must be a non-empty string/);
    assert.match(text, /workouts\.0\.d: must be YYYY-MM-DD/);
    assert.match(text, /workouts\.0\.routineId: must be null or a non-empty string/);
    assert.match(text, /workouts\.0\.name: must be a string/);
    assert.match(text, /workouts\.0\.end: must be >= start/);
    assert.match(text, /workouts\.0\.bw: must be a positive finite number/);
    assert.match(text, /workouts\.0\.vol: must be a finite number >= 0/);
    assert.match(text, /workouts\.0\.prs\.1: must be a string/);
    assert.equal(fs.existsSync(states.stateFile('u1')), false);
  });
});
```

- [x] **Step 4: Add invalid entry and set test**

Add:

```js
test('updateUserState rejects invalid workout entries and sets without changing state or audit', () => {
  withTempStateService((states, audit) => {
    const uid = 'u1';
    const original = { ...validState(), _revision: 4 };
    fs.writeFileSync(states.stateFile(uid), JSON.stringify(original));

    const result = states.updateUserState(uid, current => {
      current.workouts.push({
        id: 'bad-entry-set',
        d: '2026-09-05',
        entries: [
          'not-an-entry',
          {
            id: '',
            topW: -1,
            sets: [
              'not-a-set',
              { done: 'yes', w: -1, r: -1, sec: -1, min: -1, speed: -1, rir: 11, rpe: 11 }
            ]
          }
        ]
      });
      return current;
    }, {
      actor: 'mcp-token:tok_1',
      operation: 'unit-test',
      expectedRevision: 4
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STATE_VALIDATION_FAILED');
    const text = issueText(result);
    assert.match(text, /workouts\.1\.entries\.0: must be an object/);
    assert.match(text, /workouts\.1\.entries\.1\.id: must be a non-empty string/);
    assert.match(text, /workouts\.1\.entries\.1\.topW: must be a finite number >= 0/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.0: must be an object/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.done: must be a boolean/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.w: must be a finite number >= 0/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.r: must be a finite number >= 0/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.sec: must be a finite number >= 0/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.min: must be a finite number >= 0/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.speed: must be a finite number >= 0/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.rir: must be a finite number 0..10/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.rpe: must be a finite number 0..10/);
    assert.deepEqual(readStored(states, uid), original);
    assert.deepEqual(audit.readAuditEvents(), []);
  }, { audit: true });
});
```

- [x] **Step 5: Add invalid target metadata test**

Add:

```js
test('replaceUserState rejects invalid workout target metadata without writing', () => {
  withTempStateService(states => {
    const input = validState();
    input.workouts = [{
      id: 'bad-target',
      d: '2026-09-05',
      entries: [{
        id: '0426',
        target: {
          id: '',
          mode: 'distance',
          sets: -1,
          reps: -1,
          weight: -1,
          repsMin: 5,
          repsMax: 4,
          sec: -1,
          min: -1,
          speed: -1,
          inc: -1,
          bodyweight: 'yes',
          side: 'no',
          prog: 42,
          policy: 42,
          sg: ''
        },
        sets: []
      }]
    }];

    const result = states.replaceUserState('u1', input);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STATE_VALIDATION_FAILED');
    const text = issueText(result);
    assert.match(text, /workouts\.0\.entries\.0\.target\.id: must be a non-empty string/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.mode: must be reps, time or cardio/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.sets: must be a finite number >= 0/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.repsMax: must be >= repsMin/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.bodyweight: must be a boolean/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.side: must be a boolean/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.prog: must be a string/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.policy: must be a string/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.sg: must be a non-empty string/);
    assert.equal(fs.existsSync(states.stateFile('u1')), false);
  });
});
```

The exact implementation may emit more numeric target issues than asserted here. Keep assertions focused on representative fields plus `repsMax >= repsMin`.

- [x] **Step 6: Add invalid `exWeights` shape test**

Add:

```js
test('updateUserState rejects invalid exWeights shape without changing state', () => {
  withTempStateService(states => {
    const uid = 'u1';
    const original = { ...validState(), _revision: 2 };
    fs.writeFileSync(states.stateFile(uid), JSON.stringify(original));

    const result = states.updateUserState(uid, current => {
      current.exWeights = {
        good: { w: 20, d: '2026-08-29' },
        bad_record: 'not-an-object',
        bad_weight: { w: -1 },
        bad_date: { w: 10, d: 'tomorrow' }
      };
      return current;
    }, {
      operation: 'unit-test',
      expectedRevision: 2
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STATE_VALIDATION_FAILED');
    const text = issueText(result);
    assert.match(text, /exWeights\.bad_record: must be an object/);
    assert.match(text, /exWeights\.bad_weight\.w: must be a finite number >= 0/);
    assert.match(text, /exWeights\.bad_date\.d: must be YYYY-MM-DD/);
    assert.deepEqual(readStored(states, uid), original);
  });
});
```

- [x] **Step 7: Strengthen active stripping test**

Modify `replaceUserState writes a sanitized full state and returns the sync timestamp` so `active` contains invalid workout-like data that would fail if it were not stripped:

```js
active: {
  startedAt: 123,
  localOnly: true,
  workouts: [{ id: '', entries: ['bad'] }]
},
```

Keep the existing assertion that stored state has no `active` key.

- [x] **Step 8: Run API tests to verify RED**

Run:

```bash
cd api && npm test
```

Expected:

- new compatibility test passes;
- active stripping test passes;
- invalid metadata/entry/set/target/`exWeights` tests fail because `api/state-validation.js` is still too shallow.

- [x] **Step 9: Commit RED tests**

```bash
git add api/test/state-service.test.js
git commit -m "test: add workout set state validation contract"
```

## Chunk 2: Shared Validator Implementation

### Task 2: Implement Conservative Workout, Set, Target And ExWeights Validation

**Files:**
- Modify: `api/state-validation.js`

- [x] **Step 1: Add primitive validation helpers**

Add after `addIssue()`:

```js
function isNonEmptyString(value) {
  return typeof value === 'string' && !!value.trim();
}

function validateOptionalString(value, issues, path) {
  if (value !== undefined && typeof value !== 'string') {
    addIssue(issues, path, 'must be a string');
  }
}

function validateOptionalNonEmptyString(value, issues, path) {
  if (value !== undefined && !isNonEmptyString(value)) {
    addIssue(issues, path, 'must be a non-empty string');
  }
}

function validateOptionalFiniteNumber(value, issues, path, message = 'must be a finite number') {
  if (value !== undefined && !isFiniteNumber(value)) {
    addIssue(issues, path, message);
    return false;
  }
  return value === undefined || isFiniteNumber(value);
}

function validateOptionalNonNegativeNumber(value, issues, path) {
  if (value === undefined) return false;
  if (!isFiniteNumber(value) || value < 0) {
    addIssue(issues, path, 'must be a finite number >= 0');
    return false;
  }
  return true;
}

function validateOptionalPositiveNumber(value, issues, path) {
  if (value === undefined || value === null) return false;
  if (!isFiniteNumber(value) || value <= 0) {
    addIssue(issues, path, 'must be a positive finite number');
    return false;
  }
  return true;
}

function validateOptionalRangeNumber(value, issues, path, min, max) {
  if (value === undefined) return false;
  if (!isFiniteNumber(value) || value < min || value > max) {
    addIssue(issues, path, `must be a finite number ${min}..${max}`);
    return false;
  }
  return true;
}
```

If a helper would duplicate existing bodyweight logic poorly, keep the implementation simple and local. Do not import frontend/MCP helpers.

- [x] **Step 2: Add target validation helpers**

Add before `validateWorkouts()`:

```js
const TARGET_NON_NEGATIVE_NUMBER_FIELDS = [
  'sets', 'reps', 'weight', 'repsMin', 'repsMax', 'sec', 'min', 'speed', 'inc'
];

function validateWorkoutTarget(target, issues, path) {
  if (target === undefined) return;
  if (!isObject(target)) {
    addIssue(issues, path, 'must be an object');
    return;
  }

  validateOptionalNonEmptyString(target.id, issues, `${path}.id`);

  if (target.mode !== undefined && !['reps', 'time', 'cardio'].includes(target.mode)) {
    addIssue(issues, `${path}.mode`, 'must be reps, time or cardio');
  }

  for (const field of TARGET_NON_NEGATIVE_NUMBER_FIELDS) {
    validateOptionalNonNegativeNumber(target[field], issues, `${path}.${field}`);
  }

  if (
    isFiniteNumber(target.repsMin) &&
    isFiniteNumber(target.repsMax) &&
    target.repsMax < target.repsMin
  ) {
    addIssue(issues, `${path}.repsMax`, 'must be >= repsMin');
  }

  if (target.bodyweight !== undefined && typeof target.bodyweight !== 'boolean') {
    addIssue(issues, `${path}.bodyweight`, 'must be a boolean');
  }
  if (target.side !== undefined && typeof target.side !== 'boolean') {
    addIssue(issues, `${path}.side`, 'must be a boolean');
  }
  validateOptionalString(target.prog, issues, `${path}.prog`);
  validateOptionalString(target.policy, issues, `${path}.policy`);
  validateOptionalNonEmptyString(target.sg, issues, `${path}.sg`);
}
```

Do not reject unknown target keys.

- [x] **Step 3: Add set validation helpers**

Add before `validateWorkoutEntry()`:

```js
const SET_NON_NEGATIVE_NUMBER_FIELDS = ['w', 'r', 'sec', 'min', 'speed'];

function validateWorkoutSet(set, issues, path) {
  if (!isObject(set)) {
    addIssue(issues, path, 'must be an object');
    return;
  }

  if (set.done !== undefined && typeof set.done !== 'boolean') {
    addIssue(issues, `${path}.done`, 'must be a boolean');
  }

  for (const field of SET_NON_NEGATIVE_NUMBER_FIELDS) {
    validateOptionalNonNegativeNumber(set[field], issues, `${path}.${field}`);
  }

  validateOptionalRangeNumber(set.rir, issues, `${path}.rir`, 0, 10);
  validateOptionalRangeNumber(set.rpe, issues, `${path}.rpe`, 0, 10);
}
```

Do not require any one mode-specific field to be present.

- [x] **Step 4: Add entry validation helper**

Add before `validateWorkouts()`:

```js
function validateWorkoutEntry(entry, issues, path) {
  if (!isObject(entry)) {
    addIssue(issues, path, 'must be an object');
    return;
  }

  validateOptionalNonEmptyString(entry.id, issues, `${path}.id`);

  if (entry.topW !== undefined && entry.topW !== null) {
    validateOptionalNonNegativeNumber(entry.topW, issues, `${path}.topW`);
  }

  validateWorkoutTarget(entry.target, issues, `${path}.target`);

  if (entry.sets !== undefined) {
    if (!Array.isArray(entry.sets)) {
      addIssue(issues, `${path}.sets`, 'must be an array');
    } else {
      entry.sets.forEach((set, index) => {
        validateWorkoutSet(set, issues, `${path}.sets.${index}`);
      });
    }
  }
}
```

- [x] **Step 5: Expand `validateWorkouts()`**

Replace the current per-workout body inside `validateWorkouts()` with:

```js
    validateOptionalNonEmptyString(workout.id, issues, `${path}.id`);

    if (workout.d !== undefined && !validISODate(workout.d)) {
      addIssue(issues, `${path}.d`, 'must be YYYY-MM-DD');
    }

    if (
      workout.routineId !== undefined &&
      workout.routineId !== null &&
      !isNonEmptyString(workout.routineId)
    ) {
      addIssue(issues, `${path}.routineId`, 'must be null or a non-empty string');
    }

    validateOptionalString(workout.name, issues, `${path}.name`);

    const hasStart = validateOptionalFiniteNumber(workout.start, issues, `${path}.start`);
    const hasEnd = validateOptionalFiniteNumber(workout.end, issues, `${path}.end`);
    if (hasStart && hasEnd && workout.start !== undefined && workout.end !== undefined && workout.end < workout.start) {
      addIssue(issues, `${path}.end`, 'must be >= start');
    }

    validateOptionalPositiveNumber(workout.bw, issues, `${path}.bw`);

    if (workout.vol !== undefined) {
      validateOptionalNonNegativeNumber(workout.vol, issues, `${path}.vol`);
    }

    if (workout.prs !== undefined) {
      if (!Array.isArray(workout.prs)) {
        addIssue(issues, `${path}.prs`, 'must be an array');
      } else {
        workout.prs.forEach((id, prIndex) => {
          if (typeof id !== 'string') addIssue(issues, `${path}.prs.${prIndex}`, 'must be a string');
        });
      }
    }

    if (workout.entries !== undefined) {
      if (!Array.isArray(workout.entries)) {
        addIssue(issues, `${path}.entries`, 'must be an array');
      } else {
        workout.entries.forEach((entry, entryIndex) => {
          validateWorkoutEntry(entry, issues, `${path}.entries.${entryIndex}`);
        });
      }
    }
```

Keep the existing early return when a workout itself is not an object.

- [x] **Step 6: Add `exWeights` validation**

Add before `export function validateState`:

```js
function validateExWeights(state, issues) {
  const exWeights = state.exWeights;
  if (exWeights === undefined) return;
  if (!isObject(exWeights)) {
    addIssue(issues, 'exWeights', 'must be an object');
    return;
  }

  for (const [exerciseId, record] of Object.entries(exWeights)) {
    const path = `exWeights.${exerciseId}`;
    if (!isObject(record)) {
      addIssue(issues, path, 'must be an object');
      continue;
    }
    validateOptionalNonNegativeNumber(record.w, issues, `${path}.w`);
    if (record.d !== undefined && !validISODate(record.d)) {
      addIssue(issues, `${path}.d`, 'must be YYYY-MM-DD');
    }
  }
}
```

Then call it in `validateState()` after `validateBodyweight(state, issues);` and before `validateWorkouts(state, issues);`:

```js
validateExWeights(state, issues);
```

- [x] **Step 7: Run API tests**

Run:

```bash
cd api && npm test
```

Expected: all API tests pass.

- [x] **Step 8: Run MCP tests**

Run:

```bash
cd mcp && npm test
```

Expected: all MCP tests pass. This proves `log_workout`, `log_freestyle_workout`, `add_bodyweight`, `edit_routine` and token flows still commit through the stricter shared validator.

- [x] **Step 9: Run MCP loadability check**

Run:

```bash
cd mcp && npm run check:node-loadable
```

Expected: pass.

- [x] **Step 10: Commit implementation**

```bash
git add api/state-validation.js
git commit -m "feat: validate workout state shape"
```

## Chunk 3: Documentation, Final Verification And Merge Prep

### Task 3: Document Deeper Shared Validation And Finalize

**Files:**
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `docs/superpowers/plans/2026-09-06-workout-set-validation.md`
- Optional modify: `mcp/README.md` only if test counts or roadmap text become stale.

- [ ] **Step 1: Update architecture validation section**

In `docs/MCP_WRITE_ARCHITECTURE.md`, update the validation section from:

```md
- `workouts` is an array with basic date and entries-array shape;
- no `active` workout is persisted from write tools.

Deeper set-level workout validation is intentionally future work so existing imported history is not rejected prematurely.
```

to:

```md
- `workouts` is an array with conservative present-field checks for workout metadata, entries, sets and targets;
- set numbers such as `w`, `r`, `sec`, `min`, `speed`, `rir` and `rpe` must be finite and within safe non-negative bounds;
- `exWeights`, when present, has a guarded `{ exerciseId: { w, d } }` shape;
- no `active` workout is persisted from write tools.

This remains a compatibility guardrail, not a strict migration. Shared validation still allows historical workouts without targets, deleted exercise ids, deleted routine ids and imported zero-valued sets.
```

Also update implementation status:

```md
- Done: deeper shared workout/set validation guards persisted workout metadata, entries, sets, targets and `exWeights` without requiring a strict historical migration.
```

Remove any line that says deeper shared workout/set validation is still not done.

- [ ] **Step 2: Update Czech roadmap docs**

In `docs/openGym_AI_Coach_MCP_dokumentace.md`, update the Phase 2 status so it includes:

```md
- hotovo: hlubší sdílená validace workout/set dat pro metadata workoutů, entries, sety, targety a `exWeights`, bez striktní migrace historických dat,
```

Change the remaining status line from:

```md
- zbývá: hlubší sdílená validace workout setů.
```

to either remove it or replace it with:

```md
- zbývá: žádný další stdio write tool v aktuální Phase 2 roadmapě; další větší etapa je remote HTTP MCP.
```

Keep wording factual and avoid claiming that all possible validation/migration work is complete.

- [ ] **Step 3: Update README roadmap only if needed**

Check `mcp/README.md`.

If it still says:

```md
Remaining work: deeper shared workout/set validation.
```

replace it with:

```md
The current stdio Phase 2 write-tool roadmap is implemented; future hardening can add optional migration/audit tooling.
```

Do not change MCP test counts unless the MCP suite output changed.

- [ ] **Step 4: Mark checklist progress**

Update this plan file as steps are completed. Do not mark verification steps complete until the exact command has been run.

- [ ] **Step 5: Run full API suite**

Run:

```bash
cd api && npm test
```

Expected: pass.

- [ ] **Step 6: Run full MCP suite**

Run:

```bash
cd mcp && npm test
```

Expected: pass.

- [ ] **Step 7: Run MCP loadability check**

Run:

```bash
cd mcp && npm run check:node-loadable
```

Expected: pass.

- [ ] **Step 8: Check whitespace and intended files**

Run:

```bash
git diff --check
git status --short
```

Expected: only intended files are modified.

- [ ] **Step 9: Commit docs and checklist**

```bash
git add docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-09-06-workout-set-validation.md
git add mcp/README.md
git commit -m "docs: document workout state validation"
```

If `mcp/README.md` was not changed, omit it from `git add`.

- [ ] **Step 10: Final review**

Dispatch a final code-review subagent for the full branch diff. It should verify:

- shared validator matches the design spec;
- compatibility tests are meaningful;
- no strict migration slipped in;
- API and MCP tests pass;
- docs no longer list deeper workout/set validation as remaining Phase 2 work.

- [ ] **Step 11: Report final state**

Report:

- final commit hash;
- tests run;
- whether the branch is ready to merge locally or already merged, depending on the workflow selected during execution.
