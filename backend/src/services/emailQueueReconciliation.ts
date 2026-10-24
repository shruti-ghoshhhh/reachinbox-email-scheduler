import { prisma } from '../config/database';
import { emailQueue } from '../queues/emailQueue';
import { enqueuePersistedEmailJobs } from './emailQueueRecovery';

const RECONCILIATION_BATCH_SIZE = 500;

/** Replay durable queue intent, including recovered QUEUED rows after a crash. */
export async function reconcileScheduledEmailJobs(): Promise<{ enqueued: number; failed: number }> {
  let enqueued = 0;
  let failed = 0;
  let cursor: { id: string } | undefined;

  // Paginate because a prolonged Redis outage can leave a large backlog.
  while (true) {
    const jobs = await prisma.emailJob.findMany({
      where: { status: { in: ['SCHEDULED', 'RATE_LIMITED', 'QUEUED'] } },
      include: { sender: { select: { email: true, name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...(cursor ? { cursor, skip: 1 } : {}),
      take: RECONCILIATION_BATCH_SIZE,
    });
    if (jobs.length === 0) break;

    const result = await enqueuePersistedEmailJobs(
      jobs,
      emailQueue,
      async (job, bullJobId) => {
        // A stale scan must not overwrite a newer recovery/window generation.
        await prisma.emailJob.updateMany({
          where: { id: job.id, bullJobId: job.bullJobId ?? null },
          data: { bullJobId },
        });
        await prisma.emailJob.updateMany({
          where: { id: job.id, status: 'SCHEDULED', bullJobId },
          data: { status: 'QUEUED' },
        });
      }
    );

    enqueued += result.enqueued;
    failed += result.failed.length;
    // Move beyond failures in this pass; the next interval/startup starts over
    // and retries those rows without starving later records in this backlog.
    cursor = { id: jobs[jobs.length - 1].id };
  }

  return { enqueued, failed };
}
