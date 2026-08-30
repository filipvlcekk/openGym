# Add Bodyweight Write Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `add_bodyweight`, a scoped MCP write tool for adding or replacing one body-weight weigh-in.

**Architecture:** Keep the tool in `mcp/src/tools.js` beside the other Phase 2 write tools. The mutation writes the existing openGym bodyweight shape `{ d, w, t }`, replacing any entry with the same date and sorting by date; commits go through token auth, state-service locks, expected revision checks and audit.

**Tech Stack:** MCP SDK tool definitions, Zod schemas, Vitest, Node JSON file storage.

---

## Chunk 1: `add_bodyweight`

### Task 1: Add failing write tool tests

**Files:**
- Modify: `mcp/test/tools.test.js`

- [x] **Step 1: Add bodyweight fixture**

Create a small write-state fixture with two bodyweight entries around the target date.

- [x] **Step 2: Test dry-run insert**

Call `add_bodyweight` with a new date and assert a preview change without state/audit writes.

- [x] **Step 3: Test commit insert**

Commit the new date and assert bodyweight is sorted, `_revision` increments, and audit records `add_bodyweight`.

- [x] **Step 4: Test commit replacement**

Commit a date that already exists and assert the existing date is replaced, not duplicated.

- [x] **Step 5: Test stale revision and missing scope**

Assert stale `expected_revision` returns `STATE_CONFLICT`, and a token without `bodyweight:write` returns `TOKEN_FORBIDDEN`.

- [x] **Step 6: Run tests to verify failure**

Run: `cd mcp && npm test`

Expected: FAIL because `add_bodyweight` is not registered yet.

### Task 2: Implement write tool

**Files:**
- Modify: `mcp/src/tools.js`

- [x] **Step 1: Add bodyweight helpers**

Add helpers for timestamp derivation, change calculation, and immutable bodyweight replacement.

- [x] **Step 2: Add `add_bodyweight` schema**

Support:

```json
{ "date": "2026-08-30", "weight": 78.4, "expected_revision": 184, "dry_run": true }
```

`date` defaults to today's local ISO date. `weight` is rounded to one decimal and must be positive.

- [x] **Step 3: Implement dry-run response**

Return `{ ok: true, dry_run: true, would_change, revision, unit, changes }`.

- [x] **Step 4: Implement commit response**

Call `updateUserState()` with `bodyweight:write`, `expectedRevision`, actor/token id and scrub-safe details.

- [x] **Step 5: Run MCP tests**

Run: `cd mcp && npm test`

Expected: PASS.

### Task 3: Docs and commit

**Files:**
- Modify: `mcp/README.md`
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `docs/superpowers/plans/2026-08-30-add-bodyweight-write-tool.md`

- [x] **Step 1: Update docs**

Document `add_bodyweight`, its scope, and current Phase 2 status.

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
git add mcp/src/tools.js mcp/test/tools.test.js mcp/README.md docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-08-30-add-bodyweight-write-tool.md
git commit -m "feat: add bodyweight mcp write tool"
```
