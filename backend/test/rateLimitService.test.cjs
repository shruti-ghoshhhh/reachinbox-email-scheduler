const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.GOOGLE_CLIENT_ID ||= 'test';
process.env.GOOGLE_CLIENT_SECRET ||= 'test';
process.env.JWT_SECRET ||= 'test';
process.env.REDIS_HOST ||= 'localhost';
process.env.REDIS_PORT ||= '6379';

require('ts-node/register');
const { redis } = require('../src/config/redis.ts');
const { checkAndIncrementRateLimit } = require('../src/services/rateLimitService.ts');

const realDate = global.Date;
const baseHour = Date.UTC(2026, 9, 24, 10, 15, 0);
let now = baseHour;
let counts = new Map();
let reservations = new Map();
let expireAt = new Map();
let failRedis = false;

class FakeDate extends realDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}

function purgeExpired() {
  for (const [key, until] of expireAt) {
    if (until <= now) {
      expireAt.delete(key);
      counts.delete(key);
      reservations.delete(key);
    }
  }
}

redis.eval = async (script, keyCount, counterKey, reservationKey, limitArg, ttlArg) => {
  if (failRedis) throw new Error('Redis unavailable');
  purgeExpired();
  assert.equal(keyCount, 2);
  assert.match(script, /A retry already admitted in this hour reuses its slot/);
  const limit = Number(limitArg);
  const ttl = Number(ttlArg) * 1000;
  if (reservations.has(reservationKey)) return [1, counts.get(counterKey) || 0];
  const current = counts.get(counterKey) || 0;
  if (current >= limit) return [0, current];
  const next = current + 1;
  counts.set(counterKey, next);
  reservations.set(reservationKey, true);
  expireAt.set(counterKey, now + ttl);
  expireAt.set(reservationKey, now + ttl);
  return [1, next];
};

function reset() {
  global.Date = FakeDate;
  now = baseHour;
  counts = new Map();
  reservations = new Map();
  expireAt = new Map();
  failRedis = false;
}

afterEach(() => { global.Date = realDate; });

test('retry in the same UTC hour reuses the job reservation', async () => {
  reset();
  assert.equal((await checkAndIncrementRateLimit('sender-a', 1, 'job-a')).allowed, true);
  const retry = await checkAndIncrementRateLimit('sender-a', 1, 'job-a');
  assert.deepEqual([retry.allowed, retry.currentCount], [true, 1]);
  assert.equal(counts.size, 1);
});

test('retry in the next UTC hour reserves against the new hourly counter', async () => {
  reset();
  await checkAndIncrementRateLimit('sender-a', 1, 'job-a');
  now += 60 * 60 * 1000;
  const retry = await checkAndIncrementRateLimit('sender-a', 1, 'job-a');
  assert.equal(retry.allowed, true);
  assert.equal(retry.currentCount, 1);
  assert.equal(counts.size, 2);
});

test('an admitted job may retry at the cap while a new job is rejected', async () => {
  reset();
  await checkAndIncrementRateLimit('sender-a', 1, 'job-a');
  const retry = await checkAndIncrementRateLimit('sender-a', 1, 'job-a');
  const fresh = await checkAndIncrementRateLimit('sender-a', 1, 'job-b');
  assert.deepEqual([retry.allowed, retry.currentCount], [true, 1]);
  assert.deepEqual([fresh.allowed, fresh.currentCount], [false, 1]);
});

test('expired reservation and counter permit a new window admission', async () => {
  reset();
  await checkAndIncrementRateLimit('sender-a', 1, 'job-a');
  now += 2 * 60 * 60 * 1000;
  const next = await checkAndIncrementRateLimit('sender-a', 1, 'job-b');
  assert.equal(next.allowed, true);
  assert.equal(next.currentCount, 1);
});

test('Redis errors fail closed and propagate to the worker for retry', async () => {
  reset();
  failRedis = true;
  await assert.rejects(checkAndIncrementRateLimit('sender-a', 1, 'job-a'), /Redis unavailable/);
});
