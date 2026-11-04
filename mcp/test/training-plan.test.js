import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { TOOLS } from '../src/tools.js'
import { buildSets } from '../../frontend/src/lib/history.js'

let dataDir, context
const file = () => path.join(dataDir, 'state-user-a.json')
const saved = () => JSON.parse(fs.readFileSync(file(), 'utf8'))
const call = (name, args, ctx = context) => TOOLS.find(t => t.name === name).handler(args, ctx)
const proposal = () => ({ from: '2026-11-04', to: '2026-11-06', expected_revision: 7,
  new_routines: [{ id: 'nov-a', name: ' Full body A ', exercises: [{ exercise_id: '0043', target: { sets: 2, repsMin: 6, repsMax: 8 } }] }],
  days: [{ date: '2026-11-04', routine_id: 'nov-a' }, { date: '2026-11-05', routine_id: 'rest' }, { date: '2026-11-06', routine_id: 'old' }] })
const audit = () => fs.existsSync(path.join(dataDir, 'audit.log')) ? fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim().split('\n').map(JSON.parse) : []
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-plan-'))
  context = { transport: 'http', auth: { verified: true }, token: { uid: 'user-a', id: 'token-a', scopes: ['state:read', 'plan:write'] }, dataDir }
  fs.writeFileSync(file(), JSON.stringify({ _revision: 7, unit: 'kg', routines: [{ id: 'old', name: 'Old', ex: [] }], week: { 3: 'old' }, dayPlan: { '2026-10-30': 'old', '2026-11-05': 'rest' }, workouts: [], exWeights: { '0043': { w: 20, d: '2026-10-30' } } }))
})
afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }))

describe('bounded training plan', () => {
  test('reads every date with override, week and unassigned distinctions', () => {
    expect(call('get_training_plan', { from: '2026-11-04', to: '2026-11-06' })).toMatchObject({ revision: 7, unit: 'kg', date_range: { from: '2026-11-04', to: '2026-11-06' }, days: [
      { date: '2026-11-04', routine_id: 'old', routine_name: 'Old', source: 'week', rest: false },
      { date: '2026-11-05', routine_id: 'rest', routine_name: null, source: 'override', rest: true },
      { date: '2026-11-06', routine_id: null, routine_name: null, source: 'unassigned', rest: false }] })
  })
  test.each([['2026-11-31', '2026-11-31'], ['2026-11-04', '2026-12-04'], ['2026-11-06', '2026-11-04']])('rejects invalid range %s..%s', (from, to) => {
    expect(() => call('get_training_plan', { from, to })).toThrow()
  })
  test('preview is stable and complete without state/audit writes', () => {
    const before = fs.readFileSync(file(), 'utf8'), p = call('apply_training_plan', proposal())
    expect(p).toMatchObject({ ok: true, dry_run: true, revision: 7, would_change: true, new_routines: [{ id: 'nov-a', name: 'Full body A', prog: 'off', ex: [{ id: '0043', reps: 6, repsMin: 6, repsMax: 8, sets: 2 }] }] })
    expect(p.new_routines[0].ex[0]).not.toHaveProperty('weight')
    expect(p.workout_initialization).toMatchObject({ note: expect.stringContaining('history'), first_sets: [{ routine_id: 'nov-a', exercise_id: '0043', set: { w: 20, r: 6 } }] })
    expect(p.preview_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(call('apply_training_plan', { ...proposal(), days: proposal().days.toReversed() }).preview_hash).toBe(p.preview_hash)
    expect(fs.readFileSync(file(), 'utf8')).toBe(before)
    expect(audit()).toEqual([])
  })
  test('commits once, preserves unrelated state and supports lost-response discovery', () => {
    const before = saved(), args = proposal(), p = call('apply_training_plan', args)
    expect(call('apply_training_plan', { ...args, dry_run: false, preview_hash: p.preview_hash })).toMatchObject({ ok: true, changed: true, revision_before: 7, revision_after: 8 })
    expect(saved()).toMatchObject({ _revision: 8, week: before.week, workouts: before.workouts, exWeights: before.exWeights })
    expect(saved().routines[0]).toEqual(before.routines[0])
    expect(saved().dayPlan['2026-10-30']).toBe('old')
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({ action: 'apply_training_plan', token_id: 'token-a', revision_before: 7, revision_after: 8 })
    expect(call('get_routine', { routine_id: 'nov-a' }).exercises[0]).toMatchObject({ reps_min: 6, reps_max: 8 })
    expect(call('get_training_plan', { from: args.from, to: args.to }).days.map(d => d.routine_id)).toEqual(['nov-a', 'rest', 'old'])
    expect(call('apply_training_plan', { ...args, dry_run: false, preview_hash: p.preview_hash }).error.code).toBe('STATE_CONFLICT')
    expect(audit()).toHaveLength(1)
  })
  test('read-after-save exposes bodyweight and per-side target semantics', () => {
    const args = proposal()
    Object.assign(args.new_routines[0].exercises[0].target, { bodyweight: true, side: false })
    const preview = call('apply_training_plan', args)
    call('apply_training_plan', { ...args, dry_run: false, preview_hash: preview.preview_hash })
    expect(call('get_routine', { routine_id: 'nov-a' }).exercises[0]).toMatchObject({ bodyweight: true, side: false })
  })
  test('November intro/main variants and all 27 dates commit together without replacing old plans', () => {
    const before = { ...saved(), routines: ['Push', 'Pull', 'Legs'].map((name, i) => ({ id: `old-${i}`, name, ex: [] })),
      week: { 1: 'old-0', 3: 'old-1', 5: 'old-2' },
      dayPlan: { '2026-11-01': 'old-0', '2026-11-03': 'old-1', '2026-12-01': 'old-2' },
      workouts: [{ id: 'historic', d: '2026-10-29', entries: [{ id: '0043', sets: [{ w: 30, r: 12, done: true }] }] }] }
    fs.writeFileSync(file(), JSON.stringify(before))
    const specs = {
      a: [['0043', 6, 8], ['0085', 8, 10], ['0025', 6, 10], ['2330', 8, 12], ['1373', 12, 15], ['2135', 30]],
      b: [['0739', 10, 12], ['0586', 10, 12], ['0047', 8, 10], ['1323', 8, 12], ['0426', 8, 10], ['1373', 12, 15], ['2135', 30]]
    }
    const new_routines = ['intro', 'main'].flatMap(phase => ['a', 'b'].map(letter => ({
      id: `nov-${phase}-${letter}`, name: `November ${phase} ${letter}`, exercises: specs[letter].map(([exercise_id, min, max], i) => ({
        exercise_id, target: { sets: phase === 'main' && i < 4 ? 3 : 2,
          ...(max ? { repsMin: min, repsMax: max } : { mode: 'time', sec: min }) }
      }))
    })))
    const sessions = { 4: 'intro-a', 6: 'intro-b', 9: 'main-a', 11: 'main-b', 13: 'main-a', 16: 'main-b', 18: 'main-a', 20: 'main-b', 23: 'main-a', 25: 'main-b', 27: 'main-a', 30: 'main-b' }
    const days = Array.from({ length: 27 }, (_, i) => ({ date: `2026-11-${String(i + 4).padStart(2, '0')}`, routine_id: sessions[i + 4] ? `nov-${sessions[i + 4]}` : 'rest' }))
    const args = { from: '2026-11-04', to: '2026-11-30', expected_revision: 7, new_routines, days }
    const preview = call('apply_training_plan', args)
    expect(saved()).toEqual(before)
    expect(call('apply_training_plan', { ...args, dry_run: false, preview_hash: preview.preview_hash })).toMatchObject({ ok: true, revision_after: 8 })
    expect(audit()).toHaveLength(1)
    expect(saved().routines).toHaveLength(7)
    expect(saved().routines.slice(0, 3)).toEqual(before.routines)
    for (const field of ['week', 'workouts', 'exWeights']) expect(saved()[field]).toEqual(before[field])
    for (const [date, routine] of Object.entries(before.dayPlan)) expect(saved().dayPlan[date]).toBe(routine)
    expect(call('get_training_plan', { from: args.from, to: args.to }).days.map(d => ({ date: d.date, routine_id: d.routine_id }))).toEqual(days)
    for (const routine of new_routines) {
      const read = call('get_routine', { routine_id: routine.id })
      expect(read.exercises.map(e => e.sets)).toEqual(routine.exercises.map(e => e.target.sets))
      expect(read.exercises[0]).toMatchObject({ reps_min: routine.exercises[0].target.repsMin, reps_max: routine.exercises[0].target.repsMax })
      expect(read.exercises.at(-1)).toMatchObject({ mode: 'time', sec: 30 })
      expect(read.exercises.every(e => e.weight === undefined)).toBe(true)
    }
  })
  test('no-op enforces hash and revision without state/audit writes', () => {
    const args = { ...proposal(), from: '2026-11-05', to: '2026-11-05', new_routines: [], days: [{ date: '2026-11-05', routine_id: 'rest' }] }
    const before = fs.readFileSync(file(), 'utf8'), p = call('apply_training_plan', args)
    expect(p.would_change).toBe(false)
    expect(call('apply_training_plan', { ...args, dry_run: false, preview_hash: p.preview_hash })).toMatchObject({ ok: true, changed: false, revision_after: 7 })
    expect(fs.readFileSync(file(), 'utf8')).toBe(before)
    expect(audit()).toEqual([])
    expect(call('apply_training_plan', { ...args, expected_revision: 6 }).error.code).toBe('STATE_CONFLICT')
  })
  test('commit hash is required and binds payload, user and token', () => {
    const args = proposal(), p = call('apply_training_plan', args), before = saved()
    for (const patch of [{}, { preview_hash: 'f'.repeat(64) }, { preview_hash: p.preview_hash, days: args.days.map(d => ({ ...d, routine_id: 'rest' })) }]) expect(() => call('apply_training_plan', { ...args, dry_run: false, ...patch })).toThrow()
    expect(() => call('apply_training_plan', { ...args, dry_run: false, preview_hash: p.preview_hash }, { ...context, token: { ...context.token, id: 'other' } })).toThrow()
    fs.writeFileSync(path.join(dataDir, 'state-user-b.json'), JSON.stringify(before))
    expect(() => call('apply_training_plan', { ...args, dry_run: false, preview_hash: p.preview_hash }, { ...context, token: { ...context.token, uid: 'user-b' } })).toThrow()
    expect(saved()).toEqual(before)
    expect(audit()).toEqual([])
  })
  test.each([
    p => { p.extra = true }, p => { p.days.pop() }, p => { p.days[1] = p.days[0] }, p => { p.days[1].date = '2026-11-07' }, p => { p.days[2].routine_id = 'missing' },
    p => { p.new_routines[0].id = 'old' }, p => { p.new_routines[0].id = 'rest' }, p => { p.new_routines[0].id = '__proto__' }, p => { p.new_routines.push(p.new_routines[0]) }, p => { p.new_routines[0].name = ' ' },
    p => { p.new_routines[0].exercises = [] }, p => { p.new_routines[0].exercises[0].exercise_id = 'missing' }, p => { p.new_routines[0].exercises[0].exercise_id = 'constructor' }, p => { p.new_routines[0].exercises.push(p.new_routines[0].exercises[0]) }, p => { p.days[0].routine_id = 'old' },
    p => { p.new_routines[0].exercises[0].target.repsMax = 5 }, p => { p.new_routines[0].exercises[0].target.reps = 10 }, p => { p.new_routines[0].exercises[0].target.sec = 30 }, p => { p.new_routines[0].exercises[0].target.bogus = true }
  ])('rejects invalid proposal atomically (%#)', mutate => {
    const args = proposal(), before = saved(); mutate(args)
    expect(() => call('apply_training_plan', args)).toThrow()
    expect(saved()).toEqual(before)
    expect(audit()).toEqual([])
  })
  test('validates current state during preview', () => {
    fs.writeFileSync(file(), JSON.stringify({ ...saved(), week: { 1: 'missing' } }))
    expect(() => call('apply_training_plan', proposal())).toThrow(/State validation/)
    expect(audit()).toEqual([])
  })
  test('preserves global buildSets history seeding across routines', () => {
    const cfg = call('apply_training_plan', proposal()).new_routines[0].ex[0]
    expect(buildSets(saved(), cfg)).toEqual([{ w: 20, r: 6, done: false }, { w: 20, r: 6, done: false }])
    expect(buildSets({ ...saved(), workouts: [{ d: '2026-10-30', entries: [{ id: cfg.id, sets: [{ w: 35, r: 12, done: true }] }] }] }, cfg)[0]).toMatchObject({ w: 20, r: 12 })
  })
  test('omitted loads remain unconfigured on fresh profiles and inherit history on existing ones', () => {
    const cfg = call('apply_training_plan', proposal()).new_routines[0].ex[0]
    expect(buildSets({ workouts: [], exWeights: {} }, cfg)[0]).toEqual({ w: undefined, r: 6, done: false })
    expect(buildSets({ workouts: [{ entries: [{ id: cfg.id, sets: [{ w: 35, r: 12, done: true }] }] }], exWeights: {} }, cfg)[0]).toMatchObject({ w: 35, r: 12 })
    const timed = { id: '0043', mode: 'time', sets: 1, sec: 30 }
    expect(buildSets({ workouts: [{ entries: [{ id: timed.id, sets: [{ sec: 50, w: 5, done: true }] }] }], exWeights: {} }, timed)[0]).toMatchObject({ sec: 50, w: 5 })
  })
  test('strict schemas enforce routine/exercise limits and unknown nested fields', () => {
    const args = proposal(), schema = TOOLS.find(t => t.name === 'apply_training_plan').schema
    expect(schema.new_routines.safeParse(Array.from({ length: 9 }, () => args.new_routines[0])).success).toBe(false)
    expect(schema.new_routines.safeParse([{ ...args.new_routines[0], exercises: Array.from({ length: 21 }, () => args.new_routines[0].exercises[0]) }]).success).toBe(false)
    for (const patch of [{ extra: true }, { exercises: [{ exercise_id: '0043', extra: true }] }]) expect(schema.new_routines.safeParse([{ ...args.new_routines[0], ...patch }]).success).toBe(false)
    expect(() => call('get_training_plan', { from: args.from, to: args.to, extra: true })).toThrow()
  })
  test('accepts known custom exercises and mode-compatible targets', () => {
    fs.writeFileSync(file(), JSON.stringify({ ...saved(), customEx: [{ id: 'custom-hold', n: 'Hold', bp: 'waist' }] }))
    const args = proposal()
    args.new_routines[0].exercises = [{ exercise_id: 'custom-hold', target: { mode: 'time', sets: 2, sec: 30 } }]
    expect(call('apply_training_plan', args).new_routines[0].ex[0]).toEqual({ id: 'custom-hold', mode: 'time', sets: 2, sec: 30 })
  })
  test('custom cardio defaults retain cardio mode without a global exercise registry entry', () => {
    fs.writeFileSync(file(), JSON.stringify({ ...saved(), customEx: [{ id: 'custom-bike', n: 'Bike', bp: 'cardio' }] }))
    const args = proposal()
    args.new_routines[0].exercises = [{ exercise_id: 'custom-bike', target: { sets: 1, min: 15, speed: 6 } }]
    const p = call('apply_training_plan', args)
    expect(p.new_routines[0].ex[0]).toEqual({ id: 'custom-bike', mode: 'cardio', sets: 1, min: 15, speed: 6 })
    expect(p.workout_initialization.first_sets[0].set).toMatchObject({ min: 15, speed: 6 })
  })
  test('historical data and all outside date overrides remain byte-equivalent after commit', () => {
    const before = { ...saved(), bodyweight: [{ d: '2026-10-29', w: 80 }], customEx: [{ id: 'custom', n: 'Custom', bp: 'back' }],
      dayPlan: { ...saved().dayPlan, '2026-11-01': 'old', '2026-12-01': 'rest' },
      workouts: [{ id: 'historic', d: '2026-10-29', entries: [{ id: '0031', target: { sets: 2, reps: 10 }, sets: [{ w: 30, r: 12, done: true }] }] }] }
    fs.writeFileSync(file(), JSON.stringify(before))
    const p = call('apply_training_plan', proposal())
    call('apply_training_plan', { ...proposal(), dry_run: false, preview_hash: p.preview_hash })
    for (const field of ['workouts', 'bodyweight', 'customEx', 'exWeights', 'week']) expect(JSON.stringify(saved()[field])).toBe(JSON.stringify(before[field]))
    for (const [date, value] of Object.entries(before.dayPlan)) expect(saved().dayPlan[date]).toBe(value)
  })
  test('reads a full 31-day month inclusively', () => {
    const plan = call('get_training_plan', { from: '2026-12-01', to: '2026-12-31' })
    expect(plan.days).toHaveLength(31)
    expect(plan.days.at(-1).date).toBe('2026-12-31')
  })
  test('post-write audit failure reports uncertainty and can be reconciled by reads', () => {
    const args = proposal(), p = call('apply_training_plan', args)
    fs.mkdirSync(path.join(dataDir, 'audit.log'))
    expect(call('apply_training_plan', { ...args, dry_run: false, preview_hash: p.preview_hash })).toMatchObject({ ok: false, error: { code: 'PLAN_COMMIT_UNCERTAIN', current_revision: 8 } })
    expect(call('get_routine', { routine_id: 'nov-a' }).name).toBe('Full body A')
    expect(call('get_training_plan', { from: args.from, to: args.to }).days[0].routine_id).toBe('nov-a')
    expect(call('apply_training_plan', { ...args, dry_run: false, preview_hash: p.preview_hash }).error.code).toBe('STATE_CONFLICT')
  })
  test('no-op does not add an absent routines field to a minimal profile', () => {
    fs.writeFileSync(file(), JSON.stringify({ _revision: 7, dayPlan: { '2026-11-05': 'rest' } }))
    const args = { ...proposal(), from: '2026-11-05', to: '2026-11-05', new_routines: [], days: [{ date: '2026-11-05', routine_id: 'rest' }] }
    const p = call('apply_training_plan', args)
    expect(call('apply_training_plan', { ...args, dry_run: false, preview_hash: p.preview_hash })).toMatchObject({ changed: false, revision_after: 7 })
    expect(saved()).not.toHaveProperty('routines')
  })
  test('initialization disclosure handles accepted sparse legacy history', () => {
    fs.writeFileSync(file(), JSON.stringify({ ...saved(), workouts: [{ d: '2026-10-30' }, { entries: [{ id: '0043' }] }] }))
    expect(call('apply_training_plan', proposal())).toMatchObject({ ok: true, workout_initialization: { first_sets: [{ set: { r: 6, w: 20 } }] } })
  })
  test('new profile retains no-state contract'  , () => {
    fs.unlinkSync(file())
    expect(call('apply_training_plan', proposal()).error).toMatch(/no synced state/)
    expect(call('get_training_plan', { from: '2026-11-04', to: '2026-11-06' }).error).toMatch(/no synced state/)
  })
})
