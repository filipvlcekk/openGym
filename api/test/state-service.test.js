import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStateService } from '../state-service.js';

test('replaceUserState writes a sanitized full state and returns the sync timestamp', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-state-service-'));
  try {
    const states = createStateService({ dataDir });
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
    const stored = JSON.parse(fs.readFileSync(states.stateFile('user/../one'), 'utf8'));
    assert.deepEqual(stored, {
      _ts: 123456,
      unit: 'kg',
      workouts: [{ id: 'w1', d: '2026-08-29' }]
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
