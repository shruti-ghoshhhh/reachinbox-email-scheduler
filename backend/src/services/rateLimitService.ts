import { redis } from '../config/redis';
import { env } from '../config/env';

/**
 * Rate limiting using Redis-backed fixed window counters.
 * Key format: rate_limit:sender:{senderId}:{YYYYMMDDHH}
 *
 * INCR + EXPIRE are pipelined for performance, but true atomicity for the
 * check-and-increment is achieved via a Lua script so multiple workers
 * cannot race past the limit.
 */

function getHourWindow(date: Date = new Date()): string {
  const d = date;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  return `${y}${mo}${day}${h}`;
}

function getRateLimitKey(senderId: string, window: string): string {
  return `rate_limit:sender:${senderId}:${window}`;
}

function getSlackNotifiedKey(senderId: string, window: string): string {
  return `rate_limit:slack_notified:${senderId}:${window}`;
}

export interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  nextWindowAt: Date;
  senderId: string;
}

/**
 * Lua script: atomically INCR the counter and check against limit.
 * Returns the new count. If the key was newly created, sets EXPIRE.
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = limit (max count)
 * ARGV[2] = TTL seconds (7200 = 2h so we cover the expiry boundary)
 *
 * Returns { count, wasCreated }
 */
const incrIfBelowLimitScript = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local current = redis.call('GET', key)
if current == false then
  current = 0
else
  current = tonumber(current)
end

if current >= limit then
  return current
end

local newVal = redis.call('INCR', key)
if newVal == 1 then
  redis.call('EXPIRE', key, ttl)
end
return newVal
`;

/**
 * Check and atomically increment the rate limit counter for a sender.
 * Returns whether the email is allowed to be sent.
 */
export async function checkAndIncrementRateLimit(senderId: string): Promise<RateLimitResult> {
  const limit = env.MAX_EMAILS_PER_HOUR_PER_SENDER;
  const window = getHourWindow();
  const key = getRateLimitKey(senderId, window);

  // Atomic: only increment if count < limit
  const result = await redis.eval(incrIfBelowLimitScript, 1, key, String(limit), '7200') as number;

  // Parse the window string back to compute next window start
  const y = parseInt(window.slice(0, 4));
  const mo = parseInt(window.slice(4, 6)) - 1;
  const day = parseInt(window.slice(6, 8));
  const h = parseInt(window.slice(8, 10));
  const windowStart = Date.UTC(y, mo, day, h);
  const nextWindowAt = new Date(windowStart + 3600000);

  // If result > limit, it means we were at limit already (script returned existing count)
  const allowed = result <= limit;

  return {
    allowed,
    currentCount: result,
    limit,
    nextWindowAt,
    senderId,
  };
}

/**
 * Decrement counter (when a job is rescheduled instead of sent).
 * Only decrement if above 0 to avoid negative counts.
 */
export async function decrementRateLimit(senderId: string): Promise<void> {
  const window = getHourWindow();
  const key = getRateLimitKey(senderId, window);
  const current = await redis.get(key);
  if (current && parseInt(current) > 0) {
    await redis.decr(key);
  }
}

/**
 * Get current rate limit status without incrementing.
 */
export async function getRateLimitStatus(senderId: string): Promise<{
  currentCount: number;
  limit: number;
  remaining: number;
  nextWindowAt: Date;
}> {
  const limit = env.MAX_EMAILS_PER_HOUR_PER_SENDER;
  const window = getHourWindow();
  const key = getRateLimitKey(senderId, window);

  const currentCount = parseInt((await redis.get(key)) ?? '0', 10);

  const y = parseInt(window.slice(0, 4));
  const mo = parseInt(window.slice(4, 6)) - 1;
  const day = parseInt(window.slice(6, 8));
  const h = parseInt(window.slice(8, 10));
  const windowStart = Date.UTC(y, mo, day, h);
  const nextWindowAt = new Date(windowStart + 3600000);

  return {
    currentCount,
    limit,
    remaining: Math.max(0, limit - currentCount),
    nextWindowAt,
  };
}

/**
 * Calculate the delay needed to push a job to the next available hour window.
 */
export async function getNextWindowDelay(senderId: string): Promise<number> {
  const window = getHourWindow();
  const y = parseInt(window.slice(0, 4));
  const mo = parseInt(window.slice(4, 6)) - 1;
  const day = parseInt(window.slice(6, 8));
  const h = parseInt(window.slice(8, 10));
  const windowStart = Date.UTC(y, mo, day, h);
  const nextWindowStart = windowStart + 3600000;

  // 5s buffer to ensure window has reset
  const delay = nextWindowStart - Date.now() + 5000;
  return Math.max(delay, 0);
}

/**
 * Check and set the "slack notified" flag for a sender+window.
 * Returns true if this is the FIRST notification for this window (should send Slack).
 * Uses SET NX (only set if not exists) for atomicity.
 */
export async function shouldSendSlackNotification(senderId: string): Promise<boolean> {
  const window = getHourWindow();
  const key = getSlackNotifiedKey(senderId, window);
  // SET key 1 NX EX 7200 — returns 'OK' if set, null if already existed
  const result = await redis.set(key, '1', 'NX', 'EX', 7200);
  return result === 'OK';
}
