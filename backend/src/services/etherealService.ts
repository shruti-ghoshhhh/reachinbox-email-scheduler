/**
 * Ethereal email service with support for multiple sender accounts.
 *
 * Multiple Ethereal accounts are created automatically on startup and
 * persisted to `.ethereal-accounts.json` so the same sender identities
 * survive backend restarts without requiring new API calls to Ethereal.
 *
 * Preview emails at: https://ethereal.email/messages
 */

import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';

/** Path where we persist Ethereal credentials across restarts */
const ACCOUNTS_FILE = path.resolve(process.cwd(), '.ethereal-accounts.json');

interface EtherealAccount {
  email: string;
  user: string;
  pass: string;
  transporter: nodemailer.Transporter;
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
    console.log(`🔄 Restoring ${saved.length} persisted Ethereal account(s)...`);
    for (const { user, pass } of saved) {
      const acc = buildAccount(user, pass);
      accountPool.push(acc);
      console.log(`✅ Restored Ethereal sender: ${acc.email}`);
    }
    defaultAccount = accountPool[0];
    console.log(`📬 Preview emails at: https://ethereal.email/messages`);
    return;
  }

  // First run — create 3 Ethereal accounts and persist them
  console.log('🔧 Creating Ethereal test accounts (first run)...');
  for (let i = 0; i < 3; i++) {
    try {
      const account = await nodemailer.createTestAccount();
      const acc = buildAccount(account.user, account.pass);
      accountPool.push(acc);
      console.log(`✅ Ethereal sender ${i + 1}: ${acc.email}`);
    } catch (err) {
      console.warn(`⚠️  Failed to create Ethereal account ${i + 1}:`, (err as Error).message);
    }
  }

  if (accountPool.length === 0) {
    throw new Error('Failed to create any Ethereal accounts');
  }

  defaultAccount = accountPool[0];
  // Persist so we don't re-create on the next restart
  saveAccounts(accountPool.map(({ user, pass }) => ({ user, pass })));
  console.log(`📬 Preview emails at: https://ethereal.email/messages`);
  console.log(`📧 Available senders: ${accountPool.map((a) => a.email).join(', ')}`);
}

/**
 * Get the transporter for a specific sender email.
 * Falls back to the default account if not found.
 */
export function getTransporterForSender(senderEmail: string): nodemailer.Transporter {
  const account = accountPool.find((a) => a.email === senderEmail);
  if (account) return account.transporter;

  // Fallback: use default account but still send from the requested address
  if (!defaultAccount) {
    throw new Error('No Ethereal accounts initialized. Call initEtherealAccounts() first.');
  }
  return defaultAccount.transporter;
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

  const transporter = getTransporterForSender(params.from);

  const info = await transporter.sendMail({
    from: `"${params.fromName}" <${defaultAccount!.user}>`, // Ethereal requires auth user as from
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
