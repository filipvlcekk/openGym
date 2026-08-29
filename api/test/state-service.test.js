import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStateService } from '../state-service.js';

function withTempStateService(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-state-service-'));
  try {
    const states = createStateService({ dataDir });
    fn(states);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function readStored(states, uid) {
  return JSON.parse(fs.readFileSync(states.stateFile(uid), 'utf8'));
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
