import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('4000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().default('6379'),
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:4000/api/auth/google/callback'),
  JWT_SECRET: z.string(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  SESSION_SECRET: z.string().default('fallback_session_secret'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  ETHEREAL_USER: z.string().optional(),
  ETHEREAL_PASS: z.string().optional(),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.string().default('50'),
  GLOBAL_MAX_EMAILS_PER_HOUR: z.string().default('200'),
  WORKER_CONCURRENCY: z.string().default('5'),
  EMAIL_SEND_DELAY_MS: z.string().default('2000'),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().default('http://localhost:4000/api/slack/callback'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = {
  ...parsed.data,
  PORT: parseInt(parsed.data.PORT, 10),
  REDIS_PORT: parseInt(parsed.data.REDIS_PORT, 10),
  MAX_EMAILS_PER_HOUR_PER_SENDER: parseInt(parsed.data.MAX_EMAILS_PER_HOUR_PER_SENDER, 10),
  GLOBAL_MAX_EMAILS_PER_HOUR: parseInt(parsed.data.GLOBAL_MAX_EMAILS_PER_HOUR, 10),
  WORKER_CONCURRENCY: parseInt(parsed.data.WORKER_CONCURRENCY, 10),
  EMAIL_SEND_DELAY_MS: parseInt(parsed.data.EMAIL_SEND_DELAY_MS, 10),
};
