import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAuditService } from '../audit-service.js';
import { createStateService } from '../state-service.js';

function withTempStateService(fn, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-state-service-'));
  try {
    const audit = options.audit ? createAuditService({ dataDir }) : null;
    const states = createStateService({ dataDir, audit });
    fn(states, audit);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function readStored(states, uid) {
  return JSON.parse(fs.readFileSync(states.stateFile(uid), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function issueText(result) {
  return result.error.issues.map(i => `${i.path}: ${i.message}`).join('\n');
}

function validState() {
  return {
    unit: 'kg',
    routines: [
      { id: 'push', name: 'Push', ex: [{ id: '0426', sets: 3, reps: 10, weight: 25 }] },
      { id: 'pull', name: 'Pull', ex: [] }
    ],
    week: { 1: 'push', 3: 'pull' },
    dayPlan: { '2026-08-31': 'rest', '2026-09-01': 'push' },
    bodyweight: [
      { d: '2026-08-20', w: 78.8, t: 1787227200000 },
      { d: '2026-08-30', w: 78.1 }
    ],
    workouts: [
      { id: 'w1', d: '2026-08-29', entries: [{ id: '0426', sets: [] }] }
    ]
  };
}

test('replaceUserState writes a sanitized full state and returns the sync timestamp', () => {
  withTempStateService(states => {
    const input = {
      _ts: 123456,
      unit: 'kg',
      active: {
        startedAt: 123,
        localOnly: true,
        workouts: [{ id: '', entries: ['bad'] }]
      },
      workouts: [{ id: 'w1', d: '2026-08-29' }]
    };

    const result = states.replaceUserState('user/../one', input);

    assert.deepEqual(result, { ok: true, ts: 123456 });
    assert.equal(input.active.localOnly, true);
    assert.equal(path.basename(states.stateFile('user/../one')), 'state-userone.json');
    assert.deepEqual(readStored(states, 'user/../one'), {
      _ts: 123456,
      _revision: 1,
      unit: 'kg',
      workouts: [{ id: 'w1', d: '2026-08-29' }]
    });
  });
});

test('replaceUserState accepts a valid minimal openGym state shape', () => {
  withTempStateService(states => {
    const result = states.replaceUserState('u1', validState());

    assert.deepEqual(result, { ok: true, ts: null });
    const stored = readStored(states, 'u1');
    assert.equal(stored._revision, 1);
    assert.equal(stored.routines.length, 2);
    assert.deepEqual(stored.week, { 1: 'push', 3: 'pull' });
  });
});

test('replaceUserState accepts conservative legacy imported and freestyle workout shapes', () => {
  withTempStateService(states => {
    const input = validState();
    input.exWeights = {
      'deleted-ex': { w: 0, d: '2026-08-29' },
      '0426': { w: 25 }
    };
    input.workouts = [
      {
        id: 'legacy',
        d: '2026-08-29',
        routineId: 'deleted-routine',
        name: 'Deleted Routine',
        start: 1788000000000,
        end: 1788003600000,
        bw: null,
        vol: 0,
        prs: ['deleted-ex'],
        entries: [{
          id: 'deleted-ex',
          topW: null,
          sets: [
            { w: 0, r: 0, done: true, rir: 0 },
            { min: 0, speed: 0, done: false, rpe: 0 }
          ]
        }]
      },
      {
        id: 'freestyle',
        d: '2026-09-04',
        routineId: null,
        name: 'Freestyle',
        start: 1788544800000,
        end: 1788547500000,
        bw: 78.4,
        vol: 450,
        prs: ['0426'],
        entries: [{
          id: 'c_ring_row',
          topW: 25,
          target: {
            id: 'c_ring_row',
            mode: 'reps',
            sets: 0,
            reps: 0,
            weight: 0,
            repsMin: 0,
            repsMax: 0,
            sec: 0,
            min: 0,
            speed: 0,
            inc: 0,
            bodyweight: true,
            side: false,
            prog: 'off',
            policy: 'linear',
            sg: 'A'
          },
          sets: [{ w: 25, r: 8, done: true }]
        }]
      }
    ];

    const result = states.replaceUserState('u1', input);

    assert.equal(result.ok, true);
    const stored = readStored(states, 'u1');
    assert.equal(stored.workouts.length, 2);
    assert.equal(stored.workouts[1].routineId, null);
    assert.deepEqual(stored.workouts, input.workouts);
    assert.deepEqual(stored.exWeights, input.exWeights);
    assert.deepEqual(stored.exWeights['deleted-ex'], { w: 0, d: '2026-08-29' });
  });
});

test('replaceUserState rejects invalid workout metadata without writing', () => {
  withTempStateService((states, audit) => {
    const uid = 'u1';
    const original = { ...clone(validState()), _revision: 3 };
    fs.writeFileSync(states.stateFile(uid), JSON.stringify(original));

    const input = validState();
    input.workouts = [{
      id: '',
      d: '2026-02-30',
      routineId: 42,
      name: 42,
      start: 20,
      end: 10,
      bw: -1,
      vol: -1,
      prs: ['ok', 42],
      entries: []
    }];

    const result = states.replaceUserState(uid, input, {
      actor: 'mcp-token:tok_1',
      expectedRevision: 3
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STATE_VALIDATION_FAILED');
    const text = issueText(result);
    assert.match(text, /workouts\.0\.id: must be a non-empty string/);
    assert.match(text, /workouts\.0\.d: must be YYYY-MM-DD/);
    assert.match(text, /workouts\.0\.routineId: must be null or a non-empty string/);
    assert.match(text, /workouts\.0\.name: must be a string/);
    assert.match(text, /workouts\.0\.end: must be >= start/);
    assert.match(text, /workouts\.0\.bw: must be a positive finite number/);
    assert.match(text, /workouts\.0\.vol: must be a finite number >= 0/);
    assert.match(text, /workouts\.0\.prs\.1: must be a string/);
    assert.deepEqual(readStored(states, uid), original);
    assert.deepEqual(audit.readAuditEvents(), []);
  }, { audit: true });
});

test('updateUserState rejects invalid workout entries and sets without changing state or audit', () => {
  withTempStateService((states, audit) => {
    const uid = 'u1';
    const original = { ...validState(), _revision: 4 };
    fs.writeFileSync(states.stateFile(uid), JSON.stringify(original));

    const result = states.updateUserState(uid, current => {
      current.workouts.push({
        id: 'bad-entry-set',
        d: '2026-09-05',
        entries: [
          'not-an-entry',
          {
            id: '',
            topW: -1,
            sets: [
              'not-a-set',
              { done: 'yes', w: -1, r: -1, sec: -1, min: -1, speed: -1, rir: 11, rpe: 11 }
            ]
          }
        ]
      });
      return current;
    }, {
      actor: 'mcp-token:tok_1',
      operation: 'unit-test',
      expectedRevision: 4
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STATE_VALIDATION_FAILED');
    const text = issueText(result);
    assert.match(text, /workouts\.1\.entries\.0: must be an object/);
    assert.match(text, /workouts\.1\.entries\.1\.id: must be a non-empty string/);
    assert.match(text, /workouts\.1\.entries\.1\.topW: must be a finite number >= 0/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.0: must be an object/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.done: must be a boolean/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.w: must be a finite number >= 0/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.r: must be a finite number >= 0/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.sec: must be a finite number >= 0/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.min: must be a finite number >= 0/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.speed: must be a finite number >= 0/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.rir: must be a finite number 0..10/);
    assert.match(text, /workouts\.1\.entries\.1\.sets\.1\.rpe: must be a finite number 0..10/);
    assert.deepEqual(readStored(states, uid), original);
    assert.deepEqual(audit.readAuditEvents(), []);
  }, { audit: true });
});

test('replaceUserState rejects invalid workout target metadata without writing', () => {
  withTempStateService((states, audit) => {
    const uid = 'u1';
    const original = { ...clone(validState()), _revision: 3 };
    fs.writeFileSync(states.stateFile(uid), JSON.stringify(original));

    const input = validState();
    input.workouts = [{
      id: 'bad-target',
      d: '2026-09-05',
      entries: [{
        id: '0426',
        target: {
          id: '',
          mode: 'distance',
          sets: -1,
          reps: -1,
          weight: -1,
          repsMin: 5,
          repsMax: 4,
          sec: -1,
          min: -1,
          speed: -1,
          inc: -1,
          bodyweight: 'yes',
          side: 'no',
          prog: 42,
          policy: 42,
          sg: ''
        },
        sets: []
      }]
    }];

    const result = states.replaceUserState(uid, input, {
      actor: 'mcp-token:tok_1',
      expectedRevision: 3
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STATE_VALIDATION_FAILED');
    const text = issueText(result);
    assert.match(text, /workouts\.0\.entries\.0\.target\.id: must be a non-empty string/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.mode: must be reps, time or cardio/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.sets: must be a finite number >= 0/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.reps: must be a finite number >= 0/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.weight: must be a finite number >= 0/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.repsMax: must be >= repsMin/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.sec: must be a finite number >= 0/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.min: must be a finite number >= 0/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.speed: must be a finite number >= 0/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.inc: must be a finite number >= 0/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.bodyweight: must be a boolean/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.side: must be a boolean/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.prog: must be a string/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.policy: must be a string/);
    assert.match(text, /workouts\.0\.entries\.0\.target\.sg: must be a non-empty string/);
    assert.deepEqual(readStored(states, uid), original);
    assert.deepEqual(audit.readAuditEvents(), []);
  }, { audit: true });
});

test('updateUserState rejects invalid exWeights shape without changing state', () => {
  withTempStateService(states => {
    const uid = 'u1';
    const original = { ...validState(), _revision: 2 };
    fs.writeFileSync(states.stateFile(uid), JSON.stringify(original));

    const result = states.updateUserState(uid, current => {
      current.exWeights = {
        good: { w: 20, d: '2026-08-29' },
        bad_record: 'not-an-object',
        bad_weight: { w: -1 },
        bad_date: { w: 10, d: 'tomorrow' }
      };
      return current;
    }, {
      operation: 'unit-test',
      expectedRevision: 2
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STATE_VALIDATION_FAILED');
    const text = issueText(result);
    assert.match(text, /exWeights\.bad_record: must be an object/);
    assert.match(text, /exWeights\.bad_weight\.w: must be a finite number >= 0/);
    assert.match(text, /exWeights\.bad_date\.d: must be YYYY-MM-DD/);
    assert.deepEqual(readStored(states, uid), original);
  });
});

test('replaceUserState rejects weekly plan references to unknown routines without writing', () => {
  withTempStateService(states => {
    const input = validState();
    input.week[1] = 'missing';

    const result = states.replaceUserState('u1', input);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STATE_VALIDATION_FAILED');
    assert.match(result.error.issues.map(i => `${i.path}: ${i.message}`).join('\n'), /week\.1.*missing/);
    assert.equal(fs.existsSync(states.stateFile('u1')), false);
  });
});

test('replaceUserState rejects non-object root state without writing', () => {
  withTempStateService(states => {
    const result = states.replaceUserState('u1', []);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STATE_VALIDATION_FAILED');
    assert.match(result.error.issues.map(i => `${i.path}: ${i.message}`).join('\n'), /state must be an object/);
    assert.equal(fs.existsSync(states.stateFile('u1')), false);
  });
});

test('updateUserState increments revision when expectedRevision matches', () => {
  withTempStateService(states => {
    const uid = 'u1';
    fs.writeFileSync(states.stateFile(uid), JSON.stringify({ _revision: 2, unit: 'kg' }));

    const result = states.updateUserState(uid, current => ({ ...current, unit: 'lb' }), {
      expectedRevision: 2,
      operation: 'unit-test'
    });

    assert.equal(result.ok, true);
    assert.equal(result.revision, 3);
    assert.deepEqual(readStored(states, uid), { _revision: 3, unit: 'lb' });
  });
});

test('updateUserState rejects duplicate routine ids without changing state or writing audit', () => {
  withTempStateService((states, audit) => {
    const uid = 'u1';
    const original = { ...validState(), _revision: 4 };
    fs.writeFileSync(states.stateFile(uid), JSON.stringify(original));

    const result = states.updateUserState(uid, current => {
      current.routines.push({ id: 'push', name: 'Duplicate Push', ex: [] });
      return current;
    }, {
      actor: 'mcp-token:tok_1',
      operation: 'edit_routine',
      expectedRevision: 4
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STATE_VALIDATION_FAILED');
    assert.match(result.error.issues.map(i => `${i.path}: ${i.message}`).join('\n'), /routines\.2\.id.*duplicate/);
    assert.deepEqual(readStored(states, uid), original);
    assert.deepEqual(audit.readAuditEvents(), []);
  }, { audit: true });
});

test('updateUserState rejects duplicate bodyweight dates without changing state', () => {
  withTempStateService(states => {
    const uid = 'u1';
    const original = { ...validState(), _revision: 2 };
    fs.writeFileSync(states.stateFile(uid), JSON.stringify(original));

    const result = states.updateUserState(uid, current => {
      current.bodyweight.push({ d: '2026-08-20', w: 78.4, t: 1787227200000 });
      return current;
    }, {
      operation: 'add_bodyweight',
      expectedRevision: 2
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STATE_VALIDATION_FAILED');
    assert.match(result.error.issues.map(i => `${i.path}: ${i.message}`).join('\n'), /bodyweight\.2\.d.*duplicate/);
    assert.deepEqual(readStored(states, uid), original);
  });
});

test('replaceUserState rejects invalid dayPlan dates without writing', () => {
  withTempStateService(states => {
    const input = validState();
    input.dayPlan = { tomorrow: 'push' };

    const result = states.replaceUserState('u1', input);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STATE_VALIDATION_FAILED');
    assert.match(result.error.issues.map(i => `${i.path}: ${i.message}`).join('\n'), /dayPlan\.tomorrow.*YYYY-MM-DD/);
    assert.equal(fs.existsSync(states.stateFile('u1')), false);
  });
});

test('updateUserState rejects a stale expectedRevision without changing the state file', () => {
  withTempStateService(states => {
    const uid = 'u1';
    const original = { _revision: 3, unit: 'kg' };
    fs.writeFileSync(states.stateFile(uid), JSON.stringify(original));

    const result = states.updateUserState(uid, current => ({ ...current, unit: 'lb' }), {
      expectedRevision: 2,
      operation: 'unit-test'
    });

    assert.deepEqual(result, {
      ok: false,
      error: {
        code: 'STATE_CONFLICT',
        message: 'State changed since the tool read it.',
        current_revision: 3
      }
    });
    assert.deepEqual(readStored(states, uid), original);
  });
});

test('updateUserState removes the per-user lock when a mutation throws', () => {
  withTempStateService(states => {
    const uid = 'u1';
    fs.writeFileSync(states.stateFile(uid), JSON.stringify({ _revision: 1, unit: 'kg' }));

    assert.throws(
      () => states.updateUserState(uid, () => { throw new Error('boom'); }, { operation: 'unit-test' }),
      /boom/
    );

    assert.equal(fs.existsSync(states.lockFile(uid)), false);
  });
});

test('updateUserState appends an audit event after a committed write', () => {
  withTempStateService((states, audit) => {
    const uid = 'u1';
    fs.writeFileSync(states.stateFile(uid), JSON.stringify({ _revision: 4, unit: 'kg' }));

    states.updateUserState(uid, current => ({ ...current, unit: 'lb' }), {
      actor: 'mcp-token:tok_1',
      tokenId: 'tok_1',
      operation: 'assign_weekday',
      expectedRevision: 4,
      details: { weekday: 1, routine_id: 'r1' }
    });

    const events = audit.readAuditEvents();
    assert.equal(events.length, 1);
    assert.deepEqual(events, [{
      timestamp: events[0].timestamp,
      uid,
      actor: 'mcp-token:tok_1',
      action: 'assign_weekday',
      token_id: 'tok_1',
      revision_before: 4,
      revision_after: 5,
      details: { weekday: 1, routine_id: 'r1' }
    }]);
  }, { audit: true });
});

test('updateUserState does not append a commit audit event for stale revision conflicts', () => {
  withTempStateService((states, audit) => {
    const uid = 'u1';
    fs.writeFileSync(states.stateFile(uid), JSON.stringify({ _revision: 2, unit: 'kg' }));

    const result = states.updateUserState(uid, current => ({ ...current, unit: 'lb' }), {
      actor: 'mcp-token:tok_1',
      operation: 'assign_weekday',
      expectedRevision: 1
    });

    assert.equal(result.ok, false);
    assert.deepEqual(audit.readAuditEvents(), []);
  }, { audit: true });
});
