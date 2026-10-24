# ReachInbox Email Scheduler

A full-stack email scheduler built with TypeScript, Express, BullMQ, Redis, PostgreSQL, Elasticsearch and Next.js. Upload leads, schedule campaigns, send through multiple Ethereal SMTP accounts, search emails, and receive Slack alerts when a sender reaches its hourly quota.

**Email scheduling uses BullMQ delayed jobs, with no cron jobs.** PostgreSQL records durable state and queue intent; Redis holds delayed jobs, quotas and sender locks. Uncertain SMTP outcomes are held for review instead of automatically resent.

## Features mapped to the assignment

| Area | Implemented features |
| --- | --- |
| Backend — scheduling | Authenticated API; up to 5,000 recipients per request; start time, sender, subject/body, campaign delay and hourly cap; multiple Ethereal senders and preview links. |
| Backend — persistence | PostgreSQL/Prisma records and migrations; Redis AOF and Docker volumes; queue reconciliation; leased worker claims and crash recovery; duplicate schedule suppression. |
| Backend — throughput | Configurable concurrency; atomic Redis sender/campaign quotas; shared sender spacing; overflow deferred to the next UTC-hour window. |
| Backend — integrations | Real Google OAuth; Slack OAuth, disconnect/reconnect and durable `chat.postMessage` alerts; Elasticsearch indexing/search/backfill; authenticated Bull Board. |
| Frontend — login | Google login, dashboard redirect, name/email/avatar header and logout. |
| Frontend — compose | Sender selection, subject/body, CSV/TXT upload with detected address count, start time, delay and campaign hourly limit. |
| Frontend — dashboard | Scheduled/Sent tables with recipient, subject, time and status; pagination, search, automatic refresh, statistics, Ethereal previews and queue-board link. |
| Frontend — UX | Reusable components, loading/empty/error states, toast messages, Slack connect/disconnect and a Needs review tab with delivery evidence. |

## Run locally

### Prerequisites

- Node.js **20.9+** and npm.
- Docker with the Compose plugin and enough memory for Elasticsearch.
- Google OAuth client credentials for login.
- Internet access for Google, Ethereal and Slack.
- A Slack app and workspace installation permission for the live notification demo.

Each numbered step starts from the repository root. Install backend and frontend dependencies separately; there is no root npm workspace. `cp` works in Bash and PowerShell; use `copy` in Windows Command Prompt.

### 1. Start infrastructure

```bash
docker compose up -d
docker compose ps
```

Wait for the services to become healthy before running migrations.

| Service | Local address | Persistence |
| --- | --- | --- |
| PostgreSQL 16 | `localhost:5432` | `postgres_data` volume |
| Redis 7 | `localhost:6379` | `redis_data`; AOF every second; `noeviction` |
| Elasticsearch 8 | [localhost:9200](http://localhost:9200) | `elasticsearch_data` volume |

Compose is configured for local development, including a sample database password and disabled Elasticsearch security. Use private networking, appropriate credentials and TLS for hosted deployments. `docker compose stop` retains data; do not remove volumes when demonstrating restart persistence.

### 2. Configure and prepare the backend

```bash
cd backend
cp .env.example .env
npm ci
```

Edit `backend/.env`: set real Google credentials, replace `JWT_SECRET` and `SESSION_SECRET` with independent random secrets, and configure Slack for the notification demo. `SESSION_SECRET` requires at least 32 characters. Leave both Ethereal variables blank for automatic multiple-sender setup. The complete configuration reference is below.

Still in `backend`:

```bash
npm run prisma:generate
npx prisma migrate deploy
npm run setup:admin
```

`setup:admin` replaces the example admin password with a random password in the ignored `.env` file. It preserves existing non-placeholder credentials and does not print secrets. Read `ADMIN_USERNAME` and `ADMIN_PASSWORD` from that file for Bull Board login.

### 3. Start Express — terminal 1

From the repository root:

```bash
cd backend
npm run dev
```

Wait for Ethereal account initialization and the server-listening message. The API runs at [localhost:4000](http://localhost:4000); [GET /health](http://localhost:4000/health) confirms that the process responds, rather than continuously probing every dependency.

### 4. Start the BullMQ worker — terminal 2

From the repository root, after the API has initialized:

```bash
cd backend
npm run worker
```

Keep both terminals running: Express accepts schedules; the separate worker sends emails. Start both from `backend` so they share `.env` and `.ethereal-accounts.json`. Additional worker terminals can use the same command.

### 5. Start Next.js — terminal 3

From the repository root:

```bash
cd frontend
cp .env.example .env.local
npm ci
npm run dev
```

The example sets `NEXT_PUBLIC_API_URL=http://localhost:4000`. Open [localhost:3000](http://localhost:3000), sign in with Google, select **Compose New Email**, choose a sender, upload leads and schedule. Inspect Scheduled/Sent and Ethereal previews as work completes.

### Compiled execution

Build each application, starting from the repository root:

```bash
cd backend
npm run build
cd ../frontend
npm run build
```

Then run `npm start` in `backend`, `npm run worker:start` in a second `backend` terminal, and `npm start` in `frontend`. Rebuild the frontend when changing its public API URL. With `NODE_ENV=production`, serve over HTTPS and configure `TRUST_PROXY` for your trusted TLS-terminating proxy so secure OAuth session cookies work.

## Google OAuth setup

1. Create/select a project in [Google Cloud Console](https://console.cloud.google.com/). Configure the OAuth consent screen and add reviewer/demo accounts as test users if the app is in testing.
2. Create an OAuth client of type **Web application**, with the authorized redirect URI exactly `http://localhost:4000/api/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and the matching `GOOGLE_CALLBACK_URL` in `backend/.env`.
4. Restart Express and sign in from the dashboard. The backend requests email/profile access, creates or updates the user, and redirects to the frontend with an application JWT.

Use the same hostname throughout (`localhost`, rather than mixing it with `127.0.0.1`). For deployment, update the registered callback, backend callback variable, frontend URL and public API URL together.

## Ethereal Email setup

Ethereal captures test messages instead of delivering them to real recipients.

**Recommended for multiple senders:** leave `ETHEREAL_USER` and `ETHEREAL_PASS` blank. On first API startup, Nodemailer provisions up to three distinct test accounts and saves credentials to `backend/.ethereal-accounts.json`. Later API/worker processes restore those same accounts. Preserve this ignored file across restarts and start the API before workers on a fresh installation. Workers on separate machines need the same account file supplied securely.

**Existing account:** create one at [Ethereal Email](https://ethereal.email/), set both SMTP credentials in `.env`, and restart API/workers. This mode provides one sender. SMTP is configured in code as `smtp.ethereal.email:587` with STARTTLS support; no additional SMTP environment variables are needed.

Choose an available sender in Compose. Successful sends store a preview URL shown in Sent; alternatively use the account's [Ethereal inbox](https://ethereal.email/messages). Provisioning and SMTP require network access. Never commit `.env`, `.env.local` or `.ethereal-accounts.json`.

## Slack OAuth and live quota alerts

1. Create a Slack app at [Slack API](https://api.slack.com/apps).
2. Under **OAuth & Permissions**, add bot scopes `chat:write` and `chat:write.public`. Register an HTTPS callback such as `https://api.example.com/api/slack/callback`, replacing the hostname with your deployed or proxied backend. Slack's standard OAuth flow requires HTTPS; see the [official OAuth guide](https://docs.slack.dev/authentication/installing-with-oauth/).
3. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and matching `SLACK_REDIRECT_URI` in `backend/.env`; restart the backend processes.
4. Sign in, click **Connect Slack** and complete real authorization. The backend stores the workspace/token/user association in PostgreSQL. Alerts target the connecting Slack user through `chat.postMessage`.
5. Disconnect/reconnect from the dashboard to remove or replace the association; connection changes take effect without redeploying.

The code's default HTTP localhost callback is a development placeholder; override `SLACK_REDIRECT_URI` for live Slack authorization. For an HTTPS deployment or local reverse-proxy demo, configure the frontend/API origins together (`FRONTEND_URL` and `NEXT_PUBLIC_API_URL`) and begin the connection through the same backend hostname used by its callback so the OAuth session cookie is preserved. Use production secure-cookie settings and the correct `TRUST_PROXY` value behind TLS termination. Exposing only the callback on a different hostname will fail session validation.

The admission reaching the **sender-wide** cap creates one durable alert per sender and UTC hour. Delivery is attempted immediately, with pending alerts retried every 30 seconds. Disconnected users do not interrupt email sending; pending alerts become eligible after connecting. Slack outages can delay notifications.

For a short demo, set `MAX_EMAILS_PER_HOUR_PER_SENDER=3`, retain a positive provider delay, and restart workers. Use a fresh sender or new UTC-hour window because counters survive restart. Schedule at least six leads with a **campaign cap greater than three**: show three sends, deferred overflow and the live Slack alert. Lowering only the Compose campaign cap does not trigger a sender-cap alert.

## Live BullMQ dashboard

Open [Bull Board](http://localhost:4000/admin/queues) using admin credentials from `backend/.env`. It shows waiting/delayed/active/completed/failed jobs, payloads and retry details.

HTTP Basic authentication is required: missing/incorrect credentials receive `401`; leaving both admin variables unset disables access with `503`. Use HTTPS outside local development, share reviewer credentials privately and restart Express after changing credentials.

## Environment reference

Backend variables load from `backend/.env`. Numeric settings are validated as whole numbers. API and workers must agree on database, Redis, queue and sending-policy configuration.

| Variable | Default/example | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Express port, 1–65,535. |
| `NODE_ENV` | `development` | `development`, `production` or `test`; production enables secure session cookies. |
| `DATABASE_URL` | `postgresql://reachinbox:reachinbox_secret@localhost:5432/reachinbox_db?schema=public` | PostgreSQL URL; example matches Compose. |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Shared Redis connection. |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | Search/index service. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Required credentials | Google Web application OAuth client. |
| `GOOGLE_CALLBACK_URL` | `http://localhost:4000/api/auth/google/callback` | Must match the registered callback. |
| `JWT_SECRET` | Required secret | Signs application tokens; replace the example. |
| `JWT_EXPIRES_IN` | `7d` | JWT lifetime. |
| `SESSION_SECRET` | Required secret, 32+ characters | Signs Redis-backed OAuth sessions. |
| `TRUST_PROXY` | `false` | `false`, `true` or trusted proxy hop count. Prefer the actual hop count behind a trusted proxy. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Optional pair; generated by `setup:admin` | Bull Board credentials; password minimum 16 characters. Set both or omit both. |
| `FRONTEND_URL` | `http://localhost:3000` | CORS origin and frontend OAuth redirects. |
| `ETHEREAL_USER` / `ETHEREAL_PASS` | Blank | Both set: one configured account. Both blank: automatic multiple-account pool. |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `50` | Shared sender cap; range 1–10,000. |
| `GLOBAL_MAX_EMAILS_PER_HOUR` | `200` | Reserved; **not enforced**. The implemented hourly policy is per sender. |
| `WORKER_CONCURRENCY` | `5` | Maximum active jobs per worker; range 1–1,000. |
| `EMAIL_SEND_DELAY_MS` | `2000` | Positive provider minimum; range 1–3,600,000 ms. |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Optional credentials | Required for Slack Connect and live alerts. |
| `SLACK_REDIRECT_URI` | `http://localhost:4000/api/slack/callback` | Must match the Slack app callback. |
| `EMAIL_QUEUE_NAME` | `email-scheduler` | Optional queue override for isolated tests/maintenance; API and workers must agree. |

Frontend `frontend/.env.local`:

| Variable | Example | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Browser-visible backend base URL, included in the frontend build. |

## Architecture and reliability

```mermaid
flowchart LR
    UI[Next.js dashboard] -->|JWT REST API| API[Express API]
    API --> DB[(PostgreSQL: records and queue intent)]
    API --> ES[(Elasticsearch: search projection)]
    API --> Q[BullMQ delayed queue / Redis]
    Q --> W[Separate worker processes]
    W --> DB
    W --> ES
    W --> R[Redis: shared quotas and sender locks]
    W --> SMTP[Ethereal SMTP]
    W --> Slack[Slack Web API]
```

### Scheduling

`POST /api/emails/schedule` validates the selected SMTP account and campaign inputs, stores a record per recipient, and enqueues delayed jobs. A PostgreSQL unique key suppresses repeated schedules with the same user, sender, recipient, subject and computed time. BullMQ IDs use database UUIDs, so subject punctuation is safe.

Initial times use the effective delay and groups sized by the campaign hourly cap. Group stride is at least one hour and at least `campaignLimit × effectiveDelay`, preventing overlapping groups. Runtime admission checks shared limits because other campaigns can use the same sender. Scheduled times are earliest intended times; backlog, quotas and provider spacing can postpone actual sends.

### Restart persistence and recovery

- Redis retains waiting/delayed jobs with AOF and persistent volumes; process restarts resume them without recreating campaigns from the beginning.
- PostgreSQL is authoritative for email status, campaign settings and queue intent. Workers reconcile eligible rows on startup and every 30 seconds, repairing the database-to-Redis enqueue boundary.
- Workers atomically claim rows with a token and renewing five-minute lease. Expired claims without SMTP attempt evidence get a new, durably stored recovery queue ID, avoiding reuse of retained completed jobs.
- Elasticsearch is a projection: API startup and 60-second backfill retry indexing from PostgreSQL after outages. Search can lag or return an availability error while scheduling continues. Scheduled/Sent search is user-scoped and results are checked against PostgreSQL.

Repeating timers handle recovery/integration retries; **email due times use BullMQ delayed jobs, without cron**. Redis AOF every second does not replace backups or high availability for data-loss incidents.

### Rate limiting, delay and concurrency

`WORKER_CONCURRENCY` controls active jobs per worker. Multiple processes share the queue and Redis. A Lua script atomically reserves sender/campaign slots in **fixed UTC-hour windows**, preventing parallel instances from racing past either cap.

The environment sender cap applies across its campaigns. The Compose cap adds a campaign constraint and cannot raise the sender cap. Quotas count logical jobs admitted for SMTP, including failed attempts; same-hour retries reuse a reservation, while later-hour retries need a new one. Fixed-hour admission is not a rolling 60-minute limit.

On exhaustion, the worker persists `RATE_LIMITED`, a new queue ID and next time, then delays the job to the next UTC hour plus five seconds. Enqueue failures remain recoverable. Quota overflow is deferred, rather than dropped or permanently failed, and the updated time appears in the dashboard. Ordering is best effort with concurrent workers and retries.

A renewing Redis sender lease covers SMTP and persistence, followed by a cooldown. Effective spacing is `max(campaign delay, EMAIL_SEND_DELAY_MS)`: by default, the next send waits at least **2 seconds after the previous send completes**. Zero campaign delay cannot bypass this minimum. Different senders can progress concurrently; waits crossing an hour boundary recheck quota before SMTP. BullMQ additionally caps queue starts at 50 jobs/second, separately from configurable sender hourly limits.

For 1,000+ recipients, initial campaign grouping spreads work, workers consume at configured concurrency, and runtime quota checks defer overflow. Shared spacing remains enforced across instances; completion time depends on the strictest caps, spacing and provider latency.

### SMTP delivery guarantee

SMTP acceptance and PostgreSQL updates cannot share a transaction. The system provides durable scheduling and duplicate suppression, **not an exactly-once SMTP guarantee**.

The worker persists evidence immediately before SMTP. A crash before that evidence permits recovery. If SMTP may have accepted the message but no durable `SENT` result exists, or a socket/timeout makes acceptance uncertain, the row becomes `DELIVERY_UNKNOWN` and automatic resend stops. Known pre-delivery failures or explicit SMTP rejections may retry; exhausted known failures become `FAILED`. Default queue jobs have three attempts with exponential backoff starting at five seconds.

**Needs review** exposes recipient/content, attempt time, message ID when available and last error. Inspect provider evidence before another send. There is deliberately no blind resend action; uncertain deliveries require operator reconciliation. Holding them avoids automatic duplicates but can leave a message unsent, including a crash immediately after attempt evidence is recorded.

## Verification and reviewer walkthrough

With Docker services running, start from the repository root:

```bash
cd backend
npm run build
npm test
npm run test:integration
cd ../frontend
npm run lint
npm run build
```

- `npm test`: focused regression coverage plus isolated Redis/BullMQ and local SMTP checks. Includes a 1,200-job queue test with a mock processor; it does not measure end-to-end SMTP capacity.
- `test:integration`: compiled API, temporary PostgreSQL schema and two workers. Checks pending-email restart survival, shared quota deferral and 1,000 distinct deliveries to loopback SMTP. Requires schema create/drop permission and Redis; cleans up isolated resources. Uses a **25 ms test minimum**, rather than the 2,000 ms application default.
- Local checks do not verify real Google consent, live Slack delivery, external Ethereal availability or Elasticsearch integration. Demonstrate these live before hand-in. The latest local validation passed all 51 backend regression tests, both production builds, frontend lint, and the two-worker integration scenario with 1,000 loopback SMTP deliveries.

Suggested demo: Google login/profile → CSV compose and multiple sender choices → scheduled/sent tables and Ethereal preview → Elasticsearch search → future work surviving worker restart → live Slack alert and deferred overflow → authenticated Bull Board. Compare against the actual Figma separately; no design fidelity claim is made here.

## Project layout

```text
backend/
  prisma/              PostgreSQL schema and checked-in migrations
  scripts/             Local admin credential setup
  src/config/          Environment, DB, Redis, sessions, Elasticsearch
  src/routes/          Authentication, emails, senders and Slack APIs
  src/queues/          BullMQ queue and job types
  src/workers/         Separate worker entry point
  src/services/        SMTP, quotas, recovery, indexing and Slack outbox
  test/                Regression, queue load and integration checks
frontend/
  src/app/             Login, OAuth callback and dashboard pages
  src/components/      Dashboard and reusable UI components
  src/contexts/        Authentication state
  src/lib/             Typed API client
  src/types/           Frontend data types
docker-compose.yml     PostgreSQL, Redis and Elasticsearch with volumes
```

### Common setup issues

| Symptom | Check |
| --- | --- |
| Environment validation fails | Replace example secrets; session secret needs 32+ characters, admin credentials must be paired, numeric settings must be valid. |
| Migration/Redis connection fails | `docker compose ps`, occupied ports and `.env` connection settings. |
| OAuth callback fails | Exact callback URI, test-user/workspace permissions, consistent hostname and session cookies; HTTPS in production mode. |
| No SMTP accounts | Ethereal availability/network access; start API first and both processes from `backend`. |
| Scheduled work does not send | Separate worker running, hourly quota, next scheduled time, Bull Board and worker logs. |
| Search unavailable or stale | Elasticsearch health; allow refresh/backfill. Database-backed Needs review remains available. |
| Bull Board returns `503`/`401` | Run `setup:admin`, restart API and use generated credentials from ignored `.env`. |
