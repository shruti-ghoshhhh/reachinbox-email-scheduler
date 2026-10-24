import type { EmailJobData } from '../queues/emailQueue';

export interface PersistedEmailJob {
  id: string;
  idempotencyKey: string;
  userId: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  hourlyLimit: number;
  delayBetweenEmailsMs: number;
  sender: { email: string; name: string };
}

export interface QueueAdder {
  add(name: string, data: EmailJobData, options: { jobId: string; delay: number }): Promise<{ id?: string }>;
}

export type MarkEnqueued = (job: PersistedEmailJob, bullJobId: string) => Promise<void>;

export function buildEmailJobData(job: PersistedEmailJob): EmailJobData {
  return {
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
    hourlyLimit: job.hourlyLimit,
    delayBetweenEmailsMs: job.delayBetweenEmailsMs,
  };
}

/**
 * Add each persisted row with its stable idempotency key. If Redis accepted an
 * earlier add but the process died before PostgreSQL recorded it, BullMQ
 * returns the same job for that id instead of creating a second delivery.
 * Continue after a row failure so one bad enqueue does not block its neighbors.
 */
export async function enqueuePersistedEmailJobs(
  jobs: PersistedEmailJob[],
  queue: QueueAdder,
  markEnqueued: MarkEnqueued,
  now = Date.now()
): Promise<{ enqueued: number; failed: Array<{ emailJobId: string; error: unknown }> }> {
  let enqueued = 0;
  const failed: Array<{ emailJobId: string; error: unknown }> = [];

  // Bound pressure on Redis and PostgreSQL when recovering a large backlog.
  for (let offset = 0; offset < jobs.length; offset += 100) {
    const batch = jobs.slice(offset, offset + 100);
    const results = await Promise.all(batch.map(async (job) => {
      try {
        const bullJob = await queue.add('send-email', buildEmailJobData(job), {
          jobId: job.idempotencyKey,
          delay: Math.max(0, job.scheduledAt.getTime() - now),
        });
        if (!bullJob.id) throw new Error(`BullMQ returned no id for ${job.id}`);
        await markEnqueued(job, bullJob.id);
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, failure: { emailJobId: job.id, error } };
      }
    }));
    for (const result of results) {
      if (result.ok) enqueued++;
      else failed.push(result.failure);
    }
  }

  return { enqueued, failed };
}
