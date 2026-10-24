import session from 'express-session';
import { redis } from './redis';

const SESSION_PREFIX = 'reachinbox:session:';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export class RedisSessionStore extends session.Store {
  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    redis.get(`${SESSION_PREFIX}${sid}`)
      .then((value) => callback(null, value ? JSON.parse(value) as session.SessionData : null))
      .catch((error: unknown) => callback(error));
  }

  set(sid: string, value: session.SessionData, callback?: (err?: unknown) => void): void {
    const ttlSeconds = Math.max(1, Math.ceil((value.cookie.maxAge ?? DEFAULT_TTL_SECONDS * 1000) / 1000));
    redis.set(`${SESSION_PREFIX}${sid}`, JSON.stringify(value), 'EX', ttlSeconds)
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    redis.del(`${SESSION_PREFIX}${sid}`)
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  touch(sid: string, value: session.SessionData, callback?: (err?: unknown) => void): void {
    const ttlSeconds = Math.max(1, Math.ceil((value.cookie.maxAge ?? DEFAULT_TTL_SECONDS * 1000) / 1000));
    redis.expire(`${SESSION_PREFIX}${sid}`, ttlSeconds)
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }
}
