# State Validation Design

## Context

Phase 2 MCP writes now use the shared `api/state-service.js` layer for schedule, routine and bodyweight mutations. Before adding higher-blast-radius writes such as `log_workout`, the same layer should reject obviously broken state shapes for both MCP mutations and the web `PUT /api/data` full-state path.

The goal is not a complete historical schema for every openGym state field. Existing self-hosted users may carry older or imported data that the UI tolerates. The first validator should protect the invariants required by current write tools and by routine scheduling.

## Recommended Approach

Use a narrow structural validator in a new `api/state-validation.js` module.

`api/state-service.js` should call `validateState(next)` after removing `active` and setting the next `_revision`, but before `atomicWrite()` and before audit logging. Validation failures return a structured result and do not write the state file.

Failure shape:

```json
{
  "ok": false,
  "error": {
    "code": "STATE_VALIDATION_FAILED",
    "message": "State validation failed.",
    "issues": [
      { "path": "week.1", "message": "references unknown routine id missing" }
    ]
  }
}
```

## Initial Invariants

Validate only the contracts that matter for current and near-future writes:

- root state is an object;
- `_revision` is a non-negative integer when present;
- `routines` is an array when present;
- every routine has a non-empty string `id`;
- routine ids are unique;
- routine `ex` is an array when present;
- `week` is an object when present;
- `week` keys are weekday numbers `0..6`;
- `week` values reference existing routine ids;
- `dayPlan` is an object when present;
- `dayPlan` keys are exact ISO dates;
- `dayPlan` values are existing routine ids or `rest`;
- `bodyweight` is an array when present;
- every bodyweight entry has exact ISO date `d`;
- bodyweight dates are unique;
- every bodyweight `w` is a positive finite number;
- optional bodyweight `t` is a finite number;
- `workouts` is an array when present;
- workout `d`, when present, is an exact ISO date;
- workout `entries`, when present, is an array.

## Explicit Non-Goals

Do not validate the complete exercise catalog, all workout set shapes, imported CSV edge cases, passkey data, UI preferences, or every optional openGym field in this step.

Do not require `PUT /api/data` callers to send `expected_revision` yet. That remains a compatibility decision separate from shape validation.

## Data Flow

```text
Web PUT /api/data ─┐
                   ├─ state-service updateUserState()
MCP write tool ────┘
                         │
                         ├─ remove active
                         ├─ set next _revision
                         ├─ validateState(next)
                         ├─ atomicWrite()
                         └─ audit event
```

## Testing

Add API-level tests around `state-service` because that is the shared write boundary:

- `replaceUserState` rejects a `week` reference to an unknown routine id;
- `updateUserState` rejects duplicate routine ids and does not audit;
- `updateUserState` rejects duplicate bodyweight dates and does not write;
- a valid minimal state still writes successfully.

MCP tool tests do not need to duplicate every validation branch; if the shared service rejects the invalid result, MCP writes inherit the behavior.
