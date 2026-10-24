const test = require('node:test');
const assert = require('node:assert/strict');
const { reclaimStaleSendingJobs } = require('../src/services/staleSendingRecovery');
const { deliverAndPersist } = require('../src/services/deliverAndPersist');

const now = Date.UTC(2026, 9, 24, 12, 0, 0);

function staleJob(overrides = {}) {
  return {
    id: 'db-job-1',
    idempotencyKey: 'user_sender_recipient_subject_123',
    userId: 'user-1',
    senderId: 'sender-1',
    recipientEmail: 'recipient@example.test',
    subject: 'Hello',
    body: 'Body',
    scheduledAt: new Date(now - 10 * 60_000),
    updatedAt: new Date(now - 6 * 60_000),
    status: 'SENDING',
    sender: { email: 'sender@example.test', name: 'Sender' },
    ...overrides,
  };
}

function fakePrisma(job) {
  return {
    row: job,
    emailJob: {
      async findMany(args) {
        assert.equal(args.where.status, 'SENDING');
        return this.parent.row.status === 'SENDING' && this.parent.row.updatedAt < args.where.updatedAt.lt
          ? [{ ...this.parent.row, sender: { ...this.parent.row.sender } }]
          : [];
      },
      async updateMany({ where, data }) {
        const row = this.parent.row;
        if (row.id !== where.id || row.status !== where.status) return { count: 0 };
        if (where.updatedAt && !(row.updatedAt < where.updatedAt.lt)) return { count: 0 };
        row.status = data.status;
        return { count: 1 };
      },
    },
  };
}

function attachParent(prisma) {
  prisma.emailJob.parent = prisma;
  return prisma;
}

function fakeQueue() {
  return {
    jobs: new Map(),
    async add(_name, data, options) {
      if (this.fail) throw new Error('Redis unavailable');
      if (!this.jobs.has(options.jobId)) this.jobs.set(options.jobId, { data, options });
      return this.jobs.get(options.jobId);
    },
  };
}

test('worker restart recovery requeues stale SENDING rows once across concurrent scans', async () => {
  const prisma = attachParent(fakePrisma(staleJob()));
  const queue = fakeQueue();

  const recovered = await Promise.all([
    reclaimStaleSendingJobs(prisma, queue, { hourlyLimit: 10, delayBetweenEmailsMs: 100 }, now),
    reclaimStaleSendingJobs(prisma, queue, { hourlyLimit: 10, delayBetweenEmailsMs: 100 }, now),
  ]);

  assert.equal(recovered.reduce((sum, count) => sum + count, 0), 1);
  assert.equal(prisma.row.status, 'QUEUED');
  assert.equal(queue.jobs.size, 1);
  const [recoveredJob] = queue.jobs.values();
  assert.equal(recoveredJob.data.emailJobId, 'db-job-1');
  assert.equal(recoveredJob.data.hourlyLimit, 10);
});

test('recovery restores stale SENDING state if re-enqueue fails so a later startup can retry', async () => {
  const prisma = attachParent(fakePrisma(staleJob()));
  const queue = fakeQueue();
  queue.fail = true;

  await assert.rejects(
    reclaimStaleSendingJobs(prisma, queue, { hourlyLimit: 10, delayBetweenEmailsMs: 100 }, now),
    /Redis unavailable/
  );
  assert.equal(prisma.row.status, 'SENDING');

  queue.fail = false;
  assert.equal(await reclaimStaleSendingJobs(prisma, queue, { hourlyLimit: 10, delayBetweenEmailsMs: 100 }, now), 1);
  assert.equal(prisma.row.status, 'QUEUED');
  assert.equal(queue.jobs.size, 1);
});

test('SMTP acceptance followed by DB write failure leaves an ambiguous SENDING row that recovery may resend', async () => {
  const prisma = attachParent(fakePrisma(staleJob()));
  const queue = fakeQueue();
  let acceptedBySmtp = 0;
  let markedQueuedAfterDeliveryFailure = false;

  await assert.rejects(deliverAndPersist(
    async () => {
      acceptedBySmtp++;
      return { messageId: 'smtp-accepted-1', previewUrl: 'https://example.test/preview/1' };
    },
    async () => { throw new Error('PostgreSQL write failed'); },
    async () => { markedQueuedAfterDeliveryFailure = true; }
  ), /PostgreSQL write failed/);

  assert.equal(acceptedBySmtp, 1);
  assert.equal(prisma.row.status, 'SENDING');
  assert.equal(markedQueuedAfterDeliveryFailure, false);

  // Model restart after the stale threshold: recovery cannot know SMTP accepted
  // the first copy and therefore makes the row eligible for another send.
  assert.equal(await reclaimStaleSendingJobs(prisma, queue, { hourlyLimit: 10, delayBetweenEmailsMs: 100 }, now), 1);
  assert.equal(prisma.row.status, 'QUEUED');
  assert.equal(queue.jobs.size, 1);
  assert.equal(acceptedBySmtp, 1);
});

test('a fresh SENDING row is not reclaimed before the five-minute threshold', async () => {
  const prisma = attachParent(fakePrisma(staleJob({ updatedAt: new Date(now - 4 * 60_000) })));
  const queue = fakeQueue();

  assert.equal(await reclaimStaleSendingJobs(prisma, queue, { hourlyLimit: 10, delayBetweenEmailsMs: 100 }, now), 0);
  assert.equal(prisma.row.status, 'SENDING');
  assert.equal(queue.jobs.size, 0);
});
