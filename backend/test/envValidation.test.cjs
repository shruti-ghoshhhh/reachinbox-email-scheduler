const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough';
process.env.ADMIN_USERNAME = 'reviewer';
process.env.ADMIN_PASSWORD = 'long-test-password-123';

const { completeEnvSchema } = require('../src/config/env');
const { hasValidAdminCredentials } = require('../src/middleware/adminAuth');

const validConfig = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  JWT_SECRET: 'test-jwt-secret',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough',
};

test('numeric environment settings parse to bounded integers', () => {
  const parsed = completeEnvSchema.parse({ ...validConfig, PORT: '4001', WORKER_CONCURRENCY: '10' });
  assert.equal(parsed.PORT, '4001');
  assert.equal(parsed.WORKER_CONCURRENCY, '10');
});

test('numeric environment settings reject malformed and out-of-range values', () => {
  assert.equal(completeEnvSchema.safeParse({ ...validConfig, PORT: '4x' }).success, false);
  assert.equal(completeEnvSchema.safeParse({ ...validConfig, REDIS_PORT: '70000' }).success, false);
  assert.equal(completeEnvSchema.safeParse({ ...validConfig, WORKER_CONCURRENCY: '0' }).success, false);
  assert.equal(completeEnvSchema.safeParse({ ...validConfig, EMAIL_SEND_DELAY_MS: '0' }).success, false);
  assert.equal(completeEnvSchema.safeParse({ ...validConfig, EMAIL_SEND_DELAY_MS: '1' }).success, true);
});

test('Bull Board credentials must be configured as a pair', () => {
  assert.equal(completeEnvSchema.safeParse({ ...validConfig, ADMIN_USERNAME: 'reviewer' }).success, false);
  assert.equal(completeEnvSchema.safeParse({ ...validConfig, ADMIN_USERNAME: 'reviewer', ADMIN_PASSWORD: 'a-long-password-value' }).success, true);
});

test('Bull Board Basic Auth accepts only the configured credential pair', () => {
  const valid = `Basic ${Buffer.from('reviewer:long-test-password-123').toString('base64')}`;
  const wrongPassword = `Basic ${Buffer.from('reviewer:wrong-password').toString('base64')}`;
  assert.equal(hasValidAdminCredentials(valid), true);
  assert.equal(hasValidAdminCredentials(wrongPassword), false);
  assert.equal(hasValidAdminCredentials(undefined), false);
});
