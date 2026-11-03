# On-demand Weekly Review Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated implementation and review tasks. Steps use checkbox syntax for tracking.

**Goal:** Deliver the first Phase 4 milestone as an on-demand Codex review using existing MCP tools.

**Architecture:** A small reusable skill composes existing read operations. Correct the effort display scale in the shared summary handler; retain existing JSON contracts and access controls.

**Tech Stack:** Codex skills, Node ESM, existing MCP handlers and Vitest.

## Chunk 1: Correct and reuse existing evidence

### Task 1: Summary effort correction

Files: `mcp/src/tools.js`, `mcp/test/tools.test.js`.

- [x] Add an RPE regression and observe it fail against the existing RIR-valued result.
- [x] Convert `effort.avg` with `frontend/src/lib/effort.js::toScale`; retain null below the rating threshold.
- [x] Run `cd mcp && npm test` and `npm run check:node-loadable`; preserve RIR and hard_pct contracts.

Result: two RPE tests failed with expected 8, received 2 before the fix. All 182
tests and Node import checks passed afterward. RIR, imported RPE and sparse
ratings are covered. hard_pct remains the existing one-decimal ratio.

### Task 2: Reusable review skill

Files: `.agents/skills/opengym-weekly-review/SKILL.md`, installed copy in `~/.codex/skills/opengym-weekly-review/SKILL.md`.

- [x] Evaluate a fixed sparse-data scenario before creating the skill; record actual behavior.
- [x] Write minimal instructions for existing summary, stall and plan tools, date windows, missing data and read-only recommendations.
- [x] Run `python3 /Users/filip/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/opengym-weekly-review`.
- [x] Forward-test the same scenario and exercise the skill against the live read-only connection.
- [x] Install the validated skill without replacing unrelated skills or editing the MCP token.

Result: baseline called four sessions "four weeks" and invented kg despite a
missing unit. The forward test correctly distinguished sessions, units and
unknown historical adherence. Both skill copies validate. Live calls to week/6w
summary, stalls and plan succeeded; no completed workouts were recorded, so no
progress or deload assessment was made.

### Task 3: Record and deploy

Files: `mcp/README.md`, `docs/openGym_AI_Coach_MCP_dokumentace.md`, `docs/OPENSHIP.md`, this plan.

- [x] Mark Phase 2/3 implementation complete and describe the limited Phase 4 milestone; retain historical verification records.
- [ ] Review, run `git diff --check`, commit and push only intended files.
- [ ] Deploy the MCP correction through the existing Openship project with persistent volumes preserved.
- [ ] Verify authenticated summaries, document results and remaining automatic coaching work.
