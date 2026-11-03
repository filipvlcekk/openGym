# Openship deployment

Deployment configuration created on 2026-11-03:

- Project: `openGym` (`proj_kkTMOQjsNvhs2dX7`).
- Workspace: `Local User's workspace`.
- Server: `This Server` (`713bef8b-4424-41cd-93b4-9d44ad72ea35`).
- Source: `filipvlcekk/openGym`, branch `deploy/openship`.
- Deployment type: Compose services, Docker runtime, server-side builds.
- App hostname: `opengym.ship.saola.cz`.
- MCP hostname: `opengym-mcp.ship.saola.cz`; endpoint `/mcp`.

## Service overrides

These overrides are saved in Openship rather than in the general-purpose
`docker-compose.yml`. Preserve them when syncing the Compose source.

- `api`: clear the upstream `image` so Openship builds `./api`. Set
  `PORT=3000`, `DATA_DIR=/data`, `RP_ID=opengym.ship.saola.cz`,
  `ORIGIN=https://opengym.ship.saola.cz`, `RP_NAME=openGym`.
  Keep one API replica. It stores users and pending passkey challenges in memory.
- `web`: clear the upstream `image`; build the root `Dockerfile` with
  `BUILDPLATFORM=linux/amd64`, matching this server. Route the app hostname to
  container port 80. Its nginx proxies `/api/` to `api:3000`.
- `mcp-http`: build `mcp/Dockerfile`; set `OPENGYM_DATA=/data`,
  `MCP_HTTP_HOST=0.0.0.0`, `MCP_HTTP_PORT=3010`. Route its hostname to
  container port 3010. Allowed origins are `https://opengym.ship.saola.cz`,
  `https://chatgpt.com`, and `https://claude.ai`.
- `media`: keep the existing shell entrypoint and `restart: no`. The saved
  initialization script uses `set -e` and downloads when either media directory
  is empty.

The public services use Openship HTTPS routing. No original `8080` or `3010`
host-port mappings are needed. Readiness checks use `/api/health` for API/web
and `/healthz` for MCP.

## Persistent data

Use the same project-namespaced named volume in every service that shares it:

- `opengym-data:/data` in both `api` and `mcp-http`.
- `opengym-media-img:/out/img` in `media`, mounted read-only at
  `/usr/share/nginx/html/img` in `web`.
- `opengym-media-gif:/out/gif` in `media`, mounted read-only at
  `/usr/share/nginx/html/gif` in `web`.

These volumes are independent of disposable source checkouts. Back up the data
volume: it holds accounts, passkeys, session keys, workouts, MCP tokens and audit
records. The initial deployment uses a fresh data volume.

## First use and updates

Open the app over HTTPS and register your own passkey. Registration defaults to
open; no initial administrator is assigned automatically. See
`SELF_HOSTING.md` for configuring `ADMIN_UIDS` and invite-only registration.
Keep the hostname stable because changing `RP_ID` invalidates existing passkeys.

Create MCP tokens through the signed-in API (`POST /api/mcp/tokens`); the frontend
does not yet have token management controls. Reads require `state:read`, and writes
require the corresponding write scopes. Standard stateless Streamable HTTP supports
`initialize`, tool discovery and calls with the SDK's 2025 protocol versions. The
custom `2026-07-28` request format remains supported. OAuth is not implemented.
See `mcp/README.md` for Codex bearer-token configuration.

Redeploy the saved project from `deploy/openship` after reviewing changes. Keep
the service overrides and named volumes; do not substitute upstream prebuilt
images. Auto-deploy is not enabled.

## Verified deployment — 2026-11-03

Deployment `dep_7REfNDr6ZbB0koWu` reached `ready` from commit
`2d7f9b92e9ed7dd5eb23a84c1370aee84f47d902`. All four service deployment
steps succeeded. API, web and MCP stay running; the media initializer exited 0.
Both hostnames have active, publicly trusted TLS certificates. The app hostname
is the project's primary domain, and HTTP redirects to HTTPS.

Verified from outside the server:

- App HTML and built JavaScript return 200 with the expected content types.
- `/api/health` returns `{"ok":true,"users":0}` on the fresh instance.
- `/api/me` rejects an unsigned request with 401.
- `/api/register/options` returns the configured passkey RP ID. The smoke check
  did not complete registration or create a user.
- A JPEG and GIF from the shared media volumes return 200 as images.
- MCP `/healthz` returns `{"ok":true}`.
- A correctly formed tokenless MCP RPC returns 401 `MCP_AUTH_REQUIRED`.
- CORS preflight permits the configured app origin.

Docker inspection confirmed API and MCP mount the same persistent
`openship-opengym-opengym-data` volume. The two media volumes are shared between
the initializer and web, and mounted read-only in web.

API tests passed 31/31. MCP tests passed 159/159 on Node 22 and 24, and all 16
Node import checks passed. Production dependency audits reported zero findings
for MCP and frontend; remaining development/mobile tooling findings were not
updated as part of this deployment. A read-only review found no blocking issues.

Real passkey registration/login, an authenticated production MCP call and
third-party MCP client compatibility still require a user's profile/token.
Automatic backup scheduling and restore were not exercised.
