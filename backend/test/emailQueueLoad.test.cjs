const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const { randomUUID } = require('node:crypto');

const JOB_COUNT = 1200;
const SENDER_COUNT = 3;
const HOURLY_LIMIT = 100;
const DELAY_MS = 10;
const CONCURRENCY = 20;
const HOUR_MS = 60 * 60 * 1000;

test('BullMQ accounts for 1,200 scheduled jobs with hourly limits and spacing', { timeout: 120_000 }, async (t) => {
  const runId = randomUUID().replaceAll('-', '');
  const queueName = `load-${runId}`;
  const prefix = `reachinbox-load-${runId}`;
  const connectionOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
  const queueConnection = new IORedis(connectionOptions);
  const workerConnection = new IORedis(connectionOptions);
  const queue = new Queue(queueName, { connection: queueConnection, prefix });
  const planned = new Map();
  let worker;

  t.after(async () => {
    if (worker) await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await Promise.all([queueConnection.quit(), workerConnection.quit()]);
  });

  await queue.waitUntilReady();
  const start = Date.now();
  const addStarted = performance.now();
  for (let i = 0; i < JOB_COUNT; i += 1) {
    const senderNumber = i % SENDER_COUNT;
    const senderOrdinal = Math.floor(i / SENDER_COUNT);
    const hourOffset = Math.floor(senderOrdinal / HOURLY_LIMIT);
    const positionInHour = senderOrdinal % HOURLY_LIMIT;
    const stride = Math.max(HOUR_MS, HOURLY_LIMIT * DELAY_MS);
    const scheduledAt = start + hourOffset * stride + positionInHour * DELAY_MS;
    const senderId = `sender-${senderNumber}`;
    const data = { index: i, senderId, senderOrdinal, hourOffset, scheduledAt };
    planned.set(i, data);
    await queue.add('send-email', data, { jobId: `job-${i}`, removeOnComplete: false });
  }
  const enqueueMs = performance.now() - addStarted;

  let processed = 0;
  let failed = 0;
  const observed = [];
  const drain = new Promise((resolve, reject) => {
    worker = new Worker(queueName, async (job) => {
      const expected = planned.get(job.data.index);
      assert.ok(expected, `unexpected job ${job.data.index}`);
      assert.equal(job.data.senderId, expected.senderId);
      assert.equal(job.data.scheduledAt, expected.scheduledAt);
      observed.push(job.data);
      processed += 1;
      if (processed + failed === JOB_COUNT) resolve();
    }, { connection: workerConnection, prefix, concurrency: CONCURRENCY });
    worker.on('failed', (job, err) => {
      failed += 1;
      reject(new Error(`job ${job?.id} failed: ${err.message}`));
    });
    worker.on('error', reject);
  });

  const processingStarted = performance.now();
  await drain;
  const countDeadline = Date.now() + 10_000;
  let completedCount = 0;
  while (completedCount < JOB_COUNT && Date.now() < countDeadline) {
    completedCount = await queue.getCompletedCount();
    if (completedCount < JOB_COUNT) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const processingMs = performance.now() - processingStarted;
  completedCount = await queue.getCompletedCount();
  const waitingCount = await queue.getWaitingCount();
  const activeCount = await queue.getActiveCount();
  const delayedCount = await queue.getDelayedCount();
  const failedCount = await queue.getFailedCount();

  assert.equal(processed, JOB_COUNT);
  assert.equal(completedCount, JOB_COUNT);
  assert.equal(waitingCount + activeCount + delayedCount + failedCount, 0);
  assert.equal(failedCount, 0);
  assert.equal(observed.length, JOB_COUNT);
  assert.equal(new Set(observed.map((job) => job.index)).size, JOB_COUNT);

  const senderWindows = new Map();
  const senderTimes = new Map();
  for (const job of planned.values()) {
    const windowKey = `${job.senderId}:${job.hourOffset}`;
    senderWindows.set(windowKey, (senderWindows.get(windowKey) || 0) + 1);
    const times = senderTimes.get(job.senderId) || [];
    times.push(job.scheduledAt);
    senderTimes.set(job.senderId, times);
  }
  assert.ok([...senderWindows.values()].every((count) => count <= HOURLY_LIMIT));
  assert.deepEqual([...senderWindows.values()].sort((a, b) => b - a), Array(SENDER_COUNT * 4).fill(HOURLY_LIMIT));
  for (const times of senderTimes.values()) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) assert.ok(times[i] - times[i - 1] >= DELAY_MS);
  }

  console.log(JSON.stringify({
    jobs: JOB_COUNT,
    senders: SENDER_COUNT,
    hourlyLimit: HOURLY_LIMIT,
    delayMs: DELAY_MS,
    concurrency: CONCURRENCY,
    enqueueMs: Math.round(enqueueMs),
    enqueueJobsPerSecond: Math.round(JOB_COUNT / (enqueueMs / 1000)),
    drainMs: Math.round(processingMs),
    processedJobsPerSecond: Math.round(JOB_COUNT / (processingMs / 1000)),
    completed: completedCount,
    failed: failedCount,
    hourlyBuckets: senderWindows.size,
    jobsPerHourlyBucket: [...senderWindows.values()],
    simulatedScheduledSpanMs: Math.max(...[...planned.values()].map((job) => job.scheduledAt)) - start,
    smtpCalls: 0,
  }));
});
