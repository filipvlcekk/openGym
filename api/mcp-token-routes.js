function requireUser(req, res, { readSession, json }) {
  const user = readSession(req);
  if (!user) {
    json(res, 401, { error: 'not signed in' });
    return null;
  }
  return user;
}

function validationErrorMessage(e) {
  const message = e?.message || '';
  if (message === 'uid required') return message;
  if (message.startsWith('invalid token scope: ')) return message;
  return null;
}

export function createMcpTokenRoutes({ tokens, readSession, readBody, json }) {
  const deps = { readSession, json };

  return {
    'POST /api/mcp/tokens': async (req, res) => {
      const user = requireUser(req, res, deps);
      if (!user) return;
      const body = await readBody(req);
      const scopes = Array.isArray(body.scopes) ? body.scopes : [];
      if (!scopes.length) return json(res, 400, { error: 'at least one scope required' });
      try {
        const created = tokens.createToken({ uid: user.id, name: body.name, scopes });
        json(res, 200, created);
      } catch (e) {
        const message = validationErrorMessage(e);
        if (message) return json(res, 400, { error: message });
        throw e;
      }
    },

    'GET /api/mcp/tokens': async (req, res) => {
      const user = requireUser(req, res, deps);
      if (!user) return;
      json(res, 200, { tokens: tokens.listTokens(user.id) });
    },

    'POST /api/mcp/tokens/revoke': async (req, res) => {
      const user = requireUser(req, res, deps);
      if (!user) return;
      const body = await readBody(req);
      const id = String(body.id || '').trim();
      if (!id) return json(res, 400, { error: 'token id required' });
      const result = tokens.revokeToken(id, user.id);
      if (!result.ok && result.error?.code === 'TOKEN_NOT_FOUND') return json(res, 404, { error: 'token not found' });
      json(res, 200, result);
    }
  };
}
