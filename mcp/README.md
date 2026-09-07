# openGym MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) bridge that lets an external LLM
application (Claude Desktop, Cursor, Cline, Continue, etc.) read your openGym profile and, when
explicitly configured with a scoped MCP token, write narrow schedule changes directly against
your self-hosted `./data` directory.

By default it runs locally as a stdio process spawned by the LLM client and adds no new
container. Write tools require `OPENGYM_MCP_TOKEN` with a narrow scope. Remote HTTP MCP is
available separately as an opt-in container profile. The LLM never sees passkeys, VAPID keys,
or session secrets.

The numbers it answers with are computed by the **same pure functions the React UI uses**
(`frontend/src/lib/*.js`) — `estimate1RM`, `loadOfWorkouts`, `effectiveRoutine`, etc. — so a
"what's my bench 1RM?" answer matches the Stats screen exactly.

> The fork ships twelve read-only tools plus scoped write tools:
> `override_day`, `assign_weekday`, structured `edit_routine` patch ops, `add_bodyweight`
> structured `log_workout`, `log_freestyle_workout` and `create_custom_exercise`.

## Quick start

### 1. Install

```bash
cd mcp
npm install
```

### 2. Point it at your data

The MCP server reads the same `./data` directory `docker compose up` creates. Pick the profile
to answer for — its user id is in `./data/db.json` under `users[].id`:

```bash
# single-user instance (the common self-hosted case) — auto-detected:
node src/index.js

# multi-user instance, or just to be explicit:
OPENGYM_UID=<your-uid> OPENGYM_DATA=/path/to/openGym/data node src/index.js
```

### 3. Register with your LLM client

Add the server to your LLM client's MCP config. For Claude Desktop, edit
`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```jsonc
{
  "mcpServers": {
    "opengym": {
      "command": "node",
      "args": ["/absolute/path/to/openGym/mcp/src/index.js"],
      "env": {
        "OPENGYM_DATA": "/absolute/path/to/openGym/data",
        "OPENGYM_UID": "<your-uid>",       // optional for read tools
        "OPENGYM_MCP_TOKEN": "ogmcp_..."   // required only for write tools
      }
    }
  }
}
```

For Cursor and other MCP-compatible clients, see the client's MCP docs — the same `command` +
`args` + `env` shape is what every stdio MCP server expects.

Restart the client; you should see the openGym tools appear with "serving profile \<name\>" on
the server's stderr.

## Remote HTTP MCP

Remote MCP is opt-in and runs as a separate `mcp-http` compose profile:

```bash
docker compose --profile mcp-http up -d mcp-http
```

The container listens on plain HTTP inside the host/Docker network. Do not expose it over
public plain HTTP. Keep the default localhost bind and terminate HTTPS at Caddy, Traefik,
nginx, Cloudflare Tunnel, or another reverse proxy:

```text
Remote MCP client -> HTTPS reverse proxy -> http://127.0.0.1:3010/mcp
```

Remote HTTP requests must use `Authorization: Bearer ogmcp_...` on every `/mcp` request.
Tokens are the same MCP tokens created through the openGym API/UI, and revocation takes effect
on the next request.

Scopes:

| Scope | Remote access |
|---|---|
| `state:read` | Required for all read tools |
| `schedule:write` | `override_day`, `assign_weekday` |
| `routine:write` | `edit_routine` |
| `exercise:write` | `create_custom_exercise` |
| `bodyweight:write` | `add_bodyweight` |
| `workout:write` | `log_workout`, `log_freestyle_workout` |

Write scopes do not imply read access. Issue combined-scope tokens for clients that need both.

Remote MCP environment variables:

| Variable | Default | Notes |
|---|---|---|
| `MCP_HTTP_BIND` | `127.0.0.1` | Host bind address used by `docker-compose.yml` |
| `MCP_HTTP_PORT_PUBLIC` | `3010` | Host port published for the reverse proxy |
| `MCP_ALLOWED_ORIGINS` | *(empty)* | Comma-separated browser origins allowed when `Origin` is present |
| `MCP_RATE_AUTH_FAIL_PER_MIN` | `10` | Failed auth attempts per IP per minute |
| `MCP_RATE_TOKEN_PER_MIN` | `120` | Coarse authenticated requests per token per minute |
| `MCP_RATE_READ_PER_MIN` | `60` | Read tool calls per token per minute |
| `MCP_RATE_WRITE_PER_MIN` | `20` | Write tool calls per token per minute |

## Tools

Twelve read-only tools and seven scoped write tools in this fork:

| Tool | What it answers |
|---|---|
| `list_routines` | What routines are saved in my profile? (names + exercise counts) |
| `get_routine` | What does the Push Day routine prescribe? (sets/reps/weight per exercise) |
| `get_week_plan` | What's on my plan this week, including today with any date-specific override? |
| `list_workouts` | Recent sessions — newest first, with dates, sets done/planned, volume, duration, PRs. |
| `get_workout` | Full set-by-set breakdown of one session, by `workout_id` or by date. On a day with two sessions the date alone returns both ids to pick from rather than guessing at one. |
| `exercise_history` | Recent completed sessions for one exercise, newest first, with target, set labels and per-entry volume. |
| `training_summary` | Compact period summary: workouts, sets, volume, PRs, bodyweight change, effort and muscle coverage. |
| `detect_stalls` | Conservative reps-mode stagnation candidates with evidence, not a final coaching verdict. |
| `get_bodyweight` | Weigh-ins with the latest weight, the goal line, and deltas vs goal. |
| `estimate_1rm` | All-time best 1RM for an exercise + the trend, or a PR table across all exercises. |
| `muscle_balance` | Which muscles I've trained this week/month/all-time, ranked + which I've neglected. |
| `progression_next` | What does openGym's configured progression policy prescribe next for this routine exercise? |
| `override_day` | Write a one-off date override to a routine or `rest`. Requires `schedule:write`, `dry_run`, and `expected_revision`. |
| `assign_weekday` | Write the recurring weekly schedule for one weekday. Use `rest` to clear that weekday. Requires `schedule:write`, `dry_run`, and `expected_revision`. |
| `edit_routine` | Patch an existing routine with `set_policy`, `set_exercise_target`, `add_exercise`, `remove_exercise`, `reorder_exercise`, `link_superset` or `unlink_superset`. Requires `routine:write`, `dry_run`, and `expected_revision`. |
| `create_custom_exercise` | Create one custom exercise in the profile catalogue. Requires `exercise:write`, `dry_run`, and `expected_revision`; add it to a routine with `edit_routine.add_exercise`. |
| `add_bodyweight` | Add or replace one body-weight weigh-in for a date. Requires `bodyweight:write`, `dry_run`, and `expected_revision`. |
| `log_workout` | Log a completed workout for an existing routine from structured JSON. Requires `workout:write`, `dry_run`, and `expected_revision`. |
| `log_freestyle_workout` | Log a completed routine-less workout from structured JSON. Requires `workout:write`, `dry_run`, and `expected_revision`; entries may use catalog or custom exercise ids. |

Each tool returns JSON the LLM can format as it likes; structured fields (sets, dates, levels)
are pre-formatted into human-readable labels in `src/labels.js` so the LLM doesn't need to
re-interpret them.

## How it reuses the training logic

The MCP server imports the training helpers under `frontend/src/lib/` directly as Node ESM
and calls the same functions the React UI does (`history.js`, `onerm.js`, `muscles.js`,
`exercises.js`). The numbers it returns match what the Stats screen shows, because they are
the same code.

The one lib file that wasn't Node-safe was `i18n.js` (Vite's `import.meta.glob` at module
top level) — split into `i18n-core.js` (pure, Node-safe) + `i18n.js` (Vite/React bits,
re-exports from core). `exercises.js` got a one-line `import.meta.env || {}` guard. No new
dependencies landed in `frontend/`, no public exports changed.

## Design constraints honoured

- **One runtime dependency beyond the MCP SDK:** none. No database driver, no HTTP framework.
- **Local stdio stays zero-container.** stdio transport is spawned by the LLM client.
- **Remote HTTP is opt-in.** The optional `mcp-http` compose profile authenticates every
  request and expects HTTPS at a reverse proxy.
- **Scoped auth.** Remote reads require `state:read`; writes require narrow write scopes.
- **No telemetry, no network.** Reads `./data/*.json` and exits when the LLM client
  disconnects.

## Tests

```bash
cd mcp && npm test
```

153 MCP tests, including 108 tool cases seeding state from `frontend/src/lib/demoSeed.js` (the same deterministic fixture
the public demo runs on). Pins JSON shape and the user-facing edge cases: rest-day override,
missing routine, zero-workout history, no synced state, superset links, per-exercise history,
period training summaries, conservative stall detection, three 1RM formulas, deterministic
progression recommendations, MCP write auth, schedule write dry-run/commit behavior, the
routine patch write behavior, routine superset linking/unlinking, custom exercise creation,
bodyweight write behavior, structured workout logging, request-scoped HTTP state isolation,
remote bearer auth, remote scope mapping, rate limiting and `/mcp` HTTP contract behavior.
"Today" is pinned via `vi.useFakeTimers({ now: ..., toFake: ['Date'] })` so date-dependent
tools see consistent values regardless of when the suite runs. The pure lib functions have
their own 92 tests in `frontend/src/lib/*.test.js`.

## Roadmap

- **Done (Phase 1):** read-only stdio, 8 base tools, direct `./data` access.
- **Done (Phase 1.5):** `progression_next`, `exercise_history`, `training_summary`
  and `detect_stalls` tools for better coaching reads. No new deps; small surface area.
- **In progress (Phase 2):** read+write over stdio. Done so far: long-lived token auth,
  `./data/tokens.json`, per-user state locks, `_revision` conflict checks, scrubbed
  `audit.log`, `override_day`, `assign_weekday`, and structured `edit_routine` patch ops for
  routine policy, existing exercise targets, add/remove/reorder exercise changes and direct
  superset linking/unlinking,
  `add_bodyweight`, structured `log_workout`, `log_freestyle_workout`,
  `create_custom_exercise`, shared structural state validation, and deeper workout/set state
  validation before committed writes.
  The current stdio Phase 2 write-tool roadmap is implemented; future hardening can add optional
  migration/audit tooling.
  See [`docs/MCP_WRITE_ARCHITECTURE.md`](../docs/MCP_WRITE_ARCHITECTURE.md) for the proposed
  token, scope, lock, revision, dry-run and audit design.
- **Done (Phase 3):** opt-in Remote MCP over Streamable HTTP-style JSON-RPC at `/mcp`,
  scoped bearer auth, revocation through existing tokens, request-scoped state, rate limiting
  and optional `mcp-http` compose profile. Public HTTPS is intentionally handled outside Node
  by a reverse proxy.

## License

AGPL-3.0-or-later, same as openGym.
