# On-demand weekly coaching review

User choice: an on-demand review in Codex, not an automatic report.

## Approach

Use a reusable `opengym-weekly-review` Codex skill over existing read tools.
`training_summary` was designed for this use; another MCP tool would duplicate
or merely wrap existing handlers. A scheduled report is outside the chosen scope.
Store the source skill in `.agents/skills/opengym-weekly-review/SKILL.md` and
install an identical copy in the user's Codex skills directory for other projects.
No server dependency, new scope, background job or training-state mutation is needed.

## Review

Fetch `training_summary` for `week` and `6w`, `detect_stalls` with `window: 4`,
and `get_week_plan`. Fetch detailed exercise history, routine prescription or
bodyweight only when a concrete question requires it. Give observations, limits
of the evidence and practical suggestions separately, in the user's language.

Quote the returned date ranges. The existing `week` contract includes today and
the date seven days before it; it is not a completed calendar week. Six-week
totals are context, not an equal-length comparison. Stall evidence spans recent
sessions and may predate the review window. Empty candidates do not establish
healthy recovery. Missing history, effort or bodyweight must not become zero.
`hard_pct` is a ratio from 0 to 1, not a percentage already multiplied by 100.

Current weekday assignments are not an historical schedule. Do not infer missed
workouts or an adherence percentage from them. No automatic deload, target
changes or notifications. Recommendations must remain conditional on the evidence;
ask about fatigue/recovery where necessary rather than diagnosing overtraining.

## Prerequisite correction

`training_summary.effort.avg` is currently canonical RIR but labeled with the
profile's display scale. Convert through the shared `toScale` helper and cover
RPE, RIR and insufficient ratings with regression tests. Preserve the existing
window and `hard_pct` contracts.

## Verification

Run a before/after scenario for the skill, validate its frontmatter and exercise
it once against the user's read-only MCP connection. Run the full MCP suite and
Node loadability after the effort fix. Review the changes, deploy the correction
to the existing MCP service and verify an authenticated summary. Preserve the
existing data volumes and read-only token configuration.
