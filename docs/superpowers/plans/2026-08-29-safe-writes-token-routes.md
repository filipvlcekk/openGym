# Safe Writes Token Routes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose MCP token management over authenticated HTTP routes so a signed-in user can create, list and revoke their own long-lived MCP tokens.

**Architecture:** Add a small `api/mcp-token-routes.js` route factory that depends on `readSession`, `readBody`, `json` and `token-service`. `api/server.js` owns wiring; the route module owns request validation and response shapes. This keeps endpoint tests focused without booting WebAuthn/passkey login.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing no-framework HTTP route map.

---

## Chunk 1: Token Management Routes

### Task 1: Add failing route tests

**Files:**
- Create: `api/test/mcp-token-routes.test.js`

- [x] **Step 1: Test unauthenticated create is rejected**

Call `POST /api/mcp/tokens` with `readSession` returning null and assert 401.

- [x] **Step 2: Test create returns raw token once**

Call `POST /api/mcp/tokens` as a user with `name` and `scopes`, then assert response includes `token`, public `record`, and no hash.

- [x] **Step 3: Test list returns only caller tokens**

Create tokens for two users, call `GET /api/mcp/tokens` as one user, assert only their token is listed.

- [x] **Step 4: Test revoke invalidates caller token**

Create a token, call `POST /api/mcp/tokens/revoke`, assert later service verification returns `TOKEN_REVOKED`.

- [x] **Step 5: Run tests to verify failure**

Run: `npm test`

Expected: FAIL because `api/mcp-token-routes.js` does not exist yet.

### Task 2: Implement route factory

**Files:**
- Create: `api/mcp-token-routes.js`

- [x] **Step 1: Add `createMcpTokenRoutes(deps)`**

Return handlers for:
- `POST /api/mcp/tokens`
- `GET /api/mcp/tokens`
- `POST /api/mcp/tokens/revoke`

- [x] **Step 2: Validate inputs**

Require signed-in session, non-empty scopes on create, token id on revoke, and map invalid scopes to 400.

- [x] **Step 3: Run API tests**

Run: `npm test`

Expected: PASS.

### Task 3: Wire into server and docs

**Files:**
- Modify: `api/server.js`
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `docs/superpowers/plans/2026-08-29-safe-writes-token-routes.md`

- [x] **Step 1: Instantiate token service in `server.js`**

Create `const tokens = createTokenService({ dataDir: DATA })`.

- [x] **Step 2: Merge token routes into `routes`**

Use object spread from `createMcpTokenRoutes({ tokens, readSession, readBody, json })`.

- [x] **Step 3: Update implementation status docs**

Mark token management HTTP routes done.

- [x] **Step 4: Run verification and commit**

Run:
- `cd api && npm test`
- `node --check api/server.js`
- `node --check api/mcp-token-routes.js`
- `git diff --check`

Commit:

```bash
git add api/server.js api/mcp-token-routes.js api/test/mcp-token-routes.test.js docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-08-29-safe-writes-token-routes.md
git commit -m "feat: add mcp token routes"
```
