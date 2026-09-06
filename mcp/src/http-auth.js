import { createTokenService } from '../../api/token-service.js'

export function parseBearerToken(header) {
  const match = String(header || '').match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

export function authError(status, code, message, extra = {}) {
  return { ok: false, status, error: { code, message, ...extra } }
}

export function authenticateHttpRequest(headers, options = {}) {
  const dataDir = options.dataDir ?? process.env.OPENGYM_DATA
  if (!dataDir) return authError(500, 'MCP_DATA_REQUIRED', 'OPENGYM_DATA is required.')

  const rawToken = parseBearerToken(headers.authorization || headers.Authorization)
  if (!rawToken) return authError(401, 'MCP_AUTH_REQUIRED', 'Authorization: Bearer token is required.')

  const verified = createTokenService({ dataDir }).verifyToken(rawToken)
  if (!verified.ok) {
    const status = verified.error.code === 'TOKEN_FORBIDDEN' ? 403 : 401
    return authError(status, verified.error.code, verified.error.message)
  }

  return {
    ok: true,
    context: {
      transport: 'http',
      dataDir,
      auth: { verified: true },
      token: verified.token
    }
  }
}
