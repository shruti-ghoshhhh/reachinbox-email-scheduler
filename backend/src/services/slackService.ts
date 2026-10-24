import { prisma } from '../config/database';
import { env } from '../config/env';

/**
 * Slack OAuth & notification service.
 * Stores per-user Slack tokens in the database.
 * Sends real Slack messages via the Web API (chat.postMessage).
 */

export function getSlackAuthUrl(state: string): string {
  const clientId = env.SLACK_CLIENT_ID;
  if (!clientId) throw new Error('SLACK_CLIENT_ID not configured');

  const scopes = ['chat:write', 'chat:write.public'].join(',');
  const redirectUri = encodeURIComponent(env.SLACK_REDIRECT_URI);

  return `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;
}

export async function exchangeSlackCode(code: string): Promise<{
  accessToken: string;
  teamId: string;
  userId: string;
  channelId?: string;
}> {
  const clientId = env.SLACK_CLIENT_ID;
  const clientSecret = env.SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Slack credentials not configured');
  }

  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: env.SLACK_REDIRECT_URI,
    }),
  });

  const data = await response.json() as {
    ok: boolean;
    access_token?: string;
    team?: { id: string };
    authed_user?: { id: string };
    incoming_webhook?: { channel_id?: string };
    error?: string;
  };

  if (!data.ok) {
    throw new Error(`Slack OAuth failed: ${data.error}`);
  }

  return {
    accessToken: data.access_token!,
    teamId: data.team!.id,
    userId: data.authed_user!.id,
    channelId: data.incoming_webhook?.channel_id,
  };
}

export async function saveSlackToken(
  userId: string,
  token: string,
  teamId: string,
  slackUserId: string
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      slackToken: token,
      slackTeamId: teamId,
      slackUserId: slackUserId,
      slackConnected: true,
    },
  });
}

export async function disconnectSlack(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      slackToken: null,
      slackTeamId: null,
      slackUserId: null,
      slackConnected: false,
    },
  });
}

/**
 * Send a real Slack notification to the user who connected Slack.
 * Gracefully no-ops if the user hasn't connected Slack.
 */
export async function sendSlackRateLimitNotification(
  userId: string,
  senderEmail: string,
  hourlyLimit: number,
  nextWindowAt: Date
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { slackToken: true, slackUserId: true, slackConnected: true },
  });

  if (!user?.slackConnected || !user.slackToken) {
    console.log(`ℹ️  No Slack connected for user ${userId}, skipping notification`);
    return;
  }

  const message = {
    channel: user.slackUserId!, // DM to the user
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '⚠️ Email Rate Limit Reached',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Sender:*\n${senderEmail}`,
          },
          {
            type: 'mrkdwn',
            text: `*Hourly Limit:*\n${hourlyLimit} emails/hour`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Emails from *${senderEmail}* have been delayed to the next window.\n\n*Next window opens at:* ${nextWindowAt.toLocaleTimeString()}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `ReachInbox Email Scheduler • ${new Date().toISOString()}`,
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.slackToken}`,
      },
      body: JSON.stringify(message),
    });

    const result = await response.json() as { ok: boolean; error?: string };

    if (!result.ok) {
      console.error(`❌ Slack notification failed: ${result.error}`);
    } else {
      console.log(`✅ Slack rate limit notification sent for sender ${senderEmail}`);
    }
  } catch (error) {
    console.error('❌ Failed to send Slack notification:', (error as Error).message);
  }
}
