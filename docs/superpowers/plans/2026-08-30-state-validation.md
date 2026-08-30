# State Validation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shared structural validation for openGym state writes before adding broader MCP write tools.

**Architecture:** Add `api/state-validation.js` with a small `validateState(state)` function. `api/state-service.js` calls it after sanitizing `active` and setting `_revision`, but before `atomicWrite()` and audit logging, so both web `PUT /api/data` and MCP write tools use the same guard.

**Tech Stack:** Node ESM, Node test runner, JSON file storage.

---

## Chunk 1: Shared State Validation

### Task 1: Add failing validation tests

**Files:**
- Modify: `api/test/state-service.test.js`

- [x] **Step 1: Test valid minimal state still writes**

Call `replaceUserState()` with routines, week, dayPlan, bodyweight and workouts in the accepted shape and assert it writes.

- [x] **Step 2: Test unknown routine reference fails**

Call `replaceUserState()` with `week[1] = "missing"` and assert `STATE_VALIDATION_FAILED` with no state file written.

- [x] **Step 3: Test duplicate routine ids fail without audit**

Seed a valid state, call `updateUserState()` to duplicate a routine id, and assert failure, unchanged file and no audit event.

- [x] **Step 4: Test duplicate bodyweight dates fail without writing**

Seed a valid state, call `updateUserState()` to add a second bodyweight entry for the same date, and assert failure and unchanged file.

- [x] **Step 5: Test invalid dayPlan fails**

- [x] **Step 5a: Test non-object root state fails**

Assert an array root state is rejected instead of being spread into an object.

Call `replaceUserState()` with a non-ISO dayPlan key and assert `STATE_VALIDATION_FAILED`.

- [x] **Step 6: Run tests to verify failure**

Run: `cd api && npm test`

Expected: FAIL because `state-service` does not validate yet.

### Task 2: Implement validator and wire it into state service

**Files:**
- Create: `api/state-validation.js`
- Modify: `api/state-service.js`

- [x] **Step 1: Implement `validateState(state)`**

Return `{ ok: true, issues: [] }` for accepted states and `{ ok: false, issues }` for invalid states. Each issue has `{ path, message }`.

- [x] **Step 2: Validate root and revision**

Reject non-object state and non-integer/negative `_revision`.

- [x] **Step 3: Validate routines and references**

Check routine ids, uniqueness, `ex` arrays, `week` keys/values and `dayPlan` keys/values.

- [x] **Step 4: Validate bodyweight and workouts**

Check bodyweight date uniqueness, positive finite weights, optional finite timestamps, and basic workout array/date/entries shape.

- [x] **Step 5: Wire validation into `updateUserState()`**

Before writing, return:

```json
{
  "ok": false,
  "error": {
    "code": "STATE_VALIDATION_FAILED",
    "message": "State validation failed.",
    "issues": []
  }
}
```

Do not write or audit failed states.

- [x] **Step 6: Run API tests**

Run: `cd api && npm test`

Expected: PASS.

### Task 3: Docs and commit

**Files:**
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `docs/superpowers/plans/2026-08-30-state-validation.md`

- [x] **Step 1: Update docs**

Mark shared state validation done and keep deeper workout validation as future work.

- [x] **Step 2: Run verification**

Run:
- `cd api && npm test`
- `cd mcp && npm test`
- `cd mcp && npm run check:node-loadable`
- `git diff --check`

Expected: all pass.

- [x] **Step 3: Commit**

Run:

```bash
git add api/state-validation.js api/state-service.js api/test/state-service.test.js docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md docs/superpowers/plans/2026-08-30-state-validation.md
git commit -m "feat: validate state writes"
```
