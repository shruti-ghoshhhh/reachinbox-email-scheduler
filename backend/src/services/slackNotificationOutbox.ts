import { prisma } from '../config/database';
import { sendSlackRateLimitNotification } from './slackService';

const LEASE_MS = 60_000;

export async function recordRateLimitThreshold(input: {
  userId: string;
  senderId: string;
  senderEmail: string;
  hourlyLimit: number;
  nextWindowAt: Date;
}): Promise<string> {
  const windowStart = new Date(input.nextWindowAt.getTime() - 60 * 60 * 1000);
  const record = await prisma.slackRateLimitNotification.upsert({
    where: { senderId_windowStart: { senderId: input.senderId, windowStart } },
    create: { ...input, windowStart },
    update: {},
    select: { id: true },
  });
  return record.id;
}

export async function deliverRateLimitNotification(id: string): Promise<void> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  const claimed = await prisma.slackRateLimitNotification.updateMany({
    where: {
      id,
      OR: [
        { status: 'PENDING' },
        { status: 'SENDING', leaseExpiresAt: { lt: now } },
      ],
    },
    data: { status: 'SENDING', leaseExpiresAt, attempts: { increment: 1 }, lastError: null },
  });
  if (!claimed.count) return;

  const item = await prisma.slackRateLimitNotification.findUnique({ where: { id } });
  if (!item) return;
  try {
    const delivered = await sendSlackRateLimitNotification(
      item.userId,
      item.senderEmail,
      item.hourlyLimit,
      item.nextWindowAt,
      item.id
    );
    if (!delivered) {
      await prisma.slackRateLimitNotification.updateMany({
        where: { id, status: 'SENDING', leaseExpiresAt },
        data: { status: 'PENDING', leaseExpiresAt: null, attempts: { decrement: 1 } },
      });
      return;
    }
    await prisma.slackRateLimitNotification.updateMany({
      where: { id, status: 'SENDING', leaseExpiresAt },
      data: { status: 'SENT', sentAt: new Date(), leaseExpiresAt: null, lastError: null },
    });
  } catch (error) {
    await prisma.slackRateLimitNotification.updateMany({
      where: { id, status: 'SENDING', leaseExpiresAt },
      data: { status: 'PENDING', leaseExpiresAt: null, lastError: (error as Error).message },
    });
    throw error;
  }
}

/** Retry pending alerts, including alerts whose owner has since reconnected Slack. */
export async function retryPendingRateLimitNotifications(): Promise<void> {
  let cursor: string | undefined;
  const scanStartedAt = new Date();
  while (true) {
    const pending = await prisma.slackRateLimitNotification.findMany({
      where: {
        createdAt: { lte: scanStartedAt },
        user: { is: { slackConnected: true, slackToken: { not: null }, slackUserId: { not: null } } },
        OR: [
          { status: 'PENDING' },
          { status: 'SENDING', leaseExpiresAt: { lt: scanStartedAt } },
        ],
      },
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: 100,
      select: { id: true },
    });
    for (const item of pending) {
      try {
        await deliverRateLimitNotification(item.id);
      } catch (error) {
        console.error(`Slack rate-limit notification ${item.id} remains retryable:`, error);
      }
    }
    if (pending.length < 100) return;
    cursor = pending[pending.length - 1].id;
  }
}
