# Safe Writes Token Service Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone MCP token service that can create, verify, scope-check, list and revoke long-lived write tokens without adding HTTP routes yet.

**Architecture:** Add `api/token-service.js` as the persistence and crypto boundary for `data/tokens.json`. Store only token secret hashes, return the raw token only at creation time, and expose narrow methods that future API routes and MCP write auth can call.

**Tech Stack:** Node.js ESM, built-in `node:test`, `node:crypto`, JSON file storage through existing-style atomic writes.

---

## Chunk 1: Token Service Core

### Task 1: Add failing token lifecycle tests

**Files:**
- Create: `api/test/token-service.test.js`

- [x] **Step 1: Test create stores only a hash**

Create a token and assert the returned raw token starts with `ogmcp_`, `tokens.json` exists, and the stored record does not contain the raw token or secret.

- [x] **Step 2: Test verify returns uid and scopes**

Verify the raw token and assert the result includes token id, uid and scopes.

- [x] **Step 3: Test required scope failure**

Verify the same token with a missing required scope and assert `TOKEN_FORBIDDEN`.

- [x] **Step 4: Test revoke blocks verification**

Revoke the token, verify again and assert `TOKEN_REVOKED`.

- [x] **Step 5: Run tests to verify failure**

Run: `npm test`

Expected: FAIL because `api/token-service.js` does not exist yet.

### Task 2: Implement token service

**Files:**
- Create: `api/token-service.js`

- [x] **Step 1: Add `createTokenService({ dataDir })`**

Expose:
- `createToken({ uid, name, scopes })`
- `verifyToken(rawToken, options)`
- `listTokens(uid)`
- `revokeToken(id, uid)`

- [x] **Step 2: Store token records in `tokens.json`**

Persist records with `id`, `uid`, `name`, `hash`, `scopes`, `created_at`, `last_used_at`, `revoked_at`.

- [x] **Step 3: Use timing-safe hash comparison**

Parse `ogmcp_<token_id>_<secret>`, hash only the secret, and compare with `crypto.timingSafeEqual`.

- [x] **Step 4: Run API tests**

Run: `npm test`

Expected: PASS.

### Task 3: Document and commit

**Files:**
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `docs/superpowers/plans/2026-08-29-safe-writes-token-service.md`

- [x] **Step 1: Update implementation status**

Mark token service core done, token management HTTP routes not done.

- [x] **Step 2: Run verification**

Run:
- `cd api && npm test`
- `node --check api/token-service.js`
- `git diff --check`

Expected: all pass.

- [x] **Step 3: Commit**

Run:

```bash
git add api/token-service.js api/test/token-service.test.js docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-08-29-safe-writes-token-service.md
git commit -m "feat: add mcp token service"
```
