import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

export const EMAIL_QUEUE_NAME = 'email-scheduler';

export interface EmailJobData {
  emailJobId: string;
  userId: string;
  senderId: string;
  senderEmail: string;
  senderName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: string; // ISO string
  idempotencyKey: string;
}

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: {
      age: 24 * 3600, // keep completed jobs for 24h
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // keep failed jobs for 7 days
    },
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});

/**
 * Schedule an email job with a delay.
 * Uses jobId as idempotency key to prevent duplicate scheduling.
 */
export async function scheduleEmailJob(
  data: EmailJobData,
  scheduledAt: Date
): Promise<string> {
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());

  const job = await emailQueue.add(
    'send-email',
    data,
    {
      jobId: data.idempotencyKey, // BullMQ deduplicates by jobId
      delay,
    }
  );

  return job.id!;
}

export async function getQueueStats() {
  const [waiting, delayed, active, completed, failed] = await Promise.all([
    emailQueue.getWaitingCount(),
    emailQueue.getDelayedCount(),
    emailQueue.getActiveCount(),
    emailQueue.getCompletedCount(),
    emailQueue.getFailedCount(),
  ]);

  return { waiting, delayed, active, completed, failed };
}
