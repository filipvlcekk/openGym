#!/usr/bin/env node
import http from 'node:http'

import { authenticateHttpRequest } from './http-auth.js'
import { createFixedWindowLimiter } from './rate-limit.js'
import { isReadTool, requiredScopeForTool } from './tool-scopes.js'
import { TOOLS } from './tools.js'

export const MCP_PROTOCOL_VERSION = '2026-07-28'
const HEADER_ERROR = -32020
const METHOD_NOT_FOUND = -32601
const INVALID_REQUEST = -32600
const INTERNAL_ERROR = -32603

function jsonRpcError(id, code, message, data = {}) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } }
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(JSON.stringify(body))
}

function sendRpcError(res, status, id, code, message, data = {}, headers = {}) {
  sendJson(res, status, jsonRpcError(id, code, message, data), headers)
}

function listFromEnv(name) {
  return String(process.env[name] || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
}

function parsePositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function rateConfig(options, key, envName, fallback) {
  const configured = options.rateLimits?.[key] || {}
  return {
    limit: parsePositiveInt(configured.limit ?? process.env[envName], fallback),
    windowMs: parsePositiveInt(configured.windowMs, 60000)
  }
}

function createLimiters(options) {
  return {
    authFail: createFixedWindowLimiter(rateConfig(options, 'authFail', 'MCP_RATE_AUTH_FAIL_PER_MIN', 10)),
    token: createFixedWindowLimiter(rateConfig(options, 'token', 'MCP_RATE_TOKEN_PER_MIN', 120)),
    read: createFixedWindowLimiter(rateConfig(options, 'read', 'MCP_RATE_READ_PER_MIN', 60)),
    write: createFixedWindowLimiter(rateConfig(options, 'write', 'MCP_RATE_WRITE_PER_MIN', 20))
  }
}

function allowedOrigins(options) {
  if (Array.isArray(options.allowedOrigins)) return options.allowedOrigins
  if (typeof options.allowedOrigins === 'string') {
    return options.allowedOrigins.split(',').map(x => x.trim()).filter(Boolean)
  }
  return listFromEnv('MCP_ALLOWED_ORIGINS')
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return forwarded || req.socket.remoteAddress || 'unknown'
}

function validateOrigin(req, options) {
  const origin = req.headers.origin
  if (!origin) return null
  const allowed = allowedOrigins(options)
  if (!allowed.length || allowed.includes(origin)) return null
  return { status: 403, code: 'MCP_ORIGIN_FORBIDDEN', message: 'Origin is not allowed.' }
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let total = 0
    const chunks = []
    req.on('data', chunk => {
      total += chunk.length
      if (total > limitBytes) {
        reject(Object.assign(new Error('Request body too large.'), { status: 413, code: 'MCP_BODY_TOO_LARGE' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function header(req, name) {
  return req.headers[name.toLowerCase()]
}

function protocolError(id, message, extra = {}) {
  return {
    status: 400,
    body: jsonRpcError(id, HEADER_ERROR, message, { code: 'MCP_HEADER_MISMATCH', ...extra })
  }
}

function validateProtocol(req, body) {
  const id = body?.id ?? null
  const headerVersion = header(req, 'MCP-Protocol-Version')
  if (!headerVersion) return protocolError(id, 'MCP-Protocol-Version header is required.')
  if (headerVersion !== MCP_PROTOCOL_VERSION) {
    return protocolError(id, 'Unsupported MCP protocol version.', {
      expected: MCP_PROTOCOL_VERSION,
      received: headerVersion
    })
  }
  const meta = body?.params?._meta
  if (!meta || typeof meta !== 'object') return protocolError(id, 'params._meta is required.')
  const metaVersion = meta['io.modelcontextprotocol/protocolVersion']
  if (!metaVersion) return protocolError(id, 'params._meta protocolVersion is required.')
  if (metaVersion !== headerVersion) {
    return protocolError(id, 'MCP protocol header and metadata versions must match.', {
      header: headerVersion,
      meta: metaVersion
    })
  }
  const methodHeader = header(req, 'Mcp-Method')
  if (!methodHeader) return protocolError(id, 'Mcp-Method header is required.')
  if (methodHeader !== body?.method) {
    return protocolError(id, 'Mcp-Method must match JSON-RPC method.', {
      header: methodHeader,
      method: body?.method
    })
  }
  if (body?.method === 'tools/call') {
    const nameHeader = header(req, 'Mcp-Name')
    const toolName = body?.params?.name
    if (!nameHeader || nameHeader !== toolName) {
      return protocolError(id, 'Mcp-Name must match tools/call params.name.', {
        header: nameHeader || null,
        name: toolName || null
      })
    }
  }
  return null
}

function authFailureRateLimit(req, limiters) {
  return limiters.authFail.check(`auth-fail:${clientIp(req)}`)
}

function tokenRateLimit(context, limiters) {
  return limiters.token.check(`token:${context.token.id}`)
}

function operationRateLimit(scope, context, limiters) {
  if (scope === 'state:read') return limiters.read.check(`read:${context.token.id}`)
  return limiters.write.check(`write:${context.token.id}`)
}

function rateLimited(res, id, result) {
  sendRpcError(res, 429, id, -32029, 'Rate limit exceeded.', {
    code: 'MCP_RATE_LIMITED',
    retryAfter: result.retryAfter
  }, { 'retry-after': String(result.retryAfter) })
}

function inputSchemaForTool(tool) {
  const properties = Object.fromEntries(Object.keys(tool.schema || {}).map(name => [name, {}]))
  return {
    type: 'object',
    properties,
    additionalProperties: false
  }
}

function toolsListResult() {
  return {
    resultType: 'tools',
    cacheScope: 'server',
    ttlMs: 60000,
    tools: TOOLS.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: inputSchemaForTool(tool)
    }))
  }
}

function toolResult(result) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  }
}

function verifyScope(toolName, context) {
  const requiredScope = requiredScopeForTool(toolName)
  if (!requiredScope) {
    return {
      ok: false,
      status: 404,
      code: 'MCP_TOOL_NOT_FOUND',
      message: 'Unknown MCP tool.'
    }
  }
  if (!Array.isArray(context.token.scopes) || !context.token.scopes.includes(requiredScope)) {
    return {
      ok: false,
      status: 403,
      code: 'TOKEN_FORBIDDEN',
      message: 'Token missing required scope.',
      required_scope: requiredScope
    }
  }
  return { ok: true, requiredScope }
}

async function handleRpc(req, res, body, context, limiters) {
  const id = body?.id ?? null
  const tokenLimit = tokenRateLimit(context, limiters)
  if (!tokenLimit.ok) return rateLimited(res, id, tokenLimit)

  if (body.method === 'tools/list') {
    return sendJson(res, 200, jsonRpcResult(id, toolsListResult()))
  }
  if (body.method !== 'tools/call') {
    return sendRpcError(res, 404, id, METHOD_NOT_FOUND, 'Method not found.', {
      code: 'MCP_METHOD_NOT_FOUND',
      method: body.method
    })
  }

  const toolName = body.params?.name
  const scoped = verifyScope(toolName, context)
  if (!scoped.ok) {
    return sendRpcError(res, scoped.status, id, -32001, scoped.message, {
      code: scoped.code,
      required_scope: scoped.required_scope || null
    })
  }
  const opLimit = operationRateLimit(scoped.requiredScope, context, limiters)
  if (!opLimit.ok) return rateLimited(res, id, opLimit)

  const tool = TOOLS.find(t => t.name === toolName)
  try {
    const result = tool.handler(body.params?.arguments || {}, context)
    return sendJson(res, 200, jsonRpcResult(id, toolResult(result)))
  } catch (err) {
    const code = err.code || 'ERROR'
    return sendJson(res, 200, jsonRpcResult(id, {
      isError: true,
      content: [{ type: 'text', text: `${code}: ${err.message}` }]
    }))
  }
}

export function createHttpMcpServer(options = {}) {
  const limiters = createLimiters(options)
  const dataDir = options.dataDir ?? process.env.OPENGYM_DATA
  const limitBytes = parsePositiveInt(options.bodyLimitBytes ?? process.env.MCP_HTTP_BODY_LIMIT_BYTES, 1024 * 1024)

  return http.createServer(async (req, res) => {
    if (req.url === '/healthz' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true })
    }
    if (req.url !== '/mcp') {
      return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } })
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      return res.end()
    }

    const originError = validateOrigin(req, options)
    if (originError) {
      return sendRpcError(res, originError.status, null, -32001, originError.message, {
        code: originError.code
      })
    }

    let body
    try {
      body = JSON.parse(await readBody(req, limitBytes) || '{}')
    } catch (err) {
      const status = err.status || 400
      return sendRpcError(res, status, null, INVALID_REQUEST, err.message || 'Invalid JSON.', {
        code: err.code || 'MCP_INVALID_JSON'
      })
    }

    const protocolFailure = validateProtocol(req, body)
    if (protocolFailure) {
      return sendJson(res, protocolFailure.status, protocolFailure.body)
    }

    const auth = authenticateHttpRequest(req.headers, { dataDir })
    if (!auth.ok) {
      const failedLimit = authFailureRateLimit(req, limiters)
      if (!failedLimit.ok) return rateLimited(res, body.id, failedLimit)
      return sendRpcError(res, auth.status, body.id, -32001, auth.error.message, auth.error)
    }

    try {
      return await handleRpc(req, res, body, auth.context, limiters)
    } catch (err) {
      return sendRpcError(res, 500, body.id, INTERNAL_ERROR, 'Internal MCP server error.', {
        code: 'MCP_INTERNAL_ERROR'
      })
    }
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const host = process.env.MCP_HTTP_HOST || '127.0.0.1'
  const port = parsePositiveInt(process.env.MCP_HTTP_PORT, 3010)
  const server = createHttpMcpServer()
  server.listen(port, host, () => {
    console.error(`[opengym-mcp-http] listening on http://${host}:${port}/mcp`)
  })
}
