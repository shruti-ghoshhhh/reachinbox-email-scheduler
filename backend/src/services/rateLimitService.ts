import { redis } from '../config/redis';
import { env } from '../config/env';
import { randomUUID } from 'node:crypto';

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
  /** Sender-wide count; this drives the status display and Slack threshold. */
  currentCount: number;
  campaignCount: number;
  limit: number;
  limitingScope: 'sender' | 'campaign' | null;
  nextWindowAt: Date;
  senderId: string;
}

/**
 * Lua script: atomically reserve one hourly slot per logical email job.
 * Returns the new count. If the key was newly created, sets EXPIRE.
 *
 * Sender and campaign counters are admitted in one atomic operation. A
 * campaign limit is an additional cap; it can never change the sender-wide
 * authoritative cap shared by concurrent campaigns.
 */
const incrIfBelowLimitScript = `
local senderKey = KEYS[1]
local senderReservation = KEYS[2]
local campaignKey = KEYS[3]
local campaignReservation = KEYS[4]
local senderLimit = tonumber(ARGV[1])
local campaignLimit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

-- A retry already admitted in this hour reuses its slot.
if redis.call('EXISTS', senderReservation) == 1 then
  return {1, tonumber(redis.call('GET', senderKey) or '0'), tonumber(redis.call('GET', campaignKey) or '0'), senderLimit, 1}
end

local senderCount = tonumber(redis.call('GET', senderKey) or '0')
local campaignCount = tonumber(redis.call('GET', campaignKey) or '0')

if senderCount >= senderLimit then
  return {0, senderCount, campaignCount, senderLimit, 1}
end
if campaignLimit > 0 and campaignCount >= campaignLimit then
  return {0, senderCount, campaignCount, campaignLimit, 2}
end

senderCount = redis.call('INCR', senderKey)
if senderCount == 1 then redis.call('EXPIRE', senderKey, ttl) end
redis.call('SET', senderReservation, '1', 'EX', ttl)
if campaignLimit > 0 then
  campaignCount = redis.call('INCR', campaignKey)
  if campaignCount == 1 then redis.call('EXPIRE', campaignKey, ttl) end
  redis.call('SET', campaignReservation, '1', 'EX', ttl)
end
return {1, senderCount, campaignCount, senderLimit, 1}
`;

/**
 * Check and atomically increment the rate limit counter for a sender.
 * Returns whether the email is allowed to be sent.
 */
export async function checkAndIncrementRateLimit(
  senderId: string,
  senderLimit = env.MAX_EMAILS_PER_HOUR_PER_SENDER,
  reservationId?: string,
  campaignId?: string,
  campaignLimit?: number
): Promise<RateLimitResult> {
  const window = getHourWindow();
  const key = getRateLimitKey(senderId, window);
  const reservationIdValue = reservationId ?? `${Date.now()}:${Math.random()}`;
  const reservationKey = `rate_limit:reservation:${senderId}:${window}:${reservationIdValue}`;
  const campaignKey = `rate_limit:campaign:${senderId}:${campaignId ?? 'none'}:${window}`;
  const campaignReservationKey = `rate_limit:campaign_reservation:${senderId}:${campaignId ?? 'none'}:${window}:${reservationIdValue}`;

  const [allowedFlag, currentCount, campaignCount, limit, scopeFlag] = await redis.eval(
    incrIfBelowLimitScript, 4, key, reservationKey, campaignKey, campaignReservationKey,
    String(senderLimit), String(campaignId ? (campaignLimit ?? senderLimit) : 0), '7200'
  ) as [number, number, number, number, number];

  // Parse the window string back to compute next window start
  const y = parseInt(window.slice(0, 4));
  const mo = parseInt(window.slice(4, 6)) - 1;
  const day = parseInt(window.slice(6, 8));
  const h = parseInt(window.slice(8, 10));
  const windowStart = Date.UTC(y, mo, day, h);
  const nextWindowAt = new Date(windowStart + 3600000);

  const allowed = allowedFlag === 1;

  return {
    allowed,
    currentCount,
    campaignCount,
    limit,
    limitingScope: allowed ? null : scopeFlag === 2 ? 'campaign' : 'sender',
    nextWindowAt,
    senderId,
  };
}

/** Campaigns may request slower sends, but cannot disable the provider minimum. */
export function getEffectiveSendSpacing(spacingMs: number): number {
  return Math.max(env.EMAIL_SEND_DELAY_MS, Number.isFinite(spacingMs) ? spacingMs : 0);
}

/** Hold sender exclusivity through SMTP, then apply the provider cooldown. */
export async function acquireSenderSendSlot(senderId: string, spacingMs: number): Promise<() => Promise<void>> {
  const spacing = getEffectiveSendSpacing(spacingMs);
  const lockKey = `rate_limit:sender:${senderId}:send_lock`;
  const nextAtKey = `rate_limit:sender:${senderId}:next_send_at`;
  const token = randomUUID();
  const leaseMs = 120_000;
  const acquireScript = `
    if redis.call('EXISTS', KEYS[1]) == 1 then
      return math.max(1, math.min(250, redis.call('PTTL', KEYS[1])))
    end
    local clock = redis.call('TIME')
    local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
    local nextAt = tonumber(redis.call('GET', KEYS[2]) or '0')
    if nextAt > now then return nextAt - now end
    redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
    return 0
  `;
  while (true) {
    const waitMs = await redis.eval(acquireScript, 2, lockKey, nextAtKey, token, String(leaseMs)) as number;
    if (waitMs === 0) break;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  const renewScript = `
    if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
  `;
  const heartbeat = setInterval(() => {
    void redis.eval(renewScript, 1, lockKey, token, String(leaseMs)).catch((error) => {
      console.error(`Failed to renew sender send lease for ${senderId}:`, error);
    });
  }, leaseMs / 4);
  heartbeat.unref();
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    const releaseScript = `
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
      local clock = redis.call('TIME')
      local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
      local spacing = tonumber(ARGV[2])
      local nextAt = tonumber(redis.call('GET', KEYS[2]) or '0')
      redis.call('SET', KEYS[2], math.max(nextAt, now + spacing), 'PX', spacing * 2)
      redis.call('DEL', KEYS[1])
      return 1
    `;
    const result = await redis.eval(releaseScript, 2, lockKey, nextAtKey, token, String(spacing)) as number;
    if (result !== 1) throw new Error(`Sender send lease was lost for ${senderId}`);
  };
}

/** Admit one sender-wide send at a time using Redis's clock across all workers. */
export async function waitForSenderSendSlot(senderId: string, spacingMs: number): Promise<void> {
  const effectiveSpacingMs = getEffectiveSendSpacing(spacingMs);
  const script = `
    local clock = redis.call('TIME')
    local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
    local spacing = tonumber(ARGV[1])
    local nextAt = tonumber(redis.call('GET', KEYS[1]) or '0')
    if nextAt > now then return nextAt - now end
    redis.call('SET', KEYS[1], now + spacing, 'PX', spacing * 2)
    return 0
  `;
  // Recheck after waking rather than pre-booking future slots: a paused worker
  // must not wake and send a burst alongside other previously reserved slots.
  while (true) {
    const waitMs = await redis.eval(script, 1, `rate_limit:sender:${senderId}:next_send_at`, String(effectiveSpacingMs)) as number;
    if (waitMs === 0) return;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/**
 * Get current rate limit status without incrementing.
 */
export async function getRateLimitStatus(senderId: string): Promise<{
  currentCount: number;
  limit: number;
  remaining: number;
  policy: 'sender-wide cap; campaign cap may further restrict';
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
    policy: 'sender-wide cap; campaign cap may further restrict',
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
  const result = await redis.set(key, '1', 'EX', 7200, 'NX');
  return result === 'OK';
}
