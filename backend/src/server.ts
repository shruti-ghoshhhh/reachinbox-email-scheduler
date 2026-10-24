import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { env } from './config/env';
import { RedisSessionStore } from './config/redisSessionStore';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { connectElasticsearch } from './config/elasticsearch';
import { emailQueue } from './queues/emailQueue';
import { initEtherealAccounts } from './services/etherealService';
import { reconcileEmailSearchIndex } from './services/emailSearchIndexReconciliation';

import authRoutes from './routes/auth';
import emailRoutes from './routes/emails';
import slackRoutes from './routes/slack';
import senderRoutes from './routes/senders';
import { requireAdmin } from './middleware/adminAuth';


const app = express();

// Enable this only when the app is behind a trusted TLS-terminating proxy.
app.set('trust proxy', env.TRUST_PROXY);

// ── Middleware ────────────────────────────────────────────────────────────
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: env.SESSION_SECRET,
  store: new RedisSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// ── BullMQ Dashboard ──────────────────────────────────────────────────────
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  // Bull Board's adapter typings lag BullMQ's progress union in the installed versions.
  queues: [new BullMQAdapter(emailQueue) as never],
  serverAdapter,
});

app.use('/admin/queues', requireAdmin, serverAdapter.getRouter());
console.log(`📊 BullMQ Dashboard available at http://localhost:${env.PORT}/admin/queues`);

// ── API Routes ────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/slack', slackRoutes);
app.use('/api/senders', senderRoutes);

// ── Health Check ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ── 404 Handler ───────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ── Error Handler ─────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ── Start Server ──────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    await connectRedis();
    await connectDatabase();
    await connectElasticsearch();
    await initEtherealAccounts();

    app.listen(env.PORT, () => {
      console.log(`🚀 Server running at http://localhost:${env.PORT}`);
      console.log(`📊 BullMQ Board: http://localhost:${env.PORT}/admin/queues`);
      console.log(`🌍 Environment: ${env.NODE_ENV}`);
      void runEmailSearchIndexReconciliation();
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

let searchIndexReconciliationRunning = false;
async function runEmailSearchIndexReconciliation(): Promise<void> {
  if (searchIndexReconciliationRunning) return;
  searchIndexReconciliationRunning = true;
  try {
    const count = await reconcileEmailSearchIndex();
    if (count > 0) console.log(`Elasticsearch backfill indexed ${count} email row(s)`);
  } catch (error) {
    console.warn('Elasticsearch backfill failed; PostgreSQL rows will be retried:', (error as Error).message);
  } finally {
    searchIndexReconciliationRunning = false;
  }
}

// PostgreSQL is authoritative: repeat a bounded-batch scan so rows missed
// during an Elasticsearch outage are eventually indexed after it recovers.
const emailSearchIndexReconciliationTimer = setInterval(
  () => void runEmailSearchIndexReconciliation(),
  60_000,
);
emailSearchIndexReconciliationTimer.unref();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, shutting down...');
  process.exit(0);
});

bootstrap();

export default app;
