const test = require('node:test');
const assert = require('node:assert/strict');
const { enqueuePersistedEmailJobs } = require('../src/services/emailQueueRecovery');

function persistedJob(overrides = {}) {
  return {
    id: 'db-job-1',
    idempotencyKey: 'user_sender_recipient_subject_123',
    userId: 'user-1',
    senderId: 'sender-1',
    recipientEmail: 'recipient@example.test',
    subject: 'Follow up: proposal',
    body: 'Body',
    scheduledAt: new Date(Date.now() + 60_000),
    hourlyLimit: 7,
    delayBetweenEmailsMs: 321,
    sender: { email: 'sender@example.test', name: 'Sender' },
    ...overrides,
  };
}

function idempotentQueue() {
  const jobs = new Map();
  return {
    jobs,
    async add(_name, data, options) {
      if (!jobs.has(options.jobId)) jobs.set(options.jobId, { id: options.jobId, data });
      return jobs.get(options.jobId);
    },
  };
}

test('retries a persisted row after queue outage and records it exactly once', async () => {
  const row = persistedJob();
  const queue = idempotentQueue();
  let status = 'SCHEDULED';
  let failFirstAttempt = true;
  const add = queue.add.bind(queue);
  queue.add = async (...args) => {
    if (failFirstAttempt) {
      failFirstAttempt = false;
      throw new Error('Redis unavailable');
    }
    return add(...args);
  };
  const markEnqueued = async () => { status = 'QUEUED'; };

  const firstRun = await enqueuePersistedEmailJobs([row], queue, markEnqueued);
  assert.equal(firstRun.failed.length, 1);
  assert.equal(status, 'SCHEDULED');
  assert.equal(queue.jobs.size, 0);

  const afterRestart = await enqueuePersistedEmailJobs([row], queue, markEnqueued);
  assert.equal(afterRestart.failed.length, 0);
  assert.equal(status, 'QUEUED');
  assert.equal(queue.jobs.size, 1);
  assert.equal(queue.jobs.get(`email-${row.id}`).data.subject, 'Follow up: proposal');
  assert.equal(queue.jobs.get(`email-${row.id}`).data.hourlyLimit, 7);
  assert.equal(queue.jobs.get(`email-${row.id}`).data.delayBetweenEmailsMs, 321);
});

test('deduplicates when Redis accepted enqueue but database acknowledgement failed', async () => {
  const row = persistedJob();
  const queue = idempotentQueue();
  let markCalls = 0;
  const markEnqueued = async () => {
    markCalls++;
    if (markCalls === 1) throw new Error('PostgreSQL acknowledgement failed');
  };

  const beforeRestart = await enqueuePersistedEmailJobs([row], queue, markEnqueued);
  assert.equal(beforeRestart.failed.length, 1);
  assert.equal(queue.jobs.size, 1); // Redis already accepted the stable job ID.

  const afterRestart = await enqueuePersistedEmailJobs([row], queue, markEnqueued);
  assert.equal(afterRestart.failed.length, 0);
  assert.equal(queue.jobs.size, 1);
  assert.equal(markCalls, 2);
});

test('reconciliation preserves a persisted rate-limit BullMQ reference', async () => {
  const row = persistedJob({ bullJobId: 'email-db-job-1-window-1792929605000' });
  const queue = idempotentQueue();
  await enqueuePersistedEmailJobs([row], queue, async () => {});
  assert.equal(queue.jobs.size, 1);
  assert.ok(queue.jobs.has(row.bullJobId));
});
