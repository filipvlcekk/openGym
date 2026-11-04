const READ_TOOLS = new Set([
  'list_routines',
  'get_routine',
  'get_week_plan',
  'get_training_plan',
  'list_workouts',
  'get_workout',
  'get_bodyweight',
  'estimate_1rm',
  'muscle_balance',
  'progression_next',
  'exercise_history',
  'training_summary',
  'detect_stalls'
])

const WRITE_TOOL_SCOPES = new Map([
  ['apply_training_plan', 'plan:write'],
  ['override_day', 'schedule:write'],
  ['assign_weekday', 'schedule:write'],
  ['edit_routine', 'routine:write'],
  ['create_custom_exercise', 'exercise:write'],
  ['add_bodyweight', 'bodyweight:write'],
  ['log_workout', 'workout:write'],
  ['log_freestyle_workout', 'workout:write']
])

export function isReadTool(name) {
  return READ_TOOLS.has(name)
}

export function requiredScopeForTool(name) {
  if (READ_TOOLS.has(name)) return 'state:read'
  return WRITE_TOOL_SCOPES.get(name) || null
}
