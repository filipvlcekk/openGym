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

Create MCP tokens from signed-in Settings. Reads require `state:read`, and writes
require the corresponding write scopes. Remote HTTP currently implements
`tools/list` and `tools/call` with protocol `2026-07-28`; it does not implement
OAuth discovery or `initialize`. Verify the intended client's compatibility.

Redeploy the saved project from `deploy/openship` after reviewing changes. Keep
the service overrides and named volumes; do not substitute upstream prebuilt
images. Auto-deploy is not enabled.
