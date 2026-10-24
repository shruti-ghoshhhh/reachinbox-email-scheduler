# ReachInbox – Full-Stack Email Job Scheduler

A production-grade email scheduling system with BullMQ + Redis, PostgreSQL, Elasticsearch, Google OAuth, Slack notifications, and a Next.js dashboard.

---

## 🏗 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                        │
│  Login → Dashboard → Compose → Scheduled/Sent Tables + Search   │
└─────────────────────────────────────┬───────────────────────────┘
                                      │ REST API (JWT)
┌─────────────────────────────────────▼───────────────────────────┐
│                     Backend (Express + TS)                       │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐    │
│  │ Auth Routes │  │ Email Routes │  │ Slack Routes         │    │
│  │ Google OAuth│  │ /schedule    │  │ /connect /callback   │    │
│  └─────────────┘  │ /scheduled   │  └──────────────────────┘    │
│                   │ /sent        │                               │
│                   └──────┬───────┘                               │
│                          │                                       │
│           ┌──────────────▼───────────────────────┐              │
│           │         BullMQ Email Queue            │              │
│           │  (Redis-backed, persistent delayed    │              │
│           │   jobs — survives restarts)           │              │
│           └──────────────┬───────────────────────┘              │
│                          │                                       │
│           ┌──────────────▼───────────────────────┐              │
│           │       Email Worker (BullMQ)           │              │
│           │  1. Idempotency check                 │              │
│           │  2. Rate limit check (Redis counter)  │              │
│           │  3. Slack notify if rate limit hit    │              │
│           │  4. Inter-email delay (configurable)  │              │
│           │  5. Send via Ethereal SMTP            │              │
│           │  6. Update DB + Elasticsearch         │              │
│           └──────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
         │             │                │
    PostgreSQL        Redis        Elasticsearch
    (jobs, users,   (BullMQ,      (search index
     senders)        rate limit    for emails)
                     counters)
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose (for Redis, PostgreSQL, Elasticsearch)
- Google OAuth credentials
- Slack App credentials (optional)

---

### 1. Start Infrastructure (Docker)

```bash
docker-compose up -d
```

This starts:
- **PostgreSQL** on port 5432
- **Redis** on port 6379
- **Elasticsearch** on port 9200

---

### 2. Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your Google OAuth credentials
```

**Required `.env` values:**

```env
DATABASE_URL="postgresql://reachinbox:reachinbox_secret@localhost:5432/reachinbox_db"
REDIS_HOST=localhost
REDIS_PORT=6379
ELASTICSEARCH_URL=http://localhost:9200

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback

JWT_SECRET=your_super_secret_key_here
FRONTEND_URL=http://localhost:3000

# Optional — auto-created if not provided
ETHEREAL_USER=
ETHEREAL_PASS=

# Rate limiting (configurable)
MAX_EMAILS_PER_HOUR_PER_SENDER=50
GLOBAL_MAX_EMAILS_PER_HOUR=200
WORKER_CONCURRENCY=5
EMAIL_SEND_DELAY_MS=2000

# Slack OAuth (optional)
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret
```

**Run migrations:**

```bash
cd backend
npx prisma migrate dev --name init
```

**Start the API server:**

```bash
npm run dev
```

**Start the worker (separate terminal):**

```bash
npm run worker
```

---

### 3. Frontend Setup

```bash
cd frontend
# .env.local is already configured with:
# NEXT_PUBLIC_API_URL=http://localhost:4000

npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 🔑 Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable **Google+ API** and **Google OAuth 2.0**
4. Add Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`
5. Copy `Client ID` and `Client Secret` to `.env`

---

## 📬 Ethereal Email Setup

Ethereal is a **fake SMTP service** for testing — no real emails are sent.

- If `ETHEREAL_USER` and `ETHEREAL_PASS` are **not set**, the app auto-creates a test account on first run.
- After each email send, a **preview URL** is returned and stored in the database.
- View sent emails at: [https://ethereal.email/messages](https://ethereal.email/messages)

---

## 💬 Slack Setup

1. Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps)
2. Add OAuth scopes: `chat:write`, `chat:write.public`
3. Set redirect URL: `http://localhost:4000/api/slack/callback`
4. Copy credentials to `.env`
5. Click "Connect Slack" in the dashboard to authorize

---

## 📊 BullMQ Dashboard

Real-time queue visibility at: **[http://localhost:4000/admin/queues](http://localhost:4000/admin/queues)**

Shows:
- Waiting / Delayed / Active / Completed / Failed jobs
- Job details, retry counts, error messages
- Real-time updates

---

## 🔄 Scheduling & Persistence

### How It Works

1. **API receives** email schedule request with `recipients[]`, `startAt`, `delayBetweenEmailsMs`
2. For each recipient, we compute `scheduledAt = startAt + (i * delay)`
3. A **DB record** is created first with `status=SCHEDULED`
4. A **BullMQ delayed job** is added with `delay = scheduledAt - now()` and a **unique `jobId`** (idempotency key)
5. BullMQ stores the job in **Redis** — it will fire at the correct time regardless of server restarts

### Server Restart Survival

- BullMQ jobs are stored in **Redis with persistence** (`appendonly yes` in docker-compose)
- On restart, the worker reconnects to Redis and picks up all pending/delayed jobs automatically
- **No jobs are lost** — future emails still send at the right time
- DB records track status independently — the worker checks DB state before processing

### Idempotency

Each job has a unique `idempotencyKey = userId_senderId_recipientEmail_subject_scheduledAt`.

- BullMQ uses this as `jobId` — duplicate jobs are **silently rejected** by BullMQ
- The worker also checks if `status === 'SENT'` in DB before processing
- This guarantees **at-most-once delivery**

---

## ⚡ Rate Limiting

### Design

We use **Redis-backed sliding window counters** keyed by `rate_limit:sender:{senderId}:{hourWindow}`.

```
hourWindow = floor(Date.now() / 3600000)  // epoch hour number
```

- **INCR + EXPIRE** are used atomically via Redis pipelines
- Safe across **multiple workers and instances** — Redis is the single source of truth
- No in-memory state involved

### When Limit is Reached

1. Worker decrements the counter (we're not sending)
2. Job status is updated to `RATE_LIMITED` in DB
3. Slack notification is sent to the user (if connected)
4. Job is **rescheduled** to the next hour window with a small buffer (+5s)
5. Order is preserved as much as possible (new jobId with timestamp suffix)
6. **No jobs are dropped**

### Configuration

```env
MAX_EMAILS_PER_HOUR_PER_SENDER=50   # Per-sender limit
GLOBAL_MAX_EMAILS_PER_HOUR=200       # Global fallback
```

---

## ⚙️ Worker Concurrency & Delay

- **Concurrency**: `WORKER_CONCURRENCY=5` — 5 emails processed in parallel
- **Inter-email delay**: `EMAIL_SEND_DELAY_MS=2000` — 2 second minimum delay between sends (via BullMQ `limiter` + `setTimeout`)
- Both are fully configurable via `.env`

---

## 🚦 Behavior Under Load (1000+ emails)

When 1000 emails are scheduled for the same time:

1. All 1000 BullMQ delayed jobs fire simultaneously
2. Worker processes `WORKER_CONCURRENCY` at a time (e.g., 5)
3. Each sender hits rate limit after `MAX_EMAILS_PER_HOUR_PER_SENDER` (e.g., 50)
4. Remaining jobs are pushed to the **next hour window automatically**
5. No emails are dropped — all eventually deliver

---

## 🗂 Project Structure

```
reachinbox/
├── docker-compose.yml
├── README.md
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── env.ts           # Zod-validated env vars
│   │   │   ├── database.ts      # Prisma client singleton
│   │   │   ├── redis.ts         # IORedis connection
│   │   │   └── elasticsearch.ts # ES client + indexing
│   │   ├── queues/
│   │   │   └── emailQueue.ts    # BullMQ queue definition
│   │   ├── workers/
│   │   │   └── emailWorker.ts   # BullMQ worker (sends emails)
│   │   ├── routes/
│   │   │   ├── auth.ts          # Google OAuth
│   │   │   ├── emails.ts        # Schedule/list emails
│   │   │   ├── slack.ts         # Slack OAuth + status
│   │   │   └── senders.ts       # Sender management
│   │   ├── services/
│   │   │   ├── etherealService.ts  # Nodemailer + Ethereal
│   │   │   ├── rateLimitService.ts # Redis rate limit
│   │   │   └── slackService.ts     # Slack Web API
│   │   ├── middleware/
│   │   │   └── auth.ts          # JWT middleware
│   │   ├── types/
│   │   │   └── index.ts         # Shared types
│   │   └── server.ts            # Express app
│   └── prisma/
│       └── schema.prisma
└── frontend/
    └── src/
        ├── app/
        │   ├── login/page.tsx       # Login page
        │   ├── auth/callback/page.tsx # OAuth callback
        │   └── dashboard/page.tsx   # Main dashboard
        ├── components/
        │   ├── dashboard/
        │   │   ├── Header.tsx
        │   │   ├── ComposeModal.tsx
        │   │   ├── ScheduledEmailsTable.tsx
        │   │   ├── SentEmailsTable.tsx
        │   │   └── StatsBar.tsx
        │   └── ui/
        │       ├── StatusBadge.tsx
        │       ├── LoadingSpinner.tsx
        │       ├── EmptyState.tsx
        │       └── CsvUploader.tsx
        ├── contexts/
        │   └── AuthContext.tsx
        ├── lib/
        │   └── api.ts              # API client
        └── types/
            └── index.ts            # Frontend types
```

---

## ✅ Features Implemented

### Backend
- [x] Email scheduling via BullMQ delayed jobs (no cron)
- [x] PostgreSQL storage with Prisma ORM
- [x] Idempotency (no duplicate sends)
- [x] Redis-backed rate limiting (per-sender, per-hour window)
- [x] Jobs rescheduled (not dropped) on rate limit
- [x] Slack OAuth + real `chat.postMessage` notification on rate limit
- [x] Graceful Slack no-op if not connected
- [x] Configurable worker concurrency
- [x] Configurable inter-email delay
- [x] Multiple sender support
- [x] Ethereal Email (fake SMTP) with preview URLs
- [x] Elasticsearch indexing for email search
- [x] BullMQ Bull Board dashboard
- [x] Google OAuth authentication
- [x] Server restart persistence (Redis-stored jobs)

### Frontend
- [x] Google OAuth login (real, not mocked)
- [x] User profile in header (name, email, avatar)
- [x] Logout
- [x] Scheduled emails table with pagination + search
- [x] Sent emails table with pagination + search + Ethereal preview links
- [x] Compose modal with CSV/TXT upload and email count
- [x] Scheduling options (start time, delay, hourly limit)
- [x] Stats bar (scheduled, sent, rate limited, active)
- [x] Slack connect button with status
- [x] Loading states (skeleton rows)
- [x] Empty states
- [x] Toast notifications
- [x] Auto-refresh every 15 seconds
- [x] Link to BullMQ Board

---

## 🔧 Trade-offs & Known Behaviors

### Crash window: SENDING → lost email (mitigated)

When a worker claims a job (moves it to `SENDING`) and is then killed *before* the SMTP call completes, the row stays in `SENDING` forever and the email is never delivered.

**Mitigation (implemented):** On worker startup, any row stuck in `SENDING` for more than **60 seconds** is automatically reset to `QUEUED` and re-enqueued. The 60-second window is configurable via `STALE_SENDING_THRESHOLD_MS` in `emailWorker.ts`. The practical risk window is therefore bounded to one restart cycle.

**Residual trade-off:** If the SMTP call *succeeded* but the DB update failed (the reverse case), the email is delivered but the DB still shows `SENDING`. The reclaim will re-send it, producing a duplicate. This is extremely unlikely with Ethereal (local network) but is an inherent at-least-once trade-off.

---

### Rate limit counter — no decrement on rate-limited path

The Lua script that enforces per-sender rate limits uses **check-then-increment**: it only increments the counter if the current value is *below* the limit. If already at the limit, it returns the existing count without touching the key.

This means when a job is rate-limited, **there is nothing to decrement** — and calling a decrement would undercount and allow extra emails through in the same window. The worker correctly skips the decrement call in this path.

---

### Hourly limit and delay from the compose form

Both `hourlyLimit` and `delayBetweenEmailsMs` submitted from the compose form are accepted by the `POST /api/emails/schedule` endpoint and used directly when spreading recipients across hour windows:

```
scheduledAt = startAt + (hourOffset × 3600000) + (posInHour × delayBetweenEmailsMs)
```

The env defaults (`MAX_EMAILS_PER_HOUR_PER_SENDER`, `EMAIL_SEND_DELAY_MS`) serve only as fallbacks when the form fields are omitted.

---

### Ethereal accounts persist across restarts

On first startup, 3 Ethereal test accounts are created via the Ethereal API and saved to `backend/.ethereal-accounts.json`. On subsequent restarts the file is read and transporters are rebuilt from the saved credentials — no new API call is made. This means **the same sender email addresses and their Ethereal inboxes survive restarts**.

To reset accounts, delete `backend/.ethereal-accounts.json` and restart.

> **Security note:** `.ethereal-accounts.json` is listed in `.gitignore` and is never committed.

---

### Rate-limited job ordering

When a job is rate-limited and rescheduled, the new BullMQ `jobId` includes `Date.now()` as a suffix (`idempotencyKey_retry_<timestamp>`). Jobs rate-limited earlier receive a smaller timestamp and are therefore processed first in the next window — **relative order is preserved** on a best-effort basis within each sender.

---

### Slack notifications

`sendSlackRateLimitNotification` looks up the *email owner's* Slack token from the database by `userId`. If the user has not connected Slack (or has since disconnected), the function logs an info message and returns without error — **it no-ops cleanly**. Re-connecting Slack (even after a disconnect) picks up immediately on the next rate-limit event without a backend restart.

---

### Elasticsearch is optional

If Elasticsearch is unavailable, full-text search falls back gracefully. Core scheduling and sending functionality is not affected.

---

### Ethereal email

Emails are fake — they are captured by Ethereal's servers. Preview URLs are stored in the DB and displayed in the dashboard. No real emails are ever sent.

---

### Worker separation

The worker (`npm run worker`) is a separate process for production-grade isolation. It can be scaled horizontally — multiple workers share the same Redis queue and the atomic `SENDING` claim prevents duplicate sends.

