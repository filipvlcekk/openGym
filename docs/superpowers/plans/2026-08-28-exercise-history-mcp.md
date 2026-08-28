# exercise_history MCP Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-only `exercise_history` MCP tool for recent per-exercise training history.

**Architecture:** Add one handler to `mcp/src/tools.js`, reusing `entryView`, `modeOf`, and `exOr` so labels and exercise metadata match existing MCP responses. Keep all calculations local to the handler and update only MCP tests plus roadmap docs.

**Tech Stack:** Node ESM, MCP SDK registration model, Zod schemas, Vitest, existing frontend pure helpers.

---

## Chunk 1: Contract Test And Handler

### Task 1: Add failing MCP tests

**Files:**
- Modify: `mcp/test/tools.test.js`

- [ ] **Step 1: Write the failing test**

Add an `exercise_history` describe block covering newest-first sessions, limit behavior, and empty history.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && npm test -- --run test/tools.test.js`

Expected: FAIL with `unknown tool exercise_history`.

### Task 2: Implement the handler

**Files:**
- Modify: `mcp/src/tools.js`

- [ ] **Step 1: Add helpers**

Add small helpers for completed set filtering, per-entry volume, and exercise mode inference from either routine config or logged target.

- [ ] **Step 2: Add `exerciseHistory` tool**

Register schema `{ exercise_id, limit }`, scan `S.workouts`, reuse `entryView`, return metadata, counts, and session rows.

- [ ] **Step 3: Update registration**

Append `exerciseHistory` to `TOOLS` and include required no-state test arguments.

- [ ] **Step 4: Run MCP tests**

Run: `cd mcp && npm test -- --run test/tools.test.js`

Expected: PASS.

## Chunk 2: Documentation And Verification

### Task 3: Update docs

**Files:**
- Modify: `mcp/README.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`

- [ ] **Step 1: Update tool counts and table**

Change nine tools to ten, add `exercise_history`, and correct stale comments about eight tools.

- [ ] **Step 2: Update roadmap**

Mark `exercise_history` as done in Phase 1.5 and keep `training_summary` as the next read-only analytics candidate.

### Task 4: Verify

**Files:**
- Read: command output only

- [ ] **Step 1: MCP test suite**

Run: `cd mcp && npm test`

- [ ] **Step 2: MCP Node import check**

Run: `cd mcp && npm run check:node-loadable`

- [ ] **Step 3: Frontend regression tests**

Run: `cd frontend && npm test`

- [ ] **Step 4: Frontend build**

Run: `cd frontend && npm run build`

- [ ] **Step 5: Audit**

Run: `cd mcp && npm audit`

Run: `cd frontend && npm audit`

- [ ] **Step 6: Git status**

Run: `git status --short --branch`
