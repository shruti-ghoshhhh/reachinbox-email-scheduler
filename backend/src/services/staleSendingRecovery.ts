import type { EmailJobData } from '../queues/emailQueue';

export const STALE_SENDING_THRESHOLD_MS = 5 * 60_000;

interface StaleEmailJob {
  id: string;
  idempotencyKey: string;
  userId: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  sender: { email: string; name: string };
}

interface RecoveryPrisma {
  emailJob: {
    findMany(args: {
      where: { status: 'SENDING'; updatedAt: { lt: Date } };
      include: { sender: { select: { email: true; name: true } } };
    }): Promise<StaleEmailJob[]>;
    updateMany(args: {
      where: { id: string; status: 'SENDING'; updatedAt: { lt: Date } } | { id: string; status: 'QUEUED' };
      data: { status: 'QUEUED' | 'SENDING' };
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
  const cutoff = new Date(now - STALE_SENDING_THRESHOLD_MS);
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
      await queue.add('send-email', {
        emailJobId: job.id,
        userId: job.userId,
        senderId: job.senderId,
        senderEmail: job.sender.email,
        senderName: job.sender.name,
        recipientEmail: job.recipientEmail,
        subject: job.subject,
        body: job.body,
        scheduledAt: job.scheduledAt.toISOString(),
        idempotencyKey: job.idempotencyKey,
        hourlyLimit: settings.hourlyLimit,
        delayBetweenEmailsMs: settings.delayBetweenEmailsMs,
      }, { jobId: `${job.idempotencyKey}_recovery_${now}_${updated}`, delay: 0 });
    } catch (error) {
      // Keep the row eligible for the next recovery scan if Redis rejected enqueue.
      await prisma.emailJob.updateMany({
        where: { id: job.id, status: 'QUEUED' },
        data: { status: 'SENDING' },
      });
      throw error;
    }
  }

  return updated;
}
