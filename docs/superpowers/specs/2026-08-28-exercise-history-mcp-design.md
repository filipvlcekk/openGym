# exercise_history MCP Tool Design

## Goal

Add a read-only MCP tool that returns the recent completed sessions for one exercise, newest first, without requiring an LLM client to fetch and filter full workouts.

## Approved Contract

Tool name: `exercise_history`

Input:

```json
{
  "exercise_id": "0426",
  "limit": 10
}
```

`exercise_id` is required. `limit` is optional, defaults to 10, and is capped to avoid dumping the whole state.

Output:

```json
{
  "exercise": { "id": "0426", "name": "Cable fly", "mode": "reps" },
  "unit": "kg",
  "total_count": 12,
  "returned_count": 10,
  "sessions": [
    {
      "date": "2026-07-24",
      "workout_id": "abc",
      "routine_id": "push",
      "routine_name": "Push Day",
      "target": { "sets": 3, "reps": 10, "weight": 25 },
      "sets": [
        { "done": true, "label": "25×10", "w": 25, "r": 10 }
      ],
      "sets_done": 3,
      "volume": 750
    }
  ]
}
```

Set labels reuse the same MCP `entryView` path as `get_workout`, so reps/time/cardio rendering stays aligned with the frontend helpers. Volume is the same set-level calculation openGym already uses for workouts: completed reps-mode load times reps; time/cardio sessions return zero volume because there is no comparable load volume.

## Behavior

- Return only workouts where the exercise has at least one completed set.
- Sort sessions newest first by workout date; preserve existing state order for sessions with the same date.
- Return an empty `sessions` array for a known exercise with no completed history.
- Use `exOr()` for exercise metadata, matching the existing tools' handling of custom or unknown exercise ids.
- Keep the tool read-only and deterministic. No new persistence, auth, network, or dependencies.

## Testing

Pin MCP contract tests against the demo seed:

- recent history returns newest-first sessions with workout metadata, target, labels, done set counts, and volume;
- `limit` caps returned sessions but not `total_count`;
- no completed history returns an empty result rather than throwing;
- no synced state returns the shared no-state fallback;
- tool is included in the registration list.
