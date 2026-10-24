const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const backendRoot = path.resolve(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await wait(50);
  }
  throw new Error(`Timed out: ${description}`);
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('real API, PostgreSQL, Redis and two workers survive restart, enforce quota and drain 1000 emails', { timeout: 180000 }, async t => {
  const runId = randomUUID().replaceAll('-', '');
  const schema = `scheduler_audit_${runId}`;
  assert.match(schema, /^scheduler_audit_[a-f0-9]{32}$/);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const databaseUrl = url.toString();
  const jwtSecret = randomUUID();
  const children = new Set();
  const logs = [];
  const accepted = [];
  const sockets = new Set();
  let prisma, queue, redis, smtp;
  const baseEnv = {
    ...process.env, DATABASE_URL: databaseUrl, EMAIL_QUEUE_NAME: `audit-${runId}`,
    JWT_SECRET: jwtSecret, SESSION_SECRET: randomUUID(),
    GOOGLE_CLIENT_ID: 'integration-only', GOOGLE_CLIENT_SECRET: 'integration-only',
    EMAIL_SEND_DELAY_MS: '25', MAX_EMAILS_PER_HOUR_PER_SENDER: '3', WORKER_CONCURRENCY: '5',
    ELASTICSEARCH_URL: 'http://127.0.0.1:1',
  };
  function start(entry, overrides = {}) {
    const child = spawn(process.execPath, ['-r', path.join(__dirname, 'fixtures/localSmtp.cjs'), entry], {
      cwd: backendRoot, env: { ...baseEnv, ...overrides }, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      logs.push(chunk.toString());
      if (logs.length > 30) logs.shift();
    });
    return child;
  }
  async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }
  t.after(async () => {
    await Promise.all([...children].map(stop));
    for (const socket of sockets) socket.destroy();
    if (smtp) await new Promise(resolve => smtp.close(resolve));
    if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
    if (redis) {
      const keys = [];
      let cursor = '0';
      do {
        const result = await redis.scan(cursor, 'MATCH', 'rate_limit:*', 'COUNT', 500);
        cursor = result[0];
        keys.push(...result[1].filter(key => key.includes(runId) || senderIds.some(id => key.includes(id))));
      } while (cursor !== '0');
      if (keys.length) await redis.del(...keys);
      await redis.quit();
    }
    if (prisma) {
      // Only this run's generated, validated schema is removed.
      assert.match(schema, /^scheduler_audit_[a-f0-9]{32}$/);
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await prisma.$disconnect();
    }
  });
  const senderIds = [];
  const migrated = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: backendRoot, env: baseEnv, windowsHide: true, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(migrated.status, 0, `Isolated schema migration failed: ${migrated.stderr}`);
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  redis = new IORedis({ host: baseEnv.REDIS_HOST || 'localhost', port: Number(baseEnv.REDIS_PORT || 6379) });
  queue = new Queue(baseEnv.EMAIL_QUEUE_NAME, { connection: { host: baseEnv.REDIS_HOST || 'localhost', port: Number(baseEnv.REDIS_PORT || 6379) } });
  smtp = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.write('220 audit.local ESMTP\r\n');
    let buffer = '', inData = false, recipient = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (true) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          accepted.push({ recipient, at: Date.now() });
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write('250 2.0.0 Accepted\r\n');
        }
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^EHLO|^HELO/.test(line)) socket.write('250 audit.local\r\n');
        else if (/^MAIL/.test(line)) socket.write('250 OK\r\n');
        else if (/^RCPT/.test(line)) { recipient = line.replace(/^RCPT TO:\s*</i, '').replace(/>.*$/, ''); socket.write('250 OK\r\n'); }
        else if (line === 'DATA') { inData = true; socket.write('354 End with dot\r\n'); }
        else if (line === 'QUIT') { socket.end('221 Bye\r\n'); return; }
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
  baseEnv.AUDIT_SMTP_PORT = String(smtp.address().port);
  const port = await freePort();
  baseEnv.PORT = String(port);
  start('dist/server.js');
  await until(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { return false; }
  }, 'isolated API startup');

  async function createOwner(suffix) {
    const user = await prisma.user.create({ data: { googleId: `${runId}-${suffix}`, email: `${runId}-${suffix}@example.test`, name: 'Integration audit' } });
    const token = jwt.sign({ userId: user.id, email: user.email }, jwtSecret, { expiresIn: '5m' });
    return { user, token };
  }
  async function schedule(owner, count, startAt, campaignLimit) {
    const response = await fetch(`http://127.0.0.1:${port}/api/emails/schedule`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ senderEmail: 'scheduler-audit@example.test', senderName: 'Local audit',
        recipients: Array.from({ length: count }, (_, i) => `${owner.user.id}-${i}@example.test`),
        subject: 'Integration: restart and limits', body: 'Local SMTP only', startAt: new Date(startAt).toISOString(),
        delayBetweenEmailsMs: 0, hourlyLimit: campaignLimit }),
    });
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const result = await response.json();
    assert.equal(result.data.scheduled, count);
    const sender = await prisma.sender.findFirst({ where: { userId: owner.user.id } });
    senderIds.push(sender.id);
  }
  try {
    const owner = await createOwner('restart');
    let workers = [start('dist/workers/emailWorker.js'), start('dist/workers/emailWorker.js')];
    const startAt = Date.now() + 4000;
    await schedule(owner, 6, startAt, 10);
    await Promise.all(workers.map(stop));
    assert.equal(accepted.length, 0, 'Future emails must not send before restart');
    workers = [start('dist/workers/emailWorker.js'), start('dist/workers/emailWorker.js')];
    await until(async () => await prisma.emailJob.count({ where: { userId: owner.user.id, status: 'SENT' } }) === 3
      && await prisma.emailJob.count({ where: { userId: owner.user.id, status: 'RATE_LIMITED' } }) === 3, '3 sent and 3 deferred by shared quota');
    assert.equal(accepted.length, 3);
    assert.equal(new Set(accepted.map(item => item.recipient)).size, 3);
    assert.ok(accepted[0].at >= startAt, 'No early send');
    for (let i = 1; i < 3; i++) assert.ok(accepted[i].at - accepted[i - 1].at >= 20, '25 ms minimum with 5 ms network observation tolerance');
    const deferred = await prisma.emailJob.findMany({ where: { userId: owner.user.id, status: 'RATE_LIMITED' } });
    assert.ok(deferred.every(row => row.scheduledAt > new Date()));
    await Promise.all(workers.map(stop));

    const loadOwner = await createOwner('load');
    const started = Date.now();
    // API persists its 25 ms minimum. Workers may impose a stricter minimum;
    // they must honor this saved campaign value as well.
    await schedule(loadOwner, 1000, Date.now(), 2000);
    workers = [start('dist/workers/emailWorker.js', { MAX_EMAILS_PER_HOUR_PER_SENDER: '2000' }), start('dist/workers/emailWorker.js', { MAX_EMAILS_PER_HOUR_PER_SENDER: '2000' })];
    await until(async () => await prisma.emailJob.count({ where: { userId: loadOwner.user.id, status: 'SENT' } }) === 1000, '1000 real application deliveries', 130000);
    const loadAccepted = accepted.filter(item => item.recipient.startsWith(loadOwner.user.id));
    assert.equal(loadAccepted.length, 1000);
    assert.equal(new Set(loadAccepted.map(item => item.recipient)).size, 1000);
    const minimumObservedSpacingMs = Math.min(...loadAccepted.slice(1).map((item, index) => item.at - loadAccepted[index].at));
    assert.ok(minimumObservedSpacingMs >= 20, `SMTP spacing collapsed to ${minimumObservedSpacingMs} ms despite a 25 ms minimum`);
    assert.equal(await prisma.emailJob.count({ where: { userId: loadOwner.user.id, status: { in: ['FAILED', 'DELIVERY_UNKNOWN'] } } }), 0);
    console.log(JSON.stringify({ restart: 'passed', workers: 2, quota: { sent: 3, deferred: 3 }, loadDelivered: 1000, minimumObservedSpacingMs, loadDurationMs: Date.now() - started, externalSmtpCalls: 0 }));
  } catch (error) {
    console.error(logs.join('').slice(-6000));
    throw error;
  }
});
