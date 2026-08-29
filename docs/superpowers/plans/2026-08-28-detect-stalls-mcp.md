# detect_stalls MCP Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-only `detect_stalls` MCP tool for conservative stagnation candidates.

**Architecture:** Add one handler to `mcp/src/tools.js`, reusing existing set labels, mode detection, exercise metadata and 1RM estimate helpers. Keep the heuristic local, transparent, and evidence-first; update MCP contract tests and roadmap docs.

**Tech Stack:** Node ESM, MCP SDK registration model, Zod schemas, Vitest, existing frontend pure helpers.

---

## Chunk 1: Contract Test And Handler

### Task 1: Add failing MCP tests

**Files:**
- Modify: `mcp/test/tools.test.js`

- [ ] **Step 1: Write failing tests**

Add a `detect_stalls` describe block with synthetic state for a stalled reps exercise, routine filtering, and insufficient/non-reps history.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && npm test -- --run test/tools.test.js`

Expected: FAIL with `unknown tool detect_stalls`.

### Task 2: Implement the handler

**Files:**
- Modify: `mcp/src/tools.js`

- [ ] **Step 1: Add helpers**

Add helpers for routine exercise enumeration, per-exercise completed session rows, target-miss detection, top-set labels, and severity.

- [ ] **Step 2: Add `detectStalls` tool**

Register schema `{ window, routine_id }`, scan routine reps exercises, compute evidence, sort candidates by severity and missed count, and return JSON.

- [ ] **Step 3: Update registration**

Append `detectStalls` to `TOOLS` and include required no-state test arguments.

- [ ] **Step 4: Run MCP tests**

Run: `cd mcp && npm test -- --run test/tools.test.js`

Expected: PASS.

## Chunk 2: Documentation And Verification

### Task 3: Update docs

**Files:**
- Modify: `mcp/README.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`

- [ ] **Step 1: Update tool counts and table**

Change eleven tools to twelve and add `detect_stalls`.

- [ ] **Step 2: Update roadmap**

Mark `detect_stalls` as done in Phase 1.5 and keep write tools as the next major phase.

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
