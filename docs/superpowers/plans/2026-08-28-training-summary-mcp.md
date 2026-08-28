# training_summary MCP Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-only `training_summary` MCP tool for compact period-level training context.

**Architecture:** Add one handler to `mcp/src/tools.js`, reusing existing frontend helpers for workout volume, set counts, effort aggregation, and muscle load. Keep period parsing as a small fixed enum and update MCP tests plus roadmap docs.

**Tech Stack:** Node ESM, MCP SDK registration model, Zod schemas, Vitest, existing frontend pure helpers.

---

## Chunk 1: Contract Test And Handler

### Task 1: Add failing MCP tests

**Files:**
- Modify: `mcp/test/tools.test.js`

- [ ] **Step 1: Write the failing tests**

Add a `training_summary` describe block covering `6w`, `week`, `all`, and empty history.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && npm test -- --run test/tools.test.js`

Expected: FAIL with `unknown tool training_summary`.

### Task 2: Implement the handler

**Files:**
- Modify: `mcp/src/tools.js`

- [ ] **Step 1: Import existing helpers**

Import effort helpers from `frontend/src/lib/effort.js` and reuse existing history/muscle helpers already present in MCP.

- [ ] **Step 2: Add period/date helpers**

Add fixed `periodDays`, `periodRange`, `inRangeByDate`, and rounding helpers local to `tools.js`.

- [ ] **Step 3: Add `trainingSummary` tool**

Register schema `{ period }`, filter state by date, aggregate workouts/bodyweight/effort/muscle coverage, and return the approved JSON shape.

- [ ] **Step 4: Update registration**

Append `trainingSummary` to `TOOLS` and include required no-state test arguments.

- [ ] **Step 5: Run MCP tests**

Run: `cd mcp && npm test -- --run test/tools.test.js`

Expected: PASS.

## Chunk 2: Documentation And Verification

### Task 3: Update docs

**Files:**
- Modify: `mcp/README.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`

- [ ] **Step 1: Update tool counts and table**

Change ten tools to eleven and add `training_summary`.

- [ ] **Step 2: Update roadmap**

Mark `training_summary` as done in Phase 1.5 and leave `detect_stalls` as the next analytical candidate.

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
