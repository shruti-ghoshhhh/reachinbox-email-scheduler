import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function hasValidAdminCredentials(header: string | undefined): boolean {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !header?.startsWith('Basic ')) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  const usernameMatches = safeEqual(decoded.slice(0, separator), env.ADMIN_USERNAME);
  const passwordMatches = safeEqual(decoded.slice(separator + 1), env.ADMIN_PASSWORD);
  return usernameMatches && passwordMatches;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    res.status(503).send('Queue dashboard is disabled until ADMIN_USERNAME and ADMIN_PASSWORD are configured.');
    return;
  }
  if (!hasValidAdminCredentials(req.get('authorization'))) {
    res.set('WWW-Authenticate', 'Basic realm="ReachInbox Queue Admin", charset="UTF-8"');
    res.status(401).send('Administrator credentials required.');
    return;
  }
  next();
}
