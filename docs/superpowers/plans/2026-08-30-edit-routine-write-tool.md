# Edit Routine Write Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first safe `edit_routine` MCP write tool for narrow routine patch operations.

**Architecture:** Keep the write tool in `mcp/src/tools.js` beside the existing Phase 2 write tools. The public MCP API uses `policy`, but stored openGym state remains compatible with the React UI by writing routine progression to `prog`; MCP read responses should prefer `prog` and fallback to legacy `policy`.

**Tech Stack:** MCP SDK tool definitions, Zod schemas, Vitest, Node JSON file storage.

---

## Chunk 1: `edit_routine`

### Task 1: Add failing write tool tests

**Files:**
- Modify: `mcp/test/tools.test.js`

- [x] **Step 1: Add a routine edit fixture**

Create a small write-state fixture with one routine containing a reps exercise and a time exercise.

- [x] **Step 2: Test dry-run preview**

Call `edit_routine` with `set_policy` and `set_exercise_target` ops and assert returned changes without state/audit writes.

- [x] **Step 3: Test commit write**

Commit the same ops and assert `prog`, exercise target fields, `_revision`, and audit event are updated.

- [x] **Step 4: Test stale revision and missing scope**

Assert stale `expected_revision` returns `STATE_CONFLICT`, and a token without `routine:write` returns `TOKEN_FORBIDDEN`.

- [x] **Step 5: Test missing routine/exercise and unknown op**

Assert invalid targets fail before writing.

- [x] **Step 6: Run tests to verify failure**

Run: `cd mcp && npm test`

Expected: FAIL because `edit_routine` is not registered yet.

### Task 2: Implement write tool

**Files:**
- Modify: `mcp/src/tools.js`
- Modify: `mcp/scripts/check-node-loadable.mjs`

- [x] **Step 1: Add routine edit helpers**

Add helpers for canonical policy read/write, routine lookup, exercise lookup, patch validation, change calculation, and immutable application.

- [x] **Step 2: Add `edit_routine` schema**

Support ops:

```json
{ "op": "set_policy", "policy": "off|linear|greyskull|double|time" }
{ "op": "set_exercise_target", "exercise_id": "...", "sets": 3, "reps": 8, "weight": 27.5 }
```

Limit ops to 10 and allow only target fields already used by openGym configs: `sets`, `reps`, `weight`, `inc`, `repsMin`, `repsMax`, `sec`, `min`, `speed`.

- [x] **Step 3: Implement dry-run response**

Return `{ ok: true, dry_run: true, would_change, revision, changes }`.

- [x] **Step 4: Implement commit response**

Call `updateUserState()` with `routine:write`, `expectedRevision`, actor/token id and scrub-safe details.

- [x] **Step 5: Run MCP tests**

Run: `cd mcp && npm test`

Expected: PASS.

### Task 3: Docs and commit

**Files:**
- Modify: `mcp/README.md`
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `docs/superpowers/plans/2026-08-30-edit-routine-write-tool.md`

- [x] **Step 1: Update docs**

Document `edit_routine`, explain the first supported ops, and move remaining routine changes to future work.

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
git add mcp/src/tools.js mcp/test/tools.test.js mcp/README.md docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-08-30-edit-routine-write-tool.md
git commit -m "feat: add edit routine mcp write tool"
```
