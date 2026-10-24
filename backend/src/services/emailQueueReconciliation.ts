import { prisma } from '../config/database';
import { emailQueue } from '../queues/emailQueue';
import { enqueuePersistedEmailJobs } from './emailQueueRecovery';

const RECONCILIATION_BATCH_SIZE = 500;

/** Re-enqueue rows left SCHEDULED after an API/Redis/database boundary failure. */
export async function reconcileScheduledEmailJobs(): Promise<{ enqueued: number; failed: number }> {
  let enqueued = 0;
  let failed = 0;
  let cursor: { id: string } | undefined;

  // Paginate because a prolonged Redis outage can leave a large backlog.
  while (true) {
    const jobs = await prisma.emailJob.findMany({
      where: { status: 'SCHEDULED' },
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
        // Store the BullMQ reference even if the worker already claimed the
        // job; only transition SCHEDULED rows so a fast worker cannot be
        // overwritten back to QUEUED.
        await prisma.emailJob.update({ where: { id: job.id }, data: { bullJobId } });
        await prisma.emailJob.updateMany({
          where: { id: job.id, status: 'SCHEDULED' },
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
