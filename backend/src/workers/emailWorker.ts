import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { prisma } from '../config/database';
import { sendEmail } from '../services/etherealService';
import {
  checkAndIncrementRateLimit,
  getNextWindowDelay,
  shouldSendSlackNotification,
  waitForSenderSendSlot,
} from '../services/rateLimitService';
import { sendSlackRateLimitNotification } from '../services/slackService';
import { indexEmailJob, updateEmailJobIndex } from '../config/elasticsearch';
import { emailQueue, EMAIL_QUEUE_NAME, type EmailJobData } from '../queues/emailQueue';
import { env } from '../config/env';
import { reconcileScheduledEmailJobs } from '../services/emailQueueReconciliation';

/**
 * Reclaim any emails stuck in SENDING from a previous worker crash.
 * If a worker is killed between the DB claim and the SMTP send, the row
 * stays SENDING forever and the email is never delivered.
 * We fix this by resetting rows older than STALE_SENDING_THRESHOLD_MS
 * back to QUEUED and re-enqueuing them.
 */
const STALE_SENDING_THRESHOLD_MS = 5 * 60_000; // allow slow SMTP calls to finish before reclaiming
const STALE_RECOVERY_RETRY_MS = 30_000;
const scheduledRecoveryTimers = new Map<string, NodeJS.Timeout>();

async function reclaimStaleSendingJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_SENDING_THRESHOLD_MS);

  // Atomically move all stale SENDING rows → QUEUED
  const staleJobs = await prisma.emailJob.findMany({
    where: { status: 'SENDING', updatedAt: { lt: cutoff } },
    include: { sender: { select: { email: true, name: true } } },
  });
  let updated = 0;
  for (const job of staleJobs) {
    const claim = await prisma.emailJob.updateMany({
      where: { id: job.id, status: 'SENDING', updatedAt: { lt: cutoff } },
      data: { status: 'QUEUED' },
    });
    if (!claim.count) continue;
    updated++;
    try {
      await emailQueue.add('send-email', {
      emailJobId: job.id, userId: job.userId, senderId: job.senderId,
      senderEmail: job.sender.email, senderName: job.sender.name,
      recipientEmail: job.recipientEmail, subject: job.subject, body: job.body,
      scheduledAt: job.scheduledAt.toISOString(), idempotencyKey: job.idempotencyKey,
      hourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      delayBetweenEmailsMs: env.EMAIL_SEND_DELAY_MS,
      }, { jobId: `${job.idempotencyKey}_recovery_${Date.now()}_${updated}`, delay: 0 });
    } catch (error) {
      // Restore SENDING so a later recovery scan can safely retry the claim.
      await prisma.emailJob.updateMany({ where: { id: job.id, status: 'QUEUED' }, data: { status: 'SENDING' } });
      throw error;
    }
  }

  if (updated > 0) {
    console.warn(
      `⚠️  Reclaimed ${updated} stale SENDING job(s) — worker likely crashed mid-send. Re-enqueuing.`
    );

  }
}

// Recover DB rows that were committed before a queue write failed or the API
// process stopped. Stable BullMQ job IDs make concurrent scans idempotent.
let reconciliationRunning = false;
async function runQueueReconciliation(): Promise<void> {
  if (reconciliationRunning) return;
  reconciliationRunning = true;
  try {
    const result = await reconcileScheduledEmailJobs();
    if (result.enqueued || result.failed) {
      console.log(`Queue reconciliation: enqueued=${result.enqueued}, failed=${result.failed}`);
    }
  } catch (err) {
    console.error('Failed to reconcile scheduled email jobs:', err);
  } finally {
    reconciliationRunning = false;
  }
}

void runQueueReconciliation();
const reconciliationTimer = setInterval(() => void runQueueReconciliation(), 30_000);
reconciliationTimer.unref();

// Run stale-SENDING recovery on startup
reclaimStaleSendingJobs().catch((err) =>
  console.error('Failed to reclaim stale SENDING jobs:', err)
);

console.log(`🚀 Email worker starting with concurrency=${env.WORKER_CONCURRENCY}`);

const worker = new Worker<EmailJobData>(
  EMAIL_QUEUE_NAME,
  async (job: Job<EmailJobData>) => {
    const {
      emailJobId,
      userId,
      senderId,
      senderEmail,
      senderName,
      recipientEmail,
      subject,
      body,
      idempotencyKey, hourlyLimit = env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      delayBetweenEmailsMs = env.EMAIL_SEND_DELAY_MS,
    } = job.data;

    console.log(`📨 Processing job ${job.id} → ${recipientEmail}`);

    // ── 1. Atomic idempotency: transition SCHEDULED/QUEUED → SENDING ───────
    // Only one worker can claim a job by atomically changing its status.
    // If another worker already claimed it, `count` will be 0 and we skip.
    // Stamp claimedAt (via updatedAt) so the stale-SENDING reclaimer can
    // detect workers that crashed between claim and SMTP send.
    const updated = await prisma.$executeRaw`
      UPDATE email_jobs
      SET status = 'SENDING', "updatedAt" = now()
      WHERE id = ${emailJobId}
        AND status IN ('SCHEDULED', 'QUEUED', 'RATE_LIMITED')
    `;

    if (updated === 0) {
      // Already being processed or already sent – skip (idempotency)
      const existing = await prisma.emailJob.findUnique({
        where: { id: emailJobId },
        select: { status: true },
      });
      console.log(`⚠️  Email ${emailJobId} already in status=${existing?.status}, skipping`);
      return;
    }

    // ── 2. Rate limit check (Lua-script atomic INCR-if-below-limit) ────────
    //
    // IMPORTANT: The Lua script only increments when current < limit.
    // If already AT the limit it returns the existing count WITHOUT
    // incrementing — so we must NOT call decrementRateLimit here, because
    // there is nothing to undo and a spurious decrement would let an extra
    // email through the next check.
    let rateLimitResult;
    try {
      // Quota is one admission per logical email per UTC hour. BullMQ SMTP
      // retries reuse this reservation instead of consuming another slot.
      rateLimitResult = await checkAndIncrementRateLimit(senderId, hourlyLimit, emailJobId);
    } catch (error) {
      await prisma.emailJob.updateMany({ where: { id: emailJobId, status: 'SENDING' }, data: { status: 'QUEUED' } });
      throw error;
    }

    if (!rateLimitResult.allowed) {
      // No decrement needed — the script did NOT increment in this case.
      console.log(
        `⏳ Rate limit hit for sender ${senderEmail}. Rescheduling to next window.`
      );

      try {
        const delay = await getNextWindowDelay(senderId);
        await emailQueue.add('send-email', job.data, {
          jobId: `${idempotencyKey}_retry_${Date.now()}`,
          delay,
        });
        await prisma.emailJob.update({ where: { id: emailJobId }, data: { status: 'RATE_LIMITED' } });
        await updateEmailJobIndex(emailJobId, { status: 'RATE_LIMITED' });

        const shouldNotify = await shouldSendSlackNotification(senderId);
        if (shouldNotify) await sendSlackRateLimitNotification(userId, senderEmail, rateLimitResult.limit, rateLimitResult.nextWindowAt);
      } catch (error) {
        await prisma.emailJob.updateMany({ where: { id: emailJobId, status: 'SENDING' }, data: { status: 'QUEUED' } });
        throw error;
      }

      return; // Don't fail the job — it's been rescheduled
    }

    // ── 3. Apply inter-email delay (to mimic provider throttling) ──────────
    await waitForSenderSendSlot(senderId, delayBetweenEmailsMs);

    // ── 4. Send email via Ethereal SMTP ────────────────────────────────────
    let result: { messageId: string; previewUrl: string } | null = null;
    try {
      result = await sendEmail({
        from: senderEmail,
        fromName: senderName,
        to: recipientEmail,
        subject,
        html: body,
      });
    } catch (smtpError) {
      // BullMQ retries this same payload; QUEUED permits its atomic claim.
      await prisma.emailJob.update({
        where: { id: emailJobId },
        data: { status: 'QUEUED', errorMessage: (smtpError as Error).message },
      });
      throw smtpError; // Let BullMQ handle retry with backoff
    }

    // ── 5. Mark as SENT in DB ──────────────────────────────────────────────
    // Known trade-off: crash window between SMTP success and DB update.
    // On retry, the atomic status check above skips (status=SENDING),
    // so we do a direct update here for crash recovery.
    const sentAt = new Date();
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: 'SENT',
        sentAt,
        previewUrl: result.previewUrl,
        errorMessage: null,
      },
    });

    // ── 6. Update Elasticsearch index ─────────────────────────────────────
    await updateEmailJobIndex(emailJobId, {
      status: 'SENT',
      sentAt: sentAt.toISOString(),
      previewUrl: result.previewUrl,
    });

    console.log(`✅ Email sent: ${emailJobId} → ${recipientEmail} | Preview: ${result.previewUrl}`);
  },
  {
    connection: redisConnection,
    concurrency: env.WORKER_CONCURRENCY,
    // Note: BullMQ limiter is per-queue, not per-sender.
    // Per-sender rate limiting is handled via Redis Lua script inside the processor.
    limiter: {
      max: 50, // global queue throughput cap
      duration: 1000,
    },
  }
);

worker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

/**
 * A stalled job can be retried by BullMQ before its DB row is old enough to
 * reclaim. That retry sees SENDING and exits, so arrange one event-driven
 * follow-up scan after the existing safety window. This avoids a polling loop
 * while still recovering rows that become stale after worker startup.
 */
worker.on('stalled', (jobId) => {
  if (scheduledRecoveryTimers.has(jobId)) return;

  const timer = setTimeout(() => {
    scheduledRecoveryTimers.delete(jobId);
    reclaimStaleSendingJobs().catch((err) => {
      console.error(`Failed to recover stalled job ${jobId}:`, err);
      // Keep recovery event-driven and retry transient Redis/DB failures.
      scheduleStaleRecovery(jobId, STALE_RECOVERY_RETRY_MS);
    });
  }, STALE_SENDING_THRESHOLD_MS);
  timer.unref();
  scheduledRecoveryTimers.set(jobId, timer);
});

function scheduleStaleRecovery(jobId: string, delayMs: number): void {
  if (scheduledRecoveryTimers.has(jobId)) return;
  const timer = setTimeout(() => {
    scheduledRecoveryTimers.delete(jobId);
    reclaimStaleSendingJobs().catch((err) => {
      console.error(`Failed to recover stalled job ${jobId}:`, err);
      scheduleStaleRecovery(jobId, STALE_RECOVERY_RETRY_MS);
    });
  }, delayMs);
  timer.unref();
  scheduledRecoveryTimers.set(jobId, timer);
}

worker.on('failed', async (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);

  if (job?.data?.emailJobId && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    try {
      // Only mark as FAILED if it hasn't already been handled above
      await prisma.$executeRaw`
        UPDATE email_jobs
        SET status = 'FAILED', "errorMessage" = ${err.message}, "updatedAt" = now()
        WHERE id = ${job.data.emailJobId}
          AND status IN ('SENDING', 'QUEUED')
      `;
      await updateEmailJobIndex(job.data.emailJobId, {
        status: 'FAILED',
        errorMessage: err.message,
      });
    } catch (dbError) {
      console.error('Failed to update job status in DB:', dbError);
    }
  }
});

worker.on('error', (err) => {
  console.error('Worker error:', err);
});

// Graceful shutdown
async function shutdown() {
  console.log('🛑 Shutting down worker...');
  await worker.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { worker };
