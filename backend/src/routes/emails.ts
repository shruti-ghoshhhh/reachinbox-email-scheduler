import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { authenticateJWT, type AuthRequest } from '../middleware/auth';
import { emailQueue, getQueueStats } from '../queues/emailQueue';
import { indexEmailJobsBulk, searchEmailJobs } from '../config/elasticsearch';
import { getRateLimitStatus } from '../services/rateLimitService';
import { env } from '../config/env';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const router = Router();

// All routes require auth
router.use(authenticateJWT);

// ── Schedule Email(s) ──────────────────────────────────────────────────────
const scheduleSchema = z.object({
  senderEmail: z.string().email(),
  senderName: z.string().min(1),
  recipients: z.array(z.string().email()).min(1).max(5000),
  subject: z.string().min(1),
  body: z.string().min(1),
  startAt: z.string().datetime(),
  delayBetweenEmailsMs: z.number().int().min(0).max(3600000).default(2000),
  hourlyLimit: z.number().int().min(1).max(10000).optional(),
  campaignId: z.string().optional(),
});

router.post('/schedule', async (req: AuthRequest, res: Response) => {
  const parseResult = scheduleSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      message: 'Validation error',
      error: parseResult.error.format(),
    });
    return;
  }

  const {
    senderEmail,
    senderName,
    recipients,
    subject,
    body,
    startAt,
    delayBetweenEmailsMs,
    hourlyLimit,
    campaignId,
  } = parseResult.data;

  const userId = req.authUser!.userId;

  try {
    // Upsert sender
    const sender = await prisma.sender.upsert({
      where: { email_userId: { email: senderEmail, userId } },
      create: { email: senderEmail, name: senderName, userId },
      update: { name: senderName },
    });

    const startTime = new Date(startAt);
    const campaignRef = campaignId ?? uuidv4();
    // Use provided hourlyLimit or fallback to env; controls overflow spread
    const effectiveHourlyLimit = hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER;

    // ── Build all records at once ─────────────────────────────────────────
    // Overflow emails (beyond hourlyLimit in the first hour) are pushed into
    // subsequent hours to stay within the rate limit.
    // Q: What happens at email 201 if the limit is 200/hour?
    // A: It is placed in the next hour window (hourOffset=1, posInHour=0).
    const hourStrideMs = Math.max(3600000, effectiveHourlyLimit * delayBetweenEmailsMs);
    const records = recipients.map((recipient, i) => {
      const hourOffset = Math.floor(i / effectiveHourlyLimit);
      const posInHour = i % effectiveHourlyLimit;
      const scheduledAt = new Date(
        startTime.getTime() + hourOffset * hourStrideMs + posInHour * delayBetweenEmailsMs
      );
      const idempotencyKey = `${userId}_${sender.id}_${recipient}_${subject}_${scheduledAt.getTime()}`;
      return { recipient, scheduledAt, idempotencyKey };
    });

    // ── Bulk insert (skip duplicates via idempotencyKey unique constraint) ─
    await prisma.emailJob.createMany({
      data: records.map(({ recipient, scheduledAt, idempotencyKey }) => ({
        idempotencyKey,
        userId,
        senderId: sender.id,
        recipientEmail: recipient,
        subject,
        body,
        scheduledAt,
        status: 'SCHEDULED' as const,
        campaignId: campaignRef,
      })),
      skipDuplicates: true,
    });

    // ── Fetch newly created jobs for BullMQ enqueue ───────────────────────
    const createdJobs = await prisma.emailJob.findMany({
      where: {
        campaignId: campaignRef,
        userId,
      },
      select: {
        id: true,
        idempotencyKey: true,
        scheduledAt: true,
        recipientEmail: true,
        createdAt: true,
      },
    });

    // Build lookup map
    const jobMap = new Map(createdJobs.map((j) => [j.idempotencyKey, j]));

    // ── Bulk enqueue via addBulk (much faster than a loop for 1000+ emails) ─
    const bullJobs = await emailQueue.addBulk(
      records
        .filter((r) => jobMap.has(r.idempotencyKey))
        .map(({ recipient, scheduledAt, idempotencyKey }) => {
          const dbJob = jobMap.get(idempotencyKey)!;
          const delay = Math.max(0, scheduledAt.getTime() - Date.now());
          return {
            name: 'send-email',
            data: {
              emailJobId: dbJob.id,
              userId,
              senderId: sender.id,
              senderEmail,
              senderName,
              recipientEmail: recipient,
              subject,
              body,
              scheduledAt: scheduledAt.toISOString(),
              idempotencyKey,
              hourlyLimit: effectiveHourlyLimit,
              delayBetweenEmailsMs,
            },
            opts: {
              jobId: idempotencyKey, // BullMQ deduplicates by jobId
              delay,
            },
          };
        })
    );

    // ── Update bullJobId references (batch transaction) ───────────────────
    const bullJobUpdates = bullJobs
      .filter((bj) => bj.id && bj.data?.idempotencyKey)
      .map((bj) =>
        prisma.emailJob.update({
          where: { idempotencyKey: bj.data.idempotencyKey },
          data: { bullJobId: bj.id },
        })
      );

    if (bullJobUpdates.length > 0) {
      await prisma.$transaction(bullJobUpdates);
    }

    // ── Bulk index in Elasticsearch ────────────────────────────────────────
    await indexEmailJobsBulk(
      createdJobs.map((j) => ({
        id: j.id,
        userId,
        senderId: sender.id,
        senderEmail,
        recipientEmail: j.recipientEmail,
        subject,
        body,
        scheduledAt: j.scheduledAt,
        status: 'QUEUED',
        campaignId: campaignRef,
        createdAt: j.createdAt,
      }))
    );

    res.status(201).json({
      success: true,
      data: {
        campaignId: campaignRef,
        scheduled: createdJobs.length,
        totalRecipients: recipients.length,
        startAt: startTime.toISOString(),
        hourlyLimit: effectiveHourlyLimit,
        hourlySpread: Math.ceil(recipients.length / effectiveHourlyLimit),
      },
      message: `${createdJobs.length} emails scheduled across ${Math.ceil(recipients.length / effectiveHourlyLimit)} hour window(s)`,
    });
  } catch (err) {
    console.error('Schedule error:', err);
    res.status(500).json({ success: false, message: 'Failed to schedule emails' });
  }
});

// ── Get Scheduled Emails ───────────────────────────────────────────────────
router.get('/scheduled', async (req: AuthRequest, res: Response) => {
  const page = parseInt((req.query.page as string) ?? '1', 10);
  const limit = parseInt((req.query.limit as string) ?? '20', 10);
  const skip = (page - 1) * limit;
  const search = req.query.search as string | undefined;

  try {
    let whereClause: Record<string, unknown> = {
      userId: req.authUser!.userId,
      status: { in: ['SCHEDULED', 'QUEUED', 'RATE_LIMITED', 'SENDING'] },
    };

    if (search) {
      // Use Elasticsearch for full-text search
      const ids = await searchEmailJobs(search, req.authUser!.userId);
      if (ids.length > 0) {
        whereClause = { id: { in: ids }, userId: req.authUser!.userId, status: { in: ['SCHEDULED', 'QUEUED', 'RATE_LIMITED', 'SENDING'] } };
      } else {
        res.json({ success: true, data: [], total: 0, page, limit, totalPages: 0 });
        return;
      }
    }

    const [total, jobs] = await Promise.all([
      prisma.emailJob.count({ where: whereClause }),
      prisma.emailJob.findMany({
        where: whereClause,
        include: { sender: { select: { email: true, name: true } } },
        orderBy: { scheduledAt: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      success: true,
      data: jobs.map((j) => ({
        ...j,
        senderEmail: j.sender.email,
        senderName: j.sender.name,
        scheduledAt: j.scheduledAt.toISOString(),
        sentAt: j.sentAt?.toISOString() ?? null,
        createdAt: j.createdAt.toISOString(),
        updatedAt: j.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Get scheduled error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch scheduled emails' });
  }
});

// ── Get Sent Emails ────────────────────────────────────────────────────────
router.get('/sent', async (req: AuthRequest, res: Response) => {
  const page = parseInt((req.query.page as string) ?? '1', 10);
  const limit = parseInt((req.query.limit as string) ?? '20', 10);
  const skip = (page - 1) * limit;
  const search = req.query.search as string | undefined;

  try {
    let whereClause: Record<string, unknown> = {
      userId: req.authUser!.userId,
      status: { in: ['SENT', 'FAILED'] },
    };

    if (search) {
      const ids = await searchEmailJobs(search, req.authUser!.userId);
      if (ids.length > 0) {
        whereClause = { id: { in: ids }, userId: req.authUser!.userId, status: { in: ['SENT', 'FAILED'] } };
      } else {
        res.json({ success: true, data: [], total: 0, page, limit, totalPages: 0 });
        return;
      }
    }

    const [total, jobs] = await Promise.all([
      prisma.emailJob.count({ where: whereClause }),
      prisma.emailJob.findMany({
        where: whereClause,
        include: { sender: { select: { email: true, name: true } } },
        orderBy: { sentAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      success: true,
      data: jobs.map((j) => ({
        ...j,
        senderEmail: j.sender.email,
        senderName: j.sender.name,
        scheduledAt: j.scheduledAt.toISOString(),
        sentAt: j.sentAt?.toISOString() ?? null,
        createdAt: j.createdAt.toISOString(),
        updatedAt: j.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Get sent error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch sent emails' });
  }
});

// ── Search emails (dedicated Elasticsearch endpoint) ─────────────────────
router.get('/search', async (req: AuthRequest, res: Response) => {
  const q = req.query.q as string;
  if (!q) {
    res.status(400).json({ success: false, message: 'q parameter is required' });
    return;
  }

  try {
    const ids = await searchEmailJobs(q, req.authUser!.userId);
    const jobs = await prisma.emailJob.findMany({
      where: { id: { in: ids }, userId: req.authUser!.userId },
      include: { sender: { select: { email: true, name: true } } },
    });

    res.json({
      success: true,
      data: jobs.map((j) => ({
        ...j,
        senderEmail: j.sender.email,
        senderName: j.sender.name,
        scheduledAt: j.scheduledAt.toISOString(),
        sentAt: j.sentAt?.toISOString() ?? null,
        createdAt: j.createdAt.toISOString(),
        updatedAt: j.updatedAt.toISOString(),
      })),
      total: ids.length,
      query: q,
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ success: false, message: 'Search failed' });
  }
});

// ── Get Queue Stats ───────────────────────────────────────────────────────
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const [queueStats, dbStats] = await Promise.all([
      getQueueStats(),
      prisma.emailJob.groupBy({
        by: ['status'],
        where: { userId: req.authUser!.userId },
        _count: { status: true },
      }),
    ]);

    const statusCounts: Record<string, number> = {};
    dbStats.forEach((s) => {
      statusCounts[s.status] = s._count.status;
    });

    res.json({
      success: true,
      data: {
        queue: queueStats,
        emails: statusCounts,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

// ── Get Rate Limit Status ─────────────────────────────────────────────────
router.get('/rate-limit/:senderId', async (req: AuthRequest, res: Response) => {
  try {
    const { senderId } = req.params;
    const sender = await prisma.sender.findFirst({
      where: { id: senderId, userId: req.authUser!.userId },
    });

    if (!sender) {
      res.status(404).json({ success: false, message: 'Sender not found' });
      return;
    }

    const status = await getRateLimitStatus(senderId);
    res.json({ success: true, data: { ...status, senderEmail: sender.email } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch rate limit status' });
  }
});

// ── Cancel Email ──────────────────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const job = await prisma.emailJob.findFirst({
      where: { id, userId: req.authUser!.userId },
    });

    if (!job) {
      res.status(404).json({ success: false, message: 'Email job not found' });
      return;
    }

    if (job.status === 'SENT') {
      res.status(400).json({ success: false, message: 'Cannot cancel already sent email' });
      return;
    }

    // Remove from BullMQ queue
    if (job.bullJobId) {
      const bullJob = await emailQueue.getJob(job.bullJobId);
      if (bullJob) {
        await bullJob.remove();
      }
    }

    await prisma.emailJob.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    res.json({ success: true, message: 'Email cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to cancel email' });
  }
});

// ── Get single email ──────────────────────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const job = await prisma.emailJob.findFirst({
      where: { id: req.params.id, userId: req.authUser!.userId },
      include: { sender: { select: { email: true, name: true } } },
    });

    if (!job) {
      res.status(404).json({ success: false, message: 'Email not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        ...job,
        senderEmail: job.sender.email,
        senderName: job.sender.name,
        scheduledAt: job.scheduledAt.toISOString(),
        sentAt: job.sentAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch email' });
  }
});

export default router;
