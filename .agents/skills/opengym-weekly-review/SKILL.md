---
name: opengym-weekly-review
description: Use when the user asks for an openGym weekly training review, coaching recap, stagnation check or evidence-based next steps using their connected openGym MCP profile.
---

# openGym weekly review

Use the connected openGym read tools. Begin with `training_summary` for `week`
and `6w`, `detect_stalls` with `window: 4`, and `get_week_plan`. Stop on an
authentication failure and explain the connection problem; do not inspect local
credentials, dump MCP configuration or substitute demo data.

Write in the user's language. State the returned date range, training completed,
effort coverage, available bodyweight observations, stagnation evidence and
practical next steps. Separate observed facts from recommendations. Fetch
`exercise_history`, `get_routine`, `progression_next` or a dated `get_bodyweight`
only when a specific finding needs that detail.

Interpret the evidence carefully:

- `week` includes today and the date seven days earlier. Quote `date_range`;
  do not call it a completed calendar week or assume seven inclusive dates.
- Six-week totals provide longer context, not an equal-length comparison.
  `detect_stalls.window` counts completed **sessions per exercise**, not weeks;
  inspect candidate dates before calling a finding recent.
- Use the returned unit. Never supply kg/lb when the evidence omits it.
- Effort `avg` uses the returned `scale`; null means insufficient rated sets.
  Include `rated_sets` / `done_sets`. `hard_pct` is a 0–1 ratio; multiply by 100
  only when displaying a percentage, retaining null and the reported precision.
- No candidate is not proof of recovery; no PR is not proof of stagnation.
  Missing weigh-ins or history are unknown, not zero. Sparse measurements do
  not establish a trend.
- Current weekday assignments do not prove the historical plan. Do not invent
  missed workouts, adherence percentages or rest days from unassigned days.
  Respect today's override when describing the next planned session.

If there is no history, explain that there is not yet enough evidence to review
progress. Offer one useful next step rather than a fabricated assessment. Deload
suggestions need supporting performance/recovery evidence; ask about fatigue if
it is missing. This review does not modify plans or targets, start notifications,
schedule future work or send messages elsewhere.
