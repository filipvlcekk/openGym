# Safe Writes State Service Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract openGym state reads and full-state replacement into a testable API service without changing the existing `/api/data` behavior.

**Architecture:** Add `api/state-service.js` as the single API-local state file boundary. `api/server.js` keeps session, routing and response handling, but calls the service for `GET /api/data`, `PUT /api/data`, reminders and admin reads. This is the Phase 2 foundation for later lock, revision, validation and audit behavior.

**Tech Stack:** Node.js ESM, built-in `node:test`, JSON file storage, existing no-framework HTTP API.

---

## Chunk 1: API State Service

### Task 1: Add service tests

**Files:**
- Create: `api/test/state-service.test.js`
- Modify: `api/package.json`

- [x] **Step 1: Write a failing service test**

Test `replaceUserState(uid, state)` writes `state-<uid>.json`, strips `active`, returns `{ ok: true, ts }`, and persists the stripped JSON.

- [x] **Step 2: Add API test script**

Add `"test": "node --test"` to `api/package.json`.

- [x] **Step 3: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because `api/state-service.js` does not exist yet.

### Task 2: Implement state service

**Files:**
- Create: `api/state-service.js`

- [x] **Step 1: Create `createStateService({ dataDir })`**

Expose:
- `stateFile(uid)`
- `readUserState(uid)`
- `replaceUserState(uid, state)`
- `atomicWrite(file, content)`

- [x] **Step 2: Run API tests**

Run: `npm test`

Expected: PASS.

### Task 3: Route API through service

**Files:**
- Modify: `api/server.js`

- [x] **Step 1: Replace local state helpers**

Instantiate the service with `DATA` and use it wherever `stateFile`, `readState` or state `atomicWrite` was used.

- [x] **Step 2: Preserve `/api/data` behavior**

`GET /api/data` still returns `{ state }` or `{ state: null }`; `PUT /api/data` still requires an object and returns `{ ok: true, ts }`.

- [x] **Step 3: Run verification**

Run:
- `cd api && npm test`
- `cd mcp && npm test`
- `cd mcp && npm run check:node-loadable`
- `git diff --check`

Expected: all pass.

### Task 4: Commit checkpoint

**Files:**
- `api/state-service.js`
- `api/test/state-service.test.js`
- `api/package.json`
- `api/server.js`
- `docs/superpowers/plans/2026-08-29-safe-writes-state-service.md`

- [x] **Step 1: Review diff**

Run: `git diff --stat` and inspect the relevant file diff.

- [x] **Step 2: Commit**

Run:

```bash
git add api/state-service.js api/test/state-service.test.js api/package.json api/server.js docs/superpowers/plans/2026-08-29-safe-writes-state-service.md
git commit -m "refactor: extract api state service"
```
