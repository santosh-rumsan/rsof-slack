# rsof-slack

Slack presence and status monitoring — real-time dashboard tracking who's active, away, on DnD, and what their status is.

Uses Slack's RTM (Real-Time Messaging) WebSocket API for instant presence updates, with periodic polling as a reconciliation fallback.

## Stack

- **Backend:** NestJS (Node.js), Prisma ORM
- **Database:** PostgreSQL
- **Frontend:** React 19, TanStack Router, Tailwind CSS, Recharts
- **Real-time:** Slack RTM via `@slack/rtm-api`, Server-Sent Events (SSE) to the browser

## Project structure

```
rsof-slack/
├── apps/
│   ├── api/        NestJS backend
│   │   ├── prisma/ Prisma schema + migrations
│   │   └── src/
│   └── web/        React frontend
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## Prerequisites

- Node.js 20+
- npm 10+ (for the API) and pnpm (for the frontend)
- PostgreSQL 14+ (local dev only — Docker handles this automatically)
- A Slack bot token (`xoxb-…`) with the `users:read`, `users:read.email`, `users.profile:read`, and `presence:read` OAuth scopes

---

## Local development setup

### 1. Clone and configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in at minimum:

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Your Slack bot token (`xoxb-…`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `API_KEY` | Any strong random string — used to authenticate the web UI and admin API |

Optional (leave blank to skip):

| Variable | Description |
|---|---|
| `JWT_PUBLIC_KEY_PEM` | RS256 public key PEM for the `/me/*` endpoints |
| `USER_MGMT_API_URL` | External user management API URL |
| `USER_MGMT_API_KEY` | Bearer token for the user management API |

### 2. Set up the database

Create the database (if it doesn't exist):

```bash
createdb rsof_slack
```

Or with a specific user:

```bash
psql -c "CREATE DATABASE rsof_slack;" postgres
```

The `DATABASE_URL` in `.env` should look like:

```
DATABASE_URL=postgresql://your_user:your_password@localhost:5432/rsof_slack
```

### 3. Install dependencies

```bash
# API
cd apps/api
npm install

# Frontend
cd ../web
pnpm install
```

### 4. Run database migrations

```bash
cd apps/api
npx prisma migrate deploy
```

This creates all four tables: `slack_users`, `presence_history`, `status_history`, `user_mappings`.

### 5. Start the backend

```bash
cd apps/api
npm run start:dev
```

The API starts on `http://localhost:8000`. On first startup it:
1. Runs any pending migrations
2. Syncs all Slack users into the database
3. Connects to the Slack RTM WebSocket
4. Starts the background scheduler

### 6. Start the frontend (separate terminal)

```bash
cd apps/web
pnpm dev
```

The frontend runs on `http://localhost:5173` (Vite dev server) and proxies API calls to `localhost:8000`.

> **Note:** Make sure `vite.config.ts` has a proxy configured for `/api`. If not, set `VITE_API_BASE_URL` or add:
> ```ts
> server: {
>   proxy: { '/api': 'http://localhost:8000' }
> }
> ```

### 7. Log in

Open `http://localhost:5173` in your browser and enter the `API_KEY` value from your `.env`.

---

## Docker setup (recommended for production)

### 1. Configure environment

```bash
cp .env.example .env
```

Fill in `SLACK_BOT_TOKEN`, `API_KEY`, and `POSTGRES_PASSWORD`. The `DATABASE_URL` is **automatically overridden** by docker-compose to point at the Postgres container — you do not need to set it manually for Docker.

### 2. Build and start

```bash
docker compose up --build
```

This:
1. Builds the React frontend (Stage 1)
2. Builds the NestJS API (Stage 2)
3. Runs `prisma migrate deploy` on startup
4. Starts PostgreSQL and the app containers

The app is available at `http://localhost:8000` (or the port set by `APP_PORT`).

### 3. Stopping

```bash
docker compose down
```

Data is persisted in the `postgres_data` Docker volume. To also remove the volume:

```bash
docker compose down -v
```

---

## Database migrations

Migrations are run automatically at startup (both locally with `npm run start:dev` and in Docker). To manage them manually:

```bash
cd apps/api

# Apply pending migrations
npx prisma migrate deploy

# Create a new migration after editing prisma/schema.prisma
npx prisma migrate dev --name describe_your_change

# Open Prisma Studio (database browser)
npx prisma studio
```

---

## API overview

All endpoints are under `/api/v1`.

| Auth | Header | Used for |
|---|---|---|
| API key | `X-API-Key: <API_KEY>` | Admin + health endpoints |
| JWT (RS256) | `Authorization: Bearer <token>` | `/me/*` endpoints |

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | RTM connection status |
| `POST` | `/admin/sync/slack-users` | Trigger immediate user sync |
| `POST` | `/admin/sync/user-mappings` | Trigger immediate mapping sync |
| `POST` | `/admin/sync/presence` | Trigger presence reconciliation |
| `GET` | `/admin/sync/status` | Scheduled job next-run times |
| `GET` | `/admin/events/presence` | SSE stream of real-time presence changes |
| `GET` | `/admin/users` | List users (`ids`, `presence`, `active_only`) |
| `GET` | `/admin/users/:slackId` | Get single user |
| `GET` | `/admin/users/:slackId/presence-history` | Presence history (`from`, `to`) |
| `GET` | `/admin/users/:slackId/status-history` | Status history (`from`, `to`) |
| `GET` | `/admin/users/:slackId/duration-summary` | Active/away totals |
| `GET` | `/admin/reports/currently-active` | Currently active users |
| `GET` | `/admin/reports/presence-summary` | Per-user availability % |
| `GET` | `/admin/reports/active-hours` | Day × hour heatmap |
| `GET` | `/admin/reports/availability` | Availability % per user |
| `GET` | `/admin/reports/dnd-patterns` | DnD session counts and durations |
| `GET` | `/admin/reports/status-trends` | Most-used status combos |
| `GET` | `/admin/reports/inactive-users` | Users inactive for N days |
| `GET` | `/me` | Authenticated user's own profile |
| `GET` | `/me/presence-history` | Own presence history |
| `GET` | `/me/status-history` | Own status history |
| `GET` | `/me/duration-summary` | Own duration totals |

---

## Environment variables reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | — | Slack bot token (`xoxb-…`) |
| `DATABASE_URL` | Yes | — | PostgreSQL connection URL |
| `API_KEY` | Yes | — | Admin API key for the web UI |
| `JWT_PUBLIC_KEY_PEM` | No | `""` | RS256 public key for `/me/*` JWT auth |
| `USER_MGMT_API_URL` | No | `""` | External user management API URL |
| `USER_MGMT_API_KEY` | No | `""` | Bearer token for user management API |
| `USER_SYNC_INTERVAL` | No | `30` | Minutes between user syncs |
| `PRESENCE_RECONCILE_INTERVAL` | No | `5` | Minutes between presence polls |
| `USER_MAPPING_SYNC_INTERVAL` | No | `60` | Minutes between mapping syncs |
| `APP_PORT` | No | `8000` | HTTP server port |
| `POSTGRES_PASSWORD` | No | `rsof_password` | Postgres password (Docker only) |
