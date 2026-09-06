const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function addIssue(issues, path, message) {
  issues.push({ path, message });
}

function joinPath(base, key) {
  return /^[a-zA-Z0-9_-]+$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && !!value.trim();
}

function validateOptionalString(value, issues, path) {
  if (value !== undefined && typeof value !== 'string') {
    addIssue(issues, path, 'must be a string');
  }
}

function validateOptionalNonEmptyString(value, issues, path) {
  if (value !== undefined && !isNonEmptyString(value)) {
    addIssue(issues, path, 'must be a non-empty string');
  }
}

function validateOptionalFiniteNumber(value, issues, path, message = 'must be a finite number') {
  if (value === undefined) return false;
  if (value !== undefined && !isFiniteNumber(value)) {
    addIssue(issues, path, message);
    return false;
  }
  return true;
}

function validateOptionalNonNegativeNumber(value, issues, path) {
  if (value === undefined) return false;
  if (!isFiniteNumber(value) || value < 0) {
    addIssue(issues, path, 'must be a finite number >= 0');
    return false;
  }
  return true;
}

function validateOptionalNullablePositiveNumber(value, issues, path) {
  if (value === undefined || value === null) return false;
  if (!isFiniteNumber(value) || value <= 0) {
    addIssue(issues, path, 'must be a positive finite number');
    return false;
  }
  return true;
}

function validateOptionalRangeNumber(value, issues, path, min, max) {
  if (value === undefined) return false;
  if (!isFiniteNumber(value) || value < min || value > max) {
    addIssue(issues, path, `must be a finite number ${min}..${max}`);
    return false;
  }
  return true;
}

function validISODate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function validateRoutines(state, issues) {
  const routines = state.routines;
  const routineIds = new Set();

  if (routines === undefined) return routineIds;
  if (!Array.isArray(routines)) {
    addIssue(issues, 'routines', 'must be an array');
    return routineIds;
  }

  routines.forEach((routine, index) => {
    const path = `routines.${index}`;
    if (!isObject(routine)) {
      addIssue(issues, path, 'must be an object');
      return;
    }

    if (typeof routine.id !== 'string' || !routine.id.trim()) {
      addIssue(issues, `${path}.id`, 'must be a non-empty string');
    } else if (routineIds.has(routine.id)) {
      addIssue(issues, `${path}.id`, `duplicate routine id ${routine.id}`);
    } else {
      routineIds.add(routine.id);
    }

    if (routine.ex !== undefined && !Array.isArray(routine.ex)) {
      addIssue(issues, `${path}.ex`, 'must be an array');
    }
  });

  return routineIds;
}

function validateWeek(state, routineIds, issues) {
  const week = state.week;
  if (week === undefined) return;
  if (!isObject(week)) {
    addIssue(issues, 'week', 'must be an object');
    return;
  }

  for (const [key, value] of Object.entries(week)) {
    const weekday = Number(key);
    if (!Number.isInteger(weekday) || String(weekday) !== key || weekday < 0 || weekday > 6) {
      addIssue(issues, `week.${key}`, 'weekday key must be an integer string 0..6');
    }
    if (typeof value !== 'string' || !routineIds.has(value)) {
      addIssue(issues, `week.${key}`, `references unknown routine id ${value}`);
    }
  }
}

function validateDayPlan(state, routineIds, issues) {
  const dayPlan = state.dayPlan;
  if (dayPlan === undefined) return;
  if (!isObject(dayPlan)) {
    addIssue(issues, 'dayPlan', 'must be an object');
    return;
  }

  for (const [date, value] of Object.entries(dayPlan)) {
    if (!validISODate(date)) {
      addIssue(issues, `dayPlan.${date}`, 'date key must be YYYY-MM-DD');
    }
    if (value !== 'rest' && (typeof value !== 'string' || !routineIds.has(value))) {
      addIssue(issues, `dayPlan.${date}`, `references unknown routine id ${value}`);
    }
  }
}

function validateBodyweight(state, issues) {
  const entries = state.bodyweight;
  const dates = new Set();
  if (entries === undefined) return;
  if (!Array.isArray(entries)) {
    addIssue(issues, 'bodyweight', 'must be an array');
    return;
  }

  entries.forEach((entry, index) => {
    const path = `bodyweight.${index}`;
    if (!isObject(entry)) {
      addIssue(issues, path, 'must be an object');
      return;
    }
    if (!validISODate(entry.d)) {
      addIssue(issues, `${path}.d`, 'must be YYYY-MM-DD');
    } else if (dates.has(entry.d)) {
      addIssue(issues, `${path}.d`, `duplicate bodyweight date ${entry.d}`);
    } else {
      dates.add(entry.d);
    }
    if (!isFiniteNumber(entry.w) || entry.w <= 0) {
      addIssue(issues, `${path}.w`, 'must be a positive finite number');
    }
    if (entry.t !== undefined && !isFiniteNumber(entry.t)) {
      addIssue(issues, `${path}.t`, 'must be a finite number');
    }
  });
}

const TARGET_NON_NEGATIVE_NUMBER_FIELDS = [
  'sets', 'reps', 'weight', 'repsMin', 'repsMax', 'sec', 'min', 'speed', 'inc'
];

function validateWorkoutTarget(target, issues, path) {
  if (target === undefined) return;
  if (!isObject(target)) {
    addIssue(issues, path, 'must be an object');
    return;
  }

  validateOptionalNonEmptyString(target.id, issues, `${path}.id`);

  if (target.mode !== undefined && !['reps', 'time', 'cardio'].includes(target.mode)) {
    addIssue(issues, `${path}.mode`, 'must be reps, time or cardio');
  }

  for (const field of TARGET_NON_NEGATIVE_NUMBER_FIELDS) {
    validateOptionalNonNegativeNumber(target[field], issues, `${path}.${field}`);
  }

  if (
    isFiniteNumber(target.repsMin) &&
    isFiniteNumber(target.repsMax) &&
    target.repsMax < target.repsMin
  ) {
    addIssue(issues, `${path}.repsMax`, 'must be >= repsMin');
  }

  if (target.bodyweight !== undefined && typeof target.bodyweight !== 'boolean') {
    addIssue(issues, `${path}.bodyweight`, 'must be a boolean');
  }
  if (target.side !== undefined && typeof target.side !== 'boolean') {
    addIssue(issues, `${path}.side`, 'must be a boolean');
  }
  validateOptionalString(target.prog, issues, `${path}.prog`);
  validateOptionalString(target.policy, issues, `${path}.policy`);
  validateOptionalNonEmptyString(target.sg, issues, `${path}.sg`);
}

const SET_NON_NEGATIVE_NUMBER_FIELDS = ['w', 'r', 'sec', 'min', 'speed'];

function validateWorkoutSet(set, issues, path) {
  if (!isObject(set)) {
    addIssue(issues, path, 'must be an object');
    return;
  }

  if (set.done !== undefined && typeof set.done !== 'boolean') {
    addIssue(issues, `${path}.done`, 'must be a boolean');
  }

  for (const field of SET_NON_NEGATIVE_NUMBER_FIELDS) {
    validateOptionalNonNegativeNumber(set[field], issues, `${path}.${field}`);
  }

  validateOptionalRangeNumber(set.rir, issues, `${path}.rir`, 0, 10);
  validateOptionalRangeNumber(set.rpe, issues, `${path}.rpe`, 0, 10);
}

function validateWorkoutEntry(entry, issues, path) {
  if (!isObject(entry)) {
    addIssue(issues, path, 'must be an object');
    return;
  }

  validateOptionalNonEmptyString(entry.id, issues, `${path}.id`);

  if (entry.topW !== undefined && entry.topW !== null) {
    validateOptionalNonNegativeNumber(entry.topW, issues, `${path}.topW`);
  }

  validateWorkoutTarget(entry.target, issues, `${path}.target`);

  if (entry.sets !== undefined) {
    if (!Array.isArray(entry.sets)) {
      addIssue(issues, `${path}.sets`, 'must be an array');
    } else {
      entry.sets.forEach((set, index) => {
        validateWorkoutSet(set, issues, `${path}.sets.${index}`);
      });
    }
  }
}

function validateWorkouts(state, issues) {
  const workouts = state.workouts;
  if (workouts === undefined) return;
  if (!Array.isArray(workouts)) {
    addIssue(issues, 'workouts', 'must be an array');
    return;
  }

  workouts.forEach((workout, index) => {
    const path = `workouts.${index}`;
    if (!isObject(workout)) {
      addIssue(issues, path, 'must be an object');
      return;
    }
    validateOptionalNonEmptyString(workout.id, issues, `${path}.id`);
    if (workout.d !== undefined && !validISODate(workout.d)) {
      addIssue(issues, `${path}.d`, 'must be YYYY-MM-DD');
    }
    if (
      workout.routineId !== undefined &&
      workout.routineId !== null &&
      !isNonEmptyString(workout.routineId)
    ) {
      addIssue(issues, `${path}.routineId`, 'must be null or a non-empty string');
    }
    validateOptionalString(workout.name, issues, `${path}.name`);
    const hasFiniteStart = validateOptionalFiniteNumber(workout.start, issues, `${path}.start`);
    const hasFiniteEnd = validateOptionalFiniteNumber(workout.end, issues, `${path}.end`);
    if (hasFiniteStart && hasFiniteEnd && workout.end < workout.start) {
      addIssue(issues, `${path}.end`, 'must be >= start');
    }
    validateOptionalNullablePositiveNumber(workout.bw, issues, `${path}.bw`);
    validateOptionalNonNegativeNumber(workout.vol, issues, `${path}.vol`);

    if (workout.prs !== undefined) {
      if (!Array.isArray(workout.prs)) {
        addIssue(issues, `${path}.prs`, 'must be an array');
      } else {
        workout.prs.forEach((pr, prIndex) => {
          if (typeof pr !== 'string') {
            addIssue(issues, `${path}.prs.${prIndex}`, 'must be a string');
          }
        });
      }
    }

    if (workout.entries !== undefined) {
      if (!Array.isArray(workout.entries)) {
        addIssue(issues, `${path}.entries`, 'must be an array');
      } else {
        workout.entries.forEach((entry, entryIndex) => {
          validateWorkoutEntry(entry, issues, `${path}.entries.${entryIndex}`);
        });
      }
    }
  });
}

function validateExWeights(state, issues) {
  const exWeights = state.exWeights;
  if (exWeights === undefined) return;
  if (!isObject(exWeights)) {
    addIssue(issues, 'exWeights', 'must be an object');
    return;
  }

  for (const [exerciseId, record] of Object.entries(exWeights)) {
    const path = joinPath('exWeights', exerciseId);
    if (!isObject(record)) {
      addIssue(issues, path, 'must be an object');
      continue;
    }
    validateOptionalNonNegativeNumber(record.w, issues, `${path}.w`);
    if (record.d !== undefined && !validISODate(record.d)) {
      addIssue(issues, `${path}.d`, 'must be YYYY-MM-DD');
    }
  }
}

export function validateState(state) {
  const issues = [];
  if (!isObject(state)) {
    addIssue(issues, '', 'state must be an object');
    return { ok: false, issues };
  }

  if (state._revision !== undefined && (!Number.isInteger(state._revision) || state._revision < 0)) {
    addIssue(issues, '_revision', 'must be a non-negative integer');
  }

  const routineIds = validateRoutines(state, issues);
  validateWeek(state, routineIds, issues);
  validateDayPlan(state, routineIds, issues);
  validateBodyweight(state, issues);
  validateWorkouts(state, issues);
  validateExWeights(state, issues);

  return { ok: issues.length === 0, issues };
}
