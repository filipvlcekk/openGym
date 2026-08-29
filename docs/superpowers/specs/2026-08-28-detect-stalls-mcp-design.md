# detect_stalls MCP Tool Design

## Goal

Add a read-only MCP tool that returns conservative stagnation candidates for reps-mode routine exercises. The tool should surface evidence an AI coach can explain, not make a final coaching decision by itself.

## Approved Contract

Tool name: `detect_stalls`

Input:

```json
{
  "window": 4,
  "routine_id": "optional"
}
```

`window` is optional, defaults to 4, and is capped to a small range. `routine_id` is optional; when present the scan is limited to that routine.

Output:

```json
{
  "window": 4,
  "unit": "kg",
  "candidates": [
    {
      "exercise": { "id": "1323", "name": "Seated row", "mode": "reps" },
      "routine": { "id": "pull", "name": "Pull Day" },
      "signal": "possible_stall",
      "severity": "medium",
      "evidence": {
        "sessions_checked": 4,
        "latest_date": "2026-07-22",
        "best_estimate_change": -1.2,
        "missed_target_sessions": 3,
        "latest_target": { "sets": 3, "reps": 10, "weight": 55 }
      },
      "recent_sessions": [
        { "date": "2026-07-22", "top_set": "55×8", "sets_done": 3, "volume": 1320 }
      ]
    }
  ]
}
```

## Heuristic

- Scan only reps-mode exercises that are present in routines.
- Require at least 3 completed sessions for an exercise.
- Inspect the latest `window` completed sessions, newest first.
- Flag a candidate when the latest session did not improve the best estimated 1RM over the earlier sessions in the window and at least 2 sessions missed the routine target.
- Also flag when at least 3 sessions missed the routine target, even if the 1RM trend is flat rather than negative.
- Severity is:
  - `high` when at least 3 sessions missed target and best estimate change is negative;
  - `medium` otherwise.
- Return evidence fields so the AI layer can interpret the result cautiously.

## Non-Goals

- Do not diagnose fatigue, technique, injury, or programming causes.
- Do not suggest deloads or plan changes.
- Do not scan timed/cardio exercises.
- Do not add write behavior, persistence, auth, network, or dependencies.

## Testing

Pin MCP contract tests against synthetic state:

- repeated missed reps with flat/down e1RM returns one candidate with evidence;
- `routine_id` filters candidates;
- timed/cardio or insufficient history does not produce candidates;
- no synced state returns the shared no-state fallback.
