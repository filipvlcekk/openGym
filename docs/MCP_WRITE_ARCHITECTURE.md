# MCP Write Architecture

This document proposes the Phase 2 architecture for safe write-enabled AI Coach tools in openGym.

Phase 1 and Phase 1.5 are read-only: the MCP server reads `state-<uid>.json` and exposes bounded tools for plans, history, progression, summaries and stall signals. Phase 2 changes the risk profile because MCP will be allowed to mutate the same user state the web UI writes.

The design goal is simple: every write must be authenticated, scoped, validated, conflict-safe, auditable and reversible by normal openGym state recovery.

## Implementation Status

As of 2026-09-04:

- Done: `api/state-service.js` owns API state reads and full-state replacement.
- Done: `updateUserState(uid, mutation, options)` supports per-user locks, `_revision` increments and optional `expectedRevision` conflict checks.
- Done: `PUT /api/data` goes through the state service while keeping the existing response shape.
- Done: `api/token-service.js` can create, verify, scope-check, list and revoke hashed MCP tokens.
- Done: authenticated token management HTTP routes exist for create, list and revoke.
- Done: `mcp/src/write-auth.js` verifies `OPENGYM_MCP_TOKEN` with optional required scopes.
- Done: `api/audit-service.js` writes scrubbed JSONL audit events for committed state writes.
- Done: `override_day` is the first MCP write tool with dry-run, `schedule:write`, revision checks and audit-backed commits.
- Done: `assign_weekday` updates recurring weekly schedule assignments with `schedule:write`, dry-run, revision checks and audit-backed commits.
- Done: `edit_routine` supports structured patch ops with `routine:write`: `set_policy`, `set_exercise_target`, `add_exercise`, `remove_exercise`, `reorder_exercise`, `link_superset` and `unlink_superset`.
- Done: `add_bodyweight` adds or replaces one weigh-in with `bodyweight:write`, dry-run, revision checks and audit-backed commits.
- Done: `log_workout` stores a completed workout for an existing routine from structured JSON with `workout:write`, dry-run, revision checks and audit-backed commits.
- Done: `log_freestyle_workout` stores a completed freestyle workout with `routineId: null`, catalog/custom exercise ids, per-entry targets, `workout:write`, dry-run, revision checks and audit-backed commits.
- Done: `create_custom_exercise` creates one custom exercise with `exercise:write`, dry-run, revision checks and audit-backed commits.
- Done: `api/state-validation.js` rejects invalid shared state shape before writes are committed or audited.
- Not done: deeper shared workout/set validation.

## Current State

The API server is a single Node process in `api/server.js`.

Current persistence model:

- `db.json` stores users, passkey credentials, push subscriptions and invites.
- `state-<uid>.json` stores the user's openGym state.
- `PUT /api/data` accepts a full state object from the signed-in web client.
- The API writes state with temp-file plus `rename`.
- MCP read tools currently read the same state file through `mcp/src/state.js`.
- MCP write tools use `OPENGYM_MCP_TOKEN` auth and write through the shared state service.

The important existing gap is not atomicity alone. `rename` prevents a partially-written file, but it does not prevent lost updates when two writers read the same old state and later overwrite each other.

## Recommended Architecture

Introduce a shared state mutation layer used by both the HTTP API and MCP write tools:

```text
api/server.js
  -> api/state-service.js

mcp/src/tools/write/*.js
  -> mcp/src/write-client.js
  -> api/state-service.js or equivalent local module
```

The core function should be:

```javascript
updateUserState(uid, mutation, options)
```

Responsibilities:

- acquire a per-user lock;
- read the latest `state-<uid>.json`;
- verify expected revision when provided;
- apply one narrow mutation;
- validate the resulting state shape;
- increment revision;
- write atomically;
- append an audit event;
- release the lock.

No write tool should read the full state, mutate it ad hoc and write it back directly.

## Why A Shared Layer

If only MCP uses a lock, the web UI can still overwrite MCP writes through `PUT /api/data`.

If only the web UI uses a lock, MCP can overwrite UI writes.

The lock has to sit underneath both paths:

```text
Web UI PUT /api/data ─┐
                      ├─ updateUserState(uid, mutation)
MCP write tool ───────┘
```

That gives one place for locking, revision checks, atomic writes, validation and audit.

## Token Auth

MCP write tools need their own long-lived token because they are not running inside the user's browser session and cannot use the HttpOnly `gymsid` cookie.

Recommended storage:

```text
data/tokens.json
```

Recommended token record:

```json
{
  "id": "tok_abc",
  "uid": "user-id",
  "name": "Claude Desktop on MacBook",
  "hash": "sha256-or-hmac-token-hash",
  "scopes": ["schedule:write", "routine:write"],
  "created_at": "2026-08-28T12:00:00.000Z",
  "last_used_at": "2026-08-28T12:10:00.000Z",
  "revoked_at": null
}
```

The raw token should be shown only once when created. Store only a hash. Compare hashes with `crypto.timingSafeEqual`.

Recommended token format:

```text
ogmcp_<token_id>_<random_secret>
```

This lets the verifier find the token record by id and compare only the secret hash.

## Token Creation

Token creation should be an authenticated web/admin action, not an MCP action.

Recommended API:

```text
POST /api/mcp/tokens
GET  /api/mcp/tokens
POST /api/mcp/tokens/revoke
```

For a personal instance, the first version can allow any signed-in user to create a token for their own profile. Admin-created tokens for other users can come later.

The UI should show:

- token name;
- scopes;
- creation time;
- last used time;
- revoked status;
- revoke button.

## Scopes

Use narrow scopes so one token does not automatically imply every write capability.

Recommended initial scopes:

```text
schedule:write   override_day, assign_weekday
routine:write    edit_routine
workout:write    log_workout, log_freestyle_workout
bodyweight:write add_bodyweight
exercise:write   create_custom_exercise
```

Read tools can stay filesystem-only initially, but once write auth exists it is cleaner to require token auth for write tools and leave read-only tools unchanged.

## MCP Environment

The MCP client config should pass:

```json
{
  "env": {
    "OPENGYM_DATA": "/absolute/path/to/data",
    "OPENGYM_MCP_TOKEN": "ogmcp_tok_abc_secret"
  }
}
```

`OPENGYM_UID` should still be supported for read-only disambiguation, but write tools should derive `uid` from the verified token. That prevents a token for one profile from writing another profile by changing an environment variable.

## Revision And Conflict Handling

Add a state revision field:

```json
{
  "_revision": 184
}
```

Every successful write increments it.

Write tools should support:

```json
{
  "expected_revision": 184
}
```

If the current state revision differs, return a structured conflict:

```json
{
  "ok": false,
  "error": {
    "code": "STATE_CONFLICT",
    "message": "State changed since the tool read it.",
    "current_revision": 185
  }
}
```

The AI client must re-read the relevant state and recompute its proposal. It must not retry the same stale mutation blindly.

## Locking

Use a per-user lock file:

```text
data/locks/state-<uid>.lock
```

Recommended lock behavior:

- acquire lock with exclusive create (`open` with `wx`);
- write metadata into the lock file: pid, uid, operation, timestamp;
- use a short timeout, for example 5 seconds;
- treat stale locks conservatively, for example older than 30 seconds;
- always release in `finally`.

Node has no built-in cross-process mutex, so lock files are the simplest fit for this file-based architecture. The critical section should stay small: read, mutate, validate, write.

## Atomic Write

The current `atomicWrite` uses temp file plus `rename`. Keep that, but make it stricter for state writes:

```text
1. write JSON to a unique temp file in the same directory
2. fsync the temp file
3. rename temp -> state-<uid>.json
4. fsync the directory when supported
```

Same-directory rename is the key property. Do not write temp files in `/tmp` and then move across filesystems.

## Mutation Shape

Write tools should be narrow and explicit.

Do not add:

```text
replace_state(json)
```

Initial tools:

```text
override_day
assign_weekday
edit_routine
add_bodyweight
log_workout
log_freestyle_workout
create_custom_exercise
```

`override_day`:

```json
{
  "date": "2026-08-26",
  "routine_id": "upper-a",
  "expected_revision": 184,
  "dry_run": true
}
```

`assign_weekday`:

```json
{
  "weekday": 1,
  "routine_id": "push",
  "expected_revision": 184,
  "dry_run": true
}
```

`edit_routine` is patch-based, not whole-routine replacement. Supported ops are limited to existing routines and catalog/custom exercise ids:

```json
{
  "routine_id": "push",
  "ops": [
    { "op": "set_exercise_target", "exercise_id": "0426", "weight": 27.5, "reps": 10 },
    { "op": "set_policy", "policy": "linear" },
    { "op": "add_exercise", "exercise_id": "0739", "position": 2, "target": { "sets": 4, "mode": "reps", "reps": 8, "weight": 120 } },
    { "op": "remove_exercise", "exercise_id": "plank" },
    { "op": "reorder_exercise", "exercise_id": "1323", "position": 1 },
    { "op": "link_superset", "exercise_id": "0739" },
    { "op": "unlink_superset", "exercise_id": "1323" }
  ],
  "expected_revision": 184,
  "dry_run": true
}
```

The tool accepts at most 10 ops per call. The public MCP field is `policy`, while current openGym state stores routine progression in `prog`; MCP read/write code normalizes that boundary. `add_exercise` starts from the same default target config the UI uses, then applies the supplied target patch. `remove_exercise`, `reorder_exercise` and `unlink_superset` run `cleanupSg` so orphan superset ids are not left behind. `link_superset` links an exercise to the previous exercise only; MCP generates the `sg` id server-side instead of accepting arbitrary group ids from the client.

`add_bodyweight` writes the same shape as the React UI:

```json
{
  "date": "2026-08-30",
  "weight": 78.4,
  "expected_revision": 184,
  "dry_run": true
}
```

If the date already exists, the entry is replaced rather than duplicated. The stored state keeps `bodyweight` sorted by date.

`log_workout` writes a finished workout for an existing routine only. Natural language parsing stays in the LLM client; MCP receives structured JSON:

```json
{
  "routine_id": "push",
  "date": "2026-08-30",
  "duration_min": 62,
  "bodyweight": 78.4,
  "entries": [
    {
      "exercise_id": "0426",
      "sets": [
        { "w": 25, "r": 10 },
        { "w": 25, "r": 8 }
      ]
    }
  ],
  "expected_revision": 184,
  "dry_run": true
}
```

The tool rejects unknown routines, exercises outside the routine, duplicate exercise entries and invalid mode-specific set shapes. It stores entries in routine order, copies each routine target into the workout entry, forces supplied sets to `done: true`, computes `vol`, `prs` and `exWeights`, and records compact audit details without logging full state snapshots.

`log_freestyle_workout` writes a finished workout that is not tied to a routine. Natural language parsing still stays in the LLM client; MCP receives structured JSON with concrete catalog or `customEx` exercise ids:

```json
{
  "name": "Hotel gym",
  "date": "2026-09-04",
  "duration_min": 45,
  "entries": [
    {
      "exercise_id": "0426",
      "target": { "mode": "reps", "sets": 3, "reps": 10, "weight": 25 },
      "sets": [
        { "w": 25, "r": 10 },
        { "w": 25, "r": 8 }
      ]
    }
  ],
  "expected_revision": 184,
  "dry_run": true
}
```

It stores `routineId: null`, defaults the name to `Freestyle`, preserves input entry order, accepts catalog or `customEx` exercise ids, normalizes per-entry targets from submitted sets plus explicit target overrides, forces supplied sets to `done: true`, computes `vol`, `prs` and `exWeights`, and records compact audit details without logging full set payloads. It does not do fuzzy matching, natural-language workout parsing, exercise creation or existing workout edits.

## Dry Run

Every write tool should support `dry_run: true`.

Dry-run response:

```json
{
  "ok": true,
  "dry_run": true,
  "would_change": true,
  "revision": 184,
  "changes": [
    {
      "path": "dayPlan.2026-08-26",
      "before": "rest",
      "after": "upper-a"
    }
  ]
}
```

Commit response:

```json
{
  "ok": true,
  "dry_run": false,
  "changed": true,
  "revision_before": 184,
  "revision_after": 185,
  "changes": [
    {
      "path": "dayPlan.2026-08-26",
      "before": "rest",
      "after": "upper-a"
    }
  ]
}
```

The AI workflow should be:

```text
1. read current state through read tools
2. call write tool with dry_run=true
3. explain proposed changes to the user
4. wait for explicit confirmation
5. call the same write tool with dry_run=false and expected_revision
6. report the committed result
```

## Validation

Shared state validation now happens after mutation sanitization and before `atomicWrite()`/audit logging in `api/state-service.js`.

Input validation examples:

- ISO dates must be exact `YYYY-MM-DD`;
- `weekday` must be `0..6` or an accepted weekday string normalized to `0..6`;
- `routine_id` must exist unless the operation explicitly supports `rest`;
- exercise ids in `set_exercise_target`, `remove_exercise` and `reorder_exercise` must exist inside that routine;
- exercise ids in `add_exercise` must exist in the catalog or `customEx`, and must not already exist inside that routine;
- weights, reps, sets, seconds and speeds must stay finite and within sane bounds;
- operation list length should be capped.
- `log_workout` entries must reference exercises inside the selected routine and match reps/time/cardio set shape.
- `log_freestyle_workout` entries must reference catalog or `customEx` exercise ids and match reps/time/cardio set shape after target inference.

Current state validation covers:

- `routines` remains an array;
- routine ids remain unique;
- `week` only references existing routine ids;
- `dayPlan` values are existing routine ids or `rest`;
- `dayPlan` and bodyweight dates are exact `YYYY-MM-DD`;
- bodyweight entries use unique dates and positive finite weights;
- `workouts` is an array with basic date and entries-array shape;
- no `active` workout is persisted from write tools.

Deeper set-level workout validation is intentionally future work so existing imported history is not rejected prematurely.

## Audit Log

Append one audit event for every committed write:

```text
data/audit.log
```

JSONL event:

```json
{
  "at": "2026-08-28T12:15:00.000Z",
  "uid": "user-id",
  "actor": "mcp",
  "token_id": "tok_abc",
  "tool": "override_day",
  "revision_before": 184,
  "revision_after": 185,
  "changes": [
    { "path": "dayPlan.2026-08-26", "before": "rest", "after": "upper-a" }
  ]
}
```

Do not log raw tokens. Avoid logging complete state snapshots.

## Error Shape

Write tools should return structured errors:

```json
{
  "ok": false,
  "error": {
    "code": "ROUTINE_NOT_FOUND",
    "message": "Routine 'upper-z' does not exist."
  }
}
```

Recommended codes:

```text
UNAUTHORIZED
FORBIDDEN
TOKEN_REVOKED
STATE_CONFLICT
VALIDATION_ERROR
ROUTINE_NOT_FOUND
EXERCISE_NOT_FOUND
LOCK_TIMEOUT
WRITE_FAILED
```

## Idempotence

Write tools should be idempotent where practical.

Example:

```text
assign_weekday(1, "push")
```

If Monday is already assigned to Push, return:

```json
{
  "ok": true,
  "changed": false,
  "reason": "already_assigned"
}
```

This reduces risk from repeated tool calls.

## Proposed File Layout

Minimal first implementation:

```text
api/
├── server.js
├── state-service.js
├── token-service.js
└── audit-service.js

mcp/src/
├── state.js
├── tools.js
└── write-auth.js
```

If `tools.js` grows too large, split later:

```text
mcp/src/tools/
├── read.js
├── write.js
└── shared.js
```

Do not split first just for neatness; split when it reduces real complexity.

## Implementation Order

1. Done: Extract API state read/write into `api/state-service.js` without behavior changes.
2. Done: Add `_revision` handling and per-user lock inside `updateUserState`.
3. Done: Change `PUT /api/data` to use `updateUserState`.
4. Done: Add token service and token management API.
5. Done: Add MCP write auth from `OPENGYM_MCP_TOKEN`.
6. Done: Implement `override_day` with dry-run first.
7. Done: Implement `assign_weekday`.
8. Done: Implement narrow `edit_routine` patch ops for routine policy and existing exercise targets.
9. Done: Implement `add_bodyweight`.
10. Done: Add shared state validation.
11. Done: Add audit log tests and conflict tests.
12. Done: Implement structured `log_workout` for existing routines.
13. Done: Extend `edit_routine` with add/remove/reorder exercise ops.
14. Done: Extend `edit_routine` with direct superset link/unlink ops.
15. Done: Implement structured `log_freestyle_workout` for routine-less completed workouts.

## Testing Strategy

Unit tests:

- lock acquisition and release;
- stale lock behavior;
- revision increment;
- conflict on stale expected revision;
- token verification, scope checks and revoked tokens;
- mutation validation;
- idempotent no-op writes.

Integration tests:

- `PUT /api/data` and MCP write both go through `updateUserState`;
- two concurrent writes do not lose data;
- dry-run returns changes but does not write;
- commit writes audit event without raw token;
- revoked token cannot write.

Regression test for the main failure mode:

```text
1. read state revision 10 in writer A
2. read state revision 10 in writer B
3. writer A commits revision 11
4. writer B tries expected_revision=10
5. writer B receives STATE_CONFLICT and state remains revision 11
```

## Open Decisions

- Whether token creation is user-self-service or admin-only in the first version.
- Whether `PUT /api/data` should require `expected_revision` immediately or accept it optionally during a compatibility window.
- Whether audit events should rotate by size or date.

## Recommendation

Build Phase 2 in this order:

```text
state-service + lock + revision
token-service + scopes
override_day
assign_weekday
edit_routine
add_bodyweight
log_workout
create_custom_exercise
log_freestyle_workout
future: deeper shared workout/set validation
```

This keeps the first write tool small and proves the safety model before editing routines, which has a larger blast radius.
