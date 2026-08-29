# Safe Writes MCP Auth Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP-side write authentication that verifies `OPENGYM_MCP_TOKEN` against `tokens.json` before future write tools run.

**Architecture:** Add `mcp/src/write-auth.js` as a small adapter around `api/token-service.js`. The module reads `OPENGYM_DATA` and `OPENGYM_MCP_TOKEN` by default, verifies the token with an optional required scope, and returns structured auth results without adding write tools yet.

**Tech Stack:** Node.js ESM, Vitest, existing MCP plain-node load checks.

---

## Chunk 1: MCP Write Auth

### Task 1: Add failing auth tests

**Files:**
- Create: `mcp/test/write-auth.test.js`

- [x] **Step 1: Test missing data dir**

Call write auth without `dataDir` and assert `MCP_DATA_REQUIRED`.

- [x] **Step 2: Test missing token**

Call write auth with `dataDir` but no token and assert `MCP_TOKEN_REQUIRED`.

- [x] **Step 3: Test valid scoped token**

Create a token through `api/token-service.js`, verify it through MCP auth with `requiredScope: 'schedule:write'`, and assert uid/scopes.

- [x] **Step 4: Test missing scope**

Verify the same token with `requiredScope: 'routine:write'` and assert `TOKEN_FORBIDDEN`.

- [x] **Step 5: Run tests to verify failure**

Run: `npm test`

Expected: FAIL because `mcp/src/write-auth.js` does not exist yet.

### Task 2: Implement auth adapter

**Files:**
- Create: `mcp/src/write-auth.js`

- [x] **Step 1: Add `verifyMcpWriteToken(options)`**

Use explicit options first, then `process.env.OPENGYM_DATA` and `process.env.OPENGYM_MCP_TOKEN`.

- [x] **Step 2: Return structured env errors**

Return `{ ok: false, error: { code, message } }` for missing data dir or token.

- [x] **Step 3: Delegate token verification**

Use `createTokenService({ dataDir }).verifyToken(token, { requiredScope })`.

- [x] **Step 4: Run MCP tests**

Run: `npm test`

Expected: PASS.

### Task 3: Docs and commit

**Files:**
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `mcp/scripts/check-node-loadable.mjs`
- Modify: `docs/superpowers/plans/2026-08-29-safe-writes-mcp-auth.md`

- [x] **Step 1: Include write-auth in node-loadable check**

Add `mcp/src/write-auth.js` to the plain Node import graph check.

- [x] **Step 2: Update implementation status docs**

Mark MCP token auth adapter done, write tools still not done.

- [x] **Step 3: Run verification and commit**

Run:
- `cd mcp && npm test`
- `cd mcp && npm run check:node-loadable`
- `cd api && npm test`
- `git diff --check`

Commit:

```bash
git add mcp/src/write-auth.js mcp/test/write-auth.test.js mcp/scripts/check-node-loadable.mjs docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-08-29-safe-writes-mcp-auth.md
git commit -m "feat: add mcp write token auth"
```
