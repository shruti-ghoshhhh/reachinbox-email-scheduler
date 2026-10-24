const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');

// Load the real Express routes and JWT middleware without external services.
const calls = [];
const prisma = { emailJob: {
  count: async (args) => { calls.push(args); return 1; },
  findMany: async (args) => {
    calls.push(args);
    return [{ id: 'held-1', status: 'DELIVERY_UNKNOWN', claimToken: 'private',
      sender: { email: 'sender@example.test', name: 'Sender' },
      deliveryMessageId: '<held-1@example.test>', errorMessage: 'SMTP acknowledgement lost',
      deliveryAttemptStartedAt: new Date('2026-10-25T00:00:00Z'), retryCount: 1 }];
  },
} };
const originalLoad = Module._load;
Module._load = function (name, parent, ...args) {
  if (parent?.filename.includes('routes') && parent.filename.endsWith('emails.ts')) {
    const mocks = {
      '../config/database': { prisma },
      '../queues/emailQueue': {},
      '../services/emailQueueReconciliation': {},
      '../config/elasticsearch': {},
      '../services/rateLimitService': { getEffectiveSendSpacing: (value) => value },
      '../services/etherealService': {},
    };
    if (name in mocks) return mocks[name];
  }
  if (name === '../config/env') return { env: { JWT_SECRET: 'review-test-secret', EMAIL_SEND_DELAY_MS: 2000 } };
  return originalLoad.call(this, name, parent, ...args);
};
const router = require('../src/routes/emails').default;
Module._load = originalLoad;
let server;
let baseUrl;
before(async () => {
  const app = express();
  app.use('/api/emails', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/emails/review`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });
const headers = { Authorization: `Bearer ${jwt.sign({ userId: 'owner-1' }, 'review-test-secret')}` };

test('review endpoint rejects unauthenticated access', async () => {
  assert.equal((await fetch(baseUrl)).status, 401);
});

test('review list is owner-scoped, held-only, paginated and preserves attempt evidence', async () => {
  calls.length = 0;
  const res = await fetch(`${baseUrl}?page=2&limit=10&search=held`, { headers });
  assert.equal(res.status, 200);
  const result = await res.json();
  for (const call of calls) {
    assert.equal(call.where.userId, 'owner-1');
    assert.equal(call.where.status, 'DELIVERY_UNKNOWN');
    assert.equal(call.where.OR[2].deliveryMessageId.contains, 'held');
  }
  assert.equal(calls[1].skip, 10);
  assert.equal(calls[1].take, 10);
  assert.equal(result.data[0].deliveryMessageId, '<held-1@example.test>');
  assert.equal(result.data[0].errorMessage, 'SMTP acknowledgement lost');
  assert.equal(result.data[0].deliveryAttemptStartedAt, '2026-10-25T00:00:00.000Z');
  assert.equal(result.data[0].claimToken, undefined);
  assert.equal(result.page, 2);
});

test('review endpoint validates pagination and structured search', async () => {
  assert.equal((await fetch(`${baseUrl}?page=0`, { headers })).status, 400);
  assert.equal((await fetch(`${baseUrl}?search[bad]=value`, { headers })).status, 400);
});
