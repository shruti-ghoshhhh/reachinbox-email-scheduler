import type { EmailJobData } from '../queues/emailQueue';
import { randomUUID } from 'crypto';

export const STALE_SENDING_THRESHOLD_MS = 5 * 60_000;

interface StaleEmailJob {
  id: string;
  campaignId?: string | null;
  idempotencyKey: string;
  userId: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  hourlyLimit: number;
  delayBetweenEmailsMs: number;
  claimLeaseExpiresAt: Date | null;
  deliveryAttemptStartedAt: Date | null;
  sender: { email: string; name: string };
}

interface RecoveryPrisma {
  emailJob: {
    findMany(args: {
      where: { status: 'SENDING'; claimLeaseExpiresAt: { lt: Date } };
      include: { sender: { select: { email: true; name: true } } };
    }): Promise<StaleEmailJob[]>;
    updateMany(args: {
      where: { id: string; status: 'SENDING'; claimLeaseExpiresAt: { lt: Date } };
      data: { status: 'QUEUED' | 'DELIVERY_UNKNOWN'; bullJobId?: string; claimToken?: null; claimLeaseExpiresAt?: Date | null; errorMessage?: string };
    }): Promise<{ count: number }>;
  };
}

interface RecoveryQueue {
  add(name: string, data: EmailJobData, options: { jobId: string; delay: number }): Promise<unknown>;
}

/** Requeue rows left SENDING beyond the safety window when a worker restarts or recovery runs. */
export async function reclaimStaleSendingJobs(
  prisma: RecoveryPrisma,
  queue: RecoveryQueue,
  settings: { hourlyLimit: number; delayBetweenEmailsMs: number },
  now = Date.now()
): Promise<number> {
  const cutoff = new Date(now);
  const staleJobs = await prisma.emailJob.findMany({
    where: { status: 'SENDING', claimLeaseExpiresAt: { lt: cutoff } },
    include: { sender: { select: { email: true, name: true } } },
  });

  let updated = 0;
  for (const job of staleJobs) {
    // A new abandoned claim needs a new ID: BullMQ retains completed recovery
    // jobs. Persist this generation in the same DB write as the QUEUED intent,
    // so reconciliation can replay it after a crash before Redis acknowledges.
    const recoveryJobId = `email-${job.id}-recovery-${randomUUID()}`;
    const claim = await prisma.emailJob.updateMany({
      where: { id: job.id, status: 'SENDING', claimLeaseExpiresAt: { lt: cutoff } },
      data: job.deliveryAttemptStartedAt
        ? { status: 'DELIVERY_UNKNOWN', claimToken: null, claimLeaseExpiresAt: null, errorMessage: 'SMTP delivery outcome is unknown; automatic resend was stopped to avoid a possible duplicate.' }
        : { status: 'QUEUED', bullJobId: recoveryJobId, claimToken: null, claimLeaseExpiresAt: null },
    });
    if (!claim.count) continue;
    updated++;
    // Once a delivery attempt was durably recorded, SMTP may have accepted it.
    // Surface the ambiguity instead of automatically sending a possible duplicate.
    if (job.deliveryAttemptStartedAt) continue;

    await queue.add('send-email', {
      emailJobId: job.id,
      campaignId: job.campaignId,
      userId: job.userId,
      senderId: job.senderId,
      senderEmail: job.sender.email,
      senderName: job.sender.name,
      recipientEmail: job.recipientEmail,
      subject: job.subject,
      body: job.body,
      scheduledAt: job.scheduledAt.toISOString(),
      idempotencyKey: job.idempotencyKey,
      hourlyLimit: job.hourlyLimit ?? settings.hourlyLimit,
      delayBetweenEmailsMs: job.delayBetweenEmailsMs ?? settings.delayBetweenEmailsMs,
    }, { jobId: recoveryJobId, delay: 0 });
  }

  return updated;
}
