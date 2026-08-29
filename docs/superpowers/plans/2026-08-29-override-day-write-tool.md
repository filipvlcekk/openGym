# Override Day Write Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first MCP write tool, `override_day`, for one-off schedule overrides with token auth, dry-run previews, revision conflicts and audit-backed commits.

**Architecture:** Keep the write tool in `mcp/src/tools.js` for now, using `mcp/src/write-auth.js` for `schedule:write` auth and `api/state-service.js` plus `api/audit-service.js` for committed writes. Dry runs read the token owner's state from disk and return the same change list shape without writing.

**Tech Stack:** MCP SDK tool definitions, Zod schemas, Vitest, Node JSON file storage.

---

## Chunk 1: `override_day`

### Task 1: Add failing write tool tests

**Files:**
- Modify: `mcp/test/tools.test.js`

- [x] **Step 1: Test dry-run preview**

Create a temp data dir, seed `state-<uid>.json`, create a `schedule:write` token, call `override_day` with `dry_run: true`, and assert it returns `would_change`, `revision`, and a `dayPlan.<date>` change without changing the file or writing audit.

- [x] **Step 2: Test commit write**

Call `override_day` with `dry_run: false`, assert `dayPlan[date]` changed, `_revision` incremented, response has `revision_before/revision_after`, and `audit.log` contains one event.

- [x] **Step 3: Test stale revision conflict**

Call commit with stale `expected_revision`, assert `STATE_CONFLICT` and unchanged state.

- [x] **Step 4: Test missing scope**

Create a token without `schedule:write`, call the tool, and assert `TOKEN_FORBIDDEN`.

- [x] **Step 5: Run tests to verify failure**

Run: `npm test`

Expected: FAIL because `override_day` is not registered yet.

### Task 2: Implement write tool

**Files:**
- Modify: `mcp/src/tools.js`

- [x] **Step 1: Add disk state helpers for write tools**

Use `process.env.OPENGYM_DATA`, `createStateService`, `createAuditService`, and token uid from `verifyMcpWriteToken`.

- [x] **Step 2: Validate target**

Allow `routine_id: "rest"` or an existing routine id; reject unknown routine ids with `ENOENT`.

- [x] **Step 3: Implement dry-run response**

Return `{ ok: true, dry_run: true, would_change, revision, changes }` without writing.

- [x] **Step 4: Implement commit response**

Call `updateUserState()` with `expectedRevision`, `actor`, `tokenId`, action `override_day`, and scrub-safe details.

- [x] **Step 5: Run MCP tests**

Run: `npm test`

Expected: PASS.

### Task 3: Docs and commit

**Files:**
- Modify: `mcp/README.md`
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `docs/superpowers/plans/2026-08-29-override-day-write-tool.md`

- [x] **Step 1: Update docs**

Mark `override_day` done as the first write tool and document required `OPENGYM_MCP_TOKEN`.

- [x] **Step 2: Run verification**

Run:
- `cd mcp && npm test`
- `cd mcp && npm run check:node-loadable`
- `cd api && npm test`
- `git diff --check`

Expected: all pass.

- [x] **Step 3: Commit**

Run:

```bash
git add mcp/src/tools.js mcp/test/tools.test.js mcp/README.md docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-08-29-override-day-write-tool.md
git commit -m "feat: add override day mcp write tool"
```
