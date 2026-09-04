# Create Custom Exercise MCP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe MCP write tool that creates one custom exercise in `S.customEx`.

**Architecture:** Add a standalone `create_custom_exercise` tool beside the existing Phase 2 write tools in `mcp/src/tools.js`. The tool validates and normalizes one custom exercise payload, writes through `api/state-service.js`, and uses the same dry-run, expected revision and audit behavior as the other MCP writes.

**Tech Stack:** Node.js ESM, Zod, Vitest, existing frontend catalogue helpers `EXDB` and `BODYPARTS`, existing MCP token/auth/write-state services.

---

## File Structure

- Modify `mcp/src/tools.js`: add schema, helper functions, exported tool and registry entry.
- Modify `mcp/test/tools.test.js`: add contract tests and registry/no-state sample.
- Modify `api/token-service.js`: allow the new `exercise:write` token scope.
- Modify `api/test/token-service.test.js`: pin `exercise:write` as a known scope.
- Modify `api/test/mcp-token-routes.test.js`: pin HTTP token creation with `exercise:write`.
- Modify `mcp/README.md`: document the new write tool, scope and Phase 2.5 status.
- Modify `docs/MCP_WRITE_ARCHITECTURE.md`: update implementation status and recommendation list.
- Modify `docs/openGym_AI_Coach_MCP_dokumentace.md`: update Czech tool/status docs.
- Modify `docs/superpowers/plans/2026-09-04-create-custom-exercise-mcp.md`: mark checklist items as completed while executing.

## Chunk 1: Contract Tests

### Task 1: Add Failing Tests For `create_custom_exercise`

**Files:**
- Modify: `mcp/test/tools.test.js`

- [x] **Step 1: Import built-in body parts**

Change the existing import:

```js
import { EXDB } from '../../frontend/src/lib/exercises.js'
```

to:

```js
import { BODYPARTS, EXDB } from '../../frontend/src/lib/exercises.js'
```

- [x] **Step 2: Add a custom exercise fixture**

Add after `routineEditState()`:

```js
function customExerciseWriteState() {
  return {
    ...writeToolState(),
    customEx: [
      { id: 'c_existing', n: 'Ring row', bp: 'back', desc: 'Existing custom movement.', tg: '', eq: 'custom', custom: true }
    ]
  }
}
```

- [x] **Step 3: Add dry-run preview test**

Add a new `describe('create_custom_exercise', ...)` before `add_bodyweight`:

```js
test('dry_run previews a custom exercise without writing state or audit', () => {
  const bodyPart = BODYPARTS.includes('waist') ? 'waist' : BODYPARTS[0]
  withWriteToolEnv({ scopes: ['exercise:write'], state: customExerciseWriteState() }, ({ dataDir }) => {
    const r = call('create_custom_exercise', {
      name: '  Ring support hold  ',
      body_part: bodyPart,
      description: '  Hold top position on rings.  ',
      expected_revision: 7,
      dry_run: true
    })

    expect(r).toEqual({
      ok: true,
      dry_run: true,
      would_change: true,
      revision: 7,
      exercise: {
        id: 'c_preview',
        name: 'Ring support hold',
        body_part: bodyPart,
        description: 'Hold top position on rings.'
      },
      changes: [{
        path: 'customEx',
        op: 'create_custom_exercise',
        before: null,
        after: {
          id: 'c_preview',
          n: 'Ring support hold',
          bp: bodyPart,
          desc: 'Hold top position on rings.',
          tg: '',
          eq: 'custom',
          custom: true
        }
      }]
    })
    expect(readDiskState(dataDir).customEx).toHaveLength(1)
    expect(readAuditEvents(dataDir)).toEqual([])
  })
})
```

- [x] **Step 4: Add commit test**

```js
test('commit creates a custom exercise, increments revision and appends audit', () => {
  const bodyPart = BODYPARTS.includes('waist') ? 'waist' : BODYPARTS[0]
  withWriteToolEnv({ scopes: ['exercise:write'], state: customExerciseWriteState() }, ({ dataDir, token }) => {
    const r = call('create_custom_exercise', {
      name: 'Ring support hold',
      body_part: bodyPart,
      description: 'Hold top position on rings.',
      expected_revision: 7,
      dry_run: false
    })

    expect(r).toMatchObject({
      ok: true,
      dry_run: false,
      changed: true,
      revision_before: 7,
      revision_after: 8,
      exercise: {
        name: 'Ring support hold',
        body_part: bodyPart,
        description: 'Hold top position on rings.'
      }
    })
    expect(r.exercise.id).toMatch(/^c[a-z0-9]+$/)

    const saved = readDiskState(dataDir)
    expect(saved._revision).toBe(8)
    expect(saved.customEx).toHaveLength(2)
    expect(saved.customEx[1]).toEqual({
      id: r.exercise.id,
      n: 'Ring support hold',
      bp: bodyPart,
      desc: 'Hold top position on rings.',
      tg: '',
      eq: 'custom',
      custom: true
    })
    expect(readAuditEvents(dataDir)).toMatchObject([{
      uid: 'u1',
      actor: `mcp-token:${token.id}`,
      action: 'create_custom_exercise',
      token_id: token.id,
      revision_before: 7,
      revision_after: 8,
      details: {
        exercise: {
          id: r.exercise.id,
          name: 'Ring support hold',
          body_part: bodyPart
        }
      }
    }])
  })
})
```

- [x] **Step 5: Add validation and auth tests**

Add tests that assert:

```js
expect(() => call('create_custom_exercise', {
  name: '   ',
  body_part: bodyPart,
  expected_revision: 7,
  dry_run: true
})).toThrow(/name must be a non-empty string/)

expect(() => call('create_custom_exercise', {
  name: EXDB[0].n.toUpperCase(),
  body_part: bodyPart,
  expected_revision: 7,
  dry_run: true
})).toThrow(/already exists/)

expect(() => call('create_custom_exercise', {
  name: 'ring row',
  body_part: bodyPart,
  expected_revision: 7,
  dry_run: true
})).toThrow(/already exists/)

expect(() => call('create_custom_exercise', {
  name: 'Cable neck raise',
  body_part: 'not-a-body-part',
  expected_revision: 7,
  dry_run: true
})).toThrow(/unknown body_part/)
```

Add stale revision and missing scope assertions matching the existing write tool patterns:

```js
expect(call('create_custom_exercise', {
  name: 'Ring support hold',
  body_part: bodyPart,
  expected_revision: 6,
  dry_run: false
})).toEqual({
  ok: false,
  error: {
    code: 'STATE_CONFLICT',
    message: 'State changed since the tool read it.',
    current_revision: 7
  }
})
```

and:

```js
expect(call('create_custom_exercise', {
  name: 'Ring support hold',
  body_part: bodyPart,
  expected_revision: 7,
  dry_run: true
})).toEqual({
  ok: false,
  error: {
    code: 'TOKEN_FORBIDDEN',
    message: 'Token missing required scope.',
    required_scope: 'exercise:write'
  }
})
```

- [x] **Step 6: Update registry/no-state smoke sample**

In the samples object near the bottom of `mcp/test/tools.test.js`, add:

```js
create_custom_exercise: { name: 'Ring support hold', body_part: 'waist', expected_revision: 0, dry_run: true },
```

If `waist` is not available in `BODYPARTS`, use a known catalogue body part from `BODYPARTS[0]` in the test setup.

- [x] **Step 7: Run tests to verify RED**

Run: `cd mcp && npm test -- tools.test.js`

Expected: FAIL because `create_custom_exercise` is not registered yet.

## Chunk 2: Tool Implementation

### Task 2: Implement `create_custom_exercise`

**Files:**
- Modify: `api/token-service.js`
- Modify: `mcp/src/tools.js`

- [x] **Step 1: Import body parts**

Change:

```js
import { EXIDX, exOr } from '../../frontend/src/lib/exercises.js'
```

to:

```js
import { BODYPARTS, EXDB, EXIDX, exOr } from '../../frontend/src/lib/exercises.js'
```

- [x] **Step 2: Add schema**

Add near the other write schemas:

```js
const createCustomExerciseSchema = {
  name: z.string().min(1).describe('Name for the new custom exercise. Trimmed before writing.'),
  body_part: z.string().min(1).describe('Existing openGym body part id, for example chest, back, upper legs or cardio.'),
  description: z.string().optional().describe('Optional setup/cue text. Trimmed and capped at 1000 characters.'),
  expected_revision: z.number().int().min(0).describe('State _revision observed before proposing the write. Prevents lost updates.'),
  dry_run: z.boolean().optional().describe('When true, preview changes without writing. Defaults to true.')
}
```

- [x] **Step 3: Add helper functions**

Add below the routine edit helpers:

```js
const BODY_PART_SET = new Set(BODYPARTS)

function normalizeCustomExerciseInput(S, { name, body_part, description }) {
  const n = String(name || '').trim()
  if (!n) fail('EINVAL', 'name must be a non-empty string')
  if (!BODY_PART_SET.has(body_part)) fail('EINVAL', `unknown body_part ${JSON.stringify(body_part)}`)

  const duplicate = [...EXDB, ...(S.customEx || [])]
    .find(ex => String(ex.n || '').trim().toLowerCase() === n.toLowerCase())
  if (duplicate) fail('EINVAL', `exercise ${JSON.stringify(duplicate.n)} already exists`)

  return {
    n,
    bp: body_part,
    desc: String(description || '').trim().slice(0, 1000),
    tg: '',
    eq: 'custom',
    custom: true
  }
}

function makeCustomExerciseId(existing = []) {
  const used = new Set(existing.map(ex => ex.id))
  for (let i = 0; i < 20; i += 1) {
    const id = `c${Math.random().toString(36).slice(2, 10)}`
    if (!used.has(id) && !EXIDX[id]) return id
  }
  fail('EINVAL', 'could not generate unique custom exercise id')
}

function customExerciseChange(S, input, id = 'c_preview') {
  const normalized = normalizeCustomExerciseInput(S, input)
  const after = { id, ...normalized }
  return {
    exercise: {
      id,
      name: normalized.n,
      body_part: normalized.bp,
      description: normalized.desc
    },
    changes: [{
      path: 'customEx',
      op: 'create_custom_exercise',
      before: null,
      after
    }]
  }
}
```

- [x] **Step 4: Add exported tool**

Add before `addBodyweight`:

```js
/** create_custom_exercise — write one custom exercise definition. */
export const createCustomExercise = {
  name: 'create_custom_exercise',
  description: 'Create one custom exercise in the profile catalogue. Requires OPENGYM_MCP_TOKEN with exercise:write. Use edit_routine.add_exercise separately to add it to a routine.',
  schema: createCustomExerciseSchema,
  handler: ({ name, body_part, description = '', expected_revision, dry_run = true }) => {
    const auth = verifyMcpWriteToken({ requiredScope: 'exercise:write' })
    if (!auth.ok) return auth

    const dataDir = process.env.OPENGYM_DATA
    const states = writeStateServices(dataDir)
    const S = states.readUserState(auth.token.uid)
    if (!S) return noState()

    const preview = customExerciseChange(S, { name, body_part, description })
    const revision = revisionOf(S)

    if (dry_run) {
      return {
        ok: true,
        dry_run: true,
        would_change: true,
        revision,
        exercise: preview.exercise,
        changes: preview.changes
      }
    }

    const id = makeCustomExerciseId(S.customEx || [])
    const committed = customExerciseChange(S, { name, body_part, description }, id)
    const result = states.updateUserState(auth.token.uid, current => {
      const normalized = normalizeCustomExerciseInput(current, { name, body_part, description })
      return {
        ...current,
        customEx: [...(current.customEx || []), { id, ...normalized }]
      }
    }, {
      actor: `mcp-token:${auth.token.id}`,
      tokenId: auth.token.id,
      operation: 'create_custom_exercise',
      expectedRevision: expected_revision,
      details: { exercise: committed.exercise }
    })
    if (!result.ok) return result

    return {
      ok: true,
      dry_run: false,
      changed: true,
      revision_before: revision,
      revision_after: result.revision,
      exercise: committed.exercise,
      changes: committed.changes
    }
  }
}
```

- [x] **Step 5: Register the tool**

Add `createCustomExercise` to `TOOLS` after `editRoutine` and before `addBodyweight`.

- [x] **Step 6: Run targeted MCP tests**

Run: `cd mcp && npm test -- tools.test.js`

Expected: PASS.

## Chunk 3: Docs, Verification And Commit

### Task 3: Document, Verify And Commit

**Files:**
- Modify: `mcp/README.md`
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `docs/superpowers/plans/2026-09-04-create-custom-exercise-mcp.md`

- [x] **Step 1: Update MCP README**

Document:

- write tool count increases by one;
- `create_custom_exercise` requires `exercise:write`;
- Phase 2.5 has `create_custom_exercise` done;
- remaining Phase 2.5 item is direct superset editing.

- [x] **Step 2: Update architecture docs**

Update implementation status and recommendation list in `docs/MCP_WRITE_ARCHITECTURE.md`.

- [x] **Step 3: Update Czech MCP docs**

Add `create_custom_exercise` to the write tool section and update the current status around Phase 2.5.

- [x] **Step 4: Mark checklist progress**

Change completed plan items from `- [ ]` to `- [x]`.

- [x] **Step 5: Run MCP suite**

Run: `cd mcp && npm test`

Expected: PASS.

- [x] **Step 6: Run MCP loadability check**

Run: `cd mcp && npm run check:node-loadable`

Expected: PASS.

- [x] **Step 7: Run API suite**

Run: `cd api && npm test`

Expected: PASS.

- [x] **Step 8: Check whitespace**

Run: `git diff --check`

Expected: no output.

- [x] **Step 9: Commit**

```bash
git add mcp/src/tools.js mcp/test/tools.test.js mcp/README.md docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-09-04-create-custom-exercise-mcp.md
git commit -m "feat: add custom exercise mcp tool"
```

- [ ] **Step 10: Report final state**

Report:

- commit hash;
- tests run;
- remaining MCP roadmap item: direct superset editing, plus later freestyle workout logging and remote MCP.
