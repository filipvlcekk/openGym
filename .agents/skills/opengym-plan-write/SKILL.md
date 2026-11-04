---
name: opengym-plan-write
description: Use when the user wants to propose or save a dated monthly training plan in openGym through Codex MCP.
---

# Confirmed openGym training plans

Use the `opengym-planning` connection for preview and approved writes. Keep the
original `opengym` connection read-only. An implementation/deployment request or
approval of a prose example does not authorize saving training data. A draft-only
request may preview but must never commit. Refusal means no commit.

Read `get_training_plan({from,to})`, `list_routines`, and relevant `get_routine`
definitions before proposing changes. Use real ISO dates within one calendar month;
confirm the year when context cannot establish it. Unassigned days are not rest
days and planned sessions are not evidence of completed workouts. Stop on missing
authentication or unavailable tools; do not inspect credentials or substitute demo
data. If no state is synced, ask the user to save a routine in openGym first.

Prepare one bounded payload:

- `from`, `to`: inclusive range, at most 31 dates in the same month.
- `new_routines`: at most 8, each with stable unique `id`, `name`, optional
  `policy` and 1–20 unique `exercises` (`exercise_id`, optional `target`). Resolve
  IDs from actual routine/catalog evidence; never invent exercise IDs. Each new
  routine must be used. Keep existing routines such as Push/Pull/Legs intact.
- `days`: exactly one `{date,routine_id}` per date, including explicit `rest`
  overrides on days off so the recurring week cannot fill them with old sessions.
- `expected_revision`: the returned current revision, including zero.

Use separate intro A/B and main A/B routines when prescribed sets change after
the introductory sessions. Do not reuse one routine and promise to edit it later.
Targets use `sets`, `reps`, `repsMin`, `repsMax` or `mode:"time"` with `sec` as
appropriate. Keep the full approved ranges. Omit an unspecified `weight`; neither
zero nor a guessed load represents an unknown load. Default to policy `off` unless
another policy was requested. Unknown IDs or unsupported targets need resolution
before preview; do not substitute a different exercise silently.

Call `apply_training_plan` with the complete payload and `dry_run:true`. Preserve
the exact input, stable IDs, returned revision and `preview_hash`. Show the returned
normalized routines, dates, rest days, set counts/ranges and any replaced date
overrides in the user's language. Include `workout_initialization`: starting sets
may inherit reps, duration and loads from history across routines or `exWeights`,
even when different targets are stored. Explain material differences before
approval; the preview does not change global workout initialization behavior.

State that nothing has been saved. Ask for explicit approval of this concrete
preview. Once approved, commit only the identical proposal with `dry_run:false`,
its `expected_revision` and matching `preview_hash`. The hash binds the normalized
proposal/user/token/revision; it does not prove human approval. Do not treat tool
permission alone as approval of the proposal.

On `STATE_CONFLICT`, `PREVIEW_MISMATCH`, changed targets/dates or routine-ID
collisions, read current state, resolve the difference, preview again and obtain
approval of the new preview. Never silently refresh a revision or rename IDs and
commit under the previous approval.
`new_routines` cannot repair existing definitions. For a collision with different
targets, explain the mismatch and propose fresh IDs for explicit approval, or
leave it unresolved; do not claim that resending an existing ID will edit it.

After a timeout, transport error or `PLAN_COMMIT_UNCERTAIN`, read the dates and
all proposed routine definitions before retrying. The state may have persisted
before audit logging or the response failed. If all assignments and normalized
definitions match, report verified success without another write. If state is
unchanged at the original revision and all proposed IDs are absent, retry only
the exact approved payload/hash. Any other outcome needs reconciliation and a
new preview/approval; never loop blindly or claim automatic idempotency.

After success (including a no-op), re-read `get_training_plan` and every affected
`get_routine`. Verify dates/rest, IDs, exercises/order, policy, sets, mode,
`reps_min`/`reps_max`, seconds and any explicitly provided weights against the
preview, including `bodyweight`, `side`, `increment` and `policy_override` when
provided. Report saved success only after this check. If a field is unavailable,
say what remains unverified; do not turn a missing weight into a prescribed zero.
