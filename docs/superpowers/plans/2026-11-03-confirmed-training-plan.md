# Confirmed Training Plan Implementation Plan

> **For agentic workers:** REQUIRED: use superpowers:subagent-driven-development when executing with subagents, otherwise superpowers:executing-plans. This document plans work only; do not execute on a request to plan.

**Goal:** Let Codex save a user-approved dated training proposal atomically without losing browser or MCP changes.

**Architecture:** First fix shared revision-aware browser synchronization. Add bounded monthly read/write MCP tools using the existing state service, target validation and token mechanism. Add a small preview/approval/verification skill.

**Tech Stack:** Node ESM, Zod, existing MCP SDK, Vitest, React/Zustand and Node test runner. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-03-confirmed-training-plan-design.md`.

**Status:** proposed; no product implementation, token changes or live plan writes performed.

## Chunk 1: Close the lost-update path before enabling writes

### Task 1: Revision-aware API contract

Files: `api/server.js`, `api/state-service.js`, `api/test/state-service.test.js`;
create a focused data-route test file/module only if needed to test real routing.

- [ ] Trace every `PUT /api/data`, `replaceUserState` caller and error consumer.
- [ ] Add failing tests for revision 12 saved by MCP as 13 followed by a web PUT
  with revision 12: HTTP 409, saved state remains 13, no extra audit event.
- [ ] Test missing revision (428), invalid revision (400), lock failure (423),
  invalid state (422), initial absent state (expected revision 0) and successful
  acknowledgement of the new revision.
- [ ] Wire `body.expected_revision` to `replaceUserState(...,{expectedRevision})`.
  Return non-2xx for `{ok:false}`; preserve machine-readable codes/details.
  Return `{ok:true,revision,ts}` for successful writes.
- [ ] Run `cd api && npm test`; verify a conflict cannot overwrite routines/history.

### Task 2: Preserve unsynced browser changes

Files: `frontend/src/store/useStore.js`, `frontend/src/lib/api.js`,
`frontend/src/views/Settings.jsx` if conflict recovery needs controls;
create `frontend/src/store/useStore.test.js` with minimal browser/API mocks.

- [ ] Add failing tests for stale-server conflicts, failed pushes, concurrent local
  edits during an in-flight push, dirty reloads and active workout preservation.
- [ ] Mark edits dirty before debounce; send the last acknowledged server revision.
  Serialize pushes. Apply acknowledgement only to revision metadata; never replace
  newer local edits with the old request snapshot or mark them clean prematurely.
- [ ] Preserve API code/details on errors. Check `{ok:false}` during transition;
  never treat a failed state-service response as synchronized.
- [ ] Pull by server revision rather than `_ts` superiority. Retain dirty local data
  on conflict, stop automatic overwrite/retry, and retain the draft across reload.
- [ ] Provide existing export-backup plus explicit reload-server recovery. Keep
  export tied to the retained local draft. Do not silently discard on sign-out.
- [ ] Test two queued local edits, server advance during offline use, first sync,
  sign-out failure, explicit recovery and confirmation that old clients get 428.
- [ ] Run `cd frontend && npm test` and `npm run build`; use existing UI components.

Deploy this chunk (API and frontend together) before any write-enabled connection
is configured. Keep the current token read-only. Rollback must not re-enable
unconditional full-state overwrites while plan writes remain enabled.

## Chunk 2: Bounded read, preview and atomic plan commit

### Task 3: Monthly read tool

Files: `mcp/src/tools.js`, `mcp/src/tool-scopes.js`,
create `mcp/test/training-plan.test.js`; update affected registry-count tests.

- [ ] Add failing tests for `get_training_plan({from,to})`: current revision,
  inclusive dates, override precedence, explicit rest, week fallback, unassigned
  dates, routine names, cross-month/reversed/impossible dates and two users.
- [ ] Implement schema and real-date range validation using existing ISO/date
  helpers. Bound to one calendar month / 31 dates. Return `revision` + `unit` +
  `date_range` + daily effective assignment/source; map to `state:read`.
- [ ] Preserve the shape and behavior of existing `get_week_plan`.
- [ ] Add the missing optional `reps_max` field to `get_routine` alongside existing
  `reps_min`; test both bounds survive a read after saving. This additive read
  correction is required to verify the approved routine definitions exactly.
- [ ] Run `cd mcp && npm test -- test/training-plan.test.js test/tool-scopes.test.js`.

### Task 4: Plan contract and dry-run

Files: `mcp/src/tools.js`, `mcp/test/training-plan.test.js`,
`api/token-service.js`, `api/test/token-service.test.js`, `mcp/src/tool-scopes.js`.

- [ ] Add `plan:write` scope and acceptance/rejection tests; existing scope names
  retain their behavior. Map only `apply_training_plan` to the new scope.
- [ ] Add strict schemas for spec fields: `from`,`to`,`new_routines`,`days`,
  `expected_revision`,`dry_run` (defaults true), optional `preview_hash`.
- [ ] Test limits (8 routines, 20 exercises each, 31 days), unknown fields,
  missing/duplicate dates, unknown exercises, duplicate/reserved/existing IDs,
  unused new routines, unknown schedule references and reversed rep ranges.
- [ ] Reuse existing routine target normalization and known-exercise resolution.
  Extract a helper only if shared code actually needs it; preserve old callers'
  validation. Store app-native `prog`/`ex` fields, preserve unspecified loads.
- [ ] Guard `defaultConfig`'s implicit `reps:10`/`weight:0`: when only rep bounds
  are supplied, use `repsMin` as concrete `reps`; reject an explicit rep target
  outside the bounds. Delete generated weight when input omitted it. Test actual
  `buildSets` on empty and existing exercise history. Disclose existing inherited
  reps, duration and loads across routines; do not alter global workout behavior.
- [ ] Build the candidate state and exact diff using narrow routines/dayPlan
  changes; validate candidate state in preview as well as commit.
- [ ] Compare expected revision before preview. Hash canonical normalized proposal,
  uid, token ID and revision with Node crypto. Specify stable key ordering and
  exclude `dry_run`/`preview_hash`; do not include current time or random IDs.
- [ ] Test that preview produces stable IDs/diffs/hash, no state/audit changes,
  and no effect on week, active workout, exWeights, existing routines or history.

### Task 5: Atomic commit, conflict and retry behavior

Files: `mcp/src/tools.js`, `mcp/test/training-plan.test.js`,
`api/state-service.js`, `api/test/state-service.test.js`.

- [ ] Test `dry_run:false` without/mismatching hash, changed targets/dates,
  another user/token hash, stale revision and invalid current references.
- [ ] Require revision + matching preview hash; recompute from current locked state.
  Call `updateUserState` once with `operation:'apply_training_plan'`, token actor
  and bounded routine/date details. Do not call separate writes in a loop.
- [ ] Test all-or-nothing validation, one revision increment, one audit event,
  no raw token, no writes outside range and no mutation of pre-existing routines.
- [ ] Test no-op behavior (schedule-only request): correct revision/hash, unchanged
  revision and audit. A no-op still enforces all permissions and preconditions.
- [ ] Add minimal opt-in `skipUnchanged:true` handling to `updateUserState`:
  compare validated mutation with current state under lock before revising,
  persisting or auditing, and return `{ok:true,changed:false,revision,ts}` on an
  equal draft. Existing calls without the option still increment as before.
  Test that stale no-op rejects, lock is released and no audit/state write occurs;
  `apply_training_plan` enables this option and honors its result.
- [ ] Simulate response loss: saved exact stable routine IDs and assignments can
  be discovered, stale retry conflicts, changed collision rejects. Document how
  the client reconciles results rather than promising automatic idempotency.
- [ ] Inspect post-persistence audit failures. Test/report actual failure boundary
  and reconcile from state; do not invent transactional state-plus-log guarantees.

### Task 6: Real transport and regression coverage

Files: `mcp/test/streamable-http.test.js`, `mcp/test/http.test.js`,
`mcp/test/tool-scopes.test.js`, `mcp/test/tools.test.js`; registry maps in tools.js.

- [ ] Register both tools and update count/no-state/schema assertions.
- [ ] Real SDK client: initialize/list/read/preview/commit in a temp profile;
  verify typed schemas, unknown-field rejection, write/read scope separation,
  revoked token, user isolation, body limits and write rate limiting.
- [ ] Keep custom HTTP and stdio behavior working; preserve deny-by-default scope map.
- [ ] Run full `cd api && npm test`, `cd mcp && npm test`,
  `npm run check:node-loadable`, `cd frontend && npm test`, `npm run build`.

## Chunk 3: Explicit approval workflow and rollout

### Task 7: Codex planning skill

Create `.agents/skills/opengym-plan-write/SKILL.md`; install a validated copy in
`~/.codex/skills/opengym-plan-write/` only during approved rollout.

- [ ] Before/after behavior scenarios: draft-only request never commits; a clear
  approval of a shown preview commits only that payload; refusal does nothing;
  conflict/changed payload requires new preview and approval.
- [ ] Read monthly plan + existing routines, resolve exercise IDs, and use explicit
  dated `rest` overrides. Represent intro A/B and main A/B as separate routines.
- [ ] Display target rep ranges and set counts per phase; no invented load numbers.
  Unspecified load remains unconfigured. Do not overwrite existing Push/Pull/Legs.
- [ ] Preserve stable IDs/hash across retries. On ambiguous errors re-read state;
  verify routine definitions as well as calendar dates before reporting success.
- [ ] Validate skill via `skill-creator/scripts/quick_validate.py`; forward-test
  sparse data, old plan collisions, refusal and conflict scenarios.

### Task 8: Documentation, client access and deployment

Files: `mcp/README.md`, `docs/MCP_WRITE_ARCHITECTURE.md`, `docs/OPENSHIP.md`,
`docs/openGym_AI_Coach_MCP_dokumentace.md`, this plan; local protected Codex config.

- [ ] Update scope/tool docs, date/retry semantics, revision requirements and counts.
- [ ] Independent review of diff, transport tests and sync conflict path;
  fix blockers, run `git diff --check`, commit/push intended files only.
- [ ] Back up the existing data volume before rollout and verify backup exists.
  Deploy API/frontend revision protection first, then MCP tools. Preserve volumes.
- [ ] Add separate `opengym-planning` Codex connection only on execution approval:
  token `state:read` + `plan:write`, protected header helper, allowlist needed
  reads + `apply_training_plan`, write tool approval prompts enabled. Keep original
  read-only connection. No workout/bodyweight/exercise/other routine write scopes.
- [ ] Verify discovery and preview through real Codex CLI. Confirm no state changes
  and no secret printed. Exercise commits only in a temporary integration profile.
- [ ] Live training plan save requires separate approval of its concrete preview.
  Re-read actual saved month and routines afterward. Do not execute the November
  example merely because implementation or deployment was approved.
- [ ] Record deployment IDs, tests, limitations and completion checkboxes.

## Acceptance scenario: the November proposal

Use a temporary profile with original Monday Push / Wednesday Pull / Friday Legs,
old history and an uncommitted browser edit. Prepare Nov 4–30 inclusive, with two
introductory full-body variants for Nov 4/6 and regular A/B variants afterward.
Every date in range must have an explicit assignment or rest. The skill uses
the exact approved alternating sequence; the server does not invent a training
schedule. The first two sessions retain two working sets; later sessions retain
the approved higher counts and repetition ranges, including plank seconds.

After approval, all four new routines and all 27 date overrides appear together;
Nov 1–3, Dec 1 onward and original routines/history/week remain byte-equivalent.
A stale browser cannot overwrite them, and the user's offline draft remains
recoverable. Refusal, stale revision or validation error leaves no half-plan.

## Deferred

Token management UI, arbitrary routine editing in this tool, whole-state import,
plan undo service, custom-exercise creation, weekly schedule replacement, background
coaching, reminders and automatic generation of load prescriptions.
