const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { buildSlackRateLimitMessage, postSlackRateLimitMessage } = require('../src/services/slackNotificationDelivery.ts');

const notification = {
  senderEmail: 'sender@example.test',
  hourlyLimit: 1,
  nextWindowAt: new Date('2026-10-25T12:00:00.000Z'),
  createdAt: new Date('2026-10-25T11:00:00.000Z'),
  clientMsgId: '00000000-0000-4000-8000-000000000001',
};

test('builds a rate limit alert with stable UTC timestamps and destination', () => {
  const message = buildSlackRateLimitMessage(notification, 'U123');
  assert.equal(message.channel, 'U123');
  assert.match(message.blocks[2].text.text, /2026-10-25T12:00:00\.000Z/);
  assert.match(message.blocks[3].elements[0].text, /2026-10-25T11:00:00\.000Z/);
});

test('resolves only when Slack confirms delivery', async () => {
  let request;
  await postSlackRateLimitMessage('xoxb-test', 'U123', notification, async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
  assert.equal(request.url, 'https://slack.com/api/chat.postMessage');
  assert.equal(request.options.headers.Authorization, 'Bearer xoxb-test');
  assert.equal(JSON.parse(request.options.body).channel, 'U123');
  assert.equal(JSON.parse(request.options.body).client_msg_id, notification.clientMsgId);
});

test('throws when Slack rejects the message so the caller can retry', async () => {
  await assert.rejects(
    postSlackRateLimitMessage('xoxb-test', 'U123', notification, async () => ({
      ok: true, status: 200, json: async () => ({ ok: false, error: 'ratelimited' }),
    })),
    /ratelimited/
  );
});

test('throws on HTTP failure even if a response body claims success', async () => {
  await assert.rejects(
    postSlackRateLimitMessage('xoxb-test', 'U123', notification, async () => ({
      ok: false, status: 503, json: async () => ({ ok: true }),
    })),
    /HTTP 503/
  );
});
