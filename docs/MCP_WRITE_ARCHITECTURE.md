# MCP Write Architecture

This document proposes the Phase 2 architecture for safe write-enabled AI Coach tools in openGym.

Phase 1 and Phase 1.5 are read-only: the MCP server reads `state-<uid>.json` and exposes bounded tools for plans, history, progression, summaries and stall signals. Phase 2 changes the risk profile because MCP will be allowed to mutate the same user state the web UI writes.

The design goal is simple: every write must be authenticated, scoped, validated, conflict-safe, auditable and reversible by normal openGym state recovery.

## Current State

The API server is a single Node process in `api/server.js`.

Current persistence model:

- `db.json` stores users, passkey credentials, push subscriptions and invites.
- `state-<uid>.json` stores the user's openGym state.
- `PUT /api/data` accepts a full state object from the signed-in web client.
- The API writes state with temp-file plus `rename`.
- MCP currently reads the same state file through `mcp/src/state.js`.
- MCP has no write tools and no separate auth.

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
workout:write    future log_workout
bodyweight:write future add_bodyweight
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

`edit_routine` should be patch-based, not whole-routine replacement:

```json
{
  "routine_id": "push",
  "ops": [
    { "op": "set_exercise_target", "exercise_id": "0426", "weight": 27.5, "reps": 10 },
    { "op": "set_policy", "policy": "linear" }
  ],
  "expected_revision": 184,
  "dry_run": true
}
```

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

Validation should happen before and after mutation.

Input validation examples:

- ISO dates must be exact `YYYY-MM-DD`;
- `weekday` must be `0..6` or an accepted weekday string normalized to `0..6`;
- `routine_id` must exist unless the operation explicitly supports `rest`;
- exercise ids in `edit_routine` must exist inside that routine;
- weights, reps, sets, seconds and speeds must stay finite and within sane bounds;
- operation list length should be capped.

State validation examples:

- `routines` remains an array;
- routine ids remain unique;
- `week` only references existing routine ids;
- `dayPlan` values are existing routine ids or `rest`;
- no `active` workout is persisted from write tools.

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

1. Extract API state read/write into `api/state-service.js` without behavior changes.
2. Add `_revision` handling and per-user lock inside `updateUserState`.
3. Change `PUT /api/data` to use `updateUserState`.
4. Add token service and token management API.
5. Add MCP write auth from `OPENGYM_MCP_TOKEN`.
6. Implement `override_day` with dry-run first.
7. Implement `assign_weekday`.
8. Implement narrow `edit_routine` patch ops.
9. Add audit log tests and conflict tests.

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
- Exact maximum operation count for `edit_routine`.
- Whether audit events should rotate by size or date.

## Recommendation

Build Phase 2 in this order:

```text
state-service + lock + revision
token-service + scopes
override_day
assign_weekday
edit_routine
```

This keeps the first write tool small and proves the safety model before editing routines, which has a larger blast radius.
