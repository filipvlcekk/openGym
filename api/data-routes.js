export function createDataRoutes({ states, readSession, readBody, json }) {
  return {
    'GET /api/data': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      json(res, 200, { state: states.readUserState(user.id) });
    },

    'PUT /api/data': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req);
      if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
      if (body.expected_revision === undefined) {
        return json(res, 428, {
          ok: false,
          error: { code: 'STATE_REVISION_REQUIRED', message: 'expected_revision required. Reload the app before saving.' }
        });
      }
      if (!Number.isInteger(body.expected_revision) || body.expected_revision < 0) {
        return json(res, 400, {
          ok: false,
          error: { code: 'STATE_REVISION_INVALID', message: 'expected_revision must be a non-negative integer.' }
        });
      }
      if (body.expected_uid !== undefined && body.expected_uid !== user.id) {
        return json(res, 409, {
          ok: false,
          error: { code: 'STATE_OWNER_MISMATCH', message: 'The signed-in profile changed. Reload before saving this draft.' }
        });
      }
      const result = states.replaceUserState(user.id, body.state, {
        expectedRevision: body.expected_revision,
        actor: `web-session:${user.id}`,
        details: { source: 'PUT /api/data' }
      }); // in-progress workouts stay device-local
      const status = result.ok ? 200 : {
        STATE_CONFLICT: 409,
        STATE_LOCKED: 423,
        STATE_VALIDATION_FAILED: 422
      }[result.error?.code] || 500;
      json(res, status, result);
    }
  };
}
