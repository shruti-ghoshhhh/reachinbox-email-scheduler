// Isolated integration regression: node --test -r ts-node/register test/recoveryRedis.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Queue, Worker } = require('bullmq');
const { reclaimStaleSendingJobs } = require('../src/services/staleSendingRecovery');
const { enqueuePersistedEmailJobs } = require('../src/services/emailQueueRecovery');

test('real BullMQ executes repeated recovery generations and replays committed queue intent after a crash', { timeout: 20_000 }, async () => {
  const queueName = `recovery-regression-${randomUUID()}`;
  const connection = { host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379), maxRetriesPerRequest: null };
  const queue = new Queue(queueName, { connection, defaultJobOptions: { removeOnComplete: false } });
  let processed = 0;
  const worker = new Worker(queueName, async () => { processed++; }, { connection });
  const now = Date.now();
  const row = {
    id: randomUUID(), userId: 'recovery-user', senderId: 'recovery-sender',
    idempotencyKey: randomUUID(), recipientEmail: 'test@example.test',
    subject: 'Retained job: recovery', body: 'Body', scheduledAt: new Date(now - 1000),
    hourlyLimit: 3, delayBetweenEmailsMs: 2000, status: 'SENDING',
    claimLeaseExpiresAt: new Date(now - 1000), deliveryAttemptStartedAt: null,
    sender: { email: 'sender@example.test', name: 'Sender' },
  };
  const prisma = { emailJob: {
    async findMany() { return row.status === 'SENDING' ? [{ ...row }] : []; },
    async updateMany({ where, data }) {
      if (row.status !== where.status || !(row.claimLeaseExpiresAt < where.claimLeaseExpiresAt.lt)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  } };
  const settings = { hourlyLimit: 3, delayBetweenEmailsMs: 2000 };
  async function waitCompleted(id) {
    for (let i = 0; i < 300; i++) {
      if (await (await queue.getJob(id))?.getState() === 'completed') return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(`job ${id} never completed`);
  }
  try {
    await queue.waitUntilReady();
    await reclaimStaleSendingJobs(prisma, queue, settings, now);
    const firstId = row.bullJobId;
    await waitCompleted(firstId);
    Object.assign(row, { status: 'SENDING', claimLeaseExpiresAt: new Date(now - 1) });
    await reclaimStaleSendingJobs(prisma, queue, settings, now);
    const secondId = row.bullJobId;
    assert.notEqual(firstId, secondId);
    await waitCompleted(secondId);
    assert.equal(processed, 2);
    assert.equal(await (await queue.getJob(firstId)).getState(), 'completed');

    Object.assign(row, { status: 'SENDING', claimLeaseExpiresAt: new Date(now - 1) });
    await assert.rejects(reclaimStaleSendingJobs(prisma, {
      async add() { throw new Error('Simulated termination before Redis write'); },
    }, settings, now), /Simulated termination/);
    const durableId = row.bullJobId;
    assert.equal(row.status, 'QUEUED');
    assert.equal(await queue.getJob(durableId), undefined);
    const result = await enqueuePersistedEmailJobs([row], queue, async () => {}, now);
    assert.equal(result.failed.length, 0);
    await waitCompleted(durableId);
    assert.equal(processed, 3);
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
});
