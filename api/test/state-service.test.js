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
      active: { startedAt: 123, localOnly: true },
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
