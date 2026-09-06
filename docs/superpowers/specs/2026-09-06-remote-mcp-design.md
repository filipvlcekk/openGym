# Remote MCP Design

## Goal

Add an optional Remote MCP surface for openGym so a remote AI client can call the same coaching tools over HTTP without replacing the existing local stdio MCP workflow.

The first implementation should be safe for a self-hosted personal instance:

- opt-in only;
- authenticated on every request;
- scoped;
- revocable;
- rate-limited;
- deployable behind the same kind of reverse proxy self-hosters already use for HTTPS.

## Sources

- MCP Streamable HTTP 2026-07-28: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx
- MCP 2026-07-28 release notes: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- MCP Authorization 2026-07-28: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx

## Current Context

The fork currently has a local stdio MCP server in `mcp/src/index.js`.

That entrypoint:

- creates a `McpServer`;
- initializes state from `OPENGYM_DATA`;
- registers every tool from `mcp/src/tools.js`;
- connects via `StdioServerTransport`.

The existing stdio model is intentionally local. Read tools use `OPENGYM_DATA` and profile resolution from `mcp/src/state.js`; write tools additionally call `mcp/src/write-auth.js`, which verifies `OPENGYM_MCP_TOKEN` against `api/token-service.js`.

The API side already has:

- `api/token-service.js` for hashed MCP tokens, scopes and revocation;
- `api/state-service.js` for locked, audited, revision-safe state writes;
- `api/state-validation.js` for shared state guardrails before writes.

The current `TOKEN_SCOPES` are write-only:

```text
schedule:write
routine:write
workout:write
exercise:write
bodyweight:write
```

Remote MCP changes the risk profile. A remote HTTP endpoint cannot leave read tools unauthenticated, because read tools expose training history, bodyweight and routines.

## Protocol Baseline

Target the current MCP Streamable HTTP shape rather than the older HTTP+SSE/session model.

For the 2026-07-28 protocol revision:

- the MCP endpoint is a single HTTP endpoint, for example `/mcp`;
- client messages are sent as HTTP `POST` requests;
- normal responses can be `application/json`;
- request-scoped streaming can use `text/event-stream`;
- protocol-level sessions and `Mcp-Session-Id` are removed;
- requests carry protocol/client metadata in `_meta`;
- HTTP headers such as `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` are used for routing/inspection;
- servers must validate `Origin` when present to reduce DNS rebinding risk.

Do not implement the deprecated HTTP+SSE transport in the first Remote MCP milestone unless a real target client requires it.

## Primary Design Decision

Use a separate optional `mcp-http` container.

Keep:

- `mcp/src/index.js` for stdio;
- local stdio behavior unchanged;
- existing stdio token behavior for write tools.

Add:

- a new HTTP entrypoint for remote access;
- token auth for all remote read and write tool calls;
- a compose profile so remote MCP is off by default.

### Why Separate From `api`

The existing `api` process owns web/passkey/sync APIs. Remote MCP is a separate agent-facing surface with different traffic and security concerns.

Keeping it separate gives:

- opt-in deployment;
- independent restart/logging/rate limits;
- a smaller blast radius if remote MCP has a bug or heavy request load;
- clearer reverse-proxy routing;
- no changes to normal web app availability when Remote MCP is disabled.

### Why HTTPS Outside Node

The Node MCP process should listen over plain HTTP inside the Docker/private host network. Public HTTPS should terminate at a reverse proxy such as Caddy, Traefik, nginx, Cloudflare Tunnel or a NAS proxy.

Reasons:

- self-hosted openGym already treats TLS as reverse-proxy infrastructure;
- Node does not need to manage ACME, certificate renewal or cipher policy;
- the same deployment model can protect `web`, `api` and `mcp-http`;
- reverse proxies are better suited for TLS, IP allowlists, coarse rate limits and request size limits;
- local development remains simple.

This does not mean exposing Remote MCP without HTTPS. It means public traffic should be:

```text
Remote MCP client
  -> HTTPS reverse proxy
  -> http://mcp-http:3010/mcp
  -> shared ./data volume
```

## Auth Model

Use existing `ogmcp_...` bearer tokens for the first Remote MCP milestone.

HTTP clients must send:

```http
Authorization: Bearer ogmcp_tok_..._...
```

Rules:

- require authorization on every `/mcp` request;
- never accept tokens in query strings;
- invalid or revoked tokens return HTTP `401`;
- insufficient scopes return HTTP `403`;
- token verification uses `api/token-service.js`;
- revocation uses the existing token management API and takes effect on the next request;
- `last_used_at` continues to update through token verification.

### OAuth Compatibility Boundary

The MCP Authorization spec describes a full OAuth 2.1 resource server / authorization server model for HTTP transports. Implementing that completely would require protected resource metadata, authorization server discovery, client registration or client metadata documents, authorization code flow and token audience validation.

That is out of scope for the first self-hosted Remote MCP milestone.

The first milestone is a pragmatic first-party bearer-token mode using openGym's existing MCP tokens. Document it clearly as self-hosted token auth, not as a full OAuth authorization server implementation.

A later interoperability milestone can add OAuth Protected Resource Metadata and a proper OAuth-compatible authorization flow if target clients require it.

## Scope Model

Add one read scope:

```text
state:read
```

Keep existing write scopes:

```text
schedule:write
routine:write
workout:write
exercise:write
bodyweight:write
```

Remote HTTP scope checks:

- `tools/list`: valid non-revoked token required, no specific scope beyond token validity;
- read tool calls: require `state:read`;
- `override_day`, `assign_weekday`: require `schedule:write`;
- `edit_routine`: require `routine:write`;
- `create_custom_exercise`: require `exercise:write`;
- `add_bodyweight`: require `bodyweight:write`;
- `log_workout`, `log_freestyle_workout`: require `workout:write`.

Do not grant read access implicitly from write scopes in the first milestone. If a remote client needs to read and write, issue a token containing both `state:read` and the relevant write scopes.

This keeps the meaning of each scope obvious and audit-friendly.

## HTTP Surface

Expose:

```text
POST /mcp
GET /healthz
```

Behavior:

- `POST /mcp` is the only MCP endpoint;
- `GET /healthz` returns a minimal unauthenticated health result with no user data;
- `GET /mcp` returns `405 Method Not Allowed`;
- `DELETE /mcp` returns `405 Method Not Allowed`;
- unsupported paths return `404`;
- request bodies must be JSON and capped by size;
- ordinary short tool calls return `application/json`;
- request-scoped SSE can be added when needed, but current openGym tools should not require long-lived streams.

The HTTP server should reject:

- missing `Authorization`;
- malformed bearer token;
- revoked token;
- request body that is not a JSON-RPC object;
- unsupported JSON-RPC method;
- invalid `Origin` when an `Origin` header is present;
- missing or incompatible protocol headers when the selected SDK/protocol mode requires them.

## Origin Policy

Remote MCP must validate `Origin` when the header is present.

Configuration:

```text
MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://claude.ai
```

Recommended behavior:

- if `Origin` is absent, allow the request. Many server-to-server clients do not send browser-style origins.
- if `Origin` is present and `MCP_ALLOWED_ORIGINS` is empty, reject with `403`.
- if `Origin` is present and not exactly listed, reject with `403`.
- do not use wildcard origins in the first milestone.

This is a guardrail against browser-origin attacks without breaking non-browser MCP clients.

## Rate Limiting

Use application-level in-memory rate limiting in `mcp-http`, plus document reverse-proxy limits for production.

Initial app-level buckets:

- failed auth by IP: low limit;
- all authenticated requests by token id;
- read tool calls by token id;
- write tool calls by token id;
- optional per-method/per-tool counters using MCP headers or parsed method/tool name.

Suggested defaults:

```text
MCP_RATE_AUTH_FAIL_PER_MIN=10
MCP_RATE_TOKEN_PER_MIN=120
MCP_RATE_READ_PER_MIN=60
MCP_RATE_WRITE_PER_MIN=20
```

Return `429 Too Many Requests` with `Retry-After`.

In-memory limits are acceptable for the first optional single-container deployment. If users run multiple `mcp-http` replicas later, rate limiting should move to the reverse proxy or shared storage.

## Docker And Deployment

Add a dedicated MCP image and optional compose profile.

Proposed service:

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
  volumes:
    - ./data:/data
  depends_on:
    - api
```

Start it with:

```bash
docker compose --profile mcp-http up -d
```

Do not publish the port by default unless that proves too awkward for common reverse-proxy setups. A reverse proxy on the same Docker network can route to `mcp-http:3010`.

If a host port is useful for local testing, make it explicitly opt-in:

```yaml
ports:
  - "${MCP_HTTP_PORT_PUBLIC:-127.0.0.1:3010}:3010"
```

Defaulting to localhost-only is safer than exposing Remote MCP to the LAN.

## Code Structure

Prefer a split that preserves the existing stdio entrypoint and avoids duplicating tool registration.

Planned files:

```text
mcp/src/index.js           stdio entrypoint
mcp/src/server.js          shared MCP server/tool registration factory
mcp/src/http.js            HTTP entrypoint
mcp/src/http-auth.js       Authorization header parsing and token/scope checks
mcp/src/rate-limit.js      small in-memory limiter helpers
mcp/src/tool-scopes.js     mapping from tool names to required scopes
mcp/test/http.test.js      HTTP transport/auth/rate tests
mcp/Dockerfile             HTTP MCP container image
```

`mcp/src/tools.js` should remain the source of truth for tool definitions and handlers.

The design should avoid changing tool handler behavior just to support HTTP. A tool should not need to know whether it was called by stdio or HTTP, except through the auth identity passed by the wrapper if needed.

## SDK Strategy

First implementation task must be a short SDK spike.

Questions to answer:

- Does the project need to upgrade `@modelcontextprotocol/sdk` to support Streamable HTTP 2026-07-28?
- Does the SDK expose a stable HTTP transport suitable for a Node HTTP server?
- Does the SDK still require sessionful initialize semantics in this installed version?
- Can the existing `McpServer` registration be reused for both stdio and HTTP?

Preferred outcome:

- upgrade/use official SDK HTTP transport if it supports the target protocol cleanly.

Fallback:

- implement a small adapter for the subset this project needs: `tools/list` and `tools/call`, using the existing `TOOLS` registry and standard JSON-RPC response shapes.

Do not hand-roll more of the MCP protocol than necessary. If the SDK can do it, use it.

## Error Handling

HTTP-level status:

- `200` for successful JSON-RPC responses;
- `202` only if the selected transport mode accepts notifications without response bodies;
- `400` for malformed JSON, header/body mismatch or invalid JSON-RPC shape;
- `401` for missing/invalid/revoked token;
- `403` for invalid origin or missing scope;
- `404` for unknown path;
- `405` for unsupported methods;
- `413` for oversized bodies;
- `429` for rate limit;
- `500` for unexpected server errors.

JSON-RPC errors should include stable machine-readable codes in `error.data.code`, while avoiding full state snapshots, raw tokens or sensitive payloads.

Tool-level errors should keep the current MCP convention:

- tool returns `isError: true` content for expected domain errors;
- transport-level auth/protocol failures return HTTP/JSON-RPC errors before tool execution.

## Observability And Logging

Log:

- startup config summary without secrets;
- listen host/port;
- invalid origin counts;
- auth failures by reason, without token values;
- rate-limit events;
- tool call method/name and token id, without arguments for write tools.

Do not log:

- raw bearer tokens;
- full state;
- full workout payloads;
- request bodies by default.

## Tests

Add tests before production implementation.

Contract tests:

- `GET /healthz` returns ok without user data;
- `GET /mcp` returns `405`;
- `POST /mcp` without auth returns `401`;
- invalid bearer returns `401`;
- revoked token returns `401`;
- valid token without `state:read` cannot call read tools;
- valid token with `state:read` can call a read tool;
- valid token without required write scope cannot call a write tool;
- valid token with required write scope can dry-run a write tool;
- invalid `Origin` returns `403`;
- allowed `Origin` succeeds;
- rate limit returns `429` and `Retry-After`;
- no raw token appears in logs or responses.

Regression tests:

- stdio MCP tests continue to pass;
- existing write tools still verify existing write scopes;
- token management API accepts `state:read` and still rejects unknown scopes;
- revoked tokens stop remote MCP requests immediately.

Verification commands:

```bash
cd api && npm test
cd mcp && npm test
cd mcp && npm run check:node-loadable
```

If SDK upgrade changes the dependency graph, add an explicit import/loadability check for the HTTP entrypoint.

## Documentation Updates

Update:

- `docs/MCP_WRITE_ARCHITECTURE.md`;
- `docs/openGym_AI_Coach_MCP_dokumentace.md`;
- `mcp/README.md`;
- `README.md` or deployment docs if compose usage changes materially;
- `.env.example` if new environment variables are documented there.

Docs must clearly state:

- Remote MCP is opt-in;
- expose it only behind HTTPS;
- Node/container listens over internal HTTP;
- read tools require `state:read`;
- write tools require their existing write scopes;
- reverse-proxy rate limiting is still recommended for public deployments.

Also clean up the stale line in `docs/MCP_WRITE_ARCHITECTURE.md` that still says deeper workout/set validation is future work.

## Out Of Scope

- full OAuth authorization server;
- Dynamic Client Registration or Client ID Metadata Documents;
- multi-user hosted SaaS deployment;
- long-running MCP Tasks extension;
- remote push notifications or proactive scheduling;
- changing existing tool payload schemas;
- exposing Remote MCP by default;
- making rate limits distributed across multiple replicas;
- frontend UI for Remote MCP setup beyond existing token management.

## Risks

### Client Compatibility

Remote MCP clients may lag behind or expect older sessionful transports.

Mitigation: start with the current official protocol and document supported version. Add legacy HTTP+SSE only if a real target client needs it.

### SDK Version Churn

The installed SDK may not support the target HTTP transport.

Mitigation: make SDK compatibility the first implementation chunk; use a fallback adapter only for the minimal `tools/list` and `tools/call` subset if needed.

### Token Semantics

The existing token model is not full OAuth.

Mitigation: document it as self-hosted bearer-token auth and keep the future OAuth path separate.

### Accidental Exposure

Remote MCP exposes sensitive training data if misconfigured.

Mitigation: opt-in compose profile, no default public port, bearer auth on every request, origin validation, docs requiring HTTPS reverse proxy.

### DoS Against API State Files

Remote reads/writes can put pressure on file-based state.

Mitigation: rate limits, request body size caps, existing per-user write locks, and conservative logging.

## Recommended Implementation Sequence

1. Clean stale docs and save this Phase 3 design.
2. Run SDK/protocol spike.
3. Add `state:read` scope and API/token tests.
4. Split shared MCP server/tool registration from stdio entrypoint.
5. Add HTTP auth, scope mapping and rate limiter helpers with unit tests.
6. Add HTTP entrypoint and `/mcp` contract tests.
7. Add Dockerfile and optional compose profile.
8. Update docs and deployment guidance.
9. Run full API/MCP verification and final review before merge.
