# rsof-slack

Slack presence and status monitoring service. Tracks real-time presence (`active`/`away`), status text/emoji, busy state, and DnD for all users in your Slack workspace. Stores historical data in PostgreSQL so you can run availability analytics and insights.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Prerequisites](#prerequisites)
3. [Slack App Setup](#slack-app-setup)
4. [Configuration](#configuration)
5. [Running with Docker (recommended)](#running-with-docker-recommended)
6. [Local Development](#local-development)
7. [Database Migrations](#database-migrations)
8. [API Reference](#api-reference)
9. [Web UI](#web-ui)
10. [JWT Setup (for user-facing endpoints)](#jwt-setup)

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Docker host                                │
│                                             │
│  ┌──────────────────────┐  ┌─────────────┐ │
│  │  app (FastAPI)       │  │  postgres   │ │
│  │  port 8000           │◄─►  port 5432  │ │
│  │                      │  └─────────────┘ │
│  │  ├── RTM WebSocket   │                  │
│  │  │   (Slack events)  │                  │
│  │  ├── APScheduler     │                  │
│  │  │   periodic sync   │                  │
│  │  └── React SPA       │                  │
│  │      (frontend/dist) │                  │
│  └──────────────────────┘                  │
└─────────────────────────────────────────────┘
```

- **Real-time**: Slack Socket Mode (RTM) pushes `presence_change` and `user_change` events instantly
- **Reconciliation**: APScheduler polls presence every 5 minutes as a catch-up sweep
- **User sync**: APScheduler runs `users.list` every 30 minutes to catch new/deactivated users
- **User mapping sync**: Syncs your internal user IDs from your user management API every 60 minutes

---

## Prerequisites

- Docker 24+ and Docker Compose v2
- A Slack workspace where you are an admin
- (Optional) An RS256 JWT public key from your identity provider (for user-facing `/me` endpoints)

---

## Slack App Setup

Follow these steps exactly to create the Slack app with the correct permissions.

### 1. Create the app

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name: `rsof-slack` (or any name)
4. Select your workspace → **Create App**

### 2. Enable Socket Mode

1. In the left sidebar, click **Socket Mode**
2. Toggle **Enable Socket Mode** on
3. Under **App-Level Tokens**, click **Generate an app-level token**
4. Name: `rsof-slack-rtm`
5. Add scope: **`connections:write`**
6. Click **Generate** → copy the token (starts with `xapp-`)
   → This is your `SLACK_APP_TOKEN`

### 3. Add Bot Token Scopes

1. In the left sidebar, click **OAuth & Permissions**
2. Scroll to **Scopes → Bot Token Scopes**
3. Add the following scopes:
   - `users:read` — list all users
   - `users:read.email` — read email addresses
   - `users.profile:read` — read status text/emoji
   - `dnd:read` — read Do Not Disturb status

### 4. Enable Events (for `user_change` and `dnd_updated_user`)

1. In the left sidebar, click **Event Subscriptions**
2. Toggle **Enable Events** on
3. Under **Subscribe to bot events**, add:
   - `user_change`
   - `dnd_updated_user`
4. Click **Save Changes**

### 5. Install to workspace

1. In the left sidebar, click **OAuth & Permissions**
2. Click **Install to Workspace** → **Allow**
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
   → This is your `SLACK_BOT_TOKEN`

---

## Configuration

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | `xoxb-...` Bot token |
| `SLACK_APP_TOKEN` | Yes | `xapp-...` App-level token for Socket Mode |
| `DATABASE_URL` | Yes | PostgreSQL URL (auto-set by docker-compose) |
| `POSTGRES_PASSWORD` | Yes | Password for the postgres container |
| `API_KEY` | Yes | Strong random string — protects all admin endpoints and the web UI |
| `JWT_PUBLIC_KEY_PEM` | No | RS256 public key PEM for `/me` JWT endpoints |
| `USER_MGMT_API_URL` | No | URL returning `[{id, slack_id, ...}]` from your user management system |
| `USER_MGMT_API_KEY` | No | Bearer token for the user management API |
| `USER_SYNC_INTERVAL` | No | Minutes between Slack user syncs (default: 30) |
| `PRESENCE_RECONCILE_INTERVAL` | No | Minutes between presence reconciliation polls (default: 5) |
| `USER_MAPPING_SYNC_INTERVAL` | No | Minutes between user mapping syncs (default: 60) |
| `APP_PORT` | No | Host port to expose (default: 8000) |
| `LOG_LEVEL` | No | `info` / `debug` / `warning` (default: info) |

---

## Running with Docker (recommended)

```bash
# 1. Copy and fill in config
cp .env.example .env
# Edit .env with your Slack tokens and API key

# 2. Build and start
docker compose up -d --build

# 3. Check logs
docker compose logs -f app

# 4. Open the UI
open http://localhost:8000
```

The app will:
1. Run Alembic migrations automatically on startup
2. Sync all Slack users immediately
3. Sync user mappings (if `USER_MGMT_API_URL` is set)
4. Connect to Slack via Socket Mode
5. Start the scheduled jobs

To stop:
```bash
docker compose down
```

To stop and remove data:
```bash
docker compose down -v
```

---

## Local Development

### Backend

```bash
# Install Python deps
uv sync

# Copy and fill in config (set DATABASE_URL, SLACK tokens, API_KEY)
cp .env.example .env

# Create the database (if using an existing postgres, not docker-compose):
# psql -U <user> -c "CREATE DATABASE rsof_slack;"
# Or start a fresh postgres via docker-compose:
docker compose up postgres -d

# Source .env so alembic picks up DATABASE_URL, then run migrations
set -a && source .env && set +a
uv run alembic upgrade head

# Start dev server (auto-reload)
uv run dev
```

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

The Vite dev server runs on port 5173 and proxies `/api` → `http://localhost:8000`.

---

## Database Migrations

Migrations run automatically on every container start. To run manually:

```bash
# Inside docker
docker compose exec app alembic upgrade head

# Locally
uv run alembic upgrade head

# Create a new migration after changing models
uv run alembic revision --autogenerate -m "description"
```

---

## API Reference

Interactive docs are available at: `http://localhost:8000/docs`

All admin endpoints require the `X-API-Key` header.

### Sync Endpoints

```
POST /api/v1/admin/sync/slack-users      Trigger Slack user sync
POST /api/v1/admin/sync/user-mappings    Trigger user mapping sync
POST /api/v1/admin/sync/presence         Reconcile presence for all users
GET  /api/v1/admin/sync/status           Scheduler job next-run times
```

### User Endpoints

```
GET /api/v1/admin/users
    ?ids=U123,U456        filter by comma-separated slack_ids
    ?presence=active      filter by presence (active | away)
    ?active_only=true     exclude deactivated users (default: true)

GET /api/v1/admin/users/{slack_id}
GET /api/v1/admin/users/{slack_id}/presence-history?from=&to=
GET /api/v1/admin/users/{slack_id}/status-history?from=&to=
GET /api/v1/admin/users/{slack_id}/duration-summary?from=&to=
```

### Report Endpoints

```
GET /api/v1/admin/reports/currently-active
GET /api/v1/admin/reports/presence-summary?from=&to=
GET /api/v1/admin/reports/active-hours?from=&to=
GET /api/v1/admin/reports/availability?from=&to=
GET /api/v1/admin/reports/dnd-patterns?from=&to=
GET /api/v1/admin/reports/status-trends?from=&to=&limit=20
GET /api/v1/admin/reports/inactive-users?days=7
```

Date parameters are ISO 8601: `2026-05-01T00:00:00` or `2026-05-01`.

### User-Facing Endpoints (JWT)

These require a `Bearer <jwt>` token in the `Authorization` header. The `sub` claim must match an `id` in the `user_mappings` table.

```
GET /api/v1/me
GET /api/v1/me/presence-history?from=&to=
GET /api/v1/me/status-history?from=&to=
GET /api/v1/me/duration-summary?from=&to=
```

### Health

```
GET /api/v1/health   → {"status": "ok", "rtm": "connected"}
```

---

## Web UI

Open `http://localhost:8000` in your browser.

You will be prompted for the `API_KEY` you set in `.env`. The key is stored in `localStorage` — click **Sign out** in the sidebar to clear it.

Pages:
- **Dashboard** — RTM connection status, live active user count, manual sync buttons
- **Users** — searchable/filterable table of all users with presence indicators
- **User detail** — presence history timeline chart + event log
- **Reports** — tabbed analytics: Availability %, Active Hours heatmap, DnD patterns, Status trends

---

## JWT Setup

If your identity provider issues RS256 JWTs with a `sub` claim that matches your user management IDs:

1. Get the RSA public key PEM from your IdP
2. Set it in `.env`:
   ```
   JWT_PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----\nMIIBIjANBgk...\n-----END PUBLIC KEY-----"
   ```
   (replace actual newlines with `\n`)
3. Restart the service

The `/me` endpoints will then accept `Authorization: Bearer <token>` requests from users, who can only see their own presence data.

---

## Production Notes

- **Reverse proxy**: Put nginx or Caddy in front. Example nginx config:
  ```nginx
  server {
      listen 443 ssl;
      server_name slack.your-domain.com;
      location / {
          proxy_pass http://localhost:8000;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
      }
  }
  ```
- **API key strength**: Use a 32+ character random string: `openssl rand -hex 32`
- **Backups**: The only stateful component is the postgres volume. Back up with `pg_dump`.
- **Resource usage**: The RTM WebSocket is a persistent connection. The poller uses ~1 API call per 100ms per active user. For 200 users, one reconciliation sweep takes ~20 seconds.
