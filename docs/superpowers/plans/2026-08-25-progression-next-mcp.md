# progression_next MCP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `progression_next` MCP tool that exposes openGym's deterministic progression recommendation for one routine exercise.

**Architecture:** Reuse `frontend/src/lib/progression.js::nextPrescription` from `mcp/src/tools.js`. Keep the tool read-only and return structured JSON plus a formatted reason for LLM clients.

**Tech Stack:** Node ESM, MCP SDK, Zod, Vitest, existing openGym frontend pure helper modules.

---

## Chunk 1: MCP Tool

### Task 1: Contract Tests

**Files:**
- Modify: `mcp/test/tools.test.js`

- [ ] Add `progression_next` tests for `up`, `hold`, missing routine, missing exercise, and no-state fallback.
- [ ] Run `cd mcp && npm test`; expected first result is failure because `progression_next` is not registered yet.

### Task 2: Tool Implementation

**Files:**
- Modify: `mcp/src/tools.js`

- [ ] Import `nextPrescription`.
- [ ] Add `progressionNext` tool with `{ routine_id, exercise_id }` schema.
- [ ] Find routine/exercise from state.
- [ ] Delegate to `nextPrescription(S, cfg, routine)`.
- [ ] Return routine, exercise, current target, policy, kind, next target, reason, and confidence.
- [ ] Register tool in `TOOLS`.

### Task 3: Verification

**Commands:**
- `cd mcp && npm test`
- `cd mcp && npm run check:node-loadable`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd mcp && npm audit`
- `cd frontend && npm audit`
