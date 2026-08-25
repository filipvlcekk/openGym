# progression_next MCP Design

## Goal

Add a read-only MCP tool named `progression_next` so AI clients can ask openGym's own
progression engine what the next target should be for one exercise in one routine.

## Architecture

The tool lives in `mcp/src/tools.js` with the existing read-only tools. It must not duplicate
fitness/progression logic. It finds the requested routine and exercise config in the current
state and delegates to `nextPrescription(S, cfg, routine)` from
`frontend/src/lib/progression.js`.

## Interface

Input:

```json
{
  "routine_id": "routine-id",
  "exercise_id": "exercise-id"
}
```

Output includes:

- routine metadata,
- exercise metadata,
- current target,
- policy and policy display name,
- result kind: `first`, `up`, `hold`, `deload`, or `off`,
- next target fields decided by the policy (`weight`, `reps`, `sec`, `sets`),
- formatted reason text,
- `confidence: "deterministic"`.

## Error Handling

The tool returns the existing no-state sentinel for a fresh account. Unknown routine or
exercise ids throw `ENOENT`, matching the current MCP tool style.

## Tests

Add MCP contract tests for:

- successful `up` prescription from demo data,
- successful `hold` prescription from demo data,
- missing routine,
- missing exercise in an existing routine,
- no-state fallback.
