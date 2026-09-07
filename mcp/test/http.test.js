import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createTokenService } from '../../api/token-service.js'
import { createHttpMcpServer } from '../src/http.js'

const PROTOCOL_VERSION = '2026-07-28'

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-mcp-http-'))
}

function stateFile(dataDir, uid) {
  return path.join(dataDir, `state-${uid}.json`)
}

function readState(dataDir, uid) {
  return JSON.parse(fs.readFileSync(stateFile(dataDir, uid), 'utf8'))
}

function readAuditEvents(dataDir) {
  try {
    const text = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim()
    return text ? text.split('\n').map(line => JSON.parse(line)) : []
  } catch {
    return []
  }
}

function writeState(dataDir, uid, state = {}) {
  fs.writeFileSync(stateFile(dataDir, uid), JSON.stringify({
    _revision: 7,
    unit: 'kg',
    routines: [
      { id: 'push', name: 'Push Day', emoji: 'P', policy: 'linear', ex: [] },
      { id: 'pull', name: 'Pull Day', emoji: 'U', policy: 'linear', ex: [] }
    ],
    week: {},
    dayPlan: { '2026-08-31': 'rest' },
    workouts: [],
    bodyweight: [],
    ...state
  }))
}

function createToken(dataDir, { uid = 'user-a', scopes = ['state:read'] } = {}) {
  return createTokenService({ dataDir }).createToken({
    uid,
    name: `${uid} token`,
    scopes
  })
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  return `http://127.0.0.1:${port}`
}

async function close(server) {
  if (!server.listening) return
  await new Promise(resolve => server.close(resolve))
}

function rpcBody(method, params = {}) {
  const { _meta, ...rest } = params
  return {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: {
      ...rest,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
        ...(_meta || {})
      }
    }
  }
}

async function postRpc(baseUrl, body, { token, headers = {} } = {}) {
  const method = body?.method
  const mcpName = method === 'tools/call' ? body.params?.name : undefined
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      'Mcp-Method': method,
      ...(mcpName ? { 'Mcp-Name': mcpName } : {}),
      ...headers
    },
    body: JSON.stringify(body)
  })
  const json = await res.json()
  return { res, json }
}

async function postRaw(baseUrl, body, { headers = {} } = {}) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body
  })
  const json = await res.json()
  return { res, json }
}

describe('remote MCP HTTP server', () => {
  let dataDir
  let server
  let baseUrl

  beforeEach(async () => {
    dataDir = tempDataDir()
    server = createHttpMcpServer({ dataDir, allowedOrigins: ['https://client.example'] })
    baseUrl = await listen(server)
  })

  afterEach(async () => {
    await close(server)
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  test('GET /healthz returns ok', async () => {
    const res = await fetch(`${baseUrl}/healthz`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('GET /mcp returns method not allowed', async () => {
    const res = await fetch(`${baseUrl}/mcp`)

    expect(res.status).toBe(405)
  })

  test('POST /mcp without auth returns 401', async () => {
    const { res, json } = await postRpc(baseUrl, rpcBody('tools/list'))

    expect(res.status).toBe(401)
    expect(json.error.data.code).toBe('MCP_AUTH_REQUIRED')
  })

  test('invalid origin returns 403', async () => {
    const token = createToken(dataDir).token
    const { res, json } = await postRpc(baseUrl, rpcBody('tools/list'), {
      token,
      headers: { origin: 'https://evil.example' }
    })

    expect(res.status).toBe(403)
    expect(json.error.data.code).toBe('MCP_ORIGIN_FORBIDDEN')
  })

  test('present Origin is rejected when no allowlist is configured', async () => {
    await close(server)
    server = createHttpMcpServer({ dataDir })
    baseUrl = await listen(server)
    const token = createToken(dataDir).token
    const { res, json } = await postRpc(baseUrl, rpcBody('tools/list'), {
      token,
      headers: { origin: 'https://client.example' }
    })

    expect(res.status).toBe(403)
    expect(json.error.data.code).toBe('MCP_ORIGIN_FORBIDDEN')
  })

  test('missing protocol header returns header validation error', async () => {
    const token = createToken(dataDir).token
    const { res, json } = await postRpc(baseUrl, rpcBody('tools/list'), {
      token,
      headers: { 'MCP-Protocol-Version': '' }
    })

    expect(res.status).toBe(400)
    expect(json.error.code).toBe(-32020)
  })

  test('missing params meta returns header validation error', async () => {
    const token = createToken(dataDir).token
    const { res, json } = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    }, { token })

    expect(res.status).toBe(400)
    expect(json.error.code).toBe(-32020)
  })

  test('missing protocol meta returns header validation error', async () => {
    const token = createToken(dataDir).token
    const { res, json } = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: {} }
    }, { token })

    expect(res.status).toBe(400)
    expect(json.error.code).toBe(-32020)
  })

  test('unsupported protocol version returns header validation error', async () => {
    const token = createToken(dataDir).token
    const { res, json } = await postRpc(baseUrl, rpcBody('tools/list', {
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2025-03-26' }
    }), {
      token,
      headers: { 'MCP-Protocol-Version': '2025-03-26' }
    })

    expect(res.status).toBe(400)
    expect(json.error.code).toBe(-32020)
    expect(json.error.data).toMatchObject({
      expected: PROTOCOL_VERSION,
      received: '2025-03-26'
    })
  })

  test('mismatched Mcp-Method returns header validation error', async () => {
    const token = createToken(dataDir).token
    const { res, json } = await postRpc(baseUrl, rpcBody('tools/list'), {
      token,
      headers: { 'Mcp-Method': 'tools/call' }
    })

    expect(res.status).toBe(400)
    expect(json.error.code).toBe(-32020)
  })

  test('missing or mismatched Mcp-Name for tools/call returns header validation error', async () => {
    const token = createToken(dataDir).token
    const body = rpcBody('tools/call', { name: 'list_routines', arguments: {} })
    const missing = await postRpc(baseUrl, body, {
      token,
      headers: { 'Mcp-Name': '' }
    })
    const mismatched = await postRpc(baseUrl, body, {
      token,
      headers: { 'Mcp-Name': 'get_workout' }
    })

    expect(missing.res.status).toBe(400)
    expect(missing.json.error.code).toBe(-32020)
    expect(mismatched.res.status).toBe(400)
    expect(mismatched.json.error.code).toBe(-32020)
  })

  test('unknown JSON-RPC method returns method-not-found', async () => {
    const token = createToken(dataDir).token
    const { res, json } = await postRpc(baseUrl, rpcBody('missing/method'), { token })

    expect(res.status).toBe(404)
    expect(json.error.code).toBe(-32601)
  })

  test('tools/list returns registered tools with cache metadata', async () => {
    const token = createToken(dataDir).token
    const { res, json } = await postRpc(baseUrl, rpcBody('tools/list'), { token })

    expect(res.status).toBe(200)
    expect(json.result.tools.some(tool => tool.name === 'list_routines')).toBe(true)
    expect(json.result.resultType).toBe('tools')
    expect(json.result.cacheScope).toBe('server')
    expect(typeof json.result.ttlMs).toBe('number')
  })

  test('valid state:read token can call a read tool', async () => {
    writeState(dataDir, 'user-a', {
      routines: [{ id: 'a-routine', name: 'A Routine', ex: [] }]
    })
    const token = createToken(dataDir, { uid: 'user-a', scopes: ['state:read'] }).token

    const { res, json } = await postRpc(baseUrl, rpcBody('tools/call', {
      name: 'list_routines',
      arguments: {}
    }), { token })

    expect(res.status).toBe(200)
    expect(json.result.content[0].type).toBe('text')
    expect(JSON.parse(json.result.content[0].text).routines.map(r => r.id)).toEqual(['a-routine'])
  })

  test('token without state:read cannot call read tools', async () => {
    const token = createToken(dataDir, { scopes: ['schedule:write'] }).token
    const { res, json } = await postRpc(baseUrl, rpcBody('tools/call', {
      name: 'list_routines',
      arguments: {}
    }), { token })

    expect(res.status).toBe(403)
    expect(json.error.data.code).toBe('TOKEN_FORBIDDEN')
  })

  test('valid write token can dry-run override_day', async () => {
    writeState(dataDir, 'user-a')
    const token = createToken(dataDir, { uid: 'user-a', scopes: ['schedule:write'] }).token
    const { res, json } = await postRpc(baseUrl, rpcBody('tools/call', {
      name: 'override_day',
      arguments: {
        date: '2026-08-31',
        routine_id: 'push',
        expected_revision: 7,
        dry_run: true
      }
    }), { token })

    expect(res.status).toBe(200)
    expect(JSON.parse(json.result.content[0].text)).toMatchObject({
      ok: true,
      dry_run: true,
      would_change: true
    })
  })

  test('invalid tool arguments return invalid params without writing', async () => {
    writeState(dataDir, 'user-a')
    const token = createToken(dataDir, { uid: 'user-a', scopes: ['schedule:write'] }).token
    const { res, json } = await postRpc(baseUrl, rpcBody('tools/call', {
      name: 'override_day',
      arguments: {
        date: '2026-08-31',
        routine_id: 'push',
        dry_run: false
      }
    }), { token })

    expect(res.status).toBe(400)
    expect(json.error.code).toBe(-32602)
    expect(json.error.data.code).toBe('MCP_INVALID_PARAMS')
    expect(readState(dataDir, 'user-a').dayPlan['2026-08-31']).toBe('rest')
    expect(readAuditEvents(dataDir)).toEqual([])
  })

  test('token without write scope cannot call write tools', async () => {
    const token = createToken(dataDir, { scopes: ['state:read'] }).token
    const { res, json } = await postRpc(baseUrl, rpcBody('tools/call', {
      name: 'override_day',
      arguments: {
        date: '2026-08-31',
        routine_id: 'push',
        expected_revision: 7,
        dry_run: true
      }
    }), { token })

    expect(res.status).toBe(403)
    expect(json.error.data.required_scope).toBe('schedule:write')
  })

  test('read calls are isolated to the bearer token uid', async () => {
    writeState(dataDir, 'user-a', {
      routines: [{ id: 'a-routine', name: 'A Routine', ex: [] }]
    })
    writeState(dataDir, 'user-b', {
      routines: [{ id: 'b-routine', name: 'B Routine', ex: [] }]
    })
    const prevUid = process.env.OPENGYM_UID
    try {
      process.env.OPENGYM_UID = 'user-b'
      const token = createToken(dataDir, { uid: 'user-a', scopes: ['state:read'] }).token
      const { json } = await postRpc(baseUrl, rpcBody('tools/call', {
        name: 'list_routines',
        arguments: {}
      }), { token })

      expect(JSON.parse(json.result.content[0].text).routines.map(r => r.id)).toEqual(['a-routine'])
    } finally {
      if (prevUid === undefined) delete process.env.OPENGYM_UID
      else process.env.OPENGYM_UID = prevUid
    }
  })

  test('write calls use bearer token uid and audit token id', async () => {
    writeState(dataDir, 'user-a')
    writeState(dataDir, 'user-b', {
      dayPlan: { '2026-08-31': 'rest', untouched: 'b' }
    })
    const prevUid = process.env.OPENGYM_UID
    try {
      process.env.OPENGYM_UID = 'user-b'
      const created = createToken(dataDir, { uid: 'user-a', scopes: ['schedule:write'] })
      const { res } = await postRpc(baseUrl, rpcBody('tools/call', {
        name: 'override_day',
        arguments: {
          date: '2026-08-31',
          routine_id: 'push',
          expected_revision: 7,
          dry_run: false
        }
      }), { token: created.token })

      expect(res.status).toBe(200)
      expect(readState(dataDir, 'user-a').dayPlan['2026-08-31']).toBe('push')
      expect(readState(dataDir, 'user-b').dayPlan).toEqual({ '2026-08-31': 'rest', untouched: 'b' })
      expect(readAuditEvents(dataDir)[0]).toMatchObject({
        uid: 'user-a',
        token_id: created.record.id
      })
    } finally {
      if (prevUid === undefined) delete process.env.OPENGYM_UID
      else process.env.OPENGYM_UID = prevUid
    }
  })

  test('rate limits failed auth and authenticated token requests', async () => {
    await close(server)
    server = createHttpMcpServer({
      dataDir,
      rateLimits: {
        authFail: { limit: 1, windowMs: 60000 },
        token: { limit: 1, windowMs: 60000 },
        read: { limit: 10, windowMs: 60000 },
        write: { limit: 10, windowMs: 60000 }
      }
    })
    baseUrl = await listen(server)
    const body = rpcBody('tools/list')

    expect((await postRpc(baseUrl, body)).res.status).toBe(401)
    const failedLimited = await postRpc(baseUrl, body)
    expect(failedLimited.res.status).toBe(429)
    expect(failedLimited.res.headers.get('retry-after')).toBeTruthy()

    const token = createToken(dataDir).token
    expect((await postRpc(baseUrl, body, { token })).res.status).toBe(200)
    const tokenLimited = await postRpc(baseUrl, body, { token })
    expect(tokenLimited.res.status).toBe(429)
    expect(tokenLimited.res.headers.get('retry-after')).toBeTruthy()
  })

  test('failed-auth limiter ignores spoofed X-Forwarded-For by default', async () => {
    await close(server)
    server = createHttpMcpServer({
      dataDir,
      rateLimits: {
        authFail: { limit: 1, windowMs: 60000 },
        token: { limit: 10, windowMs: 60000 },
        read: { limit: 10, windowMs: 60000 },
        write: { limit: 10, windowMs: 60000 }
      }
    })
    baseUrl = await listen(server)
    const body = rpcBody('tools/list')

    expect((await postRpc(baseUrl, body, {
      headers: { 'x-forwarded-for': '203.0.113.1' }
    })).res.status).toBe(401)
    const limited = await postRpc(baseUrl, body, {
      headers: { 'x-forwarded-for': '203.0.113.2' }
    })
    expect(limited.res.status).toBe(429)
  })

  test('oversized bodies return a JSON-RPC body limit error', async () => {
    await close(server)
    server = createHttpMcpServer({ dataDir, bodyLimitBytes: 8 })
    baseUrl = await listen(server)

    const { res, json } = await postRaw(baseUrl, JSON.stringify(rpcBody('tools/list')))

    expect(res.status).toBe(413)
    expect(json.error.data.code).toBe('MCP_BODY_TOO_LARGE')
  })

  test('malformed JSON returns a generic message without echoing body text', async () => {
    const { res, json } = await postRaw(baseUrl, '{ "secret": "SECRETFRAGMENT",')

    expect(res.status).toBe(400)
    expect(json.error.message).toBe('Invalid JSON.')
    expect(JSON.stringify(json)).not.toContain('SECRETFRAGMENT')
  })
})
