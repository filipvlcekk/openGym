# training_summary MCP Tool Design

## Goal

Add a read-only MCP tool that returns a compact training summary for a fixed period. The tool gives an AI coach enough current context for weekly review, post-workout analysis, and planning without fetching every workout.

## Approved Contract

Tool name: `training_summary`

Input:

```json
{
  "period": "6w"
}
```

`period` is required and must be one of `week`, `month`, `6w`, `12w`, or `all`. The fixed enum keeps the contract deterministic and avoids natural-language date parsing inside MCP.

Output:

```json
{
  "period": "6w",
  "unit": "kg",
  "date_range": { "from": "2026-06-15", "to": "2026-07-27" },
  "workouts": {
    "completed": 18,
    "sets_done": 312,
    "volume": 184250,
    "prs": 12
  },
  "bodyweight": {
    "from": 80.1,
    "to": 78.3,
    "change": -1.8
  },
  "effort": {
    "scale": "RIR",
    "rated_sets": 140,
    "avg": 2.1,
    "hard_pct": 0.72
  },
  "muscle_coverage": {
    "worked_count": 14,
    "neglected_count": 4,
    "top": [{ "slug": "quadriceps", "name": "Quads", "effective_sets": 42 }],
    "neglected": [{ "slug": "tibialis", "name": "Shins" }]
  }
}
```

## Behavior

- Filter workouts and bodyweight entries by ISO date, inclusive of both ends.
- `week`, `month`, `6w`, and `12w` count back 7, 30, 42, and 84 days from today respectively. `all` has `from: null`.
- Workouts summary includes completed workouts, completed sets, total completed load volume, and PR count.
- Bodyweight summary uses first and last weigh-ins in the filtered range. If there are fewer than two points, `change` is `null`.
- Effort summary reuses `effortSummary`, `displayScale`, and `scaleName` from `frontend/src/lib/effort.js`; values are rounded and stay nullable when there is not enough rated data.
- Muscle coverage reuses `loadOfWorkouts` and `rankOf`, matching the existing `muscle_balance` tool semantics.
- The tool is read-only and deterministic. It adds no persistence, auth, network, or dependencies.

## Testing

Pin MCP contract tests against the demo seed:

- `6w` returns the expected date range and non-empty aggregate sections;
- `week` is a narrower or equal window than `6w`;
- `all` has `from: null` and covers the whole seeded history;
- a zero-history state returns zeros/nulls rather than throwing;
- a single bodyweight point has endpoints but no trend change;
- no synced state returns the shared no-state fallback.
