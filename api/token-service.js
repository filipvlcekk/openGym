import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { atomicWrite } from './state-service.js';

export const TOKEN_SCOPES = new Set([
  'schedule:write',
  'routine:write',
  'workout:write',
  'exercise:write',
  'bodyweight:write'
]);

function randomSegment(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url').replace(/_/g, '-');
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function hashSecretHex(secret) {
  return hashSecret(secret).toString('hex');
}

function parseRawToken(rawToken) {
  const match = String(rawToken || '').match(/^(ogmcp)_(tok_[A-Za-z0-9-]+)_([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  return { id: match[2], secret: match[3] };
}

function timingSafeHexEqual(storedHex, secret) {
  const stored = Buffer.from(String(storedHex || ''), 'hex');
  const actual = hashSecret(secret);
  if (stored.length !== actual.length) return false;
  return crypto.timingSafeEqual(stored, actual);
}

function publicRecord(record) {
  return {
    id: record.id,
    uid: record.uid,
    name: record.name,
    scopes: record.scopes,
    created_at: record.created_at,
    last_used_at: record.last_used_at,
    revoked_at: record.revoked_at
  };
}

function authRecord(record) {
  return {
    id: record.id,
    uid: record.uid,
    name: record.name,
    scopes: record.scopes
  };
}

export function createTokenService({ dataDir }) {
  const tokenFile = path.join(dataDir, 'tokens.json');

  function loadStore() {
    try {
      const store = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      return { tokens: Array.isArray(store.tokens) ? store.tokens : [] };
    } catch {
      return { tokens: [] };
    }
  }

  function saveStore(store) {
    atomicWrite(tokenFile, JSON.stringify({ tokens: store.tokens }, null, 2));
  }

  function createToken({ uid, name, scopes }) {
    const owner = String(uid || '').trim();
    if (!owner) throw new Error('uid required');
    const tokenScopes = Array.from(new Set((Array.isArray(scopes) ? scopes : []).map(String)));
    const invalidScope = tokenScopes.find(scope => !TOKEN_SCOPES.has(scope));
    if (invalidScope) throw new Error('invalid token scope: ' + invalidScope);

    const store = loadStore();
    const id = 'tok_' + randomSegment(9);
    const secret = randomSegment(24);
    const now = new Date().toISOString();
    const record = {
      id,
      uid: owner,
      name: String(name || '').trim().slice(0, 80) || 'MCP token',
      hash: hashSecretHex(secret),
      scopes: tokenScopes,
      created_at: now,
      last_used_at: null,
      revoked_at: null
    };
    store.tokens.push(record);
    saveStore(store);
    return { token: `ogmcp_${id}_${secret}`, record: publicRecord(record) };
  }

  function verifyToken(rawToken, options = {}) {
    const parsed = parseRawToken(rawToken);
    if (!parsed) {
      return { ok: false, error: { code: 'TOKEN_INVALID', message: 'Invalid token.' } };
    }

    const store = loadStore();
    const record = store.tokens.find(t => t.id === parsed.id);
    if (!record || !timingSafeHexEqual(record.hash, parsed.secret)) {
      return { ok: false, error: { code: 'TOKEN_INVALID', message: 'Invalid token.' } };
    }
    if (record.revoked_at) {
      return { ok: false, error: { code: 'TOKEN_REVOKED', message: 'Token has been revoked.' } };
    }
    if (options.requiredScope && !record.scopes.includes(options.requiredScope)) {
      return {
        ok: false,
        error: {
          code: 'TOKEN_FORBIDDEN',
          message: 'Token missing required scope.',
          required_scope: options.requiredScope
        }
      };
    }

    record.last_used_at = new Date().toISOString();
    saveStore(store);
    return { ok: true, token: authRecord(record) };
  }

  function listTokens(uid) {
    const store = loadStore();
    return store.tokens.filter(t => t.uid === uid).map(publicRecord);
  }

  function revokeToken(id, uid) {
    const store = loadStore();
    const record = store.tokens.find(t => t.id === id && t.uid === uid);
    if (!record) {
      return { ok: false, error: { code: 'TOKEN_NOT_FOUND', message: 'Token not found.' } };
    }
    if (!record.revoked_at) record.revoked_at = new Date().toISOString();
    saveStore(store);
    return { ok: true };
  }

  return { createToken, verifyToken, listTokens, revokeToken };
}
