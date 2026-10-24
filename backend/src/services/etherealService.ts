/**
 * Ethereal email service with support for multiple sender accounts.
 *
 * Multiple Ethereal accounts are created automatically on startup and
 * persisted to `.ethereal-accounts.json` so the same sender identities
 * survive backend restarts without requiring new API calls to Ethereal.
 *
 * Preview emails at: https://ethereal.email/messages
 */

import fs from 'fs';
import path from 'path';
import { env } from '../config/env';
import type { Transporter } from 'nodemailer';

// Nodemailer's test-account helper caches one account by default. Disable that
// cache while it loads so the multi-account pool can contain distinct senders.
const previousEtherealCache = process.env.ETHEREAL_CACHE;
process.env.ETHEREAL_CACHE = 'no';
const nodemailer = require('nodemailer') as typeof import('nodemailer');
if (previousEtherealCache === undefined) delete process.env.ETHEREAL_CACHE;
else process.env.ETHEREAL_CACHE = previousEtherealCache;

/** Path where we persist Ethereal credentials across restarts */
const ACCOUNTS_FILE = path.resolve(process.cwd(), '.ethereal-accounts.json');

interface EtherealAccount {
  email: string;
  user: string;
  pass: string;
  transporter: Transporter;
}

// Pool of Ethereal accounts for multi-sender demo
const accountPool: EtherealAccount[] = [];
let defaultAccount: EtherealAccount | null = null;



interface PersistedAccount {
  user: string;
  pass: string;
}

function loadPersistedAccounts(): PersistedAccount[] {
  try {
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PersistedAccount[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // File doesn't exist or is corrupt — will create fresh accounts
  }
  return [];
}

function saveAccounts(accounts: PersistedAccount[]): void {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
  } catch (err) {
    console.warn('⚠️  Could not persist Ethereal accounts:', (err as Error).message);
  }
}

function buildAccount(user: string, pass: string): EtherealAccount {
  const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user, pass },
  });
  return { email: user, user, pass, transporter };
}

/**
 * Initialize multiple Ethereal accounts for demo purposes.
 * Restores previously-created accounts from disk first so sender
 * identities (and Ethereal preview inboxes) survive restarts.
 * Call once on server startup.
 */
export async function initEtherealAccounts(): Promise<void> {
  if (accountPool.length > 0) return;

  // If credentials are set in .env, use a single configured account
  if (env.ETHEREAL_USER && env.ETHEREAL_PASS) {
    const acc = buildAccount(env.ETHEREAL_USER, env.ETHEREAL_PASS);
    accountPool.push(acc);
    defaultAccount = acc;
    console.log(`✅ Using configured Ethereal account: ${env.ETHEREAL_USER}`);
    return;
  }

  // Try to restore previously persisted accounts (survives restarts)
  const saved = loadPersistedAccounts();
  if (saved.length > 0) {
    const uniqueSaved = [...new Map(saved.map((account) => [account.user, account])).values()];
    console.log(`🔄 Restoring ${uniqueSaved.length} persisted Ethereal account(s)...`);
    for (const { user, pass } of uniqueSaved) {
      const acc = buildAccount(user, pass);
      accountPool.push(acc);
      console.log(`✅ Restored Ethereal sender: ${acc.email}`);
    }
  }

  // Maintain up to three distinct accounts. Nodemailer's account cache is
  // disabled above so each call provisions a separate Ethereal identity.
  console.log('🔧 Creating Ethereal test accounts...');
  for (let i = accountPool.length; i < 3; i++) {
    try {
      const account = await nodemailer.createTestAccount();
      if (accountPool.some((existing) => existing.email === account.user)) continue;
      const acc = buildAccount(account.user, account.pass);
      accountPool.push(acc);
      console.log(`✅ Ethereal sender ${accountPool.length}: ${acc.email}`);
    } catch (err) {
      console.warn(`⚠️  Failed to create Ethereal account ${i + 1}:`, (err as Error).message);
    }
  }

  if (accountPool.length === 0) {
    throw new Error('Failed to create any Ethereal accounts');
  }

  defaultAccount = accountPool[0];
  // Persist only distinct account credentials so sender choices survive restarts.
  saveAccounts(accountPool.map(({ user, pass }) => ({ user, pass })));
  console.log(`📬 Preview emails at: https://ethereal.email/messages`);
  console.log(`📧 Available senders: ${accountPool.map((a) => a.email).join(', ')}`);
}

/**
 * Get the transporter for a specific sender email.
 * Throws when the requested sender is not a configured Ethereal account.
 */
export function getTransporterForSender(senderEmail: string): Transporter {
  const account = accountPool.find((a) => a.email === senderEmail);
  if (account) return account.transporter;
  throw new Error(`No configured Ethereal account found for sender ${senderEmail}`);
}

/**
 * Get all registered Ethereal accounts (for display/seed purposes).
 */
export function getEtherealAccounts(): Array<{ email: string; previewUrl: string }> {
  return accountPool.map((a) => ({
    email: a.email,
    previewUrl: `https://ethereal.email/messages`,
  }));
}

export function getEtherealSenderAccounts(): Array<{ email: string }> {
  return accountPool.map(({ email }) => ({ email }));
}

export interface SendEmailResult {
  messageId: string;
  previewUrl: string;
}

export async function sendEmail(params: {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  if (!defaultAccount) {
    await initEtherealAccounts();
  }

  const account = accountPool.find((a) => a.email === params.from);
  if (!account) {
    throw new Error(`No configured Ethereal account found for sender ${params.from}`);
  }

  const info = await account.transporter.sendMail({
    from: `"${params.fromName}" <${account.user}>`, // Ethereal requires the authenticated address as From
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.html.replace(/<[^>]*>/g, ''), // strip HTML for text fallback
  });

  const previewUrl = (nodemailer.getTestMessageUrl(info) as string) || 'https://ethereal.email/messages';
  console.log(`📧 Email sent to ${params.to} | Preview: ${previewUrl}`);

  return {
    messageId: info.messageId,
    previewUrl,
  };
}
