# Confirmed training-plan writes from Codex

Status: proposed implementation; user requested a plan, not execution.

## Outcome and boundaries

Codex can propose a dated training plan, show its exact changes and save the
approved proposal into the same profile used by openGym. The motivating case is
November 2026, alternating new full-body A/B routines with lighter introductory
sessions. This is a software capability, not approval to save that example or
permission to enable live write tokens during planning.

Preserve existing routines, history, active workouts, bodyweight and recurring
weekday assignments. Only add explicitly declared routines and update explicitly
listed date overrides within one month. Days off are explicit `rest` overrides;
otherwise an old recurring Push/Pull/Legs assignment would still take effect.

## Approaches

1. **Recommended: one atomic `apply_training_plan` operation.** Adds routines and
   applies bounded date overrides using the existing state service. One preview,
   one revision check, one commit and one audit event for the whole proposal.
2. Separate `create_routine` plus repeated `override_day` calls: reuses more
   individual operations, but a failure may leave half a month or orphan routines.
3. Plan-file import: already supports new routines and weekly assignments, but
   does not represent dated monthly overrides and requires a manual UI handoff.

The recommendation is an implementation choice for review, not a new requirement
attributed to the user. No batch framework, OAuth, automatic coach, undo service
or new dependency is needed.

## Prerequisite: prevent browser writes from erasing MCP changes

Today `PUT /api/data` calls `replaceUserState` without `expectedRevision`, and
`useStore.pushState` sends full state without handling state-service error bodies.
A stale browser can erase a successfully committed MCP plan. Fix this first.

Require an integer `expected_revision` for authenticated web writes. Return 428
when missing, 409 for a revision conflict, 423 for lock contention, and 422 for
state validation errors. Success returns the acknowledged revision. The client
tracks its last server revision, serializes pushes and retains changes made while
a request was in flight. Mark local edits dirty immediately, including offline
edits. A pull must not silently overwrite dirty local data or automatically push
it over newer server data. Keep active workout data device-local as today.

On conflict, retain the local draft and stop retries. Let the user export it or
explicitly reload server state. Do not introduce a general merge algorithm. No
sign-out or conflict action may silently discard an unsynced draft. Deploy the
API and matching frontend together before enabling planning writes; an older
client receives a reload-required response rather than overwriting state.

## Read contract

Add `get_training_plan({from,to})`, requiring `state:read`. Dates must be real ISO
dates in one calendar month, inclusive and ordered (maximum 31 dates). Return
`revision`, `unit`, the requested range and every date's effective routine/rest,
with its source (`override`, `week`, `unassigned`) and routine name. This gives
Codex the actual monthly state and revision for preview and final verification.
Current `get_week_plan` remains compatible. Do not infer past completion from
current schedule assignments.

`get_routine` currently exposes `reps_min` but omits `reps_max`; return the latter
additively so final verification can compare both saved repetition bounds.

## Write contract

Add `plan:write` to token scopes; map `apply_training_plan` to that single scope.
It permits this narrow operation, not logging workouts, editing existing routines
or changing the indefinite weekly schedule. Reuse `state:read` for planning reads.

Input shape:

```json
{
  "from": "2026-11-04",
  "to": "2026-11-30",
  "new_routines": [
    {
      "id": "nov2026-a-intro",
      "name": "Full body A — introductory",
      "policy": "off",
      "exercises": [
        {
          "exercise_id": "0043",
          "target": {"mode":"reps","sets":2,"repsMin":6,"repsMax":8}
        }
      ]
    }
  ],
  "days": [
    {"date":"2026-11-04","routine_id":"nov2026-a-intro"},
    {"date":"2026-11-05","routine_id":"rest"}
  ],
  "expected_revision": 12,
  "dry_run": true
}
```

The example omits other days/exercises for readability; a valid request must
include exactly one assignment for every date in the range. `new_routines` has
0–8 entries, each with 1–20 unique known catalog/profile exercise IDs. New routine
IDs are stable client-generated strings restricted to safe characters, reserved
`rest` is forbidden, and all IDs must be absent from existing routines. This
operation never overwrites an existing routine, even on an equal-name match.
Routine names are trimmed, nonempty and bounded. Every new routine must be used
by at least one proposed date. Targets reuse `edit_routine` validation, including
mode compatibility, finite numbers and ordered rep bounds; no unknown fields.
Do not import the browser plan parser: it drops invalid exercises silently.

Normalize API names into the existing `{id,name,prog,ex}` state shape. Default
policy is `off`; no invented loads, no mutation of `exWeights`. Preserve omitted
loads as unconfigured and disclose any inherited load used by the existing UI.
Preview exposes normalized stored targets, including both repetition bounds.
The current `defaultConfig` adds `reps:10` and `weight:0`. If only a repetition
range was supplied, set concrete `reps` to `repsMin` rather than leaving 10 outside
a 6–8 range; reject an explicitly supplied `reps` outside its bounds. Remove the
default `weight` when no load was supplied. Existing `buildSets` may seed reps,
duration and loads from historical sessions across routines. Disclose that
behavior and test fresh/history examples; storing a prescription does not change
global workout initialization or overwrite the user's historical performance.

Represent introductory A/B and later A/B as separate declared routines when set
counts differ. Do not rewrite a shared routine later to simulate phased targets.
Existing routines may be referenced by date, but their contents cannot change.
Everything outside the range, including `week`, is unchanged.

## Preview, approval and commit

Both preview and commit enforce the supplied revision. A stale preview returns
`STATE_CONFLICT` before suggesting changes. Preview validates the complete
candidate state without writing state, a proposal file or audit. It returns:
`revision`, `would_change`, exact routine additions and date before/after diffs,
and `preview_hash` over the canonical normalized request, uid, token ID and revision.
Exclude `dry_run` and the hash field itself from canonical input.

Commit requires the identical proposal, revision and `preview_hash`. Recompute
validation and diff from current state; reject a mismatch. This prevents accidental
payload changes between preview and save. It does **not** prove a human clicked
approve: explicit conversational consent is enforced by the Codex workflow and
its tool approval controls, not claimed as a server authentication property.

Apply the whole state mutation once under `updateUserState`'s lock, with a single
revision increment and audit event. Revalidate within the locked callback, not
only against a snapshot read outside it. A failure before state persistence
commits nothing. Existing post-write audit failure behavior must be inspected;
never claim a rollback or exactly-once audit if the existing service cannot prove it.
No-op commits check revision/hash and do not bump revision or append audit.
The current state service always increments revisions. Add opt-in
`skipUnchanged:true` for this operation: compare current/draft under the same
lock after mutation validation, before changing revision, writing or auditing.
Leave all existing callers' default behavior unchanged.

After a lost response, Codex reads the monthly range and proposed stable routine
IDs. If the exact intended state exists, report it as already saved. Otherwise
show the divergence and re-preview; never generate new IDs and blindly retry.

## Codex workflow and access

A dedicated `opengym-plan-write` skill reads current routines and the dated plan,
builds explicit dates (not an unbounded weekday change), calls preview and shows
the changes. It waits for approval of that concrete preview; a request to draft a
plan is not approval to commit. On conflict or changed proposal, request fresh
approval after another preview. Report success only after re-reading saved state.

At rollout, create a separate token with `state:read` + `plan:write`, stored through
the existing protected local header-helper mechanism. Keep the current read-only
connection. Expose only the new planning tool plus needed read tools on the new
connection; configure its writes to prompt. Never print raw MCP configuration or
credentials. Token UI is a separate follow-up; existing signed-in token routes
are enough for this milestone. Planning this implementation does not issue a token.

## Acceptance

- A/B introduction and main variants plus November dates save in one state write.
- All unselected dates, existing routines and user history are unchanged.
- Preview, refusal, invalid input, stale revision and insufficient scopes write nothing.
- Changed payload/hash is rejected; HTTP and stdio enforce the same tool validation.
- Two users cannot read or alter each other's proposal/state; revoked tokens fail.
- A stale open browser cannot erase the saved plan or lose its own unsynced draft.
- Lost-response recovery does not duplicate routines or repeat a commit blindly.
- Tests use temporary data. Live rollout verifies discovery and dry-run only unless
  the user separately approves a specific training plan.
