import { createTokenService } from '../../api/token-service.js';

export function verifyMcpWriteToken(options = {}) {
  const dataDir = options.dataDir ?? process.env.OPENGYM_DATA;
  const token = options.token ?? process.env.OPENGYM_MCP_TOKEN;

  if (!dataDir) {
    return {
      ok: false,
      error: {
        code: 'MCP_DATA_REQUIRED',
        message: 'OPENGYM_DATA is required for MCP write auth.'
      }
    };
  }
  if (!token) {
    return {
      ok: false,
      error: {
        code: 'MCP_TOKEN_REQUIRED',
        message: 'OPENGYM_MCP_TOKEN is required for write tools.'
      }
    };
  }

  return createTokenService({ dataDir }).verifyToken(token, { requiredScope: options.requiredScope });
}
