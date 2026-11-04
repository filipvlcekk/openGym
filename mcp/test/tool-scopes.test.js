import { describe, expect, test } from 'vitest'

import { TOOLS } from '../src/tools.js'
import { isReadTool, requiredScopeForTool } from '../src/tool-scopes.js'

describe('tool scope mapping', () => {
  test('maps read tools to state:read', () => {
    expect(requiredScopeForTool('list_routines')).toBe('state:read')
    expect(requiredScopeForTool('get_training_plan')).toBe('state:read')
    expect(requiredScopeForTool('get_workout')).toBe('state:read')
    expect(requiredScopeForTool('detect_stalls')).toBe('state:read')
    expect(isReadTool('training_summary')).toBe(true)
  })

  test('maps write tools to narrow write scopes', () => {
    expect(requiredScopeForTool('apply_training_plan')).toBe('plan:write')
    expect(isReadTool('apply_training_plan')).toBe(false)
    expect(requiredScopeForTool('override_day')).toBe('schedule:write')
    expect(requiredScopeForTool('assign_weekday')).toBe('schedule:write')
    expect(requiredScopeForTool('edit_routine')).toBe('routine:write')
    expect(requiredScopeForTool('create_custom_exercise')).toBe('exercise:write')
    expect(requiredScopeForTool('add_bodyweight')).toBe('bodyweight:write')
    expect(requiredScopeForTool('log_workout')).toBe('workout:write')
    expect(requiredScopeForTool('log_freestyle_workout')).toBe('workout:write')
  })

  test('rejects unknown tools', () => {
    expect(requiredScopeForTool('missing')).toBe(null)
  })

  test('every registered tool has a remote scope mapping', () => {
    const missing = TOOLS.map(t => t.name).filter(name => !requiredScopeForTool(name))
    expect(missing).toEqual([])
  })
})
