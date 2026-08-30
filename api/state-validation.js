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
    if (workout.d !== undefined && !validISODate(workout.d)) {
      addIssue(issues, `${path}.d`, 'must be YYYY-MM-DD');
    }
    if (workout.entries !== undefined && !Array.isArray(workout.entries)) {
      addIssue(issues, `${path}.entries`, 'must be an array');
    }
  });
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

  return { ok: issues.length === 0, issues };
}
