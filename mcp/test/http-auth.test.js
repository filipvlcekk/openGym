import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createTokenService } from '../../api/token-service.js'
import { authenticateHttpRequest, parseBearerToken } from '../src/http-auth.js'

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-mcp-http-auth-'))
}

describe('remote MCP HTTP auth', () => {
  let dataDir

  beforeEach(() => {
    dataDir = tempDataDir()
  })

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  test('parses bearer tokens case-insensitively', () => {
    expect(parseBearerToken('Bearer ogmcp_tok_abc_secret')).toBe('ogmcp_tok_abc_secret')
    expect(parseBearerToken('bearer   ogmcp_tok_abc_secret  ')).toBe('ogmcp_tok_abc_secret')
    expect(parseBearerToken('Basic nope')).toBe(null)
  })

  test('requires Authorization bearer token', () => {
    expect(authenticateHttpRequest({}, { dataDir })).toEqual({
      ok: false,
      status: 401,
      error: {
        code: 'MCP_AUTH_REQUIRED',
        message: 'Authorization: Bearer token is required.'
      }
    })
    expect(authenticateHttpRequest({ authorization: 'Basic abc' }, { dataDir })).toEqual({
      ok: false,
      status: 401,
      error: {
        code: 'MCP_AUTH_REQUIRED',
        message: 'Authorization: Bearer token is required.'
      }
    })
  })

  test('rejects invalid tokens with 401', () => {
    expect(authenticateHttpRequest({
      authorization: 'Bearer ogmcp_tok_missing_secret'
    }, { dataDir })).toEqual({
      ok: false,
      status: 401,
      error: {
        code: 'TOKEN_INVALID',
        message: 'Invalid token.'
      }
    })
  })

  test('rejects revoked tokens with 401', () => {
    const tokens = createTokenService({ dataDir })
    const created = tokens.createToken({
      uid: 'user-a',
      name: 'Remote MCP',
      scopes: ['state:read']
    })
    tokens.revokeToken(created.record.id, 'user-a')

    expect(authenticateHttpRequest({
      Authorization: `Bearer ${created.token}`
    }, { dataDir })).toEqual({
      ok: false,
      status: 401,
      error: {
        code: 'TOKEN_REVOKED',
        message: 'Token has been revoked.'
      }
    })
  })

  test('returns a verified request context for valid tokens', () => {
    const tokens = createTokenService({ dataDir })
    const created = tokens.createToken({
      uid: 'user-a',
      name: 'Remote MCP',
      scopes: ['state:read', 'schedule:write']
    })

    expect(authenticateHttpRequest({
      authorization: `Bearer ${created.token}`
    }, { dataDir })).toEqual({
      ok: true,
      context: {
        transport: 'http',
        dataDir,
        auth: { verified: true },
        token: {
          id: created.record.id,
          uid: 'user-a',
          name: 'Remote MCP',
          scopes: ['state:read', 'schedule:write']
        }
      }
    })
  })
})
