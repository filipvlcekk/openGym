# Remote MCP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Remote MCP HTTP surface with scoped bearer auth, request-scoped user state, revocation, rate limiting and Docker Compose support.

**Architecture:** Keep the existing stdio MCP entrypoint working unchanged for local clients. Add a separate HTTP entrypoint and optional `mcp-http` container that uses the same tool registry but authenticates every request, binds reads/writes to the verified token uid, and expects public HTTPS termination at a reverse proxy. Target MCP Streamable HTTP 2026-07-28 semantics where the SDK supports them; resolve SDK specifics in the first chunk before committing to transport code.

**Tech Stack:** Node.js ESM, `@modelcontextprotocol/sdk`, `zod`, `vitest`, Node `http`/SDK transport or minimal adapter, existing API token/state services, Docker Compose.

---

## Source Spec

- `docs/superpowers/specs/2026-09-06-remote-mcp-design.md`

Key constraints:

- `mcp-http` is optional and off by default.
- HTTPS is handled by a reverse proxy outside Node.
- Remote reads require `state:read`.
- Remote writes require existing write scopes.
- Remote tool calls must use request-scoped token uid/state/auth, not process-wide `OPENGYM_UID` or `OPENGYM_MCP_TOKEN`.
- Do not implement a full OAuth authorization server in this milestone.

## File Structure

Planned create/modify set:

- Modify `api/token-service.js`: add `state:read` to `TOKEN_SCOPES`.
- Modify `api/test/token-service.test.js`: cover `state:read` token creation/verification.
- Modify `mcp/src/state.js`: add explicit `getStateForUid(uid, options)` and `getUserForUid(uid, options)` helpers while preserving current stdio global `getState()`/`getUser()`.
- Modify `mcp/src/write-auth.js`: allow explicit bearer token/dataDir paths and keep env fallback only for stdio.
- Modify `mcp/src/tools.js`: allow handlers to accept optional verified `context`; use context-aware state/auth/dataDir when present.
- Create `mcp/src/tool-scopes.js`: map tool names to read/write scope requirements.
- Create `mcp/src/http-auth.js`: parse `Authorization`, verify tokens, map auth failures to HTTP/JSON-RPC errors.
- Create `mcp/src/rate-limit.js`: simple in-memory token/IP buckets.
- Create `mcp/src/server.js`: shared MCP server/tool registration factory for stdio and HTTP if SDK path supports it.
- Modify `mcp/src/index.js`: use shared server factory while preserving stdio behavior.
- Create `mcp/src/http.js`: HTTP entrypoint for `/mcp` and `/healthz`.
- Create `mcp/test/http-auth.test.js`: auth/scope helper tests.
- Create `mcp/test/rate-limit.test.js`: limiter tests.
- Create `mcp/test/http.test.js`: HTTP transport contract tests.
- Modify `mcp/scripts/check-node-loadable.mjs`: include new HTTP modules.
- Modify `mcp/package.json` and `mcp/package-lock.json`: add/update dependencies/scripts discovered in SDK spike.
- Create `mcp/Dockerfile`: container for Remote MCP.
- Modify `docker-compose.yml`: add optional `mcp-http` service profile.
- Modify docs:
  - `docs/MCP_WRITE_ARCHITECTURE.md`
  - `docs/openGym_AI_Coach_MCP_dokumentace.md`
  - `mcp/README.md`
  - `.env.example` if present, otherwise document env vars in README/docs.

## Chunk 0: Planning Docs Cleanup

### Task 0: Clean Stale Roadmap Lines

**Files:**
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/superpowers/plans/2026-09-06-remote-mcp.md`

- [x] **Step 1: Locate stale Phase 2 recommendation text**

Run:

```bash
rg -n "future: deeper shared workout/set validation|deeper shared workout/set validation" docs/MCP_WRITE_ARCHITECTURE.md mcp/README.md docs/openGym_AI_Coach_MCP_dokumentace.md
```

Expected: only historical design/plan files should still mention the old future state. Active roadmap docs should not claim deeper workout/set validation is future work.

- [x] **Step 2: Update `docs/MCP_WRITE_ARCHITECTURE.md` implementation order**

Change the bottom recommendation list from the stale text:

```text
create_custom_exercise
log_freestyle_workout
future: deeper shared workout/set validation
```

to:

```text
create_custom_exercise
log_freestyle_workout
deeper shared workout/set validation
future: remote MCP over Streamable HTTP
```

If the implementation-order numbered list is missing `create_custom_exercise` or deeper workout/set validation, add them as done items.

- [x] **Step 3: Run docs diff check**

Run:

```bash
git diff --check
git diff -- docs/MCP_WRITE_ARCHITECTURE.md
```

Expected: no whitespace errors; diff only updates stale roadmap wording.

- [x] **Step 4: Commit docs cleanup**

```bash
git add docs/MCP_WRITE_ARCHITECTURE.md docs/superpowers/plans/2026-09-06-remote-mcp.md
git commit -m "docs: align mcp phase roadmap"
```

## Chunk 1: SDK And Protocol Spike

### Task 1: Determine HTTP Transport Strategy

**Files:**
- Modify: `mcp/package.json`
- Modify: `mcp/package-lock.json`
- Create: `mcp/scripts/check-mcp-http-sdk.mjs`
- Modify: `docs/superpowers/plans/2026-09-06-remote-mcp.md`

- [x] **Step 1: Inspect installed SDK exports**

Create `mcp/scripts/check-mcp-http-sdk.mjs`:

```js
const candidates = [
  '@modelcontextprotocol/sdk/server/streamableHttp.js',
  '@modelcontextprotocol/sdk/server/streamable-http.js',
  '@modelcontextprotocol/sdk/server/http.js',
  '@modelcontextprotocol/sdk/server/mcp.js'
];

for (const specifier of candidates) {
  try {
    const mod = await import(specifier);
    console.log(specifier, Object.keys(mod).sort().join(', '));
  } catch (error) {
    console.log(specifier, 'ERROR', error.code || error.message);
  }
}
```

- [x] **Step 2: Run SDK export check**

Run:

```bash
cd mcp && node scripts/check-mcp-http-sdk.mjs
```

Expected: identify whether the installed SDK exposes an HTTP/Streamable HTTP server transport.

- [x] **Step 3: Upgrade SDK if needed**

If no usable HTTP transport exists, update SDK intentionally:

```bash
cd mcp && npm install @modelcontextprotocol/sdk@latest
```

Then rerun:

```bash
cd mcp && node scripts/check-mcp-http-sdk.mjs
```

Expected: SDK exports are known and lockfile/package changes are explicit.

- [x] **Step 4: Decide transport path**

Document in this plan under this step:

```md
Decision: use SDK `<export-name>` for HTTP transport.
```

or:

```md
Decision: use a minimal in-project JSON-RPC adapter for `tools/list` and `tools/call` because SDK HTTP transport does not support the target 2026-07-28 shape cleanly.
```

Do not implement production HTTP yet.

Decision: the current lockfile installs `@modelcontextprotocol/sdk` with
`@modelcontextprotocol/sdk/server/streamableHttp.js` exporting
`StreamableHTTPServerTransport`, so no package upgrade is needed for discovery.
Use a minimal in-project JSON-RPC adapter first for `tools/list` and `tools/call`
because Phase 3 must enforce project-specific bearer auth, request-scoped
state/auth context, rate limits, mandatory 2026-07-28 headers and exact tests at
the HTTP boundary. Keep the SDK transport export documented for a later swap if
it cleanly supports per-request context and the same wire-level assertions.

- [x] **Step 5: Run current MCP verification**

Run:

```bash
cd mcp && npm test
cd mcp && npm run check:node-loadable
```

Expected: pass. If SDK upgrade breaks tests, fix dependency/import issues before continuing.

- [x] **Step 6: Commit SDK decision**

```bash
git add mcp/package.json mcp/package-lock.json mcp/scripts/check-mcp-http-sdk.mjs docs/superpowers/plans/2026-09-06-remote-mcp.md
git commit -m "chore: document remote mcp transport strategy"
```

## Chunk 2: Token Scope And Request-Scoped State

### Task 2: Add `state:read` Token Scope

**Files:**
- Modify: `api/token-service.js`
- Modify: `api/test/token-service.test.js`

- [x] **Step 1: Add failing token scope test**

Add a test proving `state:read` is accepted, following the existing `withTempTokenService()` helper style:

```js
test('createToken accepts remote MCP read scope', () => {
  withTempTokenService(tokens => {
    const created = tokens.createToken({
      uid: 'u1',
      name: 'Remote MCP',
      scopes: ['state:read']
    });

    assert.deepEqual(created.record.scopes, ['state:read']);
    assert.deepEqual(tokens.verifyToken(created.token, { requiredScope: 'state:read' }), {
      ok: true,
      token: {
        id: created.record.id,
        uid: 'u1',
        name: 'Remote MCP',
        scopes: ['state:read']
      }
    });
  });
});
```

Use the local test style if adding to an existing test file.

- [x] **Step 2: Run API tests to verify RED**

Run:

```bash
cd api && npm test
```

Expected: fails with `invalid token scope: state:read`.

- [x] **Step 3: Add scope**

In `api/token-service.js`, add:

```js
'state:read',
```

to `TOKEN_SCOPES`.

- [x] **Step 4: Run API tests**

Run:

```bash
cd api && npm test
```

Expected: pass.

- [x] **Step 5: Commit scope**

```bash
git add api/token-service.js api/test/token-service.test.js
git commit -m "feat: add remote mcp read scope"
```

### Task 3: Add Request-Scoped State Helpers

**Files:**
- Modify: `mcp/src/state.js`
- Create: `mcp/test/state-context.test.js`

- [x] **Step 1: Add failing multi-user state tests**

Create `mcp/test/state-context.test.js` with fixtures:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { getStateForUid, getUserForUid } from '../src/state.js';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-mcp-state-context-'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

describe('request-scoped state helpers', () => {
  test('reads state for the explicit uid instead of OPENGYM_UID', () => {
    const dataDir = tempDataDir();
    const prev = process.env.OPENGYM_UID;
    try {
      process.env.OPENGYM_UID = 'user-b';
      writeJson(path.join(dataDir, 'db.json'), {
        users: [
          { id: 'user-a', name: 'A', created: '2026-09-06T00:00:00.000Z' },
          { id: 'user-b', name: 'B', created: '2026-09-06T00:00:00.000Z' }
        ],
        creds: [],
        subs: [],
        invites: []
      });
      writeJson(path.join(dataDir, 'state-user-a.json'), { unit: 'kg', marker: 'A' });
      writeJson(path.join(dataDir, 'state-user-b.json'), { unit: 'lb', marker: 'B' });

      expect(getStateForUid('user-a', { dataDir }).marker).toBe('A');
      expect(getUserForUid('user-a', { dataDir }).name).toBe('A');
    } finally {
      if (prev === undefined) delete process.env.OPENGYM_UID;
      else process.env.OPENGYM_UID = prev;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
```

- [x] **Step 2: Run test to verify RED**

Run:

```bash
cd mcp && npm test -- state-context.test.js
```

Expected: fails because `getStateForUid`/`getUserForUid` are not exported.

- [x] **Step 3: Implement explicit state helpers**

In `mcp/src/state.js`, add helpers that:

- accept `{ dataDir = DATA_DIR }`;
- sanitize uid with the same filename-safe rules;
- read `state-<uid>.json`;
- merge `defaultsShape()` into loaded state;
- read `db.json` only for `getUserForUid`;
- return `null` for missing state file;
- never mutate `_uid`, `_state`, `_db` or `_loadedMtime`.

Implementation shape:

```js
function safeUid(uid) {
  const value = String(uid || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`uid contains characters that aren't safe in a filename: ${JSON.stringify(value)}`);
  }
  return value;
}

function stateFileIn(dataDir, uid) {
  return path.join(dataDir, 'state-' + safeUid(uid) + '.json');
}

export function getStateForUid(uid, options = {}) {
  const dir = options.dataDir || DATA_DIR;
  const state = readJsonOrNull(stateFileIn(dir, uid));
  return state ? Object.assign({}, defaultsShape(), state) : null;
}

export function getUserForUid(uid, options = {}) {
  const dir = options.dataDir || DATA_DIR;
  const db = readJsonOrNull(path.join(dir, 'db.json')) || { users: [] };
  const id = safeUid(uid);
  const user = db.users.find(u => u.id === id) || { id, name: 'Profile', created: null };
  return { id: user.id, name: user.name, created: user.created || null };
}
```

Deduplicate with existing `stateFile(uid)` carefully if it stays readable.

- [x] **Step 4: Run MCP tests**

Run:

```bash
cd mcp && npm test -- state-context.test.js
cd mcp && npm test
```

Expected: pass.

- [x] **Step 5: Commit state helpers**

```bash
git add mcp/src/state.js mcp/test/state-context.test.js
git commit -m "feat: add request scoped mcp state helpers"
```

## Chunk 3: Tool Context And Scope Mapping

### Task 4: Add Tool Scope Mapping

**Files:**
- Create: `mcp/src/tool-scopes.js`
- Create: `mcp/test/tool-scopes.test.js`

- [x] **Step 1: Add failing scope mapping tests**

Create `mcp/test/tool-scopes.test.js`:

```js
import { describe, expect, test } from 'vitest';

import { requiredScopeForTool, isReadTool } from '../src/tool-scopes.js';

describe('tool scope mapping', () => {
  test('maps read tools to state:read', () => {
    expect(requiredScopeForTool('list_routines')).toBe('state:read');
    expect(requiredScopeForTool('get_workout')).toBe('state:read');
    expect(requiredScopeForTool('detect_stalls')).toBe('state:read');
    expect(isReadTool('training_summary')).toBe(true);
  });

  test('maps write tools to narrow write scopes', () => {
    expect(requiredScopeForTool('override_day')).toBe('schedule:write');
    expect(requiredScopeForTool('assign_weekday')).toBe('schedule:write');
    expect(requiredScopeForTool('edit_routine')).toBe('routine:write');
    expect(requiredScopeForTool('create_custom_exercise')).toBe('exercise:write');
    expect(requiredScopeForTool('add_bodyweight')).toBe('bodyweight:write');
    expect(requiredScopeForTool('log_workout')).toBe('workout:write');
    expect(requiredScopeForTool('log_freestyle_workout')).toBe('workout:write');
  });

  test('rejects unknown tools', () => {
    expect(requiredScopeForTool('missing')).toBe(null);
  });
});
```

- [x] **Step 2: Run test to verify RED**

Run:

```bash
cd mcp && npm test -- tool-scopes.test.js
```

Expected: fails because module does not exist.

- [x] **Step 3: Implement mapping**

Create `mcp/src/tool-scopes.js`:

```js
const READ_TOOLS = new Set([
  'list_routines',
  'get_routine',
  'get_week_plan',
  'list_workouts',
  'get_workout',
  'get_bodyweight',
  'estimate_1rm',
  'muscle_balance',
  'progression_next',
  'exercise_history',
  'training_summary',
  'detect_stalls'
]);

const WRITE_TOOL_SCOPES = new Map([
  ['override_day', 'schedule:write'],
  ['assign_weekday', 'schedule:write'],
  ['edit_routine', 'routine:write'],
  ['create_custom_exercise', 'exercise:write'],
  ['add_bodyweight', 'bodyweight:write'],
  ['log_workout', 'workout:write'],
  ['log_freestyle_workout', 'workout:write']
]);

export function isReadTool(name) {
  return READ_TOOLS.has(name);
}

export function requiredScopeForTool(name) {
  if (READ_TOOLS.has(name)) return 'state:read';
  return WRITE_TOOL_SCOPES.get(name) || null;
}
```

- [x] **Step 4: Add coverage for registry drift**

Extend test to import `TOOLS` and assert every registered tool has a scope:

```js
import { TOOLS } from '../src/tools.js';

test('every registered tool has a remote scope mapping', () => {
  const missing = TOOLS.map(t => t.name).filter(name => !requiredScopeForTool(name));
  expect(missing).toEqual([]);
});
```

- [x] **Step 5: Run MCP tests**

Run:

```bash
cd mcp && npm test
```

Expected: pass.

- [x] **Step 6: Commit scope mapping**

```bash
git add mcp/src/tool-scopes.js mcp/test/tool-scopes.test.js
git commit -m "feat: map mcp tools to remote scopes"
```

### Task 5: Make Tool Execution Context-Aware

**Files:**
- Modify: `mcp/src/tools.js`
- Modify: `mcp/src/write-auth.js`
- Modify: `mcp/test/tools.test.js`

- [x] **Step 1: Add failing HTTP-context read isolation test**

In `mcp/test/tools.test.js`, add a test that seeds two disk states and calls a read tool with context:

```js
test('read tools use request context uid when provided', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-mcp-context-tools-'));
  const prevUid = process.env.OPENGYM_UID;
  try {
    process.env.OPENGYM_UID = 'user-b';
    fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
      users: [
        { id: 'user-a', name: 'A', created: '2026-09-06T00:00:00.000Z' },
        { id: 'user-b', name: 'B', created: '2026-09-06T00:00:00.000Z' }
      ],
      creds: [],
      subs: [],
      invites: []
    }));
    fs.writeFileSync(path.join(dataDir, 'state-user-a.json'), JSON.stringify({
      unit: 'kg',
      routines: [{ id: 'a-routine', name: 'A Routine', ex: [] }],
      week: {},
      dayPlan: {},
      workouts: [],
      bodyweight: []
    }));
    fs.writeFileSync(path.join(dataDir, 'state-user-b.json'), JSON.stringify({
      unit: 'kg',
      routines: [{ id: 'b-routine', name: 'B Routine', ex: [] }],
      week: {},
      dayPlan: {},
      workouts: [],
      bodyweight: []
    }));

    const result = call('list_routines', {}, {
      transport: 'http',
      dataDir,
      auth: { verified: true },
      token: { id: 'tok_a', uid: 'user-a', name: 'A token', scopes: ['state:read'] }
    });

    expect(result.routines.map(r => r.id)).toEqual(['a-routine']);
  } finally {
    if (prevUid === undefined) delete process.env.OPENGYM_UID;
    else process.env.OPENGYM_UID = prevUid;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
```

Update local `call()` helper to pass optional context to handlers.

- [x] **Step 2: Add failing HTTP-context write identity test**

Add a test that creates two users, sets `OPENGYM_UID` and `OPENGYM_DATA` to user B's data directory, creates a token for user A in a separate HTTP `dataDir` with `schedule:write`, and calls `override_day` with an HTTP context representing that verified token.

Expected assertions:

- `state-user-a.json` changed;
- `state-user-b.json` unchanged;
- audit event `uid` is `user-a`;
- audit event `token_id` is user A token id.
- no file in the env `OPENGYM_DATA` directory changed.

- [x] **Step 3: Run targeted tests to verify RED**

Run:

```bash
cd mcp && npm test -- tools.test.js
```

Expected: new tests fail because handlers ignore context or write auth falls back to env.

- [x] **Step 4: Add context helpers inside `mcp/src/tools.js`**

Import:

```js
import { getState, getUser, getStateForUid, getUserForUid } from './state.js'
```

Add:

```js
function isVerifiedHttpContext(context) {
  return context?.transport === 'http' && context?.auth?.verified === true && context?.token?.uid;
}

function stateForContext(context) {
  return isVerifiedHttpContext(context)
    ? getStateForUid(context.token.uid, { dataDir: context.dataDir })
    : getState();
}

function userForContext(context) {
  return isVerifiedHttpContext(context)
    ? getUserForUid(context.token.uid, { dataDir: context.dataDir })
    : getUser();
}

function writeAuthForContext(requiredScope, context) {
  if (context?.transport === 'http') {
    if (!isVerifiedHttpContext(context)) {
      return {
        ok: false,
        error: {
          code: 'TOKEN_INVALID',
          message: 'HTTP tool context must contain a verified token.'
        }
      };
    }
    if (!context.token.scopes.includes(requiredScope)) {
      return {
        ok: false,
        error: {
          code: 'TOKEN_FORBIDDEN',
          message: 'Token missing required scope.',
          required_scope: requiredScope
        }
      };
    }
    return { ok: true, token: context.token };
  }
  return verifyMcpWriteToken({ requiredScope });
}

function dataDirForContext(context) {
  return isVerifiedHttpContext(context)
    ? context.dataDir
    : process.env.OPENGYM_DATA;
}
```

Then replace read handler calls:

```js
const S = getState()
```

with:

```js
const S = stateForContext(context)
```

and any `getUser()` usage with `userForContext(context)`.

Replace write auth calls:

```js
verifyMcpWriteToken({ requiredScope: 'schedule:write' })
```

with:

```js
writeAuthForContext('schedule:write', context)
```

Also replace write service setup:

```js
const dataDir = process.env.OPENGYM_DATA
const states = writeStateServices(dataDir)
```

with:

```js
const dataDir = dataDirForContext(context)
const states = writeStateServices(dataDir)
```

This is mandatory for HTTP: the same process may serve multiple data dirs in tests, and production HTTP must never write to a path selected by env when a verified request context provided a different `dataDir`.

Each handler should become:

```js
handler: (params, context) => {
  ...
}
```

Existing stdio tests pass no context and keep old env-token behavior. HTTP server code must construct context only from `authenticateHttpRequest()`. Tests may use a `verifiedHttpContext()` helper to avoid duplicating auth setup, but that helper must set `auth: { verified: true }` explicitly.

- [x] **Step 5: Run MCP tests**

Run:

```bash
cd mcp && npm test
```

Expected: pass.

- [x] **Step 6: Commit context-aware tools**

```bash
git add mcp/src/tools.js mcp/src/write-auth.js mcp/test/tools.test.js
git commit -m "feat: bind mcp tools to request context"
```

## Chunk 4: HTTP Auth And Rate Helpers

### Task 6: Implement HTTP Auth Helpers

**Files:**
- Create: `mcp/src/http-auth.js`
- Create: `mcp/test/http-auth.test.js`

- [x] **Step 1: Add failing auth helper tests**

Create tests for:

- missing Authorization -> `401`, code `MCP_AUTH_REQUIRED`;
- non-Bearer Authorization -> `401`, code `MCP_AUTH_REQUIRED`;
- invalid token -> `401`, code `TOKEN_INVALID`;
- revoked token -> `401`, code `TOKEN_REVOKED`;
- valid token returns request context with `auth.verified`, `token.id`, `token.uid`, `scopes`, `dataDir`.

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
cd mcp && npm test -- http-auth.test.js
```

Expected: fails because module does not exist.

- [x] **Step 3: Implement `parseBearerToken` and `authenticateHttpRequest`**

Create `mcp/src/http-auth.js`:

```js
import { createTokenService } from '../../api/token-service.js';

export function parseBearerToken(header) {
  const match = String(header || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function authError(status, code, message, extra = {}) {
  return { ok: false, status, error: { code, message, ...extra } };
}

export function authenticateHttpRequest(headers, options = {}) {
  const dataDir = options.dataDir ?? process.env.OPENGYM_DATA;
  if (!dataDir) return authError(500, 'MCP_DATA_REQUIRED', 'OPENGYM_DATA is required.');

  const rawToken = parseBearerToken(headers.authorization || headers.Authorization);
  if (!rawToken) return authError(401, 'MCP_AUTH_REQUIRED', 'Authorization: Bearer token is required.');

  const verified = createTokenService({ dataDir }).verifyToken(rawToken);
  if (!verified.ok) {
    return authError(verified.error.code === 'TOKEN_FORBIDDEN' ? 403 : 401, verified.error.code, verified.error.message);
  }

  return {
    ok: true,
    context: {
      transport: 'http',
      dataDir,
      auth: { verified: true },
      token: verified.token
    }
  };
}
```

Adjust status mapping if token service errors differ.

- [x] **Step 4: Run tests**

Run:

```bash
cd mcp && npm test -- http-auth.test.js
```

Expected: pass.

- [x] **Step 5: Commit HTTP auth helpers**

```bash
git add mcp/src/http-auth.js mcp/test/http-auth.test.js
git commit -m "feat: add remote mcp http auth"
```

### Task 7: Implement In-Memory Rate Limiter

**Files:**
- Create: `mcp/src/rate-limit.js`
- Create: `mcp/test/rate-limit.test.js`

- [x] **Step 1: Add failing limiter tests**

Create tests for:

- allows requests under limit;
- rejects over limit with `retryAfter`;
- separates buckets by key;
- can use injected clock for deterministic tests.

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
cd mcp && npm test -- rate-limit.test.js
```

Expected: module missing.

- [x] **Step 3: Implement limiter**

Create `mcp/src/rate-limit.js`:

```js
export function createFixedWindowLimiter({ limit, windowMs, now = () => Date.now() }) {
  const buckets = new Map();

  return {
    check(key) {
      const current = now();
      const bucket = buckets.get(key);
      if (!bucket || current >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: current + windowMs });
        return { ok: true, remaining: limit - 1, resetAt: current + windowMs };
      }
      if (bucket.count >= limit) {
        return {
          ok: false,
          remaining: 0,
          resetAt: bucket.resetAt,
          retryAfter: Math.max(1, Math.ceil((bucket.resetAt - current) / 1000))
        };
      }
      bucket.count += 1;
      return { ok: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
    },
    reset() {
      buckets.clear();
    }
  };
}
```

- [x] **Step 4: Run limiter tests**

Run:

```bash
cd mcp && npm test -- rate-limit.test.js
```

Expected: pass.

- [x] **Step 5: Commit limiter**

```bash
git add mcp/src/rate-limit.js mcp/test/rate-limit.test.js
git commit -m "feat: add remote mcp rate limiter"
```

## Chunk 5: HTTP Entry Point

### Task 8: Split Shared MCP Server Registration

**Files:**
- Create: `mcp/src/server.js`
- Modify: `mcp/src/index.js`
- Modify: `mcp/scripts/check-node-loadable.mjs`

- [x] **Step 1: Create shared server factory**

Move current `McpServer` creation and tool registration into `mcp/src/server.js`:

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOLS } from './tools.js';

export function createOpenGymMcpServer(options = {}) {
  const server = new McpServer({
    name: 'opengym',
    version: '0.1.0'
  });

  for (const tool of TOOLS) {
    server.tool(
      tool.name,
      tool.description,
      tool.schema,
      async (params) => {
        try {
          const result = tool.handler(params || {}, options.context);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          const code = err.code || 'ERROR';
          return {
            isError: true,
            content: [{ type: 'text', text: `${code}: ${err.message}` }]
          };
        }
      }
    );
  }

  return server;
}
```

If HTTP needs per-request context and SDK server instances cannot vary context per request, keep this factory for stdio and use direct `TOOLS` dispatch in `http.js`.

- [x] **Step 2: Update stdio entrypoint**

In `mcp/src/index.js`, keep init/logging and replace local server construction with:

```js
import { createOpenGymMcpServer } from './server.js';

const server = createOpenGymMcpServer();
```

- [x] **Step 3: Update loadability script**

Add `../src/server.js` to `mcp/scripts/check-node-loadable.mjs`.

- [x] **Step 4: Run MCP tests and loadability**

Run:

```bash
cd mcp && npm test
cd mcp && npm run check:node-loadable
```

Expected: pass.

- [x] **Step 5: Commit server split**

```bash
git add mcp/src/server.js mcp/src/index.js mcp/scripts/check-node-loadable.mjs
git commit -m "refactor: share mcp server registration"
```

### Task 9: Add HTTP Contract Tests

**Files:**
- Create: `mcp/test/http.test.js`
- Create: `mcp/src/http.js` initially minimal if needed for imports

- [x] **Step 1: Add HTTP test harness**

Use Node `http` client or `fetch` against an ephemeral server. Export a factory from `mcp/src/http.js` so tests can start/stop without binding a fixed port:

```js
export function createHttpMcpServer(options = {}) {
  // implementation comes later
}
```

- [x] **Step 2: Add failing route/auth tests**

Test:

- `GET /healthz` returns `{ ok: true }`;
- `GET /mcp` returns `405`;
- `POST /mcp` without auth returns `401`;
- invalid origin returns `403`;
- missing `MCP-Protocol-Version` returns `400`;
- missing `params._meta` returns `400` with JSON-RPC `error.code === -32020`;
- missing `params._meta['io.modelcontextprotocol/protocolVersion']` returns `400` with JSON-RPC `error.code === -32020`;
- unsupported protocol version returns `400` with JSON-RPC `error.code === -32020`;
- mismatched `Mcp-Method` returns `400` with JSON-RPC `error.code === -32020`;
- missing or mismatched `Mcp-Name` for `tools/call` returns `400` with JSON-RPC `error.code === -32020`;
- unknown JSON-RPC method returns HTTP `404` with JSON-RPC `-32601`.

- [x] **Step 3: Add failing tool tests**

Test:

- valid `state:read` token can call `tools/call` for `list_routines`;
- token without `state:read` gets `403` for read tool;
- valid write token can dry-run `override_day`;
- token without write scope gets `403`;
- two-user read isolation;
- HTTP write ignores mismatched `OPENGYM_UID` and uses bearer token uid;
- audit event contains bearer token id.

- [x] **Step 4: Add failing rate-limit test**

Configure low limits through server options and assert:

- repeated missing or invalid auth from the same IP returns `429`;
- authenticated token requests over the token limit return `429`;
- `Retry-After` header exists.

- [x] **Step 5: Run HTTP tests to verify RED**

Run:

```bash
cd mcp && npm test -- http.test.js
```

Expected: fail because HTTP server is not implemented.

### Task 10: Implement `/mcp` HTTP Server

**Files:**
- Modify: `mcp/src/http.js`
- Modify: `mcp/scripts/check-node-loadable.mjs`

- [x] **Step 1: Implement route skeleton**

Use Node `http` unless SDK spike selected a specific SDK HTTP transport.

Skeleton responsibilities:

- `GET /healthz` -> `200`;
- unsupported path -> `404`;
- unsupported method on `/mcp` -> `405`;
- body size cap;
- JSON parse;
- auth;
- origin check;
- protocol header checks;
- rate checks;
- dispatch.

- [x] **Step 2: Implement JSON-RPC helpers**

Add helpers inside `mcp/src/http.js` or a small internal module:

```js
function jsonRpcError(id, code, message, data = {}) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } };
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}
```

Use required JSON-RPC numeric codes plus stable `error.data.code` values:

- header validation failures: `error.code === -32020`, `error.data.code === 'MCP_HEADER_MISMATCH'` or a more precise local header code;
- unknown methods: `error.code === -32601`, `error.data.code === 'MCP_METHOD_NOT_FOUND'`;
- auth/scope/rate failures: use suitable transport JSON-RPC codes with local `error.data.code` values such as `MCP_AUTH_REQUIRED`, `TOKEN_INVALID`, `TOKEN_FORBIDDEN`, `MCP_RATE_LIMITED`.

- [x] **Step 3: Implement header validation**

For target `2026-07-28`:

- require `MCP-Protocol-Version`;
- require request `params._meta`;
- require `params._meta['io.modelcontextprotocol/protocolVersion']`;
- support only the protocol version selected in the SDK spike, expected first target `2026-07-28`;
- compare `MCP-Protocol-Version` to `params._meta['io.modelcontextprotocol/protocolVersion']`;
- require `Mcp-Method` and compare to body `method`;
- for `tools/call`, require `Mcp-Name` and compare to `params.name`.

Tests should pin behavior. If the SDK path handles headers itself, keep tests at the public server level.

- [x] **Step 4: Implement dispatch**

For minimal adapter:

- `tools/list`: return tool names/descriptions/input schemas from `TOOLS` plus required 2026-07-28 cache/result metadata, for example `resultType`, `ttlMs` and `cacheScope` if the SDK does not supply them;
- `tools/call`: lookup tool by `params.name`, require scope, call `handler(params.arguments || {}, context)`;
- unknown method: HTTP `404`, JSON-RPC `-32601`;
- unknown tool: JSON-RPC tool error or `404` depending SDK-compatible behavior chosen in spike.

Do not expose prompts/resources unless existing stdio server exposes them.

- [x] **Step 5: Wire auth/scope/rate**

Order:

1. origin check;
2. body size/parse/protocol check;
3. authenticate token;
4. before returning any missing/invalid/revoked-token auth failure, increment/check failed-auth-by-IP limiter and return `429` with `Retry-After` if exhausted;
5. after successful auth, apply coarse token rate limit;
6. method/tool scope check;
7. read/write rate limit bucket;
8. dispatch.

Do not log raw tokens or request bodies.

- [x] **Step 6: Add HTTP module to loadability**

Add new modules to `mcp/scripts/check-node-loadable.mjs`:

```js
'../src/http-auth.js',
'../src/rate-limit.js',
'../src/tool-scopes.js',
'../src/http.js',
'../src/server.js'
```

- [x] **Step 7: Run HTTP tests**

Run:

```bash
cd mcp && npm test -- http.test.js
```

Expected: pass.

- [x] **Step 8: Run full MCP tests and loadability**

Run:

```bash
cd mcp && npm test
cd mcp && npm run check:node-loadable
```

Expected: pass.

- [x] **Step 9: Commit HTTP server**

```bash
git add mcp/src/http.js mcp/test/http.test.js mcp/scripts/check-node-loadable.mjs
git commit -m "feat: add remote mcp http endpoint"
```

## Chunk 6: Docker And Deployment Docs

### Task 11: Add Remote MCP Container

**Files:**
- Create: `mcp/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `.dockerignore` if needed

- [x] **Step 1: Add Dockerfile**

Create `mcp/Dockerfile`:

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY api/package*.json ./api/
COPY mcp/package*.json ./mcp/

RUN cd mcp && npm ci --omit=dev

COPY api ./api
COPY frontend/src/lib ./frontend/src/lib
COPY frontend/src/instr ./frontend/src/instr
COPY mcp ./mcp

WORKDIR /app/mcp

ENV OPENGYM_DATA=/data
ENV MCP_HTTP_HOST=0.0.0.0
ENV MCP_HTTP_PORT=3010

EXPOSE 3010

CMD ["node", "src/http.js"]
```

Adjust copied paths based on actual imports from `mcp/src/tools.js`; keep image minimal but correct.

- [x] **Step 2: Add compose profile service**

Add to `docker-compose.yml`:

```yaml
  mcp-http:
    build:
      context: .
      dockerfile: mcp/Dockerfile
    restart: unless-stopped
    profiles: ["mcp-http"]
    env_file: .env
    environment:
      - OPENGYM_DATA=/data
      - MCP_HTTP_HOST=0.0.0.0
      - MCP_HTTP_PORT=3010
      - MCP_ALLOWED_ORIGINS=${MCP_ALLOWED_ORIGINS:-}
      - MCP_RATE_AUTH_FAIL_PER_MIN=${MCP_RATE_AUTH_FAIL_PER_MIN:-10}
      - MCP_RATE_TOKEN_PER_MIN=${MCP_RATE_TOKEN_PER_MIN:-120}
      - MCP_RATE_READ_PER_MIN=${MCP_RATE_READ_PER_MIN:-60}
      - MCP_RATE_WRITE_PER_MIN=${MCP_RATE_WRITE_PER_MIN:-20}
    ports:
      - "${MCP_HTTP_BIND:-127.0.0.1}:${MCP_HTTP_PORT_PUBLIC:-3010}:3010"
    volumes:
      - ./data:/data
    depends_on:
      - api
```

This keeps the default host bind local-only while allowing a host reverse proxy to reach it.

- [x] **Step 3: Validate compose syntax**

Run:

```bash
docker compose config
```

Expected: config renders, includes `mcp-http` with `profiles: ["mcp-http"]`, and keeps the default published bind on `127.0.0.1`. If Docker is unavailable, document that verification could not be run.

Result: `docker compose config` could not be run in this environment because
`docker` is not installed (`zsh:1: command not found: docker`). The compose
diff was checked manually and `git diff --check` passed.

- [x] **Step 4: Build optional image if Docker is available**

Run:

```bash
docker compose --profile mcp-http build mcp-http
```

Expected: build succeeds. If dependency install needs network and fails in sandbox, rerun with approval.

Result: skipped for the same environment reason as Step 3: Docker CLI is not
installed in this workspace.

- [x] **Step 5: Commit container config**

```bash
git add mcp/Dockerfile docker-compose.yml
# Add .dockerignore only if the task created or modified it:
# git add .dockerignore
git commit -m "feat: add optional remote mcp container"
```

### Task 12: Update Remote MCP Documentation

**Files:**
- Modify: `mcp/README.md`
- Modify: `docs/MCP_WRITE_ARCHITECTURE.md`
- Modify: `docs/openGym_AI_Coach_MCP_dokumentace.md`
- Modify: `.env.example` only if present
- Modify: `README.md` only if the root deployment section should mention the optional profile.

- [x] **Step 1: Document env vars**

Document:

```text
MCP_HTTP_BIND=127.0.0.1
MCP_HTTP_PORT_PUBLIC=3010
MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://claude.ai
MCP_RATE_AUTH_FAIL_PER_MIN=10
MCP_RATE_TOKEN_PER_MIN=120
MCP_RATE_READ_PER_MIN=60
MCP_RATE_WRITE_PER_MIN=20
```

- [x] **Step 2: Document token scopes**

Explain:

- remote reads require `state:read`;
- remote writes require existing write scopes;
- issue combined-scope tokens for clients that need read+write;
- revocation through existing token UI/API stops Remote MCP.

- [x] **Step 3: Document reverse proxy requirement**

Add:

```text
Do not expose Remote MCP over plain public HTTP. Keep the container bound to localhost or an internal Docker network and terminate HTTPS at a reverse proxy.
```

Include a minimal Caddy/nginx example only if it stays short and generic.

- [x] **Step 4: Update roadmap status**

Mark Phase 3 Remote MCP as implemented once code is done. Before code is done, mark the plan/spec as prepared only.

- [x] **Step 5: Run docs checks**

Run:

```bash
git diff --check
rg -n "future: deeper shared workout/set validation|Remaining work: deeper shared workout/set validation" docs mcp/README.md
```

Expected: no active roadmap stale text.

- [x] **Step 6: Commit docs**

```bash
git add README.md mcp/README.md docs/MCP_WRITE_ARCHITECTURE.md docs/openGym_AI_Coach_MCP_dokumentace.md
# Add .env.example only if it exists and was changed:
# git add .env.example
git commit -m "docs: document remote mcp deployment"
```

## Chunk 7: Final Verification And Merge

### Task 13: Full Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-09-06-remote-mcp.md`

- [x] **Step 1: Run API tests**

Run:

```bash
cd api && npm test
```

Expected: all pass.

Result: `npm test` in `api` passed 31/31 tests.

- [x] **Step 2: Run MCP tests**

Run:

```bash
cd mcp && npm test
```

Expected: all pass.

Result: `npm test` in `mcp` passed 153/153 tests.

- [x] **Step 3: Run MCP loadability**

Run:

```bash
cd mcp && npm run check:node-loadable
```

Expected: all listed modules load, including new HTTP modules.

Result: `npm run check:node-loadable` in `mcp` loaded the MCP import graph under plain Node.

- [x] **Step 4: Run Docker verification if available**

Run:

```bash
docker compose config
docker compose --profile mcp-http build mcp-http
```

Expected: pass, or document exact reason if Docker/network is unavailable.

Result: Docker CLI is unavailable in this environment: `zsh:1: command not found: docker`.

- [x] **Step 5: Manual HTTP smoke test**

If local server can run, start:

```bash
cd mcp && OPENGYM_DATA=../data MCP_HTTP_HOST=127.0.0.1 MCP_HTTP_PORT=3010 node src/http.js
```

Then call `/healthz` and one authenticated `/mcp` `tools/list` or `tools/call` request with a test token.

The `/mcp` smoke request must include compliant headers and matching body metadata. Example shape:

```bash
curl -sS http://127.0.0.1:3010/mcp \
  -H "Authorization: Bearer $OPENGYM_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/list" \
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {
          "name": "opengym-smoke",
          "version": "0.1.0"
        }
      }
    }
  }'
```

Expected: health ok, authenticated MCP response ok, no token appears in logs.

Result: started `node src/http.js` against a temporary data dir on `127.0.0.1:3019`;
`GET /healthz` returned `{"ok":true}` and authenticated `tools/list` returned 19 tools.
The server log only printed the listen URL.

- [x] **Step 6: Check git status and whitespace**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: clean or only intended plan checkbox updates.

Result: `git diff --check` passed with no output; `git status --short --branch`
showed only the intended plan update.

- [x] **Step 7: Commit final plan checkbox update**

```bash
git add docs/superpowers/plans/2026-09-06-remote-mcp.md
git commit -m "docs: close remote mcp plan"
```

Result: committed as `5a73fb4`; the checkbox was reconciled on 2026-11-03.

### Task 14: Final Review And Local Merge

**Files:**
- No code changes unless review finds issues.

- [x] **Step 1: Request final branch review**

Ask a read-only reviewer to inspect the full branch against the spec:

- request-scoped state/auth;
- protocol/header behavior;
- scope enforcement;
- revocation;
- rate limiting;
- Docker opt-in safety;
- docs accuracy.

Result: final review found two Medium HTTP boundary issues: missing CORS handling for
allowed browser clients and missing JSON-RPC envelope validation.

- [x] **Step 2: Fix blocking review findings**

Use `superpowers:receiving-code-review` for any feedback. Fix critical/important issues before merge. Re-run relevant tests.

Result: fixed in `7b4b00c` with CORS preflight/response headers, JSON-RPC envelope validation
and regression tests. Re-ran `api` tests 31/31, `mcp` tests 159/159,
`mcp` loadability and `git diff --check`. Re-review reported no findings.

- [x] **Step 3: Use finishing branch workflow**

Use `superpowers:finishing-a-development-branch`.

Expected preferred option, based on prior project workflow:

```text
Merge back to main locally
```

Result: fast-forward merged `phase-3-remote-mcp` into local `main`.

- [x] **Step 4: Post-merge verification on `main`**

Run:

```bash
cd api && npm test
cd mcp && npm test
cd mcp && npm run check:node-loadable
docker compose config
```

Expected: pass, except Docker commands only if available.

Result: on local `main`, `api` tests passed 31/31, `mcp` tests passed 159/159,
and MCP loadability passed. `docker compose config` could not run because Docker CLI is not
installed in this environment: `zsh:1: command not found: docker`.

### Follow-up deployment verification — 2026-11-03

The full stack was source-built and deployed on Openship's Docker server from
branch `deploy/openship`, commit `2d7f9b9`. This exposed and fixed missing API
modules in `api/Dockerfile` and the legacy builder's missing `BUILDPLATFORM`
argument. MCP production dependencies were updated to patched versions; tests
remain 159/159 and the production dependency audit reports zero findings.

Deployment `dep_7REfNDr6ZbB0koWu` reached `ready`. Public HTTPS health checks,
tokenless RPC rejection, CORS, frontend assets, exercise media and shared
persistent volumes were verified. This verifies the actual server-side image
builds and running stack; it is not a local `docker compose build` run.
Configuration, URLs and remaining user-client checks are recorded in
`docs/OPENSHIP.md`.
