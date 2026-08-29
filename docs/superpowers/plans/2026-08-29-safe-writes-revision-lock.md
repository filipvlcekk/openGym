# Safe Writes Revision And Lock Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the core conflict-safety primitives for Phase 2 writes: `_revision`, `expectedRevision`, and per-user state lock files.

**Architecture:** Keep the API-compatible `replaceUserState(uid, state)` wrapper, but route it through a new `updateUserState(uid, mutation, options)` service method. The service owns lock acquisition, read-modify-write, revision increments and structured conflict errors so later web and MCP writers share the same write path.

**Tech Stack:** Node.js ESM, built-in `node:test`, synchronous JSON file storage, exclusive lock files via `fs.openSync(..., 'wx')`.

---

## Chunk 1: Revision And Lock

### Task 1: Add failing revision tests

**Files:**
- Modify: `api/test/state-service.test.js`

- [x] **Step 1: Test successful revision increment**

Seed a state with `_revision: 2`, call `updateUserState(..., { expectedRevision: 2 })`, and assert the stored state has `_revision: 3`.

- [x] **Step 2: Test stale expected revision conflict**

Seed `_revision: 3`, call with `expectedRevision: 2`, and assert the result is `{ ok: false, error: { code: 'STATE_CONFLICT', current_revision: 3 } }` and the file is unchanged.

- [x] **Step 3: Run test to verify failure**

Run: `npm test`

Expected: FAIL because `updateUserState` does not exist yet.

### Task 2: Add failing lock test

**Files:**
- Modify: `api/test/state-service.test.js`

- [x] **Step 1: Test lock cleanup after mutation failure**

Call `updateUserState` with a mutation that throws and assert the per-user lock file is removed in `finally`.

- [x] **Step 2: Run test to verify failure**

Run: `npm test`

Expected: FAIL because locking does not exist yet.

### Task 3: Implement revision and lock

**Files:**
- Modify: `api/state-service.js`

- [x] **Step 1: Add `lockFile(uid)` and `withUserStateLock(uid, operation, fn)`**

Use `dataDir/locks/state-<uid>.lock`, `fs.openSync(lock, 'wx')`, metadata JSON, stale-lock cleanup, timeout and `finally` release.

- [x] **Step 2: Add `updateUserState(uid, mutation, options)`**

Inside the lock: read current state, check `expectedRevision` when supplied, apply mutation, strip `active`, increment `_revision`, write state.

- [x] **Step 3: Route `replaceUserState` through `updateUserState`**

Keep the current public response shape `{ ok: true, ts }` for successful full-state replacement.

- [x] **Step 4: Run API tests**

Run: `npm test`

Expected: PASS.

### Task 4: Verify and commit

**Files:**
- `api/state-service.js`
- `api/test/state-service.test.js`
- `docs/superpowers/plans/2026-08-29-safe-writes-revision-lock.md`

- [x] **Step 1: Run verification**

Run:
- `cd api && npm test`
- `cd mcp && npm test`
- `cd mcp && npm run check:node-loadable`
- `git diff --check`

Expected: all pass.

- [x] **Step 2: Commit**

Run:

```bash
git add api/state-service.js api/test/state-service.test.js docs/superpowers/plans/2026-08-29-safe-writes-revision-lock.md
git commit -m "feat: add state revision lock"
```
