// Tool-layer tests for mcp/src/tools.js, seeded from frontend/src/lib/demoSeed.js — the same
// deterministic fixture the public demo runs on. The pure lib functions have their own 92
// tests in frontend/src/lib/*.test.js; here we pin JSON shape + the user-facing edge cases
// (rest-day override, missing routine, zero-workout history, no synced state, superset links).
import { describe, beforeAll, afterAll, beforeEach, test, expect, vi } from 'vitest'
import { buildDemoState } from '../../frontend/src/lib/demoSeed.js'
import { EXDB } from '../../frontend/src/lib/exercises.js'
import { _seedStateForTests } from '../src/state.js'
import { TOOLS } from '../src/tools.js'

// Re-stated here so the assertions stand alone without reaching into lib internals to learn
// the demo state's exact values.
const FAKE_TODAY_ISO = '2026-07-27'                         // Monday — Push Day is scheduled
const GOAL_WEIGHT = 77
// Re-pinned against the v1.2.4 seed, which moved when the demo learned about bodyweight work
// and effort. Hand-checked rather than copied off a failing run: 18412.5 is the sum of w×r
// over the twenty completed sets, and 1.3 is 78.3 − 77.
const NEWEST_WORKOUT = { date: '2026-07-24', name: 'Leg Day', volume: 18412.5, bw: 78.4, sets_done: 20, sets_total: 20, duration: '1h 11m' }
const LATEST_BW = { date: '2026-07-27', weight: 78.3, delta: 1.3 }
const LEG_PRESS_ID = '0739'                                 // sled 45° leg press in the demo data
const LEG_PRESS_BEST = { w: 152.5, r: 12, epley: 213.5, brzycki: 219.6 }

const byName = Object.fromEntries(TOOLS.map(t => [t.name, t.handler]))

let S = null

function call(name, params = {}) {
  const h = byName[name]
  if (!h) throw new Error(`unknown tool ${name}`)
  return h(params)
}

function freshState() {
  const s = buildDemoState()
  s.unit = 'kg'
  return s
}

function isoDaysAgo(days) {
  const d = new Date(FAKE_TODAY_ISO + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function sortedByDate(xs) {
  return xs.slice().sort((a, b) => (a.d || '').localeCompare(b.d || ''))
}

function workout(id, date, routineId, name, entries) {
  return {
    id,
    d: date,
    routineId,
    name,
    start: new Date(date + 'T10:00:00Z').getTime(),
    end: new Date(date + 'T11:00:00Z').getTime(),
    bw: null,
    vol: 0,
    prs: [],
    entries
  }
}

function entry(id, target, sets) {
  return { id, target, sets: sets.map(s => ({ ...s, done: true })) }
}

function syntheticStallState() {
  const pull = {
    id: 'pull',
    name: 'Pull Day',
    emoji: null,
    policy: 'linear',
    ex: [
      { id: '1323', sets: 3, reps: 10, weight: 55, mode: 'reps' },
      { id: '0426', sets: 3, reps: 10, weight: 25, mode: 'reps' },
      { id: 'synth-plank', sets: 3, sec: 60, mode: 'time' }
    ]
  }
  const legs = {
    id: 'legs',
    name: 'Leg Day',
    emoji: null,
    policy: 'linear',
    ex: [{ id: LEG_PRESS_ID, sets: 3, reps: 10, weight: 145, mode: 'reps' }]
  }
  const rowTarget = pull.ex[0]
  const flyTarget = pull.ex[1]
  const plankTarget = pull.ex[2]
  const pressTarget = legs.ex[0]
  return {
    unit: 'kg',
    routines: [pull, legs],
    week: {},
    dayPlan: {},
    bodyweight: [],
    exWeights: {},
    workouts: [
      workout('w1', '2026-07-01', 'pull', 'Pull Day', [
        entry('1323', rowTarget, [{ w: 55, r: 8 }, { w: 55, r: 8 }, { w: 55, r: 7 }]),
        entry('0426', flyTarget, [{ w: 20, r: 10 }, { w: 20, r: 10 }, { w: 20, r: 10 }]),
        entry('synth-plank', plankTarget, [{ sec: 60 }, { sec: 60 }, { sec: 60 }])
      ]),
      workout('w2', '2026-07-08', 'pull', 'Pull Day', [
        entry('1323', rowTarget, [{ w: 55, r: 8 }, { w: 55, r: 8 }, { w: 55, r: 8 }]),
        entry('0426', flyTarget, [{ w: 22.5, r: 10 }, { w: 22.5, r: 10 }, { w: 22.5, r: 10 }])
      ]),
      workout('w3', '2026-07-15', 'pull', 'Pull Day', [
        entry('1323', rowTarget, [{ w: 55, r: 8 }, { w: 55, r: 7 }, { w: 55, r: 7 }]),
        entry('0426', flyTarget, [{ w: 25, r: 10 }, { w: 25, r: 10 }, { w: 25, r: 10 }])
      ]),
      workout('w4', '2026-07-22', 'pull', 'Pull Day', [
        entry('1323', rowTarget, [{ w: 52.5, r: 8 }, { w: 52.5, r: 7 }, { w: 52.5, r: 7 }]),
        entry('0426', flyTarget, [{ w: 27.5, r: 10 }, { w: 27.5, r: 10 }, { w: 27.5, r: 10 }])
      ]),
      workout('l1', '2026-07-03', 'legs', 'Leg Day', [
        entry(LEG_PRESS_ID, pressTarget, [{ w: 145, r: 8 }, { w: 145, r: 8 }, { w: 145, r: 8 }])
      ]),
      workout('l2', '2026-07-10', 'legs', 'Leg Day', [
        entry(LEG_PRESS_ID, pressTarget, [{ w: 145, r: 8 }, { w: 145, r: 7 }, { w: 145, r: 7 }])
      ]),
      workout('l3', '2026-07-17', 'legs', 'Leg Day', [
        entry(LEG_PRESS_ID, pressTarget, [{ w: 142.5, r: 8 }, { w: 142.5, r: 7 }, { w: 142.5, r: 7 }])
      ])
    ]
  }
}

// Pin "today" before building state so dayPlan/week alignment matches the assertions below.
// `toFake: ['Date']` only — keeps fs.watch and the rest of the event loop real.
beforeAll(() => {
  vi.useFakeTimers({ now: new Date(FAKE_TODAY_ISO + 'T12:00:00Z'), toFake: ['Date'] })
  S = freshState()
  _seedStateForTests(S)
})

afterAll(() => {
  vi.useRealTimers()
})

// Fresh state per test — tests that mutate dayPlan can't leak into siblings.
beforeEach(() => {
  S = freshState()
  _seedStateForTests(S)
})

/* ---------- list_routines ---------- */

describe('list_routines', () => {
  test('returns the three starter routines with names + counts', () => {
    const r = call('list_routines')
    expect(r.unit).toBe('kg')
    expect(r.routines.length).toBe(3)
    expect(r.routines.map(x => x.name).sort()).toEqual(['Leg Day', 'Pull Day', 'Push Day'])
    r.routines.forEach(rn => {
      expect(typeof rn.id).toBe('string')
      expect(rn.exercise_count).toBeGreaterThan(0)
      expect(typeof rn.superset_groups).toBe('number')
      expect(['off', 'linear', 'greyskull', 'double', 'time']).toContain(rn.policy)
    })
  })

  test('list_routines entries line up with get_routine (no id drift)', () => {
    const list = call('list_routines').routines
    list.forEach(summary => {
      const detail = call('get_routine', { routine_id: summary.id })
      expect(detail.id).toBe(summary.id)
      expect(detail.name).toBe(summary.name)
      expect(detail.exercises.length).toBe(summary.exercise_count)
    })
  })
})

/* ---------- get_routine ---------- */

describe('get_routine', () => {
  test('returns the full exercise list for Push Day with per-exercise summaries', () => {
    const push = call('list_routines').routines.find(x => x.name === 'Push Day')
    const r = call('get_routine', { routine_id: push.id })
    expect(r.name).toBe('Push Day')
    expect(r.exercises.length).toBe(push.exercise_count)
    expect(r.policy_name).toBeTruthy()
    r.exercises.forEach(e => {
      expect(['reps', 'time', 'cardio']).toContain(e.mode)
      // Every summary has "N × M" with a non-ASCII × (the lib uses U+00D7, not ASCII 'x')
      expect(e.summary).toMatch(/\d+\s*×\s*\d+/)
      expect(e.superset_group === null || typeof e.superset_group === 'string').toBe(true)
    })
  })

  test('throws ENOENT on a bogus routine id', () => {
    expect(() => call('get_routine', { routine_id: 'bogus' })).toThrow()
  })

  test('reports superset links when an adjacent pair shares an sg id', () => {
    // Inject a superset pair into a clone, since the starter plan has none.
    S.routines[0].ex[0].sg = 'A'
    S.routines[0].ex[1].sg = 'A'
    const r = call('get_routine', { routine_id: S.routines[0].id })
    expect(r.exercises[0].superset_group).toBe('A')
    expect(r.exercises[1].superset_group).toBe('A')
    expect(r.exercises[2].superset_group).toBeNull()
  })

  test('preserves mode + per-mode fields for a timed entry and a cardio entry', () => {
    // Append synthetic entries the starter plan doesn't ship: a timed plank (sec, no w) and a
    // cardio treadmill block (min + speed). These exercise ids don't exist in EXDB, so exOr
    // returns a placeholder named "Unknown exercise" — that's fine, we test the cfg fields.
    const push = S.routines.find(r => r.name === 'Push Day')
    push.ex.push({ id: 'synth-plank', sets: 3, sec: 60, weight: 0, mode: 'time' })
    push.ex.push({ id: 'synth-treadmill', sets: 1, min: 20, speed: 8, mode: 'cardio' })
    const r = call('get_routine', { routine_id: push.id })
    const t = r.exercises[r.exercises.length - 2]
    const c = r.exercises[r.exercises.length - 1]
    expect(t.mode).toBe('time')
    expect(t.sec).toBe(60)
    expect(t.reps).toBeUndefined()
    expect(c.mode).toBe('cardio')
    expect(c.min).toBe(20)
    expect(c.speed).toBe(8)
  })
})

/* ---------- get_week_plan ---------- */

describe('get_week_plan', () => {
  test('reports each weekday in getDay() order (Sunday=0 … Saturday=6) with names', () => {
    const r = call('get_week_plan')
    expect(r.weekdays.length).toBe(7)
    expect(r.weekdays.map(d => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(r.weekdays.map(d => d.weekday_name))
      .toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
  })

  test('today is the pinned Monday, and Push Day is scheduled', () => {
    const r = call('get_week_plan')
    expect(r.today).toBe(FAKE_TODAY_ISO)
    const push = S.routines.find(x => x.name === 'Push Day')
    expect(r.today_routine_id).toBe(push.id)
    expect(r.today_routine_name).toBe('Push Day')
  })

  test('week[1]/[3]/[5] map to Push/Pull/Leg, other weekdays are rest', () => {
    const r = call('get_week_plan')
    const byWd = Object.fromEntries(r.weekdays.map(d => [d.weekday, d]))
    expect(byWd[1].routine_name).toBe('Push Day')
    expect(byWd[3].routine_name).toBe('Pull Day')
    expect(byWd[5].routine_name).toBe('Leg Day')
    ;[0, 2, 4, 6].forEach(wd => {
      expect(byWd[wd].routine_id).toBeNull()
      expect(byWd[wd].routine_name).toBeNull()
    })
  })

  test('a "rest" override on today cancels the scheduled routine', () => {
    // Sanity check first — without the override, today has a routine.
    const before = call('get_week_plan')
    expect(before.today_routine_id).not.toBeNull()
    S.dayPlan[FAKE_TODAY_ISO] = 'rest'
    const after = call('get_week_plan')
    expect(after.today_routine_id).toBeNull()
    expect(after.today_routine_name).toBeNull()
    // The override is surfaced on the matching weekday entry.
    const todayWd = new Date(FAKE_TODAY_ISO + 'T12:00:00Z').getDay()
    expect(after.weekdays.find(d => d.weekday === todayWd).override_for_today_or_null).toBe('rest')
  })

  test('a routine-id override on today replaces the weekday default', () => {
    const legs = S.routines.find(r => r.name === 'Leg Day')
    S.dayPlan[FAKE_TODAY_ISO] = legs.id
    const r = call('get_week_plan')
    expect(r.today_routine_id).toBe(legs.id)
    expect(r.today_routine_name).toBe('Leg Day')
  })

  test('empty week + no override → today has no routine (a quiet Sunday)', () => {
    S.week = {}
    S.dayPlan = {}
    const r = call('get_week_plan')
    expect(r.today_routine_id).toBeNull()
    expect(r.today_routine_name).toBeNull()
    r.weekdays.forEach(d => expect(d.routine_id).toBeNull())
  })
})

/* ---------- list_workouts ---------- */

describe('list_workouts', () => {
  test('newest first, with computed volume/duration matching hand-calculated values', () => {
    const r = call('list_workouts', {})
    expect(r.returned_count).toBeGreaterThan(0)
    expect(r.total_count).toBeGreaterThanOrEqual(r.returned_count)
    // newest-first check
    const dates = r.workouts.map(w => w.date)
    expect([...dates].sort().reverse()).toEqual(dates)
    // The newest workout is the Friday before the pinned Monday today.
    expect(r.workouts[0].date).toBe(NEWEST_WORKOUT.date)
    expect(r.workouts[0].routine_name).toBe(NEWEST_WORKOUT.name)
    expect(r.workouts[0].volume).toBe(NEWEST_WORKOUT.volume)
    expect(r.workouts[0].sets_done).toBe(NEWEST_WORKOUT.sets_done)
    expect(r.workouts[0].sets_planned).toBe(NEWEST_WORKOUT.sets_total)
    expect(r.workouts[0].sets_ratio).toBe(`${NEWEST_WORKOUT.sets_done}/${NEWEST_WORKOUT.sets_total}`)
    // Past the hour the lib switches format, so the expectation carries the rendered string
    // rather than assuming a "N min" shape that only held while the session was shorter.
    expect(r.workouts[0].duration).toBe(NEWEST_WORKOUT.duration)
    expect(r.workouts[0].bodyweight_at_workout).toBe(NEWEST_WORKOUT.bw)
    r.workouts.forEach(w => {
      expect(w.sets_done).toBeLessThanOrEqual(w.sets_planned)
      expect(typeof w.volume).toBe('number')
      expect(w.sets_ratio).toMatch(/^\d+\/\d+$/)
    })
  })

  test('date range filter narrows results (closed interval, both endpoints inclusive)', () => {
    const all = call('list_workouts')
    expect(all.workouts.length).toBeGreaterThan(2)
    const earliest = all.workouts[all.workouts.length - 1].date
    // closed on both ends — earliest's own date should still appear
    const restricted = call('list_workouts', { from: earliest, to: earliest })
    expect(restricted.returned_count).toBe(1)
    expect(restricted.workouts[0].date).toBe(earliest)
  })

  test('a from > to range yields zero workouts (not an error, not silently everything)', () => {
    const r = call('list_workouts', { from: '2026-07-27', to: '2026-01-01' })
    expect(r.returned_count).toBe(0)
    expect(r.workouts).toEqual([])
    expect(r.total_count).toBeGreaterThan(0)  // total still reflects the real history
  })

  test('respects limit (caps returned_count, never total_count)', () => {
    const r = call('list_workouts', { limit: 3 })
    expect(r.returned_count).toBeLessThanOrEqual(3)
    expect(r.total_count).toBeGreaterThanOrEqual(r.returned_count)
  })
})

/* ---------- get_workout ---------- */

describe('get_workout', () => {
  test('matches the newest workout from list_workouts, every set has a readable label', () => {
    const list = call('list_workouts', {}).workouts
    const w = call('get_workout', { date: list[0].date })
    expect(w.date).toBe(list[0].date)
    expect(w.entries.length).toBe(list[0].exercise_count)
    expect(w.volume).toBe(list[0].volume)
    w.entries.forEach(e => {
      expect(['reps', 'time', 'cardio']).toContain(e.mode)
      e.sets.forEach(s => {
        expect(typeof s.label).toBe('string')
        expect(s.label.length).toBeGreaterThan(0)
      })
    })
  })

  test('throws ENOENT on a date with no workout', () => {
    expect(() => call('get_workout', { date: '1900-01-01' })).toThrow()
  })

  test('two sessions on one day are both reachable, and the date alone never picks one silently', () => {
    // Lifting in the morning, a run in the evening: ordinary, and it used to make the second
    // session unreachable while questions about it were answered with the first one's numbers.
    const day = '2026-07-26'
    S.workouts.push(
      { id: 'w-morning', d: day, name: 'Pull', start: 1000, end: 1000 + 40 * 60000, vol: 0, prs: [], entries: [] },
      { id: 'w-evening', d: day, name: 'Cardio', start: 2000, end: 2000 + 55 * 60000, vol: 0, prs: [], entries: [] }
    )
    _seedStateForTests(S)

    const amb = call('get_workout', { date: day })
    expect(amb.ambiguous).toBe(true)
    expect(amb.workouts.map(w => w.id).sort()).toEqual(['w-evening', 'w-morning'])

    // Each is retrievable by the id the ambiguous answer handed back.
    expect(call('get_workout', { workout_id: 'w-evening' }).routine_name).toBe('Cardio')
    expect(call('get_workout', { workout_id: 'w-morning' }).routine_name).toBe('Pull')
    // And list_workouts carries the id, or nothing above could ask for one.
    expect(call('list_workouts', {}).workouts.every(w => 'id' in w)).toBe(true)
  })

  test('an unknown workout_id is an error, not the wrong workout', () => {
    expect(() => call('get_workout', { workout_id: 'nope' })).toThrow()
    expect(() => call('get_workout', {})).toThrow()
  })

  test('renders reps/time/cardio set labels in the lib format on a synthetic workout', () => {
    // The starter routine has only reps-mode exercises — synthesise a workout that includes a
    // timed plank and a cardio row so the label rendering is actually exercised.
    S.workouts = [{
      id: 'synth-1', d: '2026-07-25', start: 0, end: 1800000, routineId: 'x', name: 'Synth',
      bw: 78, vol: 0, prs: [],
      entries: [
        { id: 'squat', target: { mode: 'reps' }, sets: [{ w: 60, r: 5, done: true }] },
        { id: 'plank', target: { mode: 'time' }, sets: [{ sec: 90, w: 0, done: true }] },
        { id: 'plank-w', target: { mode: 'time' }, sets: [{ sec: 90, w: 20, done: true }] },
        { id: 'row', target: { mode: 'cardio' }, sets: [{ min: 20, speed: 8, done: true }] }
      ]
    }]
    const w = call('get_workout', { date: '2026-07-25' })
    expect(w.entries[0].sets[0].label).toBe('60×5')             // reps
    // 90 sec → 1 min 30 sec → mm:ss label is "1:30" (fmtSec in history.js)
    expect(w.entries[1].sets[0].label).toBe('1:30')             // 90 s in mm:ss, no weight
    expect(w.entries[2].sets[0].label).toBe('1:30 · 20')        // weighted plank
    expect(w.entries[3].sets[0].label).toBe('20 min @ 8 km/h')   // cardio
  })

  test('infers cardio mode from the exercise id when the target has no mode key', () => {
    // Reproduces the review bug: the sheet saves a cardio target as {sets, min, speed} with
    // no mode and no id. modeOf must fall through to isCardio(id), which needs the id on the
    // cfg — entryView has to spread id into the cfg the way every app call site does.
    const CARDIO_ID = EXDB.find(e => e.bp === 'cardio').id
    S.workouts = [{
      id: 'synth-cardio', d: '2026-07-25', start: 0, end: 1800000, routineId: 'x', name: 'Synth',
      bw: 78, vol: 0, prs: [],
      entries: [
        { id: CARDIO_ID, target: { sets: 1, min: 20, speed: 8 }, sets: [{ min: 20, speed: 8, done: true }] }
      ]
    }]
    const w = call('get_workout', { date: '2026-07-25' })
    expect(w.entries[0].mode).toBe('cardio')
    expect(w.entries[0].sets[0].label).toBe('20 min @ 8 km/h')
  })
})

/* ---------- exercise_history ---------- */

describe('exercise_history', () => {
  test('returns recent completed sessions for one exercise, newest first, with labels and volume', () => {
    const exerciseId = '0426'
    const expected = S.workouts
      .filter(w => (w.entries || []).some(e =>
        e.id === exerciseId && (e.sets || []).some(s => s.done)))
      .slice()
      .sort((a, b) => (b.d || '').localeCompare(a.d || ''))

    expect(expected.length).toBeGreaterThan(2)

    const r = call('exercise_history', { exercise_id: exerciseId, limit: 2 })
    expect(r.unit).toBe('kg')
    expect(r.exercise).toMatchObject({ id: exerciseId, name: EXDB.find(e => e.id === exerciseId).n, mode: 'reps' })
    expect(r.total_count).toBe(expected.length)
    expect(r.returned_count).toBe(2)
    expect(r.sessions).toHaveLength(2)
    expect(r.sessions.map(s => s.date)).toEqual(expected.slice(0, 2).map(w => w.d))

    const firstRaw = expected[0]
    const firstEntry = firstRaw.entries.find(e => e.id === exerciseId)
    const expectedVolume = firstEntry.sets
      .filter(s => s.done)
      .reduce((sum, s) => sum + (Number(s.w) || 0) * (Number(s.r) || 0), 0)
    expect(r.sessions[0]).toMatchObject({
      date: firstRaw.d,
      workout_id: firstRaw.id || null,
      routine_id: firstRaw.routineId || null,
      routine_name: firstRaw.name || null,
      target: firstEntry.target || null,
      sets_done: firstEntry.sets.filter(s => s.done).length,
      volume: expectedVolume
    })
    r.sessions[0].sets.forEach(s => {
      expect(s.done).toBe(true)
      expect(typeof s.label).toBe('string')
      expect(s.label.length).toBeGreaterThan(0)
    })
  })

  test('limit caps returned sessions without changing total_count', () => {
    const exerciseId = '0426'
    const all = call('exercise_history', { exercise_id: exerciseId, limit: 100 })
    const limited = call('exercise_history', { exercise_id: exerciseId, limit: 1 })

    expect(all.total_count).toBeGreaterThan(1)
    expect(limited.total_count).toBe(all.total_count)
    expect(limited.returned_count).toBe(1)
    expect(limited.sessions).toHaveLength(1)
    expect(limited.sessions[0]).toEqual(all.sessions[0])
  })

  test('an exercise with no completed history returns an empty result, not an error', () => {
    const used = new Set(S.workouts.flatMap(w => (w.entries || []).map(e => e.id)))
    const unused = EXDB.find(e => !used.has(e.id))
    expect(unused).toBeTruthy()

    const r = call('exercise_history', { exercise_id: unused.id })
    expect(r.exercise).toMatchObject({ id: unused.id, name: unused.n })
    expect(r.total_count).toBe(0)
    expect(r.returned_count).toBe(0)
    expect(r.sessions).toEqual([])
  })
})

/* ---------- training_summary ---------- */

describe('training_summary', () => {
  test('summarises the last 6 weeks with stable aggregate sections', () => {
    const r = call('training_summary', { period: '6w' })

    expect(r.period).toBe('6w')
    expect(r.unit).toBe('kg')
    expect(r.date_range).toEqual({ from: isoDaysAgo(42), to: FAKE_TODAY_ISO })
    expect(r.workouts.completed).toBeGreaterThan(0)
    expect(r.workouts.sets_done).toBeGreaterThan(0)
    expect(r.workouts.volume).toBeGreaterThan(0)
    expect(r.workouts.prs).toBeGreaterThanOrEqual(0)
    expect(r.bodyweight.from).not.toBeNull()
    expect(r.bodyweight.to).not.toBeNull()
    expect(typeof r.bodyweight.change).toBe('number')
    expect(r.effort.scale).toBe('RIR')
    expect(r.effort.done_sets).toBeGreaterThan(0)
    expect(r.effort.rated_sets).toBeGreaterThan(0)
    expect(r.effort.avg).not.toBeNull()
    expect(r.effort.hard_pct).not.toBeNull()
    expect(r.muscle_coverage.worked_count).toBeGreaterThan(0)
    expect(r.muscle_coverage.neglected_count).toBeGreaterThanOrEqual(0)
    expect(r.muscle_coverage.top.length).toBeGreaterThan(0)
    expect(r.muscle_coverage.top[0]).toHaveProperty('slug')
    expect(r.muscle_coverage.top[0]).toHaveProperty('name')
    expect(r.muscle_coverage.top[0]).toHaveProperty('effective_sets')
    expect(r.muscle_coverage.worked_count + r.muscle_coverage.neglected_count)
      .toBe(r.muscle_coverage.muscle_count)
  })

  test('week is a narrower window than 6w, and 6w is no larger than all', () => {
    const week = call('training_summary', { period: 'week' })
    const six = call('training_summary', { period: '6w' })
    const all = call('training_summary', { period: 'all' })

    expect(week.date_range).toEqual({ from: isoDaysAgo(7), to: FAKE_TODAY_ISO })
    expect(all.date_range.from).toBeNull()
    expect(week.workouts.completed).toBeLessThanOrEqual(six.workouts.completed)
    expect(six.workouts.completed).toBeLessThanOrEqual(all.workouts.completed)
    expect(week.workouts.sets_done).toBeLessThanOrEqual(six.workouts.sets_done)
    expect(six.workouts.sets_done).toBeLessThanOrEqual(all.workouts.sets_done)
    expect(week.workouts.volume).toBeLessThanOrEqual(six.workouts.volume)
    expect(six.workouts.volume).toBeLessThanOrEqual(all.workouts.volume)
  })

  test('all covers the complete seeded history and bodyweight endpoints', () => {
    const r = call('training_summary', { period: 'all' })
    const bw = sortedByDate(S.bodyweight)
    const expectedChange = Math.round((bw.at(-1).w - bw[0].w) * 10) / 10

    expect(r.date_range).toEqual({ from: null, to: FAKE_TODAY_ISO })
    expect(r.workouts.completed).toBe(S.workouts.length)
    expect(r.bodyweight.from).toBe(bw[0].w)
    expect(r.bodyweight.to).toBe(bw.at(-1).w)
    expect(r.bodyweight.change).toBe(expectedChange)
  })

  test('zero-history state returns zeros and nulls rather than throwing', () => {
    S.workouts = []
    S.bodyweight = []
    _seedStateForTests(S)

    const r = call('training_summary', { period: 'month' })
    expect(r.workouts).toEqual({ completed: 0, sets_done: 0, volume: 0, prs: 0 })
    expect(r.bodyweight).toEqual({ from: null, to: null, change: null })
    expect(r.effort.done_sets).toBe(0)
    expect(r.effort.rated_sets).toBe(0)
    expect(r.effort.avg).toBeNull()
    expect(r.effort.hard_pct).toBeNull()
    expect(r.muscle_coverage.worked_count).toBe(0)
    expect(r.muscle_coverage.neglected_count).toBe(r.muscle_coverage.muscle_count)
    expect(r.muscle_coverage.top).toEqual([])
  })

  test('one bodyweight point has endpoints but no change', () => {
    S.workouts = []
    S.bodyweight = [{ d: FAKE_TODAY_ISO, w: 79.2 }]
    _seedStateForTests(S)

    const r = call('training_summary', { period: 'week' })
    expect(r.bodyweight).toEqual({ from: 79.2, to: 79.2, change: null })
  })
})

/* ---------- get_bodyweight ---------- */

describe('get_bodyweight', () => {
  test('returns weigh-ins with the goal, the latest entry, and exact delta vs goal', () => {
    const r = call('get_bodyweight')
    expect(r.goal).toBe(GOAL_WEIGHT)
    expect(r.entries.length).toBeGreaterThan(0)
    // Newest is the LATEST_BW entry (deterministic from the demo seed at the pinned time).
    expect(r.latest).toBeTruthy()
    expect(r.latest.date).toBe(LATEST_BW.date)
    expect(r.latest.weight).toBe(LATEST_BW.weight)
    expect(r.latest.delta_vs_goal).toBe(LATEST_BW.delta)
    // entries are chronological
    const dates = r.entries.map(e => e.date)
    expect([...dates].sort()).toEqual(dates)
  })

  test('closed date range returns a single matching entry on the boundary', () => {
    const all = call('get_bodyweight')
    expect(all.entries.length).toBeGreaterThan(1)
    const earliest = all.entries[0].date
    const restricted = call('get_bodyweight', { from: earliest, to: earliest })
    expect(restricted.entries.length).toBe(1)
    expect(restricted.entries[0].date).toBe(earliest)
  })

  test('no goal set → delta_vs_goal is null, not NaN, not zero', () => {
    S.targetW = null
    const r = call('get_bodyweight')
    expect(r.goal).toBeNull()
    r.entries.forEach(e => expect(e.delta_vs_goal).toBeNull())
    expect(r.latest.delta_vs_goal).toBeNull()
  })
})

/* ---------- estimate_1rm ---------- */

describe('estimate_1rm', () => {
  test('PR table across all reps-mode exercises; epley formula is the default', () => {
    const r = call('estimate_1rm', {})
    expect(r.formula).toBe('epley')
    expect(Array.isArray(r.pr_table)).toBe(true)
    expect(r.pr_table.length).toBeGreaterThan(0)
    r.pr_table.forEach(p => {
      expect(typeof p.est).toBe('number')
      expect(p.est).toBeGreaterThan(0)
      expect(typeof p.exName).toBe('string')
      expect(typeof p.exId).toBe('string')   // exId surfaced (regression test for the bug where callers passed exName as id)
    })
    // sort order: descending by est
    for (let i = 1; i < r.pr_table.length; i++) {
      expect(r.pr_table[i].est).toBeLessThanOrEqual(r.pr_table[i - 1].est)
    }
  })

  test('top-of-table values exactly match the hand-computed Epley for the demo seed', () => {
    const r = call('estimate_1rm', {})
    const top = r.pr_table[0]
    // Demo seed's hardest set: sled 45° leg press at 152.5×12 (r=12 hits estimate1RM's REP_CAP).
    expect(top.exId).toBe(LEG_PRESS_ID)
    expect(top.w).toBe(LEG_PRESS_BEST.w)
    expect(top.r).toBe(LEG_PRESS_BEST.r)
    expect(top.est).toBeCloseTo(LEG_PRESS_BEST.epley, 1)
  })

  test('per-exercise trend + best, with formula honours (Epley vs Brzycki numbers diverge)', () => {
    const epley = call('estimate_1rm', { exercise_id: LEG_PRESS_ID, formula: 'epley' })
    expect(epley.exercise.id).toBe(LEG_PRESS_ID)
    expect(epley.formula).toBe('epley')
    expect(Array.isArray(epley.trend)).toBe(true)
    expect(epley.best).toBeTruthy()
    expect(epley.best.w).toBe(LEG_PRESS_BEST.w)
    expect(epley.best.r).toBe(LEG_PRESS_BEST.r)
    expect(epley.best.est).toBeCloseTo(LEG_PRESS_BEST.epley, 1)
    const brz = call('estimate_1rm', { exercise_id: LEG_PRESS_ID, formula: 'brzycki' })
    expect(brz.formula).toBe('brzycki')
    expect(brz.best.est).toBeCloseTo(LEG_PRESS_BEST.brzycki, 1)
    // Distinct formulas must produce distinct estimates for this set.
    expect(epley.best.est).not.toBeCloseTo(brz.best.est, 1)
  })

  test('exercises with no reps-mode history get null best + empty trend (not a 0 estimate)', () => {
    S.workouts = []
    _seedStateForTests(S)
    const r = call('estimate_1rm', { exercise_id: LEG_PRESS_ID })
    expect(r.best).toBeNull()
    expect(r.trend).toEqual([])
    const table = call('estimate_1rm', {}).pr_table
    expect(table).toEqual([])
  })

  test('a null estimate says which kind of null it is', () => {
    // "Never trained" and "trained, but always above the rep cap" are opposite facts that both
    // arrive as best: null. Undistinguished, the second one reads as the first and an assistant
    // reports "no records" for an exercise in the log every week.
    S.workouts = [{
      id: 'w-highrep', d: '2026-07-26', name: 'Accessories', start: 1000, end: 1000 + 20 * 60000,
      vol: 0, prs: [],
      entries: [{
        id: LEG_PRESS_ID, target: { sets: 2, reps: 20, mode: 'reps' },
        sets: [{ w: 40, r: 20, done: true }, { w: 40, r: 18, done: true }]
      }]
    }]
    _seedStateForTests(S)

    const capped = call('estimate_1rm', { exercise_id: LEG_PRESS_ID })
    expect(capped.best).toBeNull()
    expect(capped.no_estimate_reason).toMatch(/above the \d+-rep cap/)

    // An exercise that genuinely has no sets must not borrow that explanation.
    const never = call('estimate_1rm', { exercise_id: '0684' })
    expect(never.best).toBeNull()
    expect(never.no_estimate_reason).toMatch(/No completed sets/)

    // And the cap is stated on this branch at all, which it never used to be.
    expect(capped.formula_note).toMatch(/Cap at/)
  })

  test('all three formulas are accepted', () => {
    ['epley', 'brzycki', 'lombardi'].forEach(f => {
      const r = call('estimate_1rm', { exercise_id: LEG_PRESS_ID, formula: f })
      expect(r.formula).toBe(f)
      expect(r.best).not.toBeNull()
    })
  })
})

/* ---------- muscle_balance ---------- */

describe('muscle_balance', () => {
  test('reports worked + neglected muscles in head-to-toe order over all time', () => {
    const r = call('muscle_balance', { period: 'all' })
    expect(r.period).toBe('all')
    expect(r.workouts_in_period).toBeGreaterThan(0)
    expect(Array.isArray(r.worked)).toBe(true)
    expect(Array.isArray(r.neglected)).toBe(true)
    expect(r.muscle_order_head_to_toe[0]).toBe('trapezius')
    expect(r.muscle_order_head_to_toe.at(-1)).toBe('tibialis')
    r.worked.forEach(w => {
      expect(w.level).toBeGreaterThanOrEqual(1)
      expect(w.level).toBeLessThanOrEqual(4)
      expect(typeof w.name).toBe('string')
      expect(typeof w.effective_sets).toBe('number')
    })
  })

  test('worked + neglected partition every muscle exactly once', () => {
    const r = call('muscle_balance', { period: 'all' })
    const all = new Set(r.muscle_order_head_to_toe)
    const worked = new Set(r.worked.map(w => w.slug))
    const neg = new Set(r.neglected.map(n => n.slug))
    expect(worked.size + neg.size).toBe(all.size)
    expect([...worked].every(s => all.has(s))).toBe(true)
    expect([...neg].every(s => all.has(s))).toBe(true)
  })

  test('period windows are inclusive: week ≤ month ≤ all', () => {
    const all = call('muscle_balance', { period: 'all' }).workouts_in_period
    const month = call('muscle_balance', { period: 'month' }).workouts_in_period
    const week = call('muscle_balance', { period: 'week' }).workouts_in_period
    expect(week).toBeLessThanOrEqual(month)
    expect(month).toBeLessThanOrEqual(all)
  })

  test('zero-workout state still returns all 18 muscles as neglected (not empty)', () => {
    S.workouts = []
    const r = call('muscle_balance', { period: 'all' })
    expect(r.workouts_in_period).toBe(0)
    expect(r.worked).toEqual([])
    expect(r.neglected.length).toBe(r.muscle_order_head_to_toe.length)
    expect(r.neglected.length).toBe(18)
  })
})

/* ---------- progression_next ---------- */

describe('progression_next', () => {
  test('returns the deterministic next progression for a completed exercise', () => {
    const push = S.routines.find(r => r.name === 'Push Day')
    const fly = push.ex.find(e => e.id === '0426')
    const r = call('progression_next', { routine_id: push.id, exercise_id: fly.id })

    expect(r.routine).toMatchObject({ id: push.id, name: 'Push Day' })
    expect(r.exercise).toMatchObject({ id: '0426', mode: 'reps' })
    expect(r.current_target.sets).toBe(fly.sets)
    expect(r.current_target.reps).toBe(fly.reps)
    expect(r.policy).toBe('linear')
    expect(r.policy_name).toBe('Linear progression')
    expect(r.kind).toBe('up')
    expect(r.next.weight).toBe(27.5)
    expect(r.reason).toBe('Every rep last time — 2.5 kg more.')
    expect(r.confidence).toBe('deterministic')
  })

  test('returns hold when recent history missed the prescribed target', () => {
    const pull = S.routines.find(r => r.name === 'Pull Day')
    const row = pull.ex.find(e => e.id === '1323')
    const r = call('progression_next', { routine_id: pull.id, exercise_id: row.id })

    expect(r.policy).toBe('linear')
    expect(r.kind).toBe('hold')
    expect(r.next.weight).toBe(55)
    expect(r.reason).toBe('Missed reps last time — same weight again (1 of 3 to go).')
  })

  test('throws ENOENT for a missing routine or an exercise outside the routine', () => {
    const push = S.routines.find(r => r.name === 'Push Day')
    expect(() => call('progression_next', { routine_id: 'missing-routine', exercise_id: '0426' })).toThrow()
    expect(() => call('progression_next', { routine_id: push.id, exercise_id: 'not-in-this-routine' })).toThrow()
  })
})

/* ---------- detect_stalls ---------- */

describe('detect_stalls', () => {
  test('returns conservative stall candidates with evidence and recent sessions', () => {
    S = syntheticStallState()
    _seedStateForTests(S)

    const r = call('detect_stalls', { window: 4 })
    expect(r.window).toBe(4)
    expect(r.unit).toBe('kg')
    expect(r.candidates.length).toBeGreaterThanOrEqual(2)

    const row = r.candidates.find(c => c.exercise.id === '1323')
    expect(row).toBeTruthy()
    expect(row.exercise).toMatchObject({ id: '1323', mode: 'reps' })
    expect(row.routine).toMatchObject({ id: 'pull', name: 'Pull Day' })
    expect(row.signal).toBe('possible_stall')
    expect(row.severity).toBe('high')
    expect(row.evidence.sessions_checked).toBe(4)
    expect(row.evidence.latest_date).toBe('2026-07-22')
    expect(row.evidence.best_estimate_change).toBeLessThan(0)
    expect(row.evidence.missed_target_sessions).toBe(4)
    expect(row.evidence.latest_target).toMatchObject({ sets: 3, reps: 10, weight: 55 })
    expect(row.recent_sessions).toHaveLength(4)
    expect(row.recent_sessions[0]).toMatchObject({
      date: '2026-07-22',
      top_set: '52.5×8',
      sets_done: 3
    })
    expect(row.recent_sessions[0].volume).toBeGreaterThan(0)
  })

  test('routine_id limits the scan to one routine', () => {
    S = syntheticStallState()
    _seedStateForTests(S)

    const pull = call('detect_stalls', { window: 4, routine_id: 'pull' })
    expect(pull.candidates.map(c => c.routine.id)).toEqual(['pull'])
    expect(pull.candidates.map(c => c.exercise.id)).toContain('1323')
    expect(pull.candidates.map(c => c.exercise.id)).not.toContain(LEG_PRESS_ID)

    const legs = call('detect_stalls', { window: 4, routine_id: 'legs' })
    expect(legs.candidates.map(c => c.routine.id)).toEqual(['legs'])
    expect(legs.candidates.map(c => c.exercise.id)).toEqual([LEG_PRESS_ID])
  })

  test('skips improving reps exercises, non-reps modes and insufficient history', () => {
    S = syntheticStallState()
    S.workouts = S.workouts.slice(0, 2)
    _seedStateForTests(S)

    const none = call('detect_stalls', { window: 4 })
    expect(none.candidates).toEqual([])

    S = syntheticStallState()
    _seedStateForTests(S)
    const pull = call('detect_stalls', { window: 4, routine_id: 'pull' })
    expect(pull.candidates.map(c => c.exercise.id)).toEqual(['1323'])
    expect(pull.candidates.map(c => c.exercise.id)).not.toContain('0426')
    expect(pull.candidates.map(c => c.exercise.id)).not.toContain('synth-plank')
  })

  test('throws ENOENT for an unknown routine filter', () => {
    S = syntheticStallState()
    _seedStateForTests(S)

    expect(() => call('detect_stalls', { routine_id: 'missing' })).toThrow()
  })
})

/* ---------- shared: no-state fallback ---------- */

describe('shared: no-state fallback', () => {
  test('every tool answers gracefully when state is null (fresh account, never signed in)', () => {
    _seedStateForTests(null)
    // Each tool gets the minimum args its zod schema mandates; under real LLM-client use the
    // SDK rejects missing ones before the handler runs, so we only test the post-validation path.
    const calls = {
      list_routines: {},
      get_routine: { routine_id: '0031' },
      get_week_plan: {},
      list_workouts: {},
      get_workout: { date: '2026-07-26' },
      get_bodyweight: {},
      estimate_1rm: {},
      muscle_balance: { period: 'all' },
      progression_next: { routine_id: 'routine', exercise_id: 'exercise' },
      exercise_history: { exercise_id: 'exercise' },
      training_summary: { period: '6w' },
      detect_stalls: { window: 4 }
    }
    for (const t of TOOLS) {
      const r = t.handler(calls[t.name] || {})
      expect(r).toHaveProperty('error')
    }
  })

  // Restore state after the no-state detour so a future test that forgets to seed sees the
  // failure rather than inherits null silently.
  afterAll(() => { _seedStateForTests(S = freshState()) })
})
