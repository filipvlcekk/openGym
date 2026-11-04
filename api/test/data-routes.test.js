import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAuditService } from '../audit-service.js';
import { createDataRoutes } from '../data-routes.js';
import { createStateService } from '../state-service.js';

async function withRoutes(fn, { user = { id: 'u1' } } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-data-routes-'));
  try {
    const audit = createAuditService({ dataDir });
    const states = createStateService({ dataDir, audit });
    const routes = createDataRoutes({
      states,
      readSession: () => user,
      readBody: async req => req.body,
      json: (res, statusCode, body) => Object.assign(res, { statusCode, body })
    });
    const call = async (method, body = {}) => {
      const res = {};
      await routes[`${method} /api/data`]({ body }, res);
      return res;
    };
    await fn({ states, audit, call });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test('data routes reject unsigned-in users', async () => {
  await withRoutes(async ({ call }) => {
    for (const method of ['GET', 'PUT']) {
      assert.deepEqual(await call(method), {
        statusCode: 401, body: { error: 'not signed in' }
      });
    }
  }, { user: null });
});

test('GET /api/data reads only the signed-in user state with its revision', async () => {
  await withRoutes(async ({ states, call }) => {
    assert.deepEqual(await call('GET'), { statusCode: 200, body: { state: null } });
    states.replaceUserState('u1', { unit: 'kg' });
    states.replaceUserState('u2', { unit: 'lb' });
    assert.deepEqual(await call('GET'), {
      statusCode: 200, body: { state: { unit: 'kg', _revision: 1 } }
    });
  });
});

test('PUT /api/data accepts revision zero for an initial save and acknowledges the revision', async () => {
  await withRoutes(async ({ states, audit, call }) => {
    const input = { unit: 'kg', _ts: 123456, active: { localOnly: true } };
    assert.deepEqual(await call('PUT', { state: input, expected_revision: 0 }), {
      statusCode: 200, body: { ok: true, revision: 1, ts: 123456 }
    });
    assert.deepEqual(states.readUserState('u1'), { unit: 'kg', _ts: 123456, _revision: 1 });
    assert.equal(audit.readAuditEvents().length, 1);
    assert.equal(audit.readAuditEvents()[0].actor, 'web-session:u1');
  });
});

test('PUT /api/data prevents a revision-12 browser from overwriting an MCP revision-13 commit', async () => {
  await withRoutes(async ({ states, audit, call }) => {
    const old = {
      _revision: 12,
      routines: [{ id: 'push', name: 'Push', ex: [] }],
      workouts: [{ id: 'old-workout', d: '2026-11-01', entries: [] }]
    };
    fs.writeFileSync(states.stateFile('u1'), JSON.stringify(old));
    states.updateUserState('u1', current => {
      current.routines.push({ id: 'nov-a', name: 'November A', ex: [] });
      current.dayPlan = { '2026-11-04': 'nov-a' };
    }, { expectedRevision: 12, actor: 'mcp-token:tok_1', operation: 'apply_training_plan' });
    const bytes = fs.readFileSync(states.stateFile('u1'), 'utf8');
    const events = audit.readAuditEvents();

    const response = await call('PUT', { state: old, expected_revision: 12 });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.body, {
      ok: false,
      error: {
        code: 'STATE_CONFLICT',
        message: 'State changed since the tool read it.',
        current_revision: 13
      }
    });
    assert.equal(fs.readFileSync(states.stateFile('u1'), 'utf8'), bytes);
    assert.deepEqual(states.readUserState('u1').workouts, old.workouts);
    assert.deepEqual(audit.readAuditEvents(), events);
  });
});

test('PUT /api/data requires a revision so older clients cannot overwrite state', async () => {
  await withRoutes(async ({ states, audit, call }) => {
    const response = await call('PUT', { state: { unit: 'kg' } });
    assert.equal(response.statusCode, 428);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.error.code, 'STATE_REVISION_REQUIRED');
    assert.equal(states.readUserState('u1'), null);
    assert.deepEqual(audit.readAuditEvents(), []);
  });
});

test('PUT /api/data rejects a draft from another authenticated profile even at the same revision', async () => {
  await withRoutes(async ({ states, audit, call }) => {
    const response = await call('PUT', { state: { unit: 'kg' }, expected_revision: 0, expected_uid: 'other-user' });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.error.code, 'STATE_OWNER_MISMATCH');
    assert.equal(states.readUserState('u1'), null);
    assert.deepEqual(audit.readAuditEvents(), []);
    assert.equal((await call('PUT', { state: { unit: 'kg' }, expected_revision: 0, expected_uid: 'u1' })).statusCode, 200);
  });
});

test('PUT /api/data rejects invalid revisions without writing', async () => {
  await withRoutes(async ({ states, audit, call }) => {
    for (const expected_revision of [-1, 0.5, '0', null, false, {}, []]) {
      const response = await call('PUT', { state: { unit: 'kg' }, expected_revision });
      assert.equal(response.statusCode, 400, JSON.stringify(expected_revision));
      assert.equal(response.body.error.code, 'STATE_REVISION_INVALID');
    }
    assert.equal(states.readUserState('u1'), null);
    assert.deepEqual(audit.readAuditEvents(), []);
  });
});

test('PUT /api/data preserves state validation error details with HTTP 422', async () => {
  await withRoutes(async ({ states, audit, call }) => {
    for (const state of [{ routines: 'invalid' }, []]) {
      const response = await call('PUT', { state, expected_revision: 0 });
      assert.equal(response.statusCode, 422);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.error.code, 'STATE_VALIDATION_FAILED');
      assert.ok(response.body.error.issues.length > 0);
    }
    assert.equal(states.readUserState('u1'), null);
    assert.deepEqual(audit.readAuditEvents(), []);
  });
});

test('PUT /api/data reports lock contention with HTTP 423 and no write', async () => {
  await withRoutes(async ({ states, audit, call }) => {
    fs.mkdirSync(path.dirname(states.lockFile('u1')), { recursive: true });
    fs.writeFileSync(states.lockFile('u1'), '{}');
    const response = await call('PUT', { state: { unit: 'kg' }, expected_revision: 0 });
    assert.equal(response.statusCode, 423);
    assert.equal(response.body.error.code, 'STATE_LOCKED');
    assert.equal(states.readUserState('u1'), null);
    assert.deepEqual(audit.readAuditEvents(), []);
  });
});

test('PUT /api/data preserves the existing state-required response', async () => {
  await withRoutes(async ({ call }) => {
    for (const state of [undefined, null, 'invalid']) {
      assert.deepEqual(await call('PUT', { state, expected_revision: 0 }), {
        statusCode: 400, body: { error: 'state required' }
      });
    }
  });
});
