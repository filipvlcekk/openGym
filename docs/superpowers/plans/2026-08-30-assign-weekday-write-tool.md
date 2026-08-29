# Assign Weekday Write Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `assign_weekday`, the MCP write tool for changing the recurring weekly schedule.

**Architecture:** Keep the write tool in `mcp/src/tools.js` next to `override_day` for now. It uses the same `schedule:write` auth, dry-run contract, expected revision check, state-service lock/write path and audit log. Assigning `"rest"` removes the weekday key from `week` because openGym represents rest days as no weekly routine assignment.

**Tech Stack:** MCP SDK tool definitions, Zod schemas, Vitest, Node JSON file storage.

---

## Chunk 1: `assign_weekday`

### Task 1: Add failing write tool tests

**Files:**
- Modify: `mcp/test/tools.test.js`

- [x] **Step 1: Test dry-run preview**

Seed `week[1] = "push"`, call `assign_weekday` with `routine_id: "pull"` and `dry_run: true`, and assert a `week.1` change without state/audit writes.

- [x] **Step 2: Test commit write**

Commit the same change and assert `week[1]` changes, `_revision` increments, and audit records `assign_weekday`.

- [x] **Step 3: Test assigning rest removes weekly assignment**

Commit `routine_id: "rest"` and assert the weekday key is absent from stored `week`.

- [x] **Step 4: Test stale revision conflict and missing scope**

Assert stale `expected_revision` returns `STATE_CONFLICT`, and a token without `schedule:write` returns `TOKEN_FORBIDDEN`.

- [x] **Step 5: Run tests to verify failure**

Run: `npm test`

Expected: FAIL because `assign_weekday` is not registered yet.

### Task 2: Implement write tool

**Files:**
- Modify: `mcp/src/tools.js`

- [x] **Step 1: Add shared schedule write helpers**

Reuse target validation and state service setup from `override_day`.

- [x] **Step 2: Implement dry-run response**

Return `{ ok: true, dry_run: true, would_change, revision, changes }`.

- [x] **Step 3: Implement commit response**

Call `updateUserState()` with action `assign_weekday`, `expectedRevision`, actor/token id and scrub-safe details.

- [x] **Step 4: Run MCP tests**

Run: `npm test`

Expected: PASS.

### Task 3: Docs and commit

**Files:**
- Modify: `mcp/README.md`
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `docs/superpowers/plans/2026-08-30-assign-weekday-write-tool.md`

- [x] **Step 1: Update docs**

Mark `assign_weekday` done and keep `edit_routine` as the next Phase 2 write tool.

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
git add mcp/src/tools.js mcp/test/tools.test.js mcp/README.md docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-08-30-assign-weekday-write-tool.md
git commit -m "feat: add assign weekday mcp write tool"
```
