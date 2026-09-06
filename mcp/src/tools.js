/* Read-only MCP tools. Each handler returns JSON; labels.js pre-substitutes any
   {0}/{1} template the lib returns so the LLM gets final text, not template strings.
   ISO dates are validated on the way in; the handlers never see 'yesterday'. */
import { z } from 'zod'
import { createAuditService } from '../../api/audit-service.js'
import { createStateService } from '../../api/state-service.js'
import { getState, getUser, getStateForUid, getUserForUid } from './state.js'
import { verifyMcpWriteToken } from './write-auth.js'
import {
  setLabel, exLine, muscleName, policyName, friendlyDuration, ratio, muscleOrder, fmt
} from './labels.js'
import {
  modeOf, workoutVolume, setsDone, effectiveRoutine, effectiveRoutineId, bestWeightFor, defaultConfig, cleanupSg
} from '../../frontend/src/lib/history.js'
import { BODYPARTS, EXDB, EXIDX, exOr } from '../../frontend/src/lib/exercises.js'
import {
  estimate1RM, best1RM, bestSetOf, e1rmSeries, DEFAULT_FORMULA, REP_CAP
} from '../../frontend/src/lib/onerm.js'
import { loadOfWorkouts, rankOf, levelsOf } from '../../frontend/src/lib/muscles.js'
import { displayScale, effortSummary, scaleName } from '../../frontend/src/lib/effort.js'
import { uid } from '../../frontend/src/lib/format.js'
import { POLICIES, nextPrescription } from '../../frontend/src/lib/progression.js'

/* ---------- helpers ---------- */

function entryView(e, S) {
  const ex = exerciseForSummary(S, e.id)
  // Spread id into the cfg the way every call site in the app does (Workout.jsx, Stats.jsx,
  // progression.js) — the sheet saves a cardio target as {sets, min, speed} with no id and no
  // mode, so modeOf needs the id to fall through to isCardio(id).
  const cfg = { ...(e.target || {}), id: e.id }
  const mode = modeOf(cfg)
  return {
    id: e.id,
    name: ex.n,
    body_part: ex.bp || null,
    mode,
    target: e.target || null,
    sets: (e.sets || []).map(s => ({
      done: !!s.done,
      label: setLabel(e.id, { ...s, done: undefined }, cfg),
      w: Number(s.w) || 0,
      r: Number(s.r) || 0,
      sec: Number(s.sec) || 0,
      min: Number(s.min) || 0,
      speed: Number(s.speed) || 0
    }))
  }
}

// Best estimate per exercise, mirroring the UI's PR table: every eligible set across history, biggest wins.
function prTable(S, formula) {
  const byId = new Map()
  for (const w of (S.workouts || [])) {
    for (const e of (w.entries || [])) {
      for (const s of (e.sets || [])) {
        if (!s.done) continue
        const est = estimate1RM(s.w, s.r, formula)
        if (est == null) continue
        const ex = exerciseForSummary(S, e.id)
        const prev = byId.get(e.id)
        if (!prev || est > prev.est) {
          // exId as well as exName: the consumer needs an id, not a name — exOr() treats any
          // string as both, so passing exName where exId belongs would silently "work" wrong.
          byId.set(e.id, { exId: e.id, exName: ex.n, bp: ex.bp || null, est, w: Number(s.w), r: Math.round(Number(s.r)), date: w.d })
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.est - a.est)
}

function entryVolume(e) {
  return (e.sets || [])
    .filter(s => s.done)
    .reduce((sum, s) => sum + (Number(s.w) || 0) * (Number(s.r) || 0), 0)
}

function doneEntryView(e, S) {
  return entryView({ ...e, sets: (e.sets || []).filter(s => s.done) }, S)
}

function routineConfigForExercise(S, exerciseId) {
  for (const r of (S.routines || [])) {
    const cfg = (r.ex || []).find(e => e.id === exerciseId)
    if (cfg) return cfg
  }
  return null
}

function modeForExerciseHistory(S, exerciseId, rows) {
  const latestTarget = rows[0]?.entry?.target
  if (latestTarget) return modeOf({ ...latestTarget, id: exerciseId })
  const cfg = routineConfigForExercise(S, exerciseId)
  return modeOf(cfg || { id: exerciseId })
}

const PERIOD_DAYS = {
  week: 7,
  month: 30,
  '6w': 42,
  '12w': 84,
  all: null
}

function currentISO() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(value + 'T12:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function daysBeforeISO(iso, days) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - days)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function periodRange(period) {
  const to = currentISO()
  const days = PERIOD_DAYS[period]
  return {
    from: days == null ? null : daysBeforeISO(to, days),
    to
  }
}

function inDateRange(d, range) {
  if (!d) return false
  if (range.from && d < range.from) return false
  if (range.to && d > range.to) return false
  return true
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10
}

function nullableRound1(n) {
  return n == null ? null : round1(n)
}

function bodyweightSummary(S, range) {
  const entries = (S.bodyweight || [])
    .filter(b => inDateRange(b.d, range))
    .sort((a, b) => (a.d || '').localeCompare(b.d || ''))
  const first = entries[0] || null
  const last = entries.at(-1) || null
  return {
    from: first ? first.w : null,
    to: last ? last.w : null,
    change: entries.length >= 2 ? round1(last.w - first.w) : null
  }
}

function normalizeBodyweight(weight) {
  const n = Math.round((Number(weight) || 0) * 10) / 10
  if (!(n > 0)) fail('EINVAL', 'weight must be > 0')
  return n
}

function bodyweightTimestamp(date) {
  return new Date(date + 'T12:00:00').getTime()
}

function bodyweightChange(S, date, weight) {
  const after = normalizeBodyweight(weight)
  const current = (S.bodyweight || []).find(b => b.d === date)
  return {
    path: `bodyweight.${date}`,
    before: current ? normalizeBodyweight(current.w) : null,
    after
  }
}

function applyBodyweightEntry(current, date, weight) {
  const entry = { d: date, w: normalizeBodyweight(weight), t: bodyweightTimestamp(date) }
  return {
    ...current,
    bodyweight: [
      ...(current.bodyweight || []).filter(b => b.d !== date),
      entry
    ].sort((a, b) => (a.d < b.d ? -1 : 1))
  }
}

function workoutTimestamp(date, hour = 18) {
  return new Date(date + 'T' + String(hour).padStart(2, '0') + ':00:00').getTime()
}

function makeWorkoutId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function normalizeWorkoutBodyweight(weight) {
  if (weight == null) return null
  return normalizeBodyweight(weight)
}

function requireFiniteNumber(value, message) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('EINVAL', message)
  return value
}

function requireInteger(value, message) {
  requireFiniteNumber(value, message)
  if (!Number.isInteger(value)) fail('EINVAL', message)
  return value
}

function normalizeWorkoutSets(exerciseId, cfg, sets) {
  if (!Array.isArray(sets) || !sets.length) fail('EINVAL', `${exerciseId} needs at least one set`)
  if (sets.length > 50) fail('EINVAL', `${exerciseId} accepts at most 50 sets`)
  const mode = modeOf(cfg)
  return sets.map((set, index) => {
    const n = index + 1
    if (!set || typeof set !== 'object') fail('EINVAL', `${exerciseId} set ${n} must be an object`)
    if (mode === 'reps') {
      const w = requireFiniteNumber(set.w, `${exerciseId} set ${n} must include finite w >= 0`)
      if (w < 0) fail('EINVAL', `${exerciseId} set ${n} must include finite w >= 0`)
      const r = requireInteger(set.r, `${exerciseId} set ${n} must include integer r >= 1`)
      if (r < 1) fail('EINVAL', `${exerciseId} set ${n} must include integer r >= 1`)
      return { w, r, done: true }
    }
    if (mode === 'time') {
      const sec = requireInteger(set.sec, `${exerciseId} set ${n} must include integer sec >= 1`)
      if (sec < 1) fail('EINVAL', `${exerciseId} set ${n} must include integer sec >= 1`)
      const w = set.w == null ? 0 : requireFiniteNumber(set.w, `${exerciseId} set ${n} w must be finite and >= 0`)
      if (w < 0) fail('EINVAL', `${exerciseId} set ${n} w must be finite and >= 0`)
      return { sec, w, done: true }
    }
    if (mode === 'cardio') {
      const min = requireFiniteNumber(set.min, `${exerciseId} set ${n} must include min >= 1`)
      if (min < 1) fail('EINVAL', `${exerciseId} set ${n} must include min >= 1`)
      const speed = set.speed == null ? 0 : requireFiniteNumber(set.speed, `${exerciseId} set ${n} speed must be finite and >= 0`)
      if (speed < 0) fail('EINVAL', `${exerciseId} set ${n} speed must be finite and >= 0`)
      return { min, speed, done: true }
    }
    fail('EINVAL', `unsupported workout mode ${JSON.stringify(mode)} for ${exerciseId}`)
  })
}

function inferFreestyleMode(S, exerciseId, target, sets) {
  if (target?.mode) return target.mode
  const ex = requireLibraryExercise(S, exerciseId)
  if (ex.bp === 'cardio') return 'cardio'
  const first = sets[0] || {}
  if (first.sec != null) return 'time'
  if (first.min != null) return 'cardio'
  return 'reps'
}

function inferredTargetFromSets(mode, sets) {
  const first = sets[0] || {}
  if (mode === 'cardio') return { mode: 'cardio', sets: sets.length, min: first.min, speed: first.speed || 0 }
  if (mode === 'time') return { sets: sets.length, sec: first.sec, weight: first.w || 0 }
  return { sets: sets.length, reps: first.r, weight: first.w || 0 }
}

const FREESTYLE_NUMERIC_TARGET_FIELDS = new Set(['sets', 'reps', 'weight', 'repsMin', 'repsMax', 'sec', 'min', 'speed'])

function validateFreestyleTargetValues(target = {}) {
  for (const [field, value] of Object.entries(target)) {
    if (FREESTYLE_NUMERIC_TARGET_FIELDS.has(field)) {
      validateTargetField(field, value)
      continue
    }
    if (field === 'mode') {
      if (!['reps', 'time', 'cardio'].includes(value)) fail('EINVAL', `unknown exercise mode ${JSON.stringify(value)}`)
      continue
    }
    if (field === 'bodyweight' || field === 'side') {
      if (typeof value !== 'boolean') fail('EINVAL', `${field} must be a boolean`)
      continue
    }
    fail('EINVAL', `unsupported freestyle target field ${JSON.stringify(field)}`)
  }
}

function validateFreestyleTargetForMode(mode, target = {}) {
  const allowed = {
    reps: new Set(['mode', 'sets', 'reps', 'repsMin', 'repsMax', 'weight', 'bodyweight', 'side']),
    time: new Set(['mode', 'sets', 'sec', 'weight', 'bodyweight', 'side']),
    cardio: new Set(['mode', 'sets', 'min', 'speed'])
  }[mode]
  for (const field of Object.keys(target)) {
    if (!allowed.has(field)) fail('EINVAL', `${field} is not valid for ${mode} mode`)
  }
  if (target.repsMin != null && target.repsMax != null && target.repsMax < target.repsMin) {
    fail('EINVAL', 'repsMax must be >= repsMin')
  }
}

function normalizeFreestyleTarget(S, exerciseId, target = {}, sets) {
  const ex = requireLibraryExercise(S, exerciseId)
  const mode = inferFreestyleMode(S, exerciseId, target, sets)
  if (ex.bp === 'cardio' && mode !== 'cardio') fail('EINVAL', `cardio exercise ${JSON.stringify(exerciseId)} must use mode "cardio"`)
  validateFreestyleTargetValues(target)
  validateFreestyleTargetForMode(mode, target)
  const normalized = {
    id: exerciseId,
    ...defaultConfig(exerciseId, mode),
    ...inferredTargetFromSets(mode, sets),
    ...target
  }
  return { ...normalized, mode }
}

function topWeightForEntry(entry) {
  const weights = (entry.sets || [])
    .filter(set => set.done)
    .map(set => Number(set.w) || 0)
  return Math.max(0, ...weights)
}

function validateLoggedWorkoutInput(S, routineId, durationMin, entries) {
  const routine = requireRoutineById(S, routineId)
  const duration = requireInteger(durationMin, 'duration_min must be an integer between 1 and 1440')
  if (duration < 1 || duration > 1440) fail('EINVAL', 'duration_min must be an integer between 1 and 1440')
  if (!Array.isArray(entries) || !entries.length) fail('EINVAL', 'log_workout needs at least one entry')
  if (entries.length > 50) fail('EINVAL', 'log_workout accepts at most 50 entries')

  const seen = new Set()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') fail('EINVAL', 'workout entry must be an object')
    if (!entry.exercise_id) fail('EINVAL', 'workout entry needs exercise_id')
    if (seen.has(entry.exercise_id)) fail('EINVAL', `duplicate workout entry for exercise ${JSON.stringify(entry.exercise_id)}`)
    seen.add(entry.exercise_id)
    const cfg = requireRoutineExercise(routine, entry.exercise_id)
    normalizeWorkoutSets(entry.exercise_id, cfg, entry.sets)
  }
  return { routine, duration }
}

function buildLoggedWorkout(S, { routine_id, date, duration_min, bodyweight, entries }) {
  const { routine, duration } = validateLoggedWorkoutInput(S, routine_id, duration_min, entries)
  const byExerciseId = new Map(entries.map(entry => [entry.exercise_id, entry]))
  const start = workoutTimestamp(date)
  const workoutEntries = (routine.ex || [])
    .filter(cfg => byExerciseId.has(cfg.id))
    .map(cfg => {
      const sets = normalizeWorkoutSets(cfg.id, cfg, byExerciseId.get(cfg.id).sets)
      const entry = {
        id: cfg.id,
        sets,
        topW: null,
        target: { ...cfg }
      }
      const topW = topWeightForEntry(entry)
      if (topW > 0) entry.topW = topW
      return entry
    })

  const prs = workoutEntries
    .filter(entry => topWeightForEntry(entry) > bestWeightFor({ ...S, workouts: S.workouts || [] }, entry.id))
    .map(entry => entry.id)

  const workout = {
    id: makeWorkoutId(),
    d: date,
    start,
    end: start + duration * 60000,
    routineId: routine.id,
    name: routine.name,
    bw: normalizeWorkoutBodyweight(bodyweight),
    entries: workoutEntries,
    prs
  }
  workout.vol = workoutVolume(workout)
  return workout
}

function normalizeFreestyleWorkoutName(name) {
  if (name == null) return 'Freestyle'
  if (typeof name !== 'string') fail('EINVAL', 'name must be a string')
  const trimmed = name.trim()
  if (!trimmed) fail('EINVAL', 'name must be a non-empty string')
  return trimmed.slice(0, 120)
}

function validateFreestyleWorkoutInput(S, durationMin, entries) {
  const duration = requireInteger(durationMin, 'duration_min must be an integer between 1 and 1440')
  if (duration < 1 || duration > 1440) fail('EINVAL', 'duration_min must be an integer between 1 and 1440')
  if (!Array.isArray(entries) || !entries.length) fail('EINVAL', 'log_freestyle_workout needs at least one entry')
  if (entries.length > 50) fail('EINVAL', 'log_freestyle_workout accepts at most 50 entries')

  const seen = new Set()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') fail('EINVAL', 'workout entry must be an object')
    if (!entry.exercise_id) fail('EINVAL', 'workout entry needs exercise_id')
    if (seen.has(entry.exercise_id)) fail('EINVAL', `duplicate workout entry for exercise ${JSON.stringify(entry.exercise_id)}`)
    seen.add(entry.exercise_id)
    requireLibraryExercise(S, entry.exercise_id)
    const target = normalizeFreestyleTarget(S, entry.exercise_id, entry.target || {}, entry.sets)
    normalizeWorkoutSets(entry.exercise_id, target, entry.sets)
  }
  return duration
}

function buildFreestyleWorkout(S, { name, date, duration_min, bodyweight, entries }) {
  if (!isValidISODate(date)) fail('EINVAL', 'date must be a valid YYYY-MM-DD date')
  const duration = validateFreestyleWorkoutInput(S, duration_min, entries)
  const start = workoutTimestamp(date)
  const workoutEntries = entries.map(entry => {
    const target = normalizeFreestyleTarget(S, entry.exercise_id, entry.target || {}, entry.sets)
    const sets = normalizeWorkoutSets(entry.exercise_id, target, entry.sets)
    const result = { id: entry.exercise_id, sets, topW: null, target }
    const topW = topWeightForEntry(result)
    if (topW > 0) result.topW = topW
    return result
  })

  const prs = workoutEntries
    .filter(entry => topWeightForEntry(entry) > bestWeightFor({ ...S, workouts: S.workouts || [] }, entry.id))
    .map(entry => entry.id)

  const workout = {
    id: makeWorkoutId(),
    d: date,
    start,
    end: start + duration * 60000,
    routineId: null,
    name: normalizeFreestyleWorkoutName(name),
    bw: normalizeWorkoutBodyweight(bodyweight),
    entries: workoutEntries,
    prs
  }
  workout.vol = workoutVolume(workout)
  return workout
}

function exWeightChanges(S, workout) {
  return (workout.entries || [])
    .map(entry => {
      const after = topWeightForEntry(entry)
      const before = S.exWeights?.[entry.id]?.w ?? null
      if (!(after > 0) || (before != null && after <= before)) return null
      return { path: `exWeights.${entry.id}`, before, after }
    })
    .filter(Boolean)
}

function loggedWorkoutChanges(S, workout) {
  return [
    { path: 'workouts', before: (S.workouts || []).length, after: (S.workouts || []).length + 1 },
    ...exWeightChanges(S, workout)
  ]
}

function applyLoggedWorkout(current, workout) {
  const exWeights = { ...(current.exWeights || {}) }
  for (const entry of workout.entries || []) {
    const max = topWeightForEntry(entry)
    const currentBest = exWeights[entry.id]
    if (max > 0 && (!currentBest || max > currentBest.w)) {
      exWeights[entry.id] = { w: max, d: workout.d }
    }
  }
  return {
    ...current,
    exWeights,
    workouts: [
      ...(current.workouts || []),
      workout
    ]
  }
}

function exerciseForSummary(S, exerciseId) {
  return (S ? exerciseFromLibrary(S, exerciseId) : null) || exOr(exerciseId)
}

function workoutSummary(workout, S = null) {
  return {
    id: workout.id || null,
    date: workout.d,
    routine_id: workout.routineId || null,
    name: workout.name || null,
    sets_done: setsDone(workout),
    volume: workoutVolume(workout),
    prs: workout.prs || [],
    bodyweight: workout.bw || null,
    duration_ms: workout.end && workout.start ? workout.end - workout.start : null,
    duration: workout.end && workout.start ? friendlyDuration(workout.end - workout.start) : null,
    entries: (workout.entries || []).map(entry => {
      const cfg = { ...(entry.target || {}), id: entry.id }
      const ex = exerciseForSummary(S, entry.id)
      return {
        id: entry.id,
        name: ex.n,
        mode: modeOf(cfg),
        sets_done: doneSetsOf(entry).length,
        volume: entryVolume(entry)
      }
    })
  }
}

function muscleCoverageSummary(workouts) {
  const load = loadOfWorkouts(workouts)
  const { worked, missed } = rankOf(load)
  return {
    muscle_count: muscleOrder().length,
    worked_count: worked.length,
    neglected_count: missed.length,
    top: worked.slice(0, 5).map(slug => ({
      slug,
      name: muscleName(slug),
      effective_sets: round1(load[slug] || 0)
    })),
    neglected: missed.map(slug => ({ slug, name: muscleName(slug) }))
  }
}

function routinesToScan(S, routineId) {
  if (!routineId) return S.routines || []
  const routine = (S.routines || []).find(r => r.id === routineId)
  if (!routine) { const e = new Error(`no routine with id ${JSON.stringify(routineId)}`); e.code = 'ENOENT'; throw e }
  return [routine]
}

function doneSetsOf(entry) {
  return (entry?.sets || []).filter(s => s.done)
}

function exerciseSessionRows(S, exerciseId) {
  return (S.workouts || [])
    .map(w => {
      const entry = (w.entries || []).find(e =>
        e.id === exerciseId && doneSetsOf(e).length)
      if (!entry) return null
      const best = bestSetOf(entry, DEFAULT_FORMULA)
      if (!best) return null
      return { workout: w, entry, best }
    })
    .filter(Boolean)
    .sort((a, b) => (a.workout.d || '').localeCompare(b.workout.d || ''))
}

function missedRoutineTarget(entry, cfg) {
  const done = doneSetsOf(entry)
  const targetSets = Math.max(1, cfg.sets || 1)
  const targetReps = cfg.reps != null ? cfg.reps : cfg.repsMin != null ? cfg.repsMin : 0
  if (done.length < targetSets) return true
  if (targetReps && done.some(s => (Number(s.r) || 0) < targetReps)) return true
  if (cfg.weight != null && done.some(s => (Number(s.w) || 0) < cfg.weight)) return true
  return false
}

function currentTargetFor(cfg) {
  return {
    sets: cfg.sets || 1,
    reps: cfg.reps != null ? cfg.reps : null,
    reps_min: cfg.repsMin != null ? cfg.repsMin : null,
    weight: cfg.weight != null ? cfg.weight : null
  }
}

function topSetLabel(exerciseId, cfg, best) {
  return setLabel(exerciseId, { w: best.w, r: best.r }, cfg)
}

function stallCandidateFor(S, routine, cfg, window) {
  if (modeOf(cfg) !== 'reps') return null
  const rows = exerciseSessionRows(S, cfg.id)
  if (rows.length < 3) return null
  const checked = rows.slice(-window)
  if (checked.length < 3) return null

  const latest = checked.at(-1)
  const previousBest = Math.max(...checked.slice(0, -1).map(r => r.best.est))
  const bestEstimateChange = round1(latest.best.est - previousBest)
  const missedTargetSessions = checked.filter(r => missedRoutineTarget(r.entry, cfg)).length
  const noImprovement = bestEstimateChange <= 0
  if (!(noImprovement && missedTargetSessions >= 2) && missedTargetSessions < 3) return null

  const ex = exerciseForSummary(S, cfg.id)
  return {
    exercise: { id: cfg.id, name: ex.n, body_part: ex.bp || null, mode: 'reps' },
    routine: { id: routine.id, name: routine.name, emoji: routine.emoji || null },
    signal: 'possible_stall',
    severity: missedTargetSessions >= 3 && bestEstimateChange < 0 ? 'high' : 'medium',
    evidence: {
      sessions_checked: checked.length,
      latest_date: latest.workout.d,
      best_estimate_change: bestEstimateChange,
      missed_target_sessions: missedTargetSessions,
      latest_target: currentTargetFor(cfg)
    },
    recent_sessions: checked.slice().reverse().map(({ workout: w, entry, best }) => ({
      date: w.d,
      workout_id: w.id || null,
      routine_id: w.routineId || null,
      routine_name: w.name || null,
      top_set: topSetLabel(cfg.id, cfg, best),
      sets_done: doneSetsOf(entry).length,
      volume: entryVolume(entry)
    }))
  }
}

function severityRank(severity) {
  return severity === 'high' ? 0 : 1
}

function revisionOf(S) {
  const revision = Number(S?._revision || 0)
  return Number.isInteger(revision) && revision >= 0 ? revision : 0
}

const ROUTINE_POLICY_SET = new Set(POLICIES)
const TARGET_FIELD_RULES = {
  sets: { integer: true, min: 1 },
  reps: { integer: true, min: 1 },
  weight: { min: 0 },
  inc: { min: 0 },
  repsMin: { integer: true, min: 1 },
  repsMax: { integer: true, min: 1 },
  sec: { integer: true, min: 1 },
  min: { min: 1 },
  speed: { min: 0 }
}
const TARGET_FIELDS = new Set(Object.keys(TARGET_FIELD_RULES))
const BODY_PART_SET = new Set(BODYPARTS)
const setPolicyOpSchema = z.object({
  op: z.literal('set_policy'),
  policy: z.enum(['off', 'linear', 'greyskull', 'double', 'time'])
}).strict()
const setExerciseTargetOpSchema = z.object({
  op: z.literal('set_exercise_target'),
  exercise_id: z.string().min(1),
  sets: z.number().int().min(1).optional(),
  reps: z.number().int().min(1).optional(),
  weight: z.number().min(0).optional(),
  inc: z.number().min(0).optional(),
  repsMin: z.number().int().min(1).optional(),
  repsMax: z.number().int().min(1).optional(),
  sec: z.number().int().min(1).optional(),
  min: z.number().min(1).optional(),
  speed: z.number().min(0).optional()
}).strict()
const addExerciseTargetSchema = z.object({
  sets: z.number().int().min(1).optional(),
  reps: z.number().int().min(1).optional(),
  weight: z.number().min(0).optional(),
  inc: z.number().min(0).optional(),
  repsMin: z.number().int().min(1).optional(),
  repsMax: z.number().int().min(1).optional(),
  sec: z.number().int().min(1).optional(),
  min: z.number().min(1).optional(),
  speed: z.number().min(0).optional(),
  mode: z.enum(['reps', 'time', 'cardio']).optional(),
  bodyweight: z.boolean().optional(),
  side: z.boolean().optional(),
  prog: z.enum(['off', 'linear', 'greyskull', 'double', 'time']).optional()
}).strict()
const addExerciseOpSchema = z.object({
  op: z.literal('add_exercise'),
  exercise_id: z.string().min(1),
  position: z.number().int().min(1).optional(),
  target: addExerciseTargetSchema.optional()
}).strict()
const removeExerciseOpSchema = z.object({
  op: z.literal('remove_exercise'),
  exercise_id: z.string().min(1)
}).strict()
const reorderExerciseOpSchema = z.object({
  op: z.literal('reorder_exercise'),
  exercise_id: z.string().min(1),
  position: z.number().int().min(1)
}).strict()
const linkSupersetOpSchema = z.object({
  op: z.literal('link_superset'),
  exercise_id: z.string().min(1)
}).strict()
const unlinkSupersetOpSchema = z.object({
  op: z.literal('unlink_superset'),
  exercise_id: z.string().min(1)
}).strict()
const repsWorkoutSetSchema = z.object({
  w: z.number().min(0),
  r: z.number().int().min(1),
  done: z.boolean().optional()
}).strict()
const timeWorkoutSetSchema = z.object({
  sec: z.number().int().min(1),
  w: z.number().min(0).optional(),
  done: z.boolean().optional()
}).strict()
const cardioWorkoutSetSchema = z.object({
  min: z.number().min(1),
  speed: z.number().min(0).optional(),
  done: z.boolean().optional()
}).strict()
const workoutEntrySchema = z.object({
  exercise_id: z.string().min(1),
  sets: z.array(z.union([repsWorkoutSetSchema, timeWorkoutSetSchema, cardioWorkoutSetSchema])).min(1).max(50)
}).strict()
const ISO_DATE_SCHEMA = z.string().refine(isValidISODate, 'date must be a valid YYYY-MM-DD date')
const freestyleTargetSchema = z.object({
  mode: z.enum(['reps', 'time', 'cardio']).optional(),
  sets: z.number().int().min(1).optional(),
  reps: z.number().int().min(1).optional(),
  weight: z.number().min(0).optional(),
  repsMin: z.number().int().min(1).optional(),
  repsMax: z.number().int().min(1).optional(),
  sec: z.number().int().min(1).optional(),
  min: z.number().min(1).optional(),
  speed: z.number().min(0).optional(),
  bodyweight: z.boolean().optional(),
  side: z.boolean().optional()
}).strict()
const freestyleWorkoutEntrySchema = z.object({
  exercise_id: z.string().min(1),
  target: freestyleTargetSchema.optional(),
  sets: z.array(z.union([repsWorkoutSetSchema, timeWorkoutSetSchema, cardioWorkoutSetSchema])).min(1).max(50)
}).strict()
const createCustomExerciseSchema = {
  name: z.string().min(1).describe('Name for the new custom exercise. Trimmed before writing.'),
  body_part: z.string().min(1).describe('Existing openGym body part id, for example chest, back, upper legs or cardio.'),
  description: z.string().optional().describe('Optional setup/cue text. Trimmed and capped at 1000 characters.'),
  expected_revision: z.number().int().min(0).describe('State _revision observed before proposing the write. Prevents lost updates.'),
  dry_run: z.boolean().optional().describe('When true, preview changes without writing. Defaults to true.')
}

function routinePolicy(routine) {
  return routine?.prog || routine?.policy || 'off'
}

function fail(code, message) {
  const e = new Error(message)
  e.code = code
  throw e
}

function requireRoutineById(S, routineId) {
  const routine = (S.routines || []).find(r => r.id === routineId)
  if (!routine) fail('ENOENT', `no routine with id ${JSON.stringify(routineId)}`)
  return routine
}

function requireRoutineExercise(routine, exerciseId) {
  const cfg = (routine.ex || []).find(e => e.id === exerciseId)
  if (!cfg) fail('ENOENT', `routine ${JSON.stringify(routine.id)} has no exercise with id ${JSON.stringify(exerciseId)}`)
  return cfg
}

function validateTargetField(field, value) {
  const rule = TARGET_FIELD_RULES[field]
  if (!rule) fail('EINVAL', `unsupported exercise target field ${JSON.stringify(field)}`)
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('EINVAL', `${field} must be a finite number`)
  if (rule.integer && !Number.isInteger(value)) fail('EINVAL', `${field} must be an integer`)
  if (value < rule.min) fail('EINVAL', `${field} must be >= ${rule.min}`)
}

function exerciseFromLibrary(S, exerciseId) {
  return EXIDX[exerciseId] || (S.customEx || []).find(ex => ex.id === exerciseId) || null
}

function requireLibraryExercise(S, exerciseId) {
  const ex = exerciseFromLibrary(S, exerciseId)
  if (!ex) fail('ENOENT', `unknown exercise id ${JSON.stringify(exerciseId)}`)
  return ex
}

function routineExerciseIndex(routine, exerciseId) {
  return (routine.ex || []).findIndex(cfg => cfg.id === exerciseId)
}

function normalizePosition(position, min, max, fallback) {
  const n = position == null ? fallback : position
  if (!Number.isInteger(n)) fail('EINVAL', 'position must be an integer')
  return Math.min(Math.max(n, min), max)
}

function validateAddExerciseTarget(target) {
  if (!target) return
  for (const [field, value] of Object.entries(target)) {
    if (TARGET_FIELDS.has(field)) {
      validateTargetField(field, value)
      continue
    }
    if (field === 'mode') {
      if (!['reps', 'time', 'cardio'].includes(value)) fail('EINVAL', `unknown exercise mode ${JSON.stringify(value)}`)
      continue
    }
    if (field === 'bodyweight' || field === 'side') {
      if (typeof value !== 'boolean') fail('EINVAL', `${field} must be a boolean`)
      continue
    }
    if (field === 'prog') {
      if (!ROUTINE_POLICY_SET.has(value)) fail('EINVAL', `unknown policy ${JSON.stringify(value)}`)
      continue
    }
    fail('EINVAL', `unsupported add_exercise target field ${JSON.stringify(field)}`)
  }
  if (target.repsMin != null && target.repsMax != null && target.repsMax < target.repsMin) {
    fail('EINVAL', 'repsMax must be >= repsMin')
  }
}

function normalizeAddExerciseTarget(S, exerciseId, target = {}) {
  const ex = requireLibraryExercise(S, exerciseId)
  validateAddExerciseTarget(target)
  if (ex.bp === 'cardio' && target.mode && target.mode !== 'cardio') {
    fail('EINVAL', `cardio exercise ${JSON.stringify(exerciseId)} must use mode "cardio"`)
  }
  const mode = target.mode || (ex.bp === 'cardio' ? 'cardio' : undefined)
  return {
    id: exerciseId,
    ...defaultConfig(exerciseId, mode),
    ...target
  }
}

function requireLinkableSupersetExercise(routine, exerciseId) {
  const index = routineExerciseIndex(routine, exerciseId)
  if (index === -1) requireRoutineExercise(routine, exerciseId)
  if (index === 0) fail('EINVAL', 'cannot link the first exercise to a previous exercise')
  return index
}

function makeSupersetId(existing = []) {
  const used = new Set(existing.map(ex => ex.sg).filter(Boolean))
  for (let i = 0; i < 20; i += 1) {
    const id = `sg${uid()}`
    if (!used.has(id)) return id
  }
  fail('EINVAL', 'could not generate unique superset id')
}

function applyLinkSuperset(routine, exerciseId, forcedGroupId) {
  const index = requireLinkableSupersetExercise(routine, exerciseId)
  const prev = routine.ex[index - 1]
  const cur = routine.ex[index]
  if (cur.sg && prev.sg && cur.sg === prev.sg) return null

  const before = cur.sg || null
  const groupId = prev.sg || forcedGroupId || makeSupersetId(routine.ex)
  prev.sg = groupId
  cur.sg = groupId
  cleanupSg(routine.ex)

  return {
    path: `routines.${routine.id}.ex.${cur.id}.sg`,
    op: 'link_superset',
    exercise_id: cur.id,
    with_previous_id: prev.id,
    before,
    after: groupId
  }
}

function applyUnlinkSuperset(routine, exerciseId) {
  const index = routineExerciseIndex(routine, exerciseId)
  if (index === -1) requireRoutineExercise(routine, exerciseId)
  const cur = routine.ex[index]
  if (!cur.sg) return null

  const before = cur.sg
  delete cur.sg
  cleanupSg(routine.ex)

  return {
    path: `routines.${routine.id}.ex.${cur.id}.sg`,
    op: 'unlink_superset',
    exercise_id: cur.id,
    before,
    after: null
  }
}

function validateEditRoutineOps(S, routine, ops) {
  if (!Array.isArray(ops) || !ops.length) fail('EINVAL', 'edit_routine needs at least one op')
  if (ops.length > 10) fail('EINVAL', 'edit_routine accepts at most 10 ops')
  const next = { ...routine, ex: (routine.ex || []).map(cfg => ({ ...cfg })) }
  for (const op of ops) {
    if (!op || typeof op !== 'object') fail('EINVAL', 'edit op must be an object')
    if (op.op === 'set_policy') {
      if (!ROUTINE_POLICY_SET.has(op.policy)) fail('EINVAL', `unknown policy ${JSON.stringify(op.policy)}`)
      continue
    }
    if (op.op === 'set_exercise_target') {
      requireRoutineExercise(next, op.exercise_id)
      const fields = Object.keys(op).filter(field => TARGET_FIELDS.has(field))
      if (!fields.length) fail('EINVAL', 'set_exercise_target needs at least one target field')
      for (const field of Object.keys(op)) {
        if (field === 'op' || field === 'exercise_id') continue
        validateTargetField(field, op[field])
      }
      if (op.repsMin != null && op.repsMax != null && op.repsMax < op.repsMin) {
        fail('EINVAL', 'repsMax must be >= repsMin')
      }
      continue
    }
    if (op.op === 'add_exercise') {
      if (routineExerciseIndex(next, op.exercise_id) !== -1) fail('EINVAL', `routine ${JSON.stringify(routine.id)} already has exercise ${JSON.stringify(op.exercise_id)}`)
      const cfg = normalizeAddExerciseTarget(S, op.exercise_id, op.target || {})
      const position = normalizePosition(op.position, 1, (next.ex || []).length + 1, (next.ex || []).length + 1)
      next.ex.splice(position - 1, 0, cfg)
      continue
    }
    if (op.op === 'remove_exercise') {
      const index = routineExerciseIndex(next, op.exercise_id)
      if (index === -1) requireRoutineExercise(next, op.exercise_id)
      next.ex.splice(index, 1)
      cleanupSg(next.ex)
      continue
    }
    if (op.op === 'reorder_exercise') {
      const index = routineExerciseIndex(next, op.exercise_id)
      if (index === -1) requireRoutineExercise(next, op.exercise_id)
      const position = normalizePosition(op.position, 1, next.ex.length, next.ex.length)
      const [cfg] = next.ex.splice(index, 1)
      next.ex.splice(position - 1, 0, cfg)
      cleanupSg(next.ex)
      continue
    }
    if (op.op === 'link_superset') {
      applyLinkSuperset(next, op.exercise_id, 'sg_preview')
      continue
    }
    if (op.op === 'unlink_superset') {
      applyUnlinkSuperset(next, op.exercise_id)
      continue
    }
    fail('EINVAL', `unknown edit op ${JSON.stringify(op.op)}`)
  }
}

function editRoutineChanges(S, routineId, ops, options = {}) {
  const routine = requireRoutineById(S, routineId)
  validateEditRoutineOps(S, routine, ops)

  const { previewSupersetId = 'sg_preview', supersetGroupIdByOp = null } = options
  const changes = []
  const pushChange = (path, before, after) => {
    if (!Object.is(before, after)) changes.push({ path, before, after })
  }
  const next = { ...routine, ex: (routine.ex || []).map(cfg => ({ ...cfg })) }

  for (const [opIndex, op] of ops.entries()) {
    if (op.op === 'set_policy') {
      pushChange(`routines.${routine.id}.policy`, routinePolicy(next), op.policy)
      next.prog = op.policy
      delete next.policy
      continue
    }

    if (op.op === 'set_exercise_target') {
      const cfg = requireRoutineExercise(next, op.exercise_id)
      for (const field of Object.keys(op)) {
        if (!TARGET_FIELDS.has(field)) continue
        pushChange(`routines.${routine.id}.ex.${cfg.id}.${field}`, cfg[field] ?? null, op[field])
        cfg[field] = op[field]
      }
      continue
    }

    if (op.op === 'add_exercise') {
      const cfg = normalizeAddExerciseTarget(S, op.exercise_id, op.target || {})
      const position = normalizePosition(op.position, 1, next.ex.length + 1, next.ex.length + 1)
      changes.push({
        path: `routines.${routine.id}.ex`,
        op: 'add_exercise',
        exercise_id: op.exercise_id,
        before: null,
        after: { ...cfg },
        position
      })
      next.ex.splice(position - 1, 0, cfg)
      continue
    }

    if (op.op === 'remove_exercise') {
      const index = routineExerciseIndex(next, op.exercise_id)
      const [cfg] = next.ex.splice(index, 1)
      changes.push({
        path: `routines.${routine.id}.ex.${op.exercise_id}`,
        op: 'remove_exercise',
        exercise_id: op.exercise_id,
        before: { ...cfg },
        after: null
      })
      cleanupSg(next.ex)
      continue
    }

    if (op.op === 'reorder_exercise') {
      const index = routineExerciseIndex(next, op.exercise_id)
      const before = index + 1
      const position = normalizePosition(op.position, 1, next.ex.length, next.ex.length)
      const [cfg] = next.ex.splice(index, 1)
      next.ex.splice(position - 1, 0, cfg)
      cleanupSg(next.ex)
      if (before !== position) {
        changes.push({
          path: `routines.${routine.id}.ex`,
          op: 'reorder_exercise',
          exercise_id: op.exercise_id,
          before,
          after: position
        })
      }
    }

    if (op.op === 'link_superset') {
      if (supersetGroupIdByOp && !supersetGroupIdByOp.has(opIndex)) {
        supersetGroupIdByOp.set(opIndex, makeSupersetId(next.ex))
      }
      const groupId = supersetGroupIdByOp ? supersetGroupIdByOp.get(opIndex) : previewSupersetId
      const change = applyLinkSuperset(next, op.exercise_id, groupId)
      if (change) changes.push(change)
      continue
    }

    if (op.op === 'unlink_superset') {
      const change = applyUnlinkSuperset(next, op.exercise_id)
      if (change) changes.push(change)
      continue
    }
  }
  return changes
}

function applyEditRoutineOps(current, routineId, ops, options = {}) {
  const routine = requireRoutineById(current, routineId)
  validateEditRoutineOps(current, routine, ops)
  const { supersetGroupIdByOp = null } = options
  return {
    ...current,
    routines: (current.routines || []).map(r => {
      if (r.id !== routineId) return r
      const next = { ...r, ex: (r.ex || []).map(cfg => ({ ...cfg })) }
      for (const [opIndex, op] of ops.entries()) {
        if (op.op === 'set_policy') {
          next.prog = op.policy
          delete next.policy
          continue
        }
        if (op.op === 'set_exercise_target') {
          const cfg = requireRoutineExercise(next, op.exercise_id)
          for (const field of Object.keys(op)) {
            if (TARGET_FIELDS.has(field)) cfg[field] = op[field]
          }
          continue
        }
        if (op.op === 'add_exercise') {
          const cfg = normalizeAddExerciseTarget(current, op.exercise_id, op.target || {})
          const position = normalizePosition(op.position, 1, next.ex.length + 1, next.ex.length + 1)
          next.ex.splice(position - 1, 0, cfg)
          continue
        }
        if (op.op === 'remove_exercise') {
          const index = routineExerciseIndex(next, op.exercise_id)
          next.ex.splice(index, 1)
          cleanupSg(next.ex)
          continue
        }
        if (op.op === 'reorder_exercise') {
          const index = routineExerciseIndex(next, op.exercise_id)
          const position = normalizePosition(op.position, 1, next.ex.length, next.ex.length)
          const [cfg] = next.ex.splice(index, 1)
          next.ex.splice(position - 1, 0, cfg)
          cleanupSg(next.ex)
          continue
        }
        if (op.op === 'link_superset') {
          applyLinkSuperset(next, op.exercise_id, supersetGroupIdByOp?.get(opIndex))
          continue
        }
        if (op.op === 'unlink_superset') {
          applyUnlinkSuperset(next, op.exercise_id)
        }
      }
      return next
    })
  }
}

function normalizeCustomExerciseInput(S, { name, body_part, description }) {
  const n = String(name || '').trim()
  if (!n) fail('EINVAL', 'name must be a non-empty string')
  if (!BODY_PART_SET.has(body_part)) fail('EINVAL', `unknown body_part ${JSON.stringify(body_part)}`)

  const duplicate = [...EXDB, ...(S.customEx || [])]
    .find(ex => String(ex.n || '').trim().toLowerCase() === n.toLowerCase())
  if (duplicate) fail('EINVAL', `exercise ${JSON.stringify(duplicate.n)} already exists`)

  return {
    n,
    bp: body_part,
    desc: String(description || '').trim().slice(0, 1000),
    tg: '',
    eq: 'custom',
    custom: true
  }
}

function makeCustomExerciseId(existing = []) {
  const used = new Set(existing.map(ex => ex.id))
  for (let i = 0; i < 20; i += 1) {
    const id = `c${uid()}`
    if (!used.has(id) && !EXIDX[id]) return id
  }
  fail('EINVAL', 'could not generate unique custom exercise id')
}

function customExerciseChange(S, input, id = 'c_preview') {
  const normalized = normalizeCustomExerciseInput(S, input)
  const after = { id, ...normalized }
  return {
    exercise: {
      id,
      name: normalized.n,
      body_part: normalized.bp,
      description: normalized.desc
    },
    changes: [{
      path: 'customEx',
      op: 'create_custom_exercise',
      before: null,
      after
    }]
  }
}

function requireOverrideTarget(S, routineId) {
  if (routineId === 'rest') return 'rest'
  const routine = (S.routines || []).find(r => r.id === routineId)
  if (!routine) { const e = new Error(`no routine with id ${JSON.stringify(routineId)}`); e.code = 'ENOENT'; throw e }
  return routine.id
}

function requireRoutineOrRest(S, routineId) {
  if (routineId === 'rest') return null
  const routine = (S.routines || []).find(r => r.id === routineId)
  if (!routine) { const e = new Error(`no routine with id ${JSON.stringify(routineId)}`); e.code = 'ENOENT'; throw e }
  return routine.id
}

function overrideDayChange(S, date, routineId) {
  const after = requireOverrideTarget(S, routineId)
  const before = S.dayPlan?.[date] ?? null
  return {
    path: `dayPlan.${date}`,
    before,
    after
  }
}

function assignWeekdayChange(S, weekday, routineId) {
  const after = requireRoutineOrRest(S, routineId)
  const before = S.week?.[weekday] ?? null
  return {
    path: `week.${weekday}`,
    before,
    after
  }
}

function writeStateServices(dataDir) {
  const audit = createAuditService({ dataDir })
  return createStateService({ dataDir, audit })
}

function isVerifiedHttpContext(context) {
  return context?.transport === 'http' && context?.auth?.verified === true && context?.token?.uid
}

function stateForContext(context) {
  return isVerifiedHttpContext(context)
    ? getStateForUid(context.token.uid, { dataDir: context.dataDir })
    : getState()
}

function userForContext(context) {
  return isVerifiedHttpContext(context)
    ? getUserForUid(context.token.uid, { dataDir: context.dataDir })
    : getUser()
}

function writeAuthForContext(requiredScope, context) {
  if (context?.transport === 'http') {
    if (!isVerifiedHttpContext(context)) {
      return {
        ok: false,
        error: {
          code: 'TOKEN_INVALID',
          message: 'HTTP tool context must contain a verified token.'
        }
      }
    }
    if (!Array.isArray(context.token.scopes) || !context.token.scopes.includes(requiredScope)) {
      return {
        ok: false,
        error: {
          code: 'TOKEN_FORBIDDEN',
          message: 'Token missing required scope.',
          required_scope: requiredScope
        }
      }
    }
    return { ok: true, token: context.token }
  }
  return verifyMcpWriteToken({ requiredScope })
}

function dataDirForContext(context) {
  return isVerifiedHttpContext(context)
    ? context.dataDir
    : process.env.OPENGYM_DATA
}

/* ---------- tools ---------- */

/** list_routines — names + counts of each routine in the user's plan. */
export const listRoutines = {
  name: 'list_routines',
  description: 'List the workout routines saved in the user\'s openGym profile (the same list the Plan screen shows). Each routine is a named set of exercises with set/rep targets. Use this to discover the plan structure before diving into a specific routine or today\'s workout.',
  schema: {},
  handler: (_params, context) => {
    const S = stateForContext(context)
    if (!S) return noState()
    return {
      unit: S.unit || 'kg',
      routines: (S.routines || []).map(r => ({
        id: r.id,
        name: r.name,
        emoji: r.emoji || null,
        exercise_count: (r.ex || []).length,
        superset_groups: [...new Set((r.ex || []).map(e => e.sg).filter(Boolean))].length || 0,
        policy: routinePolicy(r)
      }))
    }
  }
}

/** get_routine — the full exercise list for one routine, including set/rep targets. */
export const getRoutine = {
  name: 'get_routine',
  description: 'Get the full exercise list for a single routine (the same view the routine editor shows). Returns mode (reps/time/cardio), set/rep/weight targets, superset links, and any per-exercise custom increment you can override. Use routine_id from list_routines.',
  schema: { routine_id: z.string().min(1) },
  handler: ({ routine_id }, context) => {
    const S = stateForContext(context)
    if (!S) return noState()
    const r = (S.routines || []).find(x => x.id === routine_id)
    if (!r) { const e = new Error(`no routine with id ${JSON.stringify(routine_id)}`); e.code = 'ENOENT'; throw e }
    return {
      id: r.id,
      name: r.name,
      emoji: r.emoji || null,
      policy: routinePolicy(r),
      policy_name: policyName(routinePolicy(r)),
      unit: S.unit || 'kg',
      exercises: (r.ex || []).map((cfg, i) => {
        const ex = exerciseForSummary(S, cfg.id)
        const mode = modeOf(cfg)
        return {
          position: i + 1,
          id: cfg.id,
          name: ex.n,
          body_part: ex.bp || null,
          mode,
          sets: cfg.sets || 1,
          reps: mode === 'reps' ? (cfg.reps || 0) : undefined,
          reps_min: mode === 'reps' && cfg.repsMin != null ? cfg.repsMin : undefined,
          sec: mode === 'time' ? (cfg.sec || 0) : undefined,
          min: mode === 'cardio' ? (cfg.min || 0) : undefined,
          speed: mode === 'cardio' ? (cfg.speed || 0) : undefined,
          weight: cfg.weight != null ? cfg.weight : undefined,
          increment: cfg.inc != null ? cfg.inc : undefined,
          policy_override: cfg.prog || cfg.policy || null,
          superset_group: cfg.sg || null,
          summary: exLine(cfg, S.unit || 'kg')
        }
      })
    }
  }
}

/** get_week_plan — what's scheduled each weekday + today. */
export const getWeekPlan = {
  name: 'get_week_plan',
  description: 'Show the user\'s weekly plan: which routine (if any) is assigned to each weekday, keyed by JS getDay() (Sunday=0, Monday=1, … Saturday=6 — the same convention the openGym state file uses). Also reports today\'s date and what routine applies today, accounting for one-off overrides the user may have set for a specific date (a "rest" override cancels the day).',
  schema: {},
  handler: (_params, context) => {
    const S = stateForContext(context)
    if (!S) return noState()
    const today = new Date()
    const isoToday = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
    const todayWd = today.getDay()
    return {
      today: isoToday,
      weekdays: [0, 1, 2, 3, 4, 5, 6].map(d => {
        const rid = S.week?.[d] || null
        const r = rid ? (S.routines || []).find(x => x.id === rid) : null
        // Surface today's override only (not the whole dayPlan dict — usually empty, but might
        // have grown from repeated "move this day" actions).
        const overrideForToday = d === todayWd ? (S.dayPlan?.[isoToday] ?? null) : null
        return {
          weekday: d,
          weekday_name: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d],
          routine_id: rid,
          routine_name: r?.name || null,
          routine_emoji: r?.emoji || null,
          override_for_today_or_null: overrideForToday
        }
      }),
      today_routine_id: effectiveRoutineId(S, isoToday),
      today_routine_name: effectiveRoutine(S, isoToday)?.name || null
    }
  }
}

/** list_workouts — newest-first summary of recent sessions. */
export const listWorkouts = {
  name: 'list_workouts',
  description: 'List recent finished workouts, newest first. Each item summarises the date, exercise count, sets done / planned, total volume (in the user\'s unit), duration and whether PRs were set. Use this before drilling into a specific date with get_workout.',
  schema: {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Inclusive start date YYYY-MM-DD. Defaults to no lower bound (list most recent).'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Inclusive end date YYYY-MM-DD. Defaults to today.'),
    limit: z.number().int().min(1).max(200).optional().describe('Max items to return. Defaults to 25.')
  },
  handler: ({ from, to, limit }, context) => {
    const S = stateForContext(context)
    if (!S) return noState()
    const lim = Math.min(Math.max(limit || 25, 1), 200)
    const all = (S.workouts || []).slice().sort((a, b) => (b.d || '').localeCompare(a.d || ''))
    const filtered = all.filter(w => {
      if (from && w.d < from) return false
      if (to && w.d > to) return false
      return true
    }).slice(0, lim)
    return {
      unit: S.unit || 'kg',
      total_count: all.length,
      returned_count: filtered.length,
      workouts: filtered.map(w => ({
        // The only thing that identifies a session uniquely. Two workouts on one day is
        // ordinary — a lifting session and an evening run — and without an id here the second
        // one cannot be asked about at all.
        id: w.id || null,
        date: w.d,
        routine_id: w.routineId || null,
        routine_name: w.name || null,
        exercise_count: (w.entries || []).length,
        sets_done: setsDone(w),
        sets_planned: plannedSets(w),
        sets_ratio: ratio(setsDone(w), plannedSets(w)),
        volume: workoutVolume(w),
        duration_ms: w.end && w.start ? (w.end - w.start) : null,
        duration: w.end && w.start ? friendlyDuration(w.end - w.start) : null,
        prs: (w.prs || []).length,
        bodyweight_at_workout: w.bw || null
      }))
    }
  }
}

function plannedSets(w) {
  let n = 0
  ;(w.entries || []).forEach(e => { n += (e.sets || []).length })
  return n
}

/** get_workout — full entry/set breakdown for one date. */
export const getWorkout = {
  name: 'get_workout',
  description: 'Get the full breakdown of one workout: every exercise, its mode (reps/time/cardio), the target, and per-set labels (e.g. "5 @ 60 kg", "1:30 · 20 kg"). Identify it by workout_id (from list_workouts) or by date. Use list_workouts first if you don\'t know either.',
  schema: {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('The workout date as YYYY-MM-DD. If two sessions share that date, the answer lists them instead and asks for a workout_id.'),
    workout_id: z.string().min(1).optional().describe('The id from list_workouts. Preferred: it names one session even on a day with two.')
  },
  handler: ({ date, workout_id }, context) => {
    const S = stateForContext(context)
    if (!S) return noState()
    const workouts = S.workouts || []
    let w
    if (workout_id) {
      w = workouts.find(x => x.id === workout_id)
      if (!w) { const e = new Error(`no workout with id ${workout_id}`); e.code = 'ENOENT'; throw e }
    } else if (date) {
      const sameDay = workouts.filter(x => x.d === date)
      if (!sameDay.length) { const e = new Error(`no workout on ${date}`); e.code = 'ENOENT'; throw e }
      // Answering with the first of two is how a question about the evening run gets the
      // morning's lifting numbers, stated with total confidence. Say there are two instead.
      if (sameDay.length > 1) {
        return {
          ambiguous: true,
          date,
          message: `${sameDay.length} workouts were logged on ${date} — call get_workout again with one of these workout_id values.`,
          workouts: sameDay.map(x => ({
            id: x.id || null,
            routine_name: x.name || null,
            sets_done: setsDone(x),
            volume: workoutVolume(x),
            duration: x.end && x.start ? friendlyDuration(x.end - x.start) : null
          }))
        }
      }
      w = sameDay[0]
    } else {
      const e = new Error('get_workout needs either workout_id or date'); e.code = 'EINVAL'; throw e
    }
    return {
      id: w.id || null,
      date: w.d,
      routine_id: w.routineId || null,
      routine_name: w.name || null,
      unit: S.unit || 'kg',
      bodyweight_at_workout: w.bw || null,
      volume: workoutVolume(w),
      sets_done: setsDone(w),
      sets_planned: plannedSets(w),
      duration: w.end && w.start ? friendlyDuration(w.end - w.start) : null,
      prs: (w.prs || []).map(id => exerciseFromLibrary(S, id)?.n || id),
      entries: (w.entries || []).map(e => entryView(e, S))
    }
  }
}

/** exercise_history — recent completed sessions for one exercise. */
export const exerciseHistory = {
  name: 'exercise_history',
  description: 'Return recent completed sessions for one exercise, newest first, with workout metadata, the prescribed target, completed set labels, done-set count and per-entry volume. Use this before coaching questions about a specific exercise trend instead of fetching full workouts and filtering them in the LLM context.',
  schema: {
    exercise_id: z.string().min(1).describe('Exercise id from get_routine or get_workout entries.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max sessions to return. Defaults to 10, capped at 100.')
  },
  handler: ({ exercise_id, limit }, context) => {
    const S = stateForContext(context)
    if (!S) return noState()
    const lim = Math.min(Math.max(limit || 10, 1), 100)
    const rows = (S.workouts || [])
      .map(w => {
        const entry = (w.entries || []).find(e =>
          e.id === exercise_id && (e.sets || []).some(s => s.done))
        return entry ? { workout: w, entry } : null
      })
      .filter(Boolean)
      .sort((a, b) => (b.workout.d || '').localeCompare(a.workout.d || ''))

    const ex = exerciseForSummary(S, exercise_id)
    const sessions = rows.slice(0, lim).map(({ workout: w, entry }) => {
      const view = doneEntryView(entry, S)
      return {
        date: w.d,
        workout_id: w.id || null,
        routine_id: w.routineId || null,
        routine_name: w.name || null,
        target: entry.target || null,
        sets: view.sets,
        sets_done: view.sets.length,
        volume: entryVolume(entry)
      }
    })

    return {
      unit: S.unit || 'kg',
      exercise: {
        id: exercise_id,
        name: ex.n,
        body_part: ex.bp || null,
        mode: modeForExerciseHistory(S, exercise_id, rows)
      },
      total_count: rows.length,
      returned_count: sessions.length,
      sessions
    }
  }
}

/** training_summary — compact period-level aggregate for AI coaching context. */
export const trainingSummary = {
  name: 'training_summary',
  description: 'Return a compact read-only training summary for a fixed period: completed workouts, done sets, volume, PRs, bodyweight change, effort coverage and muscle coverage. Use this for weekly reviews, post-workout summaries and planning context before asking for more detailed tools.',
  schema: {
    period: z.enum(['week', 'month', '6w', '12w', 'all']).describe('Summary window: last 7 days, last 30 days, last 6 weeks, last 12 weeks, or all history.')
  },
  handler: ({ period }, context) => {
    const S = stateForContext(context)
    if (!S) return noState()
    const range = periodRange(period)
    const workouts = (S.workouts || []).filter(w => inDateRange(w.d, range))
    const effort = effortSummary({ ...S, workouts }, 0)

    return {
      period,
      unit: S.unit || 'kg',
      date_range: range,
      workouts: {
        completed: workouts.length,
        sets_done: workouts.reduce((sum, w) => sum + setsDone(w), 0),
        volume: round1(workouts.reduce((sum, w) => sum + workoutVolume(w), 0)),
        prs: workouts.reduce((sum, w) => sum + (w.prs || []).length, 0)
      },
      bodyweight: bodyweightSummary(S, range),
      effort: {
        scale: scaleName(displayScale(S)),
        done_sets: effort.done,
        rated_sets: effort.rated,
        avg: nullableRound1(effort.avg),
        hard_pct: nullableRound1(effort.hardPct)
      },
      muscle_coverage: muscleCoverageSummary(workouts)
    }
  }
}

/** detect_stalls — conservative stagnation candidates with evidence. */
export const detectStalls = {
  name: 'detect_stalls',
  description: 'Detect conservative stagnation candidates for reps-mode routine exercises. Returns evidence only — repeated missed targets, recent estimated-1RM change and recent sessions — so the AI coach can explain uncertainty instead of declaring a diagnosis.',
  schema: {
    window: z.number().int().min(3).max(8).optional().describe('Number of recent completed sessions to inspect per exercise. Defaults to 4.'),
    routine_id: z.string().min(1).optional().describe('Optional routine id from list_routines/get_routine. Limits the scan to that routine.')
  },
  handler: ({ window, routine_id }, context) => {
    const S = stateForContext(context)
    if (!S) return noState()
    const win = Math.min(Math.max(window || 4, 3), 8)
    const candidates = routinesToScan(S, routine_id)
      .flatMap(routine => (routine.ex || []).map(cfg => stallCandidateFor(S, routine, cfg, win)))
      .filter(Boolean)
      .sort((a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        b.evidence.missed_target_sessions - a.evidence.missed_target_sessions ||
        a.evidence.best_estimate_change - b.evidence.best_estimate_change ||
        a.exercise.name.localeCompare(b.exercise.name))
    return {
      window: win,
      unit: S.unit || 'kg',
      candidates
    }
  }
}

/** get_bodyweight — recent weigh-ins with the goal line. */
export const getBodyweight = {
  name: 'get_bodyweight',
  description: 'Get the body-weight log: chronological weigh-ins with weights, current goal, deltas vs goal (signed positive = above goal), and a latest summary. Useful for "am I trending toward my weight goal?" questions.',
  schema: {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Inclusive start date YYYY-MM-DD.'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Inclusive end date YYYY-MM-DD. Defaults to today.')
  },
  handler: ({ from, to }, context) => {
    const S = stateForContext(context)
    if (!S) return noState()
    const goal = S.targetW || null
    const bw = (S.bodyweight || []).filter(b => {
      if (from && b.d < from) return false
      if (to && b.d > to) return false
      return true
    }).sort((a, b) => (a.d || '').localeCompare(b.d || ''))
    const latest = bw.length ? bw[bw.length - 1] : null
    return {
      unit: S.unit || 'kg',
      goal,
      count: bw.length,
      latest: latest ? { date: latest.d, weight: latest.w, delta_vs_goal: goal != null ? Math.round((latest.w - goal) * 10) / 10 : null } : null,
      entries: bw.map(b => ({
        date: b.d,
        weight: b.w,
        delta_vs_goal: goal != null ? Math.round((b.w - goal) * 10) / 10 : null
      }))
    }
  }
}

/** estimate_1rm — best-ever 1RM for one exercise or a PR table across all reps-mode exercises. */
export const estimate1rm = {
  name: 'estimate_1rm',
  description: `Estimate one-rep max using Epley, Brzycki or Lombardi formulas. If an exercise_id is given, returns the all-time best estimate for that exercise with the source set (weight × reps + date) and the trend across history. If no exercise_id is given, returns a PR table across all reps-mode exercises (sorted highest first). Refuses to guess above ${REP_CAP} reps — above that, formulas diverge past 10% and "work capacity" is read instead of "maximal strength".`,
  schema: {
    exercise_id: z.string().optional().describe('An exercise id from list_routines or get_workout entries. If omitted, returns a full PR table.'),
    formula: z.enum(['epley', 'brzycki', 'lombardi']).optional().describe(`Formula to use. Defaults to ${DEFAULT_FORMULA}.`)
  },
  handler: ({ exercise_id, formula }, context) => {
    const S = stateForContext(context)
    if (!S) return noState()
    const f = formula || DEFAULT_FORMULA
    if (exercise_id) {
      const ex = exerciseForSummary(S, exercise_id)
      const best = best1RM(S, exercise_id, f)
      const series = e1rmSeries(S, exercise_id, f)
      // A null best has two very different causes: never trained, or trained only above the
      // rep cap. Without saying which, an exercise logged for years at 15 reps reads as "no
      // records for calf raise" — a confident statement about the opposite of the truth.
      const trainedAtAll = (S.workouts || []).some(w =>
        (w.entries || []).some(e => e.id === exercise_id && (e.sets || []).some(s => s.done)))
      // w/r (not weight/reps) matches pr_table and entry-view — every set in the API surface uses the same couple.
      return {
        exercise: { id: exercise_id, name: ex.n, body_part: ex.bp || null },
        formula: f,
        formula_note: `Estimates use the ${f} formula. Cap at ${REP_CAP} reps applies; r=1 is treated as the measurement, not an estimate.`,
        best: best ? { est: best.est, w: best.w, r: best.r, date: best.d } : null,
        no_estimate_reason: best ? null
          : trainedAtAll
            ? `This exercise has logged sets, but none of them qualify: every set was above the ${REP_CAP}-rep cap, or carried no weight. That is not the same as never having trained it.`
            : 'No completed sets logged for this exercise.',
        trend: series.map(p => ({ date: p.d, est: p.y, w: p.w, r: p.r }))
      }
    }
    return {
      formula: f,
      formula_note: `Estimates use the ${f} formula. Cap at ${REP_CAP} reps applies; r=1 is treated as the measurement, not an estimate.`,
      pr_table: prTable(S, f)
    }
  }
}

/** muscle_balance — training distribution per muscle over a period (week/month/all). */
export const muscleBalance = {
  name: 'muscle_balance',
  description: 'Show which muscles the user has trained in a period, ranked by "effective sets" (volume in kg is intentionally not used — 100 kg leg press vs 12 kg lateral raise say nothing about which muscle worked harder). Reports worked muscles with a 0-4 relative level (1 = some work, 4 = most worked) and the muscles trained zero times in that period — useful for "what am I neglecting?" questions.',
  schema: {
    period: z.enum(['week', 'month', 'all']).describe('window: last 7 days, last 30 days, or all-time')
  },
  handler: ({ period }, context) => {
    const S = stateForContext(context)
    if (!S) return noState()
    const now = Date.now()
    const cutoff = period === 'week' ? now - 7 * 86400000
      : period === 'month' ? now - 30 * 86400000
        : Number.NEGATIVE_INFINITY
    const workouts = (S.workouts || []).filter(w => (w.start || new Date(w.d + 'T12:00:00').getTime()) >= cutoff)
    const load = loadOfWorkouts(workouts)
    const { worked, missed } = rankOf(load)
    const levels = levelsOf(load)
    return {
      period,
      cutoff_iso: period === 'all' ? null : new Date(cutoff).toISOString().slice(0, 10),
      workouts_in_period: workouts.length,
      worked: worked.map(slug => ({ slug, name: muscleName(slug), level: levels[slug], effective_sets: Math.round((load[slug] || 0) * 10) / 10 })),
      neglected: missed.map(slug => ({ slug, name: muscleName(slug) })),
      muscle_order_head_to_toe: muscleOrder()
    }
  }
}

/** progression_next — deterministic next target from openGym's progression engine. */
export const progressionNext = {
  name: 'progression_next',
  description: 'Return the next prescribed target for one exercise in one routine according to openGym\'s configured progression policy and workout history. This is deterministic: it delegates to the same progression engine the app uses, so use it before giving coaching advice like "add weight", "hold", or "deload".',
  schema: {
    routine_id: z.string().min(1).describe('Routine id from list_routines/get_routine.'),
    exercise_id: z.string().min(1).describe('Exercise id from get_routine exercises.')
  },
  handler: ({ routine_id, exercise_id }, context) => {
    const S = stateForContext(context)
    if (!S) return noState()
    const routine = (S.routines || []).find(r => r.id === routine_id)
    if (!routine) { const e = new Error(`no routine with id ${JSON.stringify(routine_id)}`); e.code = 'ENOENT'; throw e }
    const cfg = (routine.ex || []).find(x => x.id === exercise_id)
    if (!cfg) { const e = new Error(`routine ${JSON.stringify(routine_id)} has no exercise with id ${JSON.stringify(exercise_id)}`); e.code = 'ENOENT'; throw e }

    const ex = exerciseForSummary(S, exercise_id)
    const mode = modeOf(cfg)
    const p = nextPrescription(S, cfg, routine)
    const unit = S.unit || 'kg'
    return {
      unit,
      routine: {
        id: routine.id,
        name: routine.name,
        emoji: routine.emoji || null
      },
      exercise: {
        id: exercise_id,
        name: ex.n,
        body_part: ex.bp || null,
        mode
      },
      current_target: {
        sets: cfg.sets || 1,
        reps: mode === 'reps' ? (cfg.reps || null) : null,
        reps_min: mode === 'reps' && cfg.repsMin != null ? cfg.repsMin : null,
        reps_max: mode === 'reps' && cfg.repsMax != null ? cfg.repsMax : null,
        sec: mode === 'time' ? (cfg.sec || null) : null,
        min: mode === 'cardio' ? (cfg.min || null) : null,
        speed: mode === 'cardio' ? (cfg.speed || null) : null,
        weight: cfg.weight != null ? cfg.weight : null,
        increment: cfg.inc != null ? cfg.inc : null
      },
      policy: p.policy,
      policy_name: policyName(p.policy),
      kind: p.kind,
      next: {
        weight: p.weight != null ? p.weight : null,
        reps: p.reps != null ? p.reps : null,
        sec: p.sec != null ? p.sec : null,
        sets: p.sets != null ? p.sets : null
      },
      reason: p.why ? fmt(p.why[0], p.why.slice(1)) : null,
      confidence: 'deterministic'
    }
  }
}

/** override_day — write a one-off routine/rest override for a date. */
export const overrideDay = {
  name: 'override_day',
  description: 'Write a one-off schedule override for a date. Requires OPENGYM_MCP_TOKEN with schedule:write. Use dry_run=true first to preview the exact dayPlan change before committing it.',
  schema: {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date to override as YYYY-MM-DD.'),
    routine_id: z.string().min(1).describe('Routine id from list_routines/get_routine, or "rest" to cancel training that day.'),
    expected_revision: z.number().int().min(0).describe('State _revision observed before proposing the write. Prevents lost updates.'),
    dry_run: z.boolean().optional().describe('When true, preview changes without writing. Defaults to true.')
  },
  handler: ({ date, routine_id, expected_revision, dry_run = true }, context) => {
    const auth = writeAuthForContext('schedule:write', context)
    if (!auth.ok) return auth

    const dataDir = dataDirForContext(context)
    const states = writeStateServices(dataDir)
    const S = states.readUserState(auth.token.uid)
    if (!S) return noState()

    const change = overrideDayChange(S, date, routine_id)
    const changes = change.before === change.after ? [] : [change]
    const revision = revisionOf(S)

    if (dry_run) {
      return {
        ok: true,
        dry_run: true,
        would_change: changes.length > 0,
        revision,
        changes
      }
    }

    if (!changes.length) {
      if (expected_revision !== revision) {
        return {
          ok: false,
          error: {
            code: 'STATE_CONFLICT',
            message: 'State changed since the tool read it.',
            current_revision: revision
          }
        }
      }
      return {
        ok: true,
        dry_run: false,
        changed: false,
        revision_before: revision,
        revision_after: revision,
        changes
      }
    }

    const result = states.updateUserState(auth.token.uid, current => {
      return {
        ...current,
        dayPlan: {
          ...(current.dayPlan || {}),
          [date]: change.after
        }
      }
    }, {
      actor: `mcp-token:${auth.token.id}`,
      tokenId: auth.token.id,
      operation: 'override_day',
      expectedRevision: expected_revision,
      details: { date, routine_id: change.after }
    })
    if (!result.ok) return result

    return {
      ok: true,
      dry_run: false,
      changed: true,
      revision_before: revision,
      revision_after: result.revision,
      changes
    }
  }
}

/** assign_weekday — write a recurring weekday routine/rest assignment. */
export const assignWeekday = {
  name: 'assign_weekday',
  description: 'Write the recurring weekly schedule for one weekday. Requires OPENGYM_MCP_TOKEN with schedule:write. Use routine_id="rest" to clear that weekday assignment.',
  schema: {
    weekday: z.number().int().min(0).max(6).describe('JS weekday number: Sunday=0, Monday=1, ... Saturday=6.'),
    routine_id: z.string().min(1).describe('Routine id from list_routines/get_routine, or "rest" to clear this weekday.'),
    expected_revision: z.number().int().min(0).describe('State _revision observed before proposing the write. Prevents lost updates.'),
    dry_run: z.boolean().optional().describe('When true, preview changes without writing. Defaults to true.')
  },
  handler: ({ weekday, routine_id, expected_revision, dry_run = true }, context) => {
    const auth = writeAuthForContext('schedule:write', context)
    if (!auth.ok) return auth

    const dataDir = dataDirForContext(context)
    const states = writeStateServices(dataDir)
    const S = states.readUserState(auth.token.uid)
    if (!S) return noState()

    const change = assignWeekdayChange(S, weekday, routine_id)
    const changes = change.before === change.after ? [] : [change]
    const revision = revisionOf(S)

    if (dry_run) {
      return {
        ok: true,
        dry_run: true,
        would_change: changes.length > 0,
        revision,
        changes
      }
    }

    if (!changes.length) {
      if (expected_revision !== revision) {
        return {
          ok: false,
          error: {
            code: 'STATE_CONFLICT',
            message: 'State changed since the tool read it.',
            current_revision: revision
          }
        }
      }
      return {
        ok: true,
        dry_run: false,
        changed: false,
        revision_before: revision,
        revision_after: revision,
        changes
      }
    }

    const result = states.updateUserState(auth.token.uid, current => {
      const week = { ...(current.week || {}) }
      if (change.after == null) delete week[weekday]
      else week[weekday] = change.after
      return { ...current, week }
    }, {
      actor: `mcp-token:${auth.token.id}`,
      tokenId: auth.token.id,
      operation: 'assign_weekday',
      expectedRevision: expected_revision,
      details: { weekday, routine_id: change.after }
    })
    if (!result.ok) return result

    return {
      ok: true,
      dry_run: false,
      changed: true,
      revision_before: revision,
      revision_after: result.revision,
      changes
    }
  }
}

/** edit_routine — write narrow patch operations against an existing routine. */
export const editRoutine = {
  name: 'edit_routine',
  description: 'Patch an existing routine. Requires OPENGYM_MCP_TOKEN with routine:write. Supports set_policy, set_exercise_target, add_exercise, remove_exercise, reorder_exercise, link_superset and unlink_superset ops; use dry_run=true first to preview exact changes before committing.',
  schema: {
    routine_id: z.string().min(1).describe('Routine id from list_routines/get_routine.'),
    ops: z.array(z.discriminatedUnion('op', [setPolicyOpSchema, setExerciseTargetOpSchema, addExerciseOpSchema, removeExerciseOpSchema, reorderExerciseOpSchema, linkSupersetOpSchema, unlinkSupersetOpSchema])).min(1).max(10).describe('Patch operations to apply in order.'),
    expected_revision: z.number().int().min(0).describe('State _revision observed before proposing the write. Prevents lost updates.'),
    dry_run: z.boolean().optional().describe('When true, preview changes without writing. Defaults to true.')
  },
  handler: ({ routine_id, ops, expected_revision, dry_run = true }, context) => {
    const auth = writeAuthForContext('routine:write', context)
    if (!auth.ok) return auth

    const dataDir = dataDirForContext(context)
    const states = writeStateServices(dataDir)
    const S = states.readUserState(auth.token.uid)
    if (!S) return noState()

    const revision = revisionOf(S)

    if (dry_run) {
      const changes = editRoutineChanges(S, routine_id, ops)
      return {
        ok: true,
        dry_run: true,
        would_change: changes.length > 0,
        revision,
        changes
      }
    }

    const supersetGroupIdByOp = new Map()
    const changes = editRoutineChanges(S, routine_id, ops, { supersetGroupIdByOp })

    if (!changes.length) {
      if (expected_revision !== revision) {
        return {
          ok: false,
          error: {
            code: 'STATE_CONFLICT',
            message: 'State changed since the tool read it.',
            current_revision: revision
          }
        }
      }
      return {
        ok: true,
        dry_run: false,
        changed: false,
        revision_before: revision,
        revision_after: revision,
        changes
      }
    }

    const result = states.updateUserState(auth.token.uid, current => {
      return applyEditRoutineOps(current, routine_id, ops, { supersetGroupIdByOp })
    }, {
      actor: `mcp-token:${auth.token.id}`,
      tokenId: auth.token.id,
      operation: 'edit_routine',
      expectedRevision: expected_revision,
      details: { routine_id, ops: ops.map(op => ({ ...op })) }
    })
    if (!result.ok) return result

    return {
      ok: true,
      dry_run: false,
      changed: true,
      revision_before: revision,
      revision_after: result.revision,
      changes
    }
  }
}

/** create_custom_exercise — write one custom exercise definition. */
export const createCustomExercise = {
  name: 'create_custom_exercise',
  description: 'Create one custom exercise in the profile catalogue. Requires OPENGYM_MCP_TOKEN with exercise:write. Use edit_routine.add_exercise separately to add it to a routine.',
  schema: createCustomExerciseSchema,
  handler: ({ name, body_part, description = '', expected_revision, dry_run = true }, context) => {
    const auth = writeAuthForContext('exercise:write', context)
    if (!auth.ok) return auth

    const dataDir = dataDirForContext(context)
    const states = writeStateServices(dataDir)
    const S = states.readUserState(auth.token.uid)
    if (!S) return noState()

    const preview = customExerciseChange(S, { name, body_part, description })
    const revision = revisionOf(S)

    if (dry_run) {
      return {
        ok: true,
        dry_run: true,
        would_change: true,
        revision,
        exercise: preview.exercise,
        changes: preview.changes
      }
    }

    const id = makeCustomExerciseId(S.customEx || [])
    const committed = customExerciseChange(S, { name, body_part, description }, id)
    const result = states.updateUserState(auth.token.uid, current => {
      const normalized = normalizeCustomExerciseInput(current, { name, body_part, description })
      return {
        ...current,
        customEx: [...(current.customEx || []), { id, ...normalized }]
      }
    }, {
      actor: `mcp-token:${auth.token.id}`,
      tokenId: auth.token.id,
      operation: 'create_custom_exercise',
      expectedRevision: expected_revision,
      details: { exercise: committed.exercise }
    })
    if (!result.ok) return result

    return {
      ok: true,
      dry_run: false,
      changed: true,
      revision_before: revision,
      revision_after: result.revision,
      exercise: committed.exercise,
      changes: committed.changes
    }
  }
}

/** add_bodyweight — write one body-weight weigh-in for a date. */
export const addBodyweight = {
  name: 'add_bodyweight',
  description: 'Add or replace one body-weight weigh-in. Requires OPENGYM_MCP_TOKEN with bodyweight:write. Date defaults to today; use dry_run=true first to preview before committing.',
  schema: {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date for the weigh-in as YYYY-MM-DD. Defaults to today.'),
    weight: z.number().positive().describe('Body weight in the profile unit. Rounded to one decimal.'),
    expected_revision: z.number().int().min(0).describe('State _revision observed before proposing the write. Prevents lost updates.'),
    dry_run: z.boolean().optional().describe('When true, preview changes without writing. Defaults to true.')
  },
  handler: ({ date = currentISO(), weight, expected_revision, dry_run = true }, context) => {
    const auth = writeAuthForContext('bodyweight:write', context)
    if (!auth.ok) return auth

    const dataDir = dataDirForContext(context)
    const states = writeStateServices(dataDir)
    const S = states.readUserState(auth.token.uid)
    if (!S) return noState()

    const change = bodyweightChange(S, date, weight)
    const changes = change.before === change.after ? [] : [change]
    const revision = revisionOf(S)
    const unit = S.unit || 'kg'

    if (dry_run) {
      return {
        ok: true,
        dry_run: true,
        would_change: changes.length > 0,
        revision,
        unit,
        changes
      }
    }

    if (!changes.length) {
      if (expected_revision !== revision) {
        return {
          ok: false,
          error: {
            code: 'STATE_CONFLICT',
            message: 'State changed since the tool read it.',
            current_revision: revision
          }
        }
      }
      return {
        ok: true,
        dry_run: false,
        changed: false,
        revision_before: revision,
        revision_after: revision,
        unit,
        changes
      }
    }

    const result = states.updateUserState(auth.token.uid, current => {
      return applyBodyweightEntry(current, date, change.after)
    }, {
      actor: `mcp-token:${auth.token.id}`,
      tokenId: auth.token.id,
      operation: 'add_bodyweight',
      expectedRevision: expected_revision,
      details: { date, weight: change.after }
    })
    if (!result.ok) return result

    return {
      ok: true,
      dry_run: false,
      changed: true,
      revision_before: revision,
      revision_after: result.revision,
      unit,
      changes
    }
  }
}

/** log_workout — write one finished workout for an existing routine. */
export const logWorkout = {
  name: 'log_workout',
  description: 'Log a completed workout for an existing routine from structured JSON. Requires OPENGYM_MCP_TOKEN with workout:write. Use dry_run=true first to preview before committing.',
  schema: {
    routine_id: z.string().min(1).describe('Routine id from list_routines/get_routine. The first version only logs existing routine workouts.'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Workout date as YYYY-MM-DD. Defaults to today.'),
    duration_min: z.number().int().min(1).max(1440).describe('Completed workout duration in minutes.'),
    bodyweight: z.number().positive().optional().describe('Optional body weight at workout time, in the profile unit. Rounded to one decimal.'),
    entries: z.array(workoutEntrySchema).min(1).max(50).describe('Completed entries keyed by exercise ids from the routine. The tool stores every supplied set as done.'),
    expected_revision: z.number().int().min(0).describe('State _revision observed before proposing the write. Prevents lost updates.'),
    dry_run: z.boolean().optional().describe('When true, preview the finished workout without writing. Defaults to true.')
  },
  handler: ({ routine_id, date = currentISO(), duration_min, bodyweight, entries, expected_revision, dry_run = true }, context) => {
    const auth = writeAuthForContext('workout:write', context)
    if (!auth.ok) return auth

    const dataDir = dataDirForContext(context)
    const states = writeStateServices(dataDir)
    const S = states.readUserState(auth.token.uid)
    if (!S) return noState()

    const workout = buildLoggedWorkout(S, { routine_id, date, duration_min, bodyweight, entries })
    const changes = loggedWorkoutChanges(S, workout)
    const revision = revisionOf(S)
    const unit = S.unit || 'kg'
    const summary = workoutSummary(workout, S)

    if (dry_run) {
      return {
        ok: true,
        dry_run: true,
        would_change: true,
        revision,
        unit,
        workout: summary,
        changes
      }
    }

    const result = states.updateUserState(auth.token.uid, current => {
      return applyLoggedWorkout(current, workout)
    }, {
      actor: `mcp-token:${auth.token.id}`,
      tokenId: auth.token.id,
      operation: 'log_workout',
      expectedRevision: expected_revision,
      details: {
        date,
        routine_id,
        workout_id: workout.id,
        sets_done: summary.sets_done,
        volume: summary.volume
      }
    })
    if (!result.ok) return result

    return {
      ok: true,
      dry_run: false,
      changed: true,
      revision_before: revision,
      revision_after: result.revision,
      unit,
      workout: summary,
      changes
    }
  }
}

/** log_freestyle_workout — write one finished workout without requiring a routine. */
export const logFreestyleWorkout = {
  name: 'log_freestyle_workout',
  description: 'Log a completed freestyle workout from structured JSON. Requires OPENGYM_MCP_TOKEN with workout:write. Use dry_run=true first to preview before committing.',
  schema: {
    name: z.string().optional().describe('Optional workout name. Trimmed, defaults to Freestyle, capped at 120 characters.'),
    date: ISO_DATE_SCHEMA.optional().describe('Workout date as YYYY-MM-DD. Defaults to today.'),
    duration_min: z.number().int().min(1).max(1440).describe('Completed workout duration in minutes.'),
    bodyweight: z.number().positive().optional().describe('Optional body weight at workout time, in the profile unit. Rounded to one decimal.'),
    entries: z.array(freestyleWorkoutEntrySchema).min(1).max(50).describe('Completed freestyle entries keyed by catalog or custom exercise ids.'),
    expected_revision: z.number().int().min(0).describe('State _revision observed before proposing the write. Prevents lost updates.'),
    dry_run: z.boolean().optional().describe('When true, preview the finished workout without writing. Defaults to true.')
  },
  handler: ({ name, date = currentISO(), duration_min, bodyweight, entries, expected_revision, dry_run = true }, context) => {
    const auth = writeAuthForContext('workout:write', context)
    if (!auth.ok) return auth

    const dataDir = dataDirForContext(context)
    const states = writeStateServices(dataDir)
    const S = states.readUserState(auth.token.uid)
    if (!S) return noState()

    const workout = buildFreestyleWorkout(S, { name, date, duration_min, bodyweight, entries })
    const changes = loggedWorkoutChanges(S, workout)
    const revision = revisionOf(S)
    const unit = S.unit || 'kg'
    const summary = workoutSummary(workout, S)

    if (dry_run) {
      return { ok: true, dry_run: true, would_change: true, revision, unit, workout: summary, changes }
    }

    const result = states.updateUserState(auth.token.uid, current => {
      return applyLoggedWorkout(current, workout)
    }, {
      actor: `mcp-token:${auth.token.id}`,
      tokenId: auth.token.id,
      operation: 'log_freestyle_workout',
      expectedRevision: expected_revision,
      details: {
        date,
        name: workout.name,
        workout_id: workout.id,
        sets_done: summary.sets_done,
        volume: summary.volume
      }
    })
    if (!result.ok) return result

    return { ok: true, dry_run: false, changed: true, revision_before: revision, revision_after: result.revision, unit, workout: summary, changes }
  }
}

/* ---------- registration list ---------- */

export const TOOLS = [
  listRoutines, getRoutine, getWeekPlan, listWorkouts, getWorkout, exerciseHistory, trainingSummary, detectStalls, getBodyweight, estimate1rm, muscleBalance, progressionNext, overrideDay, assignWeekday, editRoutine, createCustomExercise, addBodyweight, logWorkout, logFreestyleWorkout
]

function noState() {
  return {
    error: 'no synced state yet — sign in at least once from a device so the openGym api can save a state file for this profile',
    unit: 'kg'
  }
}
