const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.GOOGLE_CLIENT_ID ||= 'test';
process.env.GOOGLE_CLIENT_SECRET ||= 'test';
process.env.JWT_SECRET ||= 'test';
process.env.REDIS_HOST ||= 'localhost';
process.env.REDIS_PORT ||= '6379';
require('ts-node/register');
const { prisma } = require('../src/config/database.ts');
const {
  recordRateLimitThreshold,
  deliverRateLimitNotification,
  retryPendingRateLimitNotifications,
} = require('../src/services/slackNotificationOutbox.ts');

const original = {
  upsert: prisma.slackRateLimitNotification.upsert,
  updateMany: prisma.slackRateLimitNotification.updateMany,
  findUnique: prisma.slackRateLimitNotification.findUnique,
  findMany: prisma.slackRateLimitNotification.findMany,
  userFindUnique: prisma.user.findUnique,
  fetch: global.fetch,
};
let calls;
let connected;

function setup() {
  calls = [];
  connected = true;
  prisma.slackRateLimitNotification.upsert = async (args) => {
    calls.push(['upsert', args]);
    return { id: 'notification-1' };
  };
  prisma.slackRateLimitNotification.updateMany = async (args) => {
    calls.push(['updateMany', args]);
    return { count: 1 };
  };
  prisma.slackRateLimitNotification.findUnique = async () => ({
    id: 'notification-1', userId: 'user-1', senderEmail: 'sender@example.test',
    hourlyLimit: 1, nextWindowAt: new Date('2026-10-25T12:00:00.000Z'),
  });
  prisma.slackRateLimitNotification.findMany = async (args) => {
    calls.push(['findMany', args]);
    return [{ id: 'notification-1' }];
  };
  prisma.user.findUnique = async () => connected
    ? { slackConnected: true, slackToken: 'xoxb-test', slackUserId: 'U123' }
    : { slackConnected: false, slackToken: null, slackUserId: null };
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
}

afterEach(() => {
  prisma.slackRateLimitNotification.upsert = original.upsert;
  prisma.slackRateLimitNotification.updateMany = original.updateMany;
  prisma.slackRateLimitNotification.findUnique = original.findUnique;
  prisma.slackRateLimitNotification.findMany = original.findMany;
  prisma.user.findUnique = original.userFindUnique;
  global.fetch = original.fetch;
});

test('deduplicates one threshold notification per sender and UTC hour', async () => {
  setup();
  const nextWindowAt = new Date('2026-10-25T12:00:00.000Z');
  assert.equal(await recordRateLimitThreshold({
    userId: 'user-1', senderId: 'sender-1', senderEmail: 'sender@example.test', hourlyLimit: 1, nextWindowAt,
  }), 'notification-1');
  assert.deepEqual(calls[0][1].where.senderId_windowStart, {
    senderId: 'sender-1', windowStart: new Date('2026-10-25T11:00:00.000Z'),
  });
});

test('marks an alert sent only after Slack confirms success', async () => {
  setup();
  await deliverRateLimitNotification('notification-1');
  assert.equal(calls[0][0], 'updateMany');
  const sentUpdate = calls.at(-1)[1];
  assert.equal(sentUpdate.data.status, 'SENT');
  assert.ok(sentUpdate.data.sentAt instanceof Date);
});

test('leaves notifications pending while Slack is disconnected for later reconnect retry', async () => {
  setup();
  connected = false;
  await deliverRateLimitNotification('notification-1');
  assert.equal(calls.at(-1)[1].data.status, 'PENDING');
  assert.equal(calls.at(-1)[1].data.attempts.decrement, 1);
});

test('returns Slack failures to pending so the worker retry loop can pick them up', async () => {
  setup();
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: 'ratelimited' }) });
  await assert.rejects(deliverRateLimitNotification('notification-1'), /ratelimited/);
  assert.equal(calls.at(-1)[1].data.status, 'PENDING');
  assert.match(calls.at(-1)[1].data.lastError, /ratelimited/);
});

test('periodically retries all pending/reclaimable alerts', async () => {
  setup();
  await retryPendingRateLimitNotifications();
  assert.ok(calls.some(([name]) => name === 'findMany'));
  assert.equal(calls.filter(([name]) => name === 'updateMany').length, 2);
});

test('retry scans filter disconnected owners and continue past the first full page', async () => {
  setup();
  const items = Array.from({ length: 101 }, (_, i) => ({ id: `notification-${String(i).padStart(3, '0')}` }));
  const delivered = [];
  const pages = [];
  prisma.slackRateLimitNotification.findMany = async (args) => {
    pages.push(args);
    assert.deepEqual(args.where.user, {
      is: { slackConnected: true, slackToken: { not: null }, slackUserId: { not: null } },
    });
    assert.ok(args.where.createdAt.lte instanceof Date);
    const offset = args.cursor ? items.findIndex((item) => item.id === args.cursor.id) + args.skip : 0;
    return items.slice(offset, offset + args.take);
  };
  prisma.slackRateLimitNotification.findUnique = async ({ where }) => {
    delivered.push(where.id);
    return { id: where.id, userId: 'user-1', senderEmail: 'sender@example.test', hourlyLimit: 1, nextWindowAt: new Date() };
  };
  await retryPendingRateLimitNotifications();
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[1].cursor, { id: items[99].id });
  assert.deepEqual(delivered, items.map((item) => item.id));
});
