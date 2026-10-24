import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const integerSetting = (fallback: string, min: number, max: number) => z.string()
  .default(fallback)
  .refine((value) => /^\d+$/.test(value), 'must be a whole number')
  .refine((value) => Number(value) >= min && Number(value) <= max, `must be between ${min} and ${max}`);

export const envSchema = z.object({
  PORT: integerSetting('4000', 1, 65535),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: integerSetting('6379', 1, 65535),
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:4000/api/auth/google/callback'),
  JWT_SECRET: z.string(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  TRUST_PROXY: z.string().default('false').refine(
    (value) => value === 'true' || value === 'false' || /^\d+$/.test(value),
    'must be true, false, or a proxy hop count',
  ),
  ADMIN_USERNAME: z.string().min(1).optional(),
  ADMIN_PASSWORD: z.string().min(16).optional(),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  ETHEREAL_USER: z.string().optional(),
  ETHEREAL_PASS: z.string().optional(),
  MAX_EMAILS_PER_HOUR_PER_SENDER: integerSetting('50', 1, 10000),
  GLOBAL_MAX_EMAILS_PER_HOUR: integerSetting('200', 1, 1000000),
  WORKER_CONCURRENCY: integerSetting('5', 1, 1000),
  EMAIL_SEND_DELAY_MS: integerSetting('2000', 1, 3600000),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().default('http://localhost:4000/api/slack/callback'),
});

export const completeEnvSchema = envSchema.refine(
  (values) => Boolean(values.ADMIN_USERNAME) === Boolean(values.ADMIN_PASSWORD),
  { message: 'ADMIN_USERNAME and ADMIN_PASSWORD must be configured together', path: ['ADMIN_PASSWORD'] },
);

const parsed = completeEnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = {
  ...parsed.data,
  PORT: Number(parsed.data.PORT),
  REDIS_PORT: Number(parsed.data.REDIS_PORT),
  MAX_EMAILS_PER_HOUR_PER_SENDER: Number(parsed.data.MAX_EMAILS_PER_HOUR_PER_SENDER),
  GLOBAL_MAX_EMAILS_PER_HOUR: Number(parsed.data.GLOBAL_MAX_EMAILS_PER_HOUR),
  WORKER_CONCURRENCY: Number(parsed.data.WORKER_CONCURRENCY),
  EMAIL_SEND_DELAY_MS: Number(parsed.data.EMAIL_SEND_DELAY_MS),
  TRUST_PROXY: parsed.data.TRUST_PROXY === 'true'
    ? true
    : parsed.data.TRUST_PROXY === 'false' ? false : Number(parsed.data.TRUST_PROXY),
};
