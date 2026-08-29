import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createTokenService } from '../../api/token-service.js';
import { verifyMcpWriteToken } from '../src/write-auth.js';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-mcp-write-auth-'));
}

describe('verifyMcpWriteToken', () => {
  let dataDir;

  beforeEach(() => {
    dataDir = tempDataDir();
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('requires OPENGYM_DATA or explicit dataDir', () => {
    expect(verifyMcpWriteToken({ dataDir: '', token: 'ogmcp_tok_abc_secret' })).toEqual({
      ok: false,
      error: {
        code: 'MCP_DATA_REQUIRED',
        message: 'OPENGYM_DATA is required for MCP write auth.'
      }
    });
  });

  test('requires OPENGYM_MCP_TOKEN or explicit token', () => {
    expect(verifyMcpWriteToken({ dataDir, token: '' })).toEqual({
      ok: false,
      error: {
        code: 'MCP_TOKEN_REQUIRED',
        message: 'OPENGYM_MCP_TOKEN is required for write tools.'
      }
    });
  });

  test('verifies a valid scoped token from the API token service', () => {
    const tokens = createTokenService({ dataDir });
    const created = tokens.createToken({
      uid: 'u1',
      name: 'Claude Desktop',
      scopes: ['schedule:write']
    });

    expect(verifyMcpWriteToken({
      dataDir,
      token: created.token,
      requiredScope: 'schedule:write'
    })).toEqual({
      ok: true,
      token: {
        id: created.record.id,
        uid: 'u1',
        name: 'Claude Desktop',
        scopes: ['schedule:write']
      }
    });
  });

  test('rejects a valid token without the required scope', () => {
    const tokens = createTokenService({ dataDir });
    const created = tokens.createToken({
      uid: 'u1',
      name: 'Claude Desktop',
      scopes: ['schedule:write']
    });

    expect(verifyMcpWriteToken({
      dataDir,
      token: created.token,
      requiredScope: 'routine:write'
    })).toEqual({
      ok: false,
      error: {
        code: 'TOKEN_FORBIDDEN',
        message: 'Token missing required scope.',
        required_scope: 'routine:write'
      }
    });
  });
});
