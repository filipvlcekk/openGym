import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createTokenService } from '../../api/token-service.js'
import { createHttpMcpServer } from '../src/http.js'

const PROTOCOL_VERSION = '2025-11-25'

describe('standard Streamable HTTP MCP', () => {
  let dataDir
  let server
  let url
  let clients

  async function start(options = {}) {
    if (server?.listening) await new Promise(resolve => server.close(resolve))
    server = createHttpMcpServer({ dataDir, allowedOrigins: ['https://client.example'], ...options })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    url = new URL(`http://127.0.0.1:${server.address().port}/mcp`)
  }

  function token(uid = 'user-a', scopes = ['state:read']) {
    return createTokenService({ dataDir }).createToken({ uid, name: uid, scopes })
  }

  function state(uid) {
    return JSON.parse(fs.readFileSync(path.join(dataDir, `state-${uid}.json`), 'utf8'))
  }

  async function post(body, bearer, headers = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...headers
      },
      body: JSON.stringify(body)
    })
    return { res, json: res.status === 202 ? null : await res.json() }
  }

  function request(method, params = {}) {
    return { jsonrpc: '2.0', id: 1, method, params }
  }

  async function connect(bearer) {
    const client = new Client({ name: 'opengym-test', version: '1.0.0' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } }
    }))
    return client
  }

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-mcp-streamable-'))
    clients = []
    for (const uid of ['user-a', 'user-b']) {
      fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), JSON.stringify({
        _revision: 7,
        unit: 'kg',
        routines: [{ id: `${uid}-routine`, name: `${uid} routine`, ex: [] }],
        week: {},
        dayPlan: { '2026-08-31': 'rest' },
        workouts: [],
        bodyweight: []
      }))
    }
    await start()
  })

  afterEach(async () => {
    await Promise.all(clients.map(client => client.close()))
    if (server.listening) await new Promise(resolve => server.close(resolve))
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  test.each(['2025-03-26', '2025-06-18', '2025-11-25'])(
    'initializes %s without custom headers or a protocol version header', async protocolVersion => {
      const { res, json } = await post(request('initialize', {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: 'codex', version: '1.0.0' }
      }), token().token, { origin: 'https://client.example' })

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(res.headers.get('mcp-session-id')).toBeNull()
      expect(res.headers.get('access-control-allow-origin')).toBe('https://client.example')
      expect(json.result).toMatchObject({
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'opengym' }
      })
    }
  )

  test('accepts the initialized notification with an empty 202 response', async () => {
    const { res, json } = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, token().token, {
      'MCP-Protocol-Version': PROTOCOL_VERSION
    })

    expect(res.status).toBe(202)
    expect(json).toBeNull()
  })

  test('SDK clients list typed tools and read only their own bearer user', async () => {
    const [a, b] = await Promise.all([connect(token('user-a').token), connect(token('user-b').token)])
    const listed = await a.listTools()
    const getRoutine = listed.tools.find(tool => tool.name === 'get_routine')

    expect(getRoutine.inputSchema).toMatchObject({
      type: 'object',
      properties: { routine_id: { type: 'string', minLength: 1 } },
      required: ['routine_id'],
      additionalProperties: false
    })
    const [readA, readB] = await Promise.all([
      a.callTool({ name: 'list_routines', arguments: {} }),
      b.callTool({ name: 'list_routines', arguments: {} })
    ])
    expect(JSON.parse(readA.content[0].text).routines.map(r => r.id)).toEqual(['user-a-routine'])
    expect(JSON.parse(readB.content[0].text).routines.map(r => r.id)).toEqual(['user-b-routine'])
  })

  test('SDK write calls update only their bearer user and retain the token audit identity', async () => {
    const created = token('user-a', ['schedule:write'])
    const client = await connect(created.token)
    const result = await client.callTool({ name: 'override_day', arguments: {
      date: '2026-08-31', routine_id: 'user-a-routine', expected_revision: 7, dry_run: false
    } })

    expect(result.isError).not.toBe(true)
    expect(state('user-a').dayPlan['2026-08-31']).toBe('user-a-routine')
    expect(state('user-b').dayPlan['2026-08-31']).toBe('rest')
    const event = JSON.parse(fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim())
    expect(event).toMatchObject({ uid: 'user-a', token_id: created.record.id })
  })

  test.each([
    [['schedule:write'], 'list_routines', {}, 'state:read'],
    [['state:read'], 'override_day', {
      date: '2026-08-31', routine_id: 'user-a-routine', expected_revision: 7, dry_run: false
    }, 'schedule:write']
  ])('SDK calls enforce the required scope before invoking %s %s', async (scopes, name, args, requiredScope) => {
    const client = await connect(token('user-a', scopes).token)

    await expect(client.callTool({ name, arguments: args })).rejects.toMatchObject({ code: 403 })
    const denied = await post(request('tools/call', { name, arguments: args }), token('user-b', scopes).token)
    expect(denied.json.error.data).toMatchObject({ code: 'TOKEN_FORBIDDEN', required_scope: requiredScope })
    expect(state('user-a').dayPlan['2026-08-31']).toBe('rest')
    expect(fs.existsSync(path.join(dataDir, 'audit.log'))).toBe(false)
  })

  test('rechecks revoked bearer tokens after SDK initialization', async () => {
    const created = token()
    const client = await connect(created.token)
    createTokenService({ dataDir }).revokeToken(created.record.id, 'user-a')

    await expect(client.callTool({ name: 'list_routines', arguments: {} })).rejects.toMatchObject({ code: 401 })
    const denied = await post(request('tools/list'), created.token)
    expect(denied.json.error.data.code).toBe('TOKEN_REVOKED')
  })

  test('rejects unknown tool arguments without writing or auditing', async () => {
    const client = await connect(token('user-a', ['schedule:write']).token)
    const result = await client.callTool({ name: 'override_day', arguments: {
      date: '2026-08-31', routine_id: 'user-a-routine', expected_revision: 7, dry_run: false, extra: true
    } })

    expect(result.isError).toBe(true)
    expect(state('user-a').dayPlan['2026-08-31']).toBe('rest')
    expect(fs.existsSync(path.join(dataDir, 'audit.log'))).toBe(false)
  })

  test('standard requests require auth and rate limit failed authentication', async () => {
    await start({ rateLimits: { authFail: { limit: 1 } } })
    const missing = await post(request('tools/list'))
    expect(missing.res.status).toBe(401)
    expect(missing.json.error.data.code).toBe('MCP_AUTH_REQUIRED')
    const limited = await post(request('tools/list'))
    expect(limited.res.status).toBe(429)
    expect(limited.res.headers.get('retry-after')).toBeTruthy()
  })

  test('standard requests retain the per-token request limit', async () => {
    await start({ rateLimits: { token: { limit: 1 } } })
    const bearer = token().token
    expect((await post(request('tools/list'), bearer)).res.status).toBe(200)
    const limited = await post(request('tools/list'), bearer)
    expect(limited.res.status).toBe(429)
    expect(limited.json.error.data.code).toBe('MCP_RATE_LIMITED')
    expect(limited.res.headers.get('retry-after')).toBeTruthy()
  })

  test('standard tool calls retain separate read and write operation limits', async () => {
    await start({ rateLimits: { read: { limit: 1 }, write: { limit: 1 } } })
    const bearer = token('user-a', ['state:read', 'schedule:write']).token
    const read = request('tools/call', { name: 'list_routines', arguments: {} })
    const write = request('tools/call', { name: 'override_day', arguments: {
      date: '2026-08-31', routine_id: 'user-a-routine', expected_revision: 7, dry_run: true
    } })

    expect((await post(read, bearer)).res.status).toBe(200)
    expect((await post(read, bearer)).res.status).toBe(429)
    expect((await post(write, bearer)).res.status).toBe(200)
    expect((await post(write, bearer)).res.status).toBe(429)
    expect(state('user-a').dayPlan['2026-08-31']).toBe('rest')
  })

  test('standard requests retain origin validation', async () => {
    const { res, json } = await post(request('tools/list'), token().token, { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(json.error.data.code).toBe('MCP_ORIGIN_FORBIDDEN')
  })

  test('standard requests retain the bounded body reader', async () => {
    await start({ bodyLimitBytes: 8 })
    const { res, json } = await post(request('tools/list'), token().token)
    expect(res.status).toBe(413)
    expect(res.headers.get('connection')).toBe('close')
    expect(json.error.data.code).toBe('MCP_BODY_TOO_LARGE')
  })

  test.each([
    { body: [request('tools/list')] },
    { body: { jsonrpc: '1.0', id: 1, method: 'tools/list' } },
    { body: { jsonrpc: '2.0', id: {}, method: 'tools/list' } },
    { body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: false } }
  ])('rejects batches and malformed envelopes before SDK dispatch: $body', async ({ body }) => {
    const { res, json } = await post(body, token().token)
    expect(res.status).toBe(400)
    expect(json.error.data.code).toBe('MCP_INVALID_REQUEST')
  })
})
