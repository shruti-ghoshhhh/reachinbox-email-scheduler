import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { prisma } from '../config/database';
import { sendEmail } from '../services/etherealService';
import {
  checkAndIncrementRateLimit,
  getNextWindowDelay,
  acquireSenderSendSlot,
} from '../services/rateLimitService';
import {
  deliverRateLimitNotification,
  recordRateLimitThreshold,
  retryPendingRateLimitNotifications,
} from '../services/slackNotificationOutbox';
import { indexEmailJob, updateEmailJobIndex } from '../config/elasticsearch';
import { emailQueue, EMAIL_QUEUE_NAME, type EmailJobData } from '../queues/emailQueue';
import { env } from '../config/env';
import { reconcileScheduledEmailJobs } from '../services/emailQueueReconciliation';
import { reclaimStaleSendingJobs, STALE_SENDING_THRESHOLD_MS } from '../services/staleSendingRecovery';
import { deliverAndPersist } from '../services/deliverAndPersist';
import { randomUUID } from 'crypto';
import { ensureCurrentQuotaReservation } from '../services/currentQuotaReservation';

/**
 * Reclaim any emails stuck in SENDING from a previous worker crash.
 * If a worker is killed between the DB claim and the SMTP send, the row
 * stays SENDING forever and the email is never delivered.
 * We fix this by resetting rows older than STALE_SENDING_THRESHOLD_MS
 * back to QUEUED and re-enqueuing them.
 */
const STALE_RECOVERY_RETRY_MS = 30_000;
const scheduledRecoveryTimers = new Map<string, NodeJS.Timeout>();
let slackNotificationRetryRunning = false;
async function runSlackNotificationRetries(): Promise<void> {
  if (slackNotificationRetryRunning) return;
  slackNotificationRetryRunning = true;
  try {
    await retryPendingRateLimitNotifications();
  } catch (error) {
    console.error('Failed to retry pending Slack notifications:', error);
  } finally {
    slackNotificationRetryRunning = false;
  }
}
const slackNotificationRetryTimer = setInterval(() => void runSlackNotificationRetries(), 30_000);
slackNotificationRetryTimer.unref();
void runSlackNotificationRetries();

async function runStaleSendingRecovery(): Promise<void> {
  const updated = await reclaimStaleSendingJobs(prisma, emailQueue, {
    hourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    delayBetweenEmailsMs: env.EMAIL_SEND_DELAY_MS,
  });
  if (updated > 0) {
    console.warn(`⚠️  Reclaimed ${updated} stale SENDING job(s) — re-enqueuing.`);
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
runStaleSendingRecovery().catch((err) =>
  console.error('Failed to reclaim stale SENDING jobs:', err)
);
const staleRecoveryTimer = setInterval(() => {
  runStaleSendingRecovery().catch((err) => console.error('Failed periodic SENDING recovery:', err));
}, 30_000);
staleRecoveryTimer.unref();

console.log(`🚀 Email worker starting with concurrency=${env.WORKER_CONCURRENCY}`);

const worker = new Worker<EmailJobData>(
  EMAIL_QUEUE_NAME,
  async (job: Job<EmailJobData>) => {
    const {
      emailJobId,
      campaignId,
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
    const claimToken = randomUUID();
    const leaseUntil = new Date(Date.now() + STALE_SENDING_THRESHOLD_MS);
    const updated = await prisma.$executeRaw`
      UPDATE email_jobs
      SET status = 'SENDING', "updatedAt" = now(), "claimToken" = ${claimToken}, "claimLeaseExpiresAt" = ${leaseUntil}
      WHERE id = ${emailJobId}
        AND status IN ('SCHEDULED', 'QUEUED', 'RATE_LIMITED')
        OR (id = ${emailJobId} AND status = 'SENDING' AND "claimLeaseExpiresAt" < now() AND "deliveryAttemptStartedAt" IS NULL)
    `;

    if (updated === 0) {
      // Already being processed or already sent – skip (idempotency)
      const existing = await prisma.emailJob.findUnique({
        where: { id: emailJobId },
        select: { status: true, deliveryAttemptStartedAt: true },
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
    const releaseBeforeSmtp = async (message?: string) => {
      await prisma.emailJob.updateMany({
        where: { id: emailJobId, status: 'SENDING', claimToken },
        data: { status: 'QUEUED', claimToken: null, claimLeaseExpiresAt: null, errorMessage: message ?? null },
      });
    };
    const reserveHourlyQuota = async () => {
      let rateLimitResult;
      try {
        // Quota is one admission per logical email per UTC hour. BullMQ SMTP
        // retries reuse this reservation instead of consuming another slot.
        rateLimitResult = await checkAndIncrementRateLimit(
          senderId,
          env.MAX_EMAILS_PER_HOUR_PER_SENDER,
          emailJobId,
          campaignId ?? undefined,
          campaignId ? hourlyLimit : undefined
        );
      } catch (error) {
        await releaseBeforeSmtp((error as Error).message);
        throw error;
      }

      // Alert on the threshold crossing (the admission that reaches the cap),
      // not only on a later denied job. Persist before delivery so transient
      // Slack failures and disconnected/reconnected users remain retryable.
      if (rateLimitResult.allowed && rateLimitResult.currentCount >= rateLimitResult.limit) {
        let notificationId: string;
        try {
          notificationId = await recordRateLimitThreshold({
            userId,
            senderId,
            senderEmail,
            hourlyLimit: rateLimitResult.limit,
            nextWindowAt: rateLimitResult.nextWindowAt,
          });
        } catch (error) {
          // Releasing the claim lets BullMQ retry the same reservation; when
          // Redis/DB recover the threshold crossing is observed again.
          await releaseBeforeSmtp((error as Error).message);
          throw error;
        }
        void deliverRateLimitNotification(notificationId).catch((error) => {
          console.error(`Slack threshold alert for sender ${senderId} remains retryable:`, error);
        });
      }

      if (!rateLimitResult.allowed) {
        // No decrement needed — the script did NOT increment in this case.
        console.log(
          `⏳ Rate limit hit for sender ${senderEmail}. Rescheduling to next window.`
        );

        const delay = await getNextWindowDelay(senderId);
        const nextScheduledAt = new Date(Date.now() + delay);
        const nextBullJobId = `email-${emailJobId}-window-${nextScheduledAt.getTime()}`;
        await prisma.emailJob.update({ where: { id: emailJobId }, data: { status: 'RATE_LIMITED', scheduledAt: nextScheduledAt, bullJobId: nextBullJobId, claimToken: null, claimLeaseExpiresAt: null } });
        try {
          await emailQueue.add('send-email', { ...job.data, scheduledAt: nextScheduledAt.toISOString() }, {
            jobId: nextBullJobId,
            delay,
          });
        } catch (error) {
          // The row is already durable and reconciliation retries this exact ID.
          console.error(`Rate-limited job ${emailJobId} will be reconciled:`, error);
        }
        try {
          await updateEmailJobIndex(emailJobId, { status: 'RATE_LIMITED' });
        } catch (error) {
          console.error(`Failed to update search index for ${emailJobId}:`, error);
        }

        return null; // Don't fail the job — it's been rescheduled
      }
      return rateLimitResult;
    };
    const initialReservation = await reserveHourlyQuota();
    if (!initialReservation) return;

    // ── 3. Apply inter-email delay (to mimic provider throttling) ──────────
    // Legitimate provider waits may exceed the claim lease. Keep the claim
    // alive while this process waits; a dead process still expires normally.
    const waitingLeaseHeartbeat = setInterval(() => {
      void prisma.emailJob.updateMany({
        where: { id: emailJobId, status: 'SENDING', claimToken },
        data: { claimLeaseExpiresAt: new Date(Date.now() + STALE_SENDING_THRESHOLD_MS) },
      }).catch(error => console.error(`Could not renew waiting claim ${emailJobId}:`, error));
    }, Math.floor(STALE_SENDING_THRESHOLD_MS / 3));
    waitingLeaseHeartbeat.unref();
    let releaseSenderSlot: (() => Promise<void>) | undefined;
    try {
      try {
        releaseSenderSlot = await acquireSenderSendSlot(senderId, delayBetweenEmailsMs);
      } catch (error) {
        await releaseBeforeSmtp((error as Error).message);
        throw error;
      }

      // An admission from the previous UTC hour cannot authorize a send now.
      // Reuse the same quota/Slack/defer path; same-hour reservation IDs dedupe.
      if (!await ensureCurrentQuotaReservation(initialReservation, reserveHourlyQuota)) return;

      // Durable evidence written immediately before the external side effect.
      // If the process dies after this point, recovery marks DELIVERY_UNKNOWN
      // and does not automatically resend because SMTP may have accepted it.
      const attemptMarked = await prisma.emailJob.updateMany({
        where: { id: emailJobId, status: 'SENDING', claimToken },
        data: { deliveryAttemptStartedAt: new Date(), claimLeaseExpiresAt: new Date(Date.now() + STALE_SENDING_THRESHOLD_MS) },
      });
      if (!attemptMarked.count) throw new Error(`Lost delivery claim for email ${emailJobId}; SMTP was not called`);

      // ── 4. Send email via Ethereal SMTP ────────────────────────────────────
      const sentAt = new Date();
      const result = await deliverAndPersist(
        () => sendEmail({
          from: senderEmail,
          fromName: senderName,
          to: recipientEmail,
          subject,
          html: body,
        }),
        async (delivery) => {
          await prisma.emailJob.update({
            where: { id: emailJobId },
            data: {
              status: 'SENT',
              sentAt,
              previewUrl: delivery.previewUrl,
              deliveryMessageId: delivery.messageId ?? null,
              claimToken: null,
              claimLeaseExpiresAt: null,
              deliveryAttemptStartedAt: null,
              errorMessage: null,
            },
          });
        },
        async (smtpError, outcome) => {
          const knownNonDelivery = outcome === 'not-delivered';
          // Preserve attempt evidence on socket/unknown outcomes. A BullMQ retry
          // then skips DELIVERY_UNKNOWN instead of sending a possible duplicate.
          await prisma.emailJob.updateMany({
            where: { id: emailJobId, status: 'SENDING', claimToken },
            data: {
              status: knownNonDelivery ? 'QUEUED' : 'DELIVERY_UNKNOWN',
              errorMessage: knownNonDelivery ? (smtpError as Error).message : `SMTP outcome is unknown: ${(smtpError as Error).message}`,
              claimToken: null,
              claimLeaseExpiresAt: null,
              ...(knownNonDelivery ? { deliveryAttemptStartedAt: null } : {}),
            },
          });
        }
      );

      // ── 6. Update Elasticsearch index ─────────────────────────────────────
      await updateEmailJobIndex(emailJobId, {
        status: 'SENT',
        sentAt: sentAt.toISOString(),
        previewUrl: result.previewUrl,
      });

      console.log(`✅ Email sent: ${emailJobId} → ${recipientEmail} | Preview: ${result.previewUrl}`);
    } finally {
      clearInterval(waitingLeaseHeartbeat);
      // Hold the sender lease across SMTP itself. A gate before DB/network
      // work alone lets concurrent workers overtake each other and send bursts.
      if (releaseSenderSlot) {
        // A release outage must not replace an SMTP/persistence error or make
        // a durably SENT email look failed. The Redis lease also has a TTL.
        await releaseSenderSlot().catch(error => {
          console.error(`Could not release sender slot for ${emailJobId}; lease will expire:`, error);
        });
      }
    }
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
    runStaleSendingRecovery().catch((err) => {
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
    runStaleSendingRecovery().catch((err) => {
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
      // Known SMTP failure clears deliveryAttemptStartedAt before BullMQ
      // retries. If evidence remains, delivery may have happened; surface the
      // ambiguity and do not turn it into a normal retryable failure.
      const markedUnknown = await prisma.emailJob.updateMany({
        where: { id: job.data.emailJobId, status: { in: ['SENDING', 'QUEUED'] }, deliveryAttemptStartedAt: { not: null } },
        data: {
          status: 'DELIVERY_UNKNOWN',
          errorMessage: `SMTP outcome is unknown after worker failure: ${err.message}`,
          claimToken: null,
          claimLeaseExpiresAt: null,
        },
      });
      const markedFailed = await prisma.$executeRaw`
        UPDATE email_jobs
        SET status = 'FAILED', "errorMessage" = ${err.message}, "claimToken" = NULL, "claimLeaseExpiresAt" = NULL, "updatedAt" = now()
        WHERE id = ${job.data.emailJobId}
          AND status IN ('SENDING', 'QUEUED')
          AND "deliveryAttemptStartedAt" IS NULL
      `;
      if (markedUnknown.count) await updateEmailJobIndex(job.data.emailJobId, {
        status: 'DELIVERY_UNKNOWN', errorMessage: `SMTP outcome is unknown after worker failure: ${err.message}`,
      });
      else if (markedFailed) await updateEmailJobIndex(job.data.emailJobId, { status: 'FAILED', errorMessage: err.message });
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
