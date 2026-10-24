const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.GOOGLE_CLIENT_ID ||= 'test';
process.env.GOOGLE_CLIENT_SECRET ||= 'test';
process.env.JWT_SECRET ||= 'test';
process.env.SESSION_SECRET ||= 'test-session-secret-that-is-long-enough';
process.env.EMAIL_SEND_DELAY_MS = '40';

const { redis } = require('../src/config/redis.ts');
const { waitForSenderSendSlot, acquireSenderSendSlot, getEffectiveSendSpacing } = require('../src/services/rateLimitService.ts');
const clients = [redis.duplicate(), redis.duplicate()];
const originalEval = redis.eval.bind(redis);
let nextClient = 0;
// Exercise the actual Lua through distinct Redis connections, as with workers.
redis.eval = (...args) => clients[nextClient++ % clients.length].eval(...args);

after(async () => {
  redis.eval = originalEval;
  await Promise.all(clients.map((client) => client.quit()));
  redis.disconnect();
});

test('campaign requests cannot disable or reduce the positive provider minimum', () => {
  assert.equal(getEffectiveSendSpacing(0), 40);
  assert.equal(getEffectiveSendSpacing(10), 40);
  assert.equal(getEffectiveSendSpacing(100), 100);
});

async function concurrentAdmissions(spacing, count, pauseEventLoop) {
  const senderId = `spacing-test-${randomUUID()}`;
  const admissions = [];
  try {
    const tasks = Array.from({ length: count }, async () => {
      await waitForSenderSendSlot(senderId, spacing);
      admissions.push(performance.now());
    });
    if (pauseEventLoop) {
      setTimeout(() => {
        const until = performance.now() + 130;
        while (performance.now() < until) { /* Simulate a paused worker. */ }
      }, 15);
    }
    await Promise.all(tasks);
    admissions.sort((a, b) => a - b);
    return admissions.slice(1).map((at, i) => at - admissions[i]);
  } finally {
    await clients[0].del(`rate_limit:sender:${senderId}:next_send_at`);
  }
}

test('real Redis serializes concurrent zero-delay requests from two connections', { timeout: 10000 }, async () => {
  const gaps = await concurrentAdmissions(0, 6, false);
  assert.ok(gaps.every((gap) => gap >= 38), `Expected provider minimum 40ms, observed: ${gaps}`);
});

test('real Redis honors larger campaign delays even after a worker pause', { timeout: 10000 }, async () => {
  const gaps = await concurrentAdmissions(60, 5, true);
  assert.ok(gaps.every((gap) => gap >= 58), `Expected campaign minimum 60ms, observed: ${gaps}`);
});

test('sender lease holds across delayed SMTP work, then enforces a completion cooldown', { timeout: 10000 }, async () => {
  const senderId = `spacing-test-${randomUUID()}`;
  const events = [];
  const firstRelease = await acquireSenderSendSlot(senderId, 0);
  assert.ok(await clients[0].pttl(`rate_limit:sender:${senderId}:send_lock`) > 0);
  const second = (async () => {
    const release = await acquireSenderSendSlot(senderId, 0);
    try { events.push(['second-start', performance.now()]); }
    finally { await release(); }
  })();
  try {
    // DB/network work can delay the first SMTP call well beyond its admission.
    await new Promise((resolve) => setTimeout(resolve, 110));
    assert.equal(events.length, 0, 'Second SMTP must not overtake delayed first SMTP');
    events.push(['first-complete', performance.now()]);
    await firstRelease();
    await second;
    assert.deepEqual(events.map(([name]) => name), ['first-complete', 'second-start']);
    assert.ok(events[1][1] - events[0][1] >= 38);
  } finally {
    await firstRelease();
    await clients[0].del(`rate_limit:sender:${senderId}:next_send_at`, `rate_limit:sender:${senderId}:send_lock`);
  }
});

test('concurrent SMTP leases never overlap and respect larger requested cooldowns', { timeout: 10000 }, async () => {
  const senderId = `spacing-test-${randomUUID()}`;
  let active = 0;
  let priorComplete;
  const gaps = [];
  try {
    await Promise.all(Array.from({ length: 5 }, async () => {
      const release = await acquireSenderSendSlot(senderId, 60);
      try {
        assert.equal(active, 0);
        active++;
        if (priorComplete !== undefined) gaps.push(performance.now() - priorComplete);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active--;
        priorComplete = performance.now();
      } finally { await release(); }
    }));
    assert.equal(gaps.length, 4);
    assert.ok(gaps.every((gap) => gap >= 58), `Observed completion-to-start gaps: ${gaps}`);
  } finally {
    await clients[0].del(`rate_limit:sender:${senderId}:next_send_at`, `rate_limit:sender:${senderId}:send_lock`);
  }
});

test('releasing a stale lease cannot delete another worker lock', async () => {
  const senderId = `spacing-test-${randomUUID()}`;
  const lockKey = `rate_limit:sender:${senderId}:send_lock`;
  const release = await acquireSenderSendSlot(senderId, 0);
  try {
    await clients[0].set(lockKey, 'replacement-owner', 'PX', 1000);
    await assert.rejects(release(), /lease was lost/);
    assert.equal(await clients[0].get(lockKey), 'replacement-owner');
  } finally {
    await clients[0].del(lockKey, `rate_limit:sender:${senderId}:next_send_at`);
  }
});
