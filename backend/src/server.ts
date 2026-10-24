import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { env } from './config/env';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { connectElasticsearch } from './config/elasticsearch';
import { emailQueue } from './queues/emailQueue';
import { initEtherealAccounts } from './services/etherealService';

import authRoutes from './routes/auth';
import emailRoutes from './routes/emails';
import slackRoutes from './routes/slack';
import senderRoutes from './routes/senders';


const app = express();

// ── Middleware ────────────────────────────────────────────────────────────
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: env.SESSION_SECRET,
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

app.use('/admin/queues', serverAdapter.getRouter());
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
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

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
