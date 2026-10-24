import { prisma } from '../config/database';
import { indexEmailJobsBulk } from '../config/elasticsearch';
import { reconcileRows } from './batchReconciliation';

const BATCH_SIZE = 500;

/**
 * Rebuild the search index from PostgreSQL in bounded, idempotent batches.
 * PostgreSQL is the source of truth; a failed/partial Elasticsearch batch is
 * safe to retry on the next pass because documents use the DB id as _id.
 */
export async function reconcileEmailSearchIndex(): Promise<number> {
  return reconcileRows({
    batchSize: BATCH_SIZE,
    fetchBatch: async (cursor) => prisma.emailJob.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      include: { sender: { select: { email: true } } },
    }),
    indexBatch: async (rows) => indexEmailJobsBulk(rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      senderId: row.senderId,
      senderEmail: row.sender.email,
      recipientEmail: row.recipientEmail,
      subject: row.subject,
      body: row.body,
      scheduledAt: row.scheduledAt,
      sentAt: row.sentAt,
      status: row.status,
      campaignId: row.campaignId,
      createdAt: row.createdAt,
    })), { throwOnError: true }),
  });
}
