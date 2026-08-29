import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createTokenService } from '../token-service.js';

function withTempTokenService(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-token-service-'));
  try {
    const tokens = createTokenService({ dataDir });
    fn(tokens, dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function readTokenStore(dataDir) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'tokens.json'), 'utf8'));
}

test('createToken returns a raw token once and stores only a secret hash', () => {
  withTempTokenService((tokens, dataDir) => {
    const created = tokens.createToken({
      uid: 'u1',
      name: 'Claude Desktop',
      scopes: ['schedule:write', 'routine:write']
    });

    assert.match(created.token, /^ogmcp_tok_[A-Za-z0-9-]+_[A-Za-z0-9_-]+$/);
    assert.equal(created.record.uid, 'u1');
    assert.deepEqual(created.record.scopes, ['schedule:write', 'routine:write']);

    const stored = readTokenStore(dataDir).tokens[0];
    assert.equal(stored.id, created.record.id);
    assert.equal(stored.uid, 'u1');
    assert.equal(stored.token, undefined);
    assert.equal(stored.secret, undefined);
    assert.notEqual(stored.hash, created.token);
    assert.equal(stored.hash.length, 64);
  });
});

test('createToken requires a uid and known scopes', () => {
  withTempTokenService(tokens => {
    assert.throws(
      () => tokens.createToken({ uid: '', name: 'Claude Desktop', scopes: ['schedule:write'] }),
      /uid required/
    );
    assert.throws(
      () => tokens.createToken({ uid: 'u1', name: 'Claude Desktop', scopes: ['admin:write'] }),
      /invalid token scope/
    );
  });
});

test('verifyToken returns token identity and updates last_used_at', () => {
  withTempTokenService((tokens, dataDir) => {
    const created = tokens.createToken({
      uid: 'u1',
      name: 'Claude Desktop',
      scopes: ['schedule:write']
    });

    const verified = tokens.verifyToken(created.token, { requiredScope: 'schedule:write' });

    assert.deepEqual(verified, {
      ok: true,
      token: {
        id: created.record.id,
        uid: 'u1',
        name: 'Claude Desktop',
        scopes: ['schedule:write']
      }
    });
    assert.equal(typeof readTokenStore(dataDir).tokens[0].last_used_at, 'string');
  });
});

test('verifyToken rejects a valid token without the required scope', () => {
  withTempTokenService(tokens => {
    const created = tokens.createToken({
      uid: 'u1',
      name: 'Claude Desktop',
      scopes: ['schedule:write']
    });

    const verified = tokens.verifyToken(created.token, { requiredScope: 'routine:write' });

    assert.deepEqual(verified, {
      ok: false,
      error: {
        code: 'TOKEN_FORBIDDEN',
        message: 'Token missing required scope.',
        required_scope: 'routine:write'
      }
    });
  });
});

test('revokeToken prevents later verification', () => {
  withTempTokenService(tokens => {
    const created = tokens.createToken({
      uid: 'u1',
      name: 'Claude Desktop',
      scopes: ['schedule:write']
    });

    assert.deepEqual(tokens.revokeToken(created.record.id, 'u1'), { ok: true });

    const verified = tokens.verifyToken(created.token, { requiredScope: 'schedule:write' });
    assert.deepEqual(verified, {
      ok: false,
      error: {
        code: 'TOKEN_REVOKED',
        message: 'Token has been revoked.'
      }
    });
  });
});
