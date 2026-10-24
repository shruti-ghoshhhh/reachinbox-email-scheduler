const test = require('node:test');
const assert = require('node:assert/strict');
const { reclaimStaleSendingJobs } = require('../src/services/staleSendingRecovery');
const { deliverAndPersist, classifySmtpFailure } = require('../src/services/deliverAndPersist');
const { enqueuePersistedEmailJobs } = require('../src/services/emailQueueRecovery');
const { ensureCurrentQuotaReservation } = require('../src/services/currentQuotaReservation');

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
    hourlyLimit: 3,
    delayBetweenEmailsMs: 250,
    claimLeaseExpiresAt: new Date(now - 6 * 60_000),
    deliveryAttemptStartedAt: null,
    updatedAt: new Date(now - 6 * 60_000),
    status: 'SENDING',
    bullJobId: 'email-db-job-1',
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
        return this.parent.row.status === 'SENDING' && this.parent.row.claimLeaseExpiresAt < args.where.claimLeaseExpiresAt.lt
          ? [{ ...this.parent.row, sender: { ...this.parent.row.sender } }]
          : [];
      },
      async updateMany({ where, data }) {
        const row = this.parent.row;
        if (row.id !== where.id || row.status !== where.status) return { count: 0 };
        if (where.claimLeaseExpiresAt && !(row.claimLeaseExpiresAt < where.claimLeaseExpiresAt.lt)) return { count: 0 };
        Object.assign(row, data);
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
      if (!this.jobs.has(options.jobId)) this.jobs.set(options.jobId, { id: options.jobId, data, options });
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
  assert.equal(recoveredJob.data.hourlyLimit, 3);
  assert.equal(recoveredJob.data.delayBetweenEmailsMs, 250);
});

test('committed recovery intent survives a failed Redis write and reconciliation replays the same generation', async () => {
  const prisma = attachParent(fakePrisma(staleJob()));
  const queue = fakeQueue();
  queue.fail = true;

  await assert.rejects(
    reclaimStaleSendingJobs(prisma, queue, { hourlyLimit: 10, delayBetweenEmailsMs: 100 }, now),
    /Redis unavailable/
  );
  assert.equal(prisma.row.status, 'QUEUED');
  const recoveryId = prisma.row.bullJobId;
  assert.match(recoveryId, /-recovery-/);

  queue.fail = false;
  assert.equal(await reclaimStaleSendingJobs(prisma, queue, { hourlyLimit: 10, delayBetweenEmailsMs: 100 }, now), 0);
  const result = await enqueuePersistedEmailJobs([prisma.row], queue, async () => {}, now);
  assert.equal(result.failed.length, 0);
  assert.equal(prisma.row.status, 'QUEUED');
  assert.equal(queue.jobs.size, 1);
  assert.ok(queue.jobs.has(recoveryId));
});

test('successive abandoned claims use different durable recovery IDs even when earlier jobs are retained', async () => {
  const prisma = attachParent(fakePrisma(staleJob()));
  const queue = fakeQueue();
  await reclaimStaleSendingJobs(prisma, queue, { hourlyLimit: 10, delayBetweenEmailsMs: 100 }, now);
  const firstId = prisma.row.bullJobId;
  queue.jobs.get(firstId).state = 'completed';
  Object.assign(prisma.row, { status: 'SENDING', claimLeaseExpiresAt: new Date(now - 1) });
  await reclaimStaleSendingJobs(prisma, queue, { hourlyLimit: 10, delayBetweenEmailsMs: 100 }, now);
  assert.notEqual(prisma.row.bullJobId, firstId);
  assert.equal(queue.jobs.size, 2);
  assert.equal(queue.jobs.get(firstId).state, 'completed');
  assert.equal(queue.jobs.get(prisma.row.bullJobId).state, undefined);
});

test('unknown SMTP transport errors preserve evidence while explicit rejection remains retryable', () => {
  for (const error of [
    Object.assign(new Error('Connection closed unexpectedly'), { code: 'ECONNECTION', command: 'CONN' }),
    Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT', command: 'CONN' }),
    new Error('Unrecognized transport failure'),
  ]) assert.equal(classifySmtpFailure(error), 'unknown');
  for (const error of [
    { code: 'EAUTH' }, { code: 'EENVELOPE' }, { code: 'ESOCKET', errno: 'ECONNREFUSED' },
    { command: 'DATA', responseCode: 451 }, { command: 'RCPT TO', responseCode: 550 },
  ]) assert.equal(classifySmtpFailure(error), 'not-delivered');
});

test('hour rollover after provider spacing defers instead of sending on an expired quota reservation', async () => {
  const oldWindow = { nextWindowAt: new Date(now) };
  let quotaChecks = 0;
  let sends = 0;
  const current = await ensureCurrentQuotaReservation(oldWindow, async () => {
    quotaChecks++;
    // Another worker has filled the new-hour sender cap. The worker's shared
    // quota path schedules into the following hour and returns null.
    return null;
  }, () => now + 1);
  if (current) sends++;
  assert.equal(quotaChecks, 1);
  assert.equal(sends, 0);
});

test('hour rollover refreshes admission once and does not double-reserve in the same hour', async () => {
  let quotaChecks = 0;
  const currentWindow = { nextWindowAt: new Date(now + 3600_000) };
  const current = await ensureCurrentQuotaReservation({ nextWindowAt: new Date(now) }, async () => {
    quotaChecks++;
    return currentWindow;
  }, () => now + 10);
  assert.equal(current, currentWindow);
  assert.equal(quotaChecks, 1);
  assert.equal(await ensureCurrentQuotaReservation(current, async () => {
    assert.fail('current-hour admission must not be counted twice');
  }, () => now + 20), current);
});

test('real SMTP disconnect after complete DATA is quarantined rather than made retryable', async () => {
  const net = require('node:net');
  const nodemailer = require('nodemailer');
  let receivedCompleteData = false;
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 localhost test SMTP\r\n');
    let buffer = '';
    let receivingData = false;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n');
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (receivingData) {
          if (line === '.') { receivedCompleteData = true; socket.destroy(); return; }
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250 localhost\r\n');
        else if (/^MAIL FROM|^RCPT TO/.test(line)) socket.write('250 OK\r\n');
        else if (line === 'DATA') { receivingData = true; socket.write('354 Send message\r\n'); }
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: server.address().port, secure: false, ignoreTLS: true });
  let failureOutcome;
  let persisted = false;
  try {
    await assert.rejects(deliverAndPersist(
      () => transport.sendMail({ from: 'sender@example.test', to: 'recipient@example.test', subject: 'Test', text: 'Complete payload' }),
      async () => { persisted = true; },
      async (_error, outcome) => { failureOutcome = outcome; }
    ));
    assert.equal(receivedCompleteData, true);
    assert.equal(failureOutcome, 'unknown');
    assert.equal(persisted, false);
  } finally {
    transport.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});

test('SMTP acceptance followed by DB write failure is marked ambiguous and is not resent', async () => {
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

  prisma.row.deliveryAttemptStartedAt = new Date(now - 6 * 60_000);
  assert.equal(await reclaimStaleSendingJobs(prisma, queue, { hourlyLimit: 10, delayBetweenEmailsMs: 100 }, now), 1);
  assert.equal(prisma.row.status, 'DELIVERY_UNKNOWN');
  assert.equal(queue.jobs.size, 0);
  assert.equal(acceptedBySmtp, 1);
});

test('a fresh SENDING row is not reclaimed before the five-minute threshold', async () => {
  const prisma = attachParent(fakePrisma(staleJob({ claimLeaseExpiresAt: new Date(now + 60_000) })));
  const queue = fakeQueue();

  assert.equal(await reclaimStaleSendingJobs(prisma, queue, { hourlyLimit: 10, delayBetweenEmailsMs: 100 }, now), 0);
  assert.equal(prisma.row.status, 'SENDING');
  assert.equal(queue.jobs.size, 0);
});
