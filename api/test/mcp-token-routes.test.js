import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createMcpTokenRoutes } from '../mcp-token-routes.js';
import { createTokenService } from '../token-service.js';

async function withRoutes(options = {}, fn) {
  if (typeof options === 'function') {
    fn = options;
    options = {};
  }
  const { user = { id: 'u1', name: 'Filip' }, body = {} } = options;
  let requestBody = body;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-mcp-token-routes-'));
  try {
    const tokens = createTokenService({ dataDir });
    const responses = [];
    const routes = createMcpTokenRoutes({
      tokens,
      readSession: () => user,
      readBody: async () => requestBody,
      json: (res, code, obj) => {
        res.statusCode = code;
        res.body = obj;
        responses.push({ code, obj });
      }
    });
    await fn({ routes, tokens, responses, setBody: next => { requestBody = next; } });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function call(routes, key) {
  const res = {};
  await routes[key]({}, res);
  return res;
}

test('POST /api/mcp/tokens rejects unauthenticated callers', async () => {
  await withRoutes({ user: null, body: { scopes: ['schedule:write'] } }, async ({ routes }) => {
    const res = await call(routes, 'POST /api/mcp/tokens');

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'not signed in' });
  });
});

test('POST /api/mcp/tokens creates a scoped token and returns the raw token once', async () => {
  await withRoutes({
    body: { name: 'Claude Desktop', scopes: ['schedule:write', 'routine:write', 'exercise:write'] }
  }, async ({ routes }) => {
    const res = await call(routes, 'POST /api/mcp/tokens');

    assert.equal(res.statusCode, 200);
    assert.match(res.body.token, /^ogmcp_tok_/);
    assert.equal(res.body.record.uid, 'u1');
    assert.equal(res.body.record.name, 'Claude Desktop');
    assert.deepEqual(res.body.record.scopes, ['schedule:write', 'routine:write', 'exercise:write']);
    assert.equal(res.body.record.hash, undefined);
    assert.equal(res.body.record.secret, undefined);
  });
});

test('GET /api/mcp/tokens lists only the signed-in user tokens', async () => {
  await withRoutes(async ({ routes, tokens }) => {
    tokens.createToken({ uid: 'u1', name: 'Mine', scopes: ['schedule:write'] });
    tokens.createToken({ uid: 'u2', name: 'Other', scopes: ['routine:write'] });

    const res = await call(routes, 'GET /api/mcp/tokens');

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.tokens.length, 1);
    assert.equal(res.body.tokens[0].name, 'Mine');
    assert.equal(res.body.tokens[0].hash, undefined);
  });
});

test('POST /api/mcp/tokens/revoke revokes a signed-in user token', async () => {
  await withRoutes(async ({ routes, tokens, setBody }) => {
    const created = tokens.createToken({ uid: 'u1', name: 'Mine', scopes: ['schedule:write'] });
    setBody({ id: created.record.id });

    const res = await call(routes, 'POST /api/mcp/tokens/revoke');

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(tokens.verifyToken(created.token).error.code, 'TOKEN_REVOKED');
  });
});

test('POST /api/mcp/tokens rejects unknown scopes', async () => {
  await withRoutes({ body: { name: 'Bad', scopes: ['admin:write'] } }, async ({ routes }) => {
    const res = await call(routes, 'POST /api/mcp/tokens');

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: 'invalid token scope: admin:write' });
  });
});
