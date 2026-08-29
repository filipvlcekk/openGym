# Safe Writes Audit Service Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JSONL audit log for committed state writes before introducing MCP write tools.

**Architecture:** Add `api/audit-service.js` as the only writer for `data/audit.log`. `api/state-service.js` accepts an optional audit service and appends one scrubbed event after each successful `updateUserState()` commit, including actor, uid, action and revision numbers without logging raw tokens or full state snapshots.

**Tech Stack:** Node.js ESM, built-in `node:test`, synchronous file append, JSONL storage.

---

## Chunk 1: Audit Service

### Task 1: Add failing audit service tests

**Files:**
- Create: `api/test/audit-service.test.js`

- [x] **Step 1: Test JSONL append**

Create an audit service, append one event, and assert `audit.log` contains one parseable JSON line with a timestamp.

- [x] **Step 2: Test sensitive field scrubbing**

Append an event containing `token`, `raw_token`, `secret`, `hash`, `state`, `before` and `after`, including nested copies, and assert those keys are omitted.

- [x] **Step 3: Run tests to verify failure**

Run: `npm test`

Expected: FAIL because `api/audit-service.js` does not exist yet.

### Task 2: Implement audit service

**Files:**
- Create: `api/audit-service.js`

- [x] **Step 1: Add `createAuditService({ dataDir })`**

Expose:
- `auditFile`
- `appendAuditEvent(event)`
- `readAuditEvents()`

- [x] **Step 2: Scrub sensitive keys recursively**

Drop exact keys: `token`, `raw_token`, `secret`, `hash`, `state`, `before`, `after`.

- [x] **Step 3: Run API tests**

Run: `npm test`

Expected: PASS.

## Chunk 2: State Service Integration

### Task 3: Add failing integration tests

**Files:**
- Modify: `api/test/state-service.test.js`

- [x] **Step 1: Test committed write appends audit event**

Use `createStateService({ dataDir, audit })`, call `updateUserState()` with `actor` and `operation`, and assert one event with `revision_before` and `revision_after`.

- [x] **Step 2: Test conflict does not append commit audit event**

Seed `_revision: 2`, call with stale `expectedRevision: 1`, and assert audit log remains empty.

- [x] **Step 3: Run tests to verify failure**

Run: `npm test`

Expected: FAIL because state service ignores `audit`.

### Task 4: Implement integration

**Files:**
- Modify: `api/state-service.js`
- Modify: `api/server.js`

- [x] **Step 1: Accept optional audit service**

`createStateService({ dataDir, audit })`.

- [x] **Step 2: Append audit after successful state write**

Append event with `uid`, `actor`, `action`, `revision_before`, `revision_after`, optional `token_id` and optional scrubbed `details`.

- [x] **Step 3: Wire server**

Instantiate `createAuditService({ dataDir: DATA })` and pass it to `createStateService`.

- [x] **Step 4: Run API tests**

Run: `npm test`

Expected: PASS.

### Task 5: Docs and commit

**Files:**
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `docs/superpowers/plans/2026-08-29-safe-writes-audit-service.md`

- [x] **Step 1: Update implementation status docs**

Mark audit service done and note that write tools are still pending.

- [x] **Step 2: Run verification**

Run:
- `cd api && npm test`
- `node --check api/server.js`
- `node --check api/audit-service.js`
- `cd mcp && npm test`
- `cd mcp && npm run check:node-loadable`
- `git diff --check`

Expected: all pass.

- [x] **Step 3: Commit**

Run:

```bash
git add api/audit-service.js api/state-service.js api/server.js api/test/audit-service.test.js api/test/state-service.test.js docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-08-29-safe-writes-audit-service.md
git commit -m "feat: add state write audit log"
```
