export interface SlackRateLimitMessageInput {
  senderEmail: string;
  hourlyLimit: number;
  nextWindowAt: Date;
  createdAt?: Date;
  clientMsgId?: string;
}

export function buildSlackRateLimitMessage(input: SlackRateLimitMessageInput, channel: string) {
  return {
    channel,
    ...(input.clientMsgId ? { client_msg_id: input.clientMsgId } : {}),
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⚠️ Email Rate Limit Reached', emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Sender:*\n${input.senderEmail}` },
          { type: 'mrkdwn', text: `*Hourly Limit:*\n${input.hourlyLimit} emails/hour` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Emails from *${input.senderEmail}* have been delayed to the next window.\n\n*Next window opens at:* ${input.nextWindowAt.toISOString()}`,
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `ReachInbox Email Scheduler • ${(input.createdAt ?? new Date()).toISOString()}` }],
      },
    ],
  };
}

/** Throw on transport/API failure so a durable caller can leave the item retryable. */
export async function postSlackRateLimitMessage(
  token: string,
  channel: string,
  input: SlackRateLimitMessageInput,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const response = await fetchImpl('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(buildSlackRateLimitMessage(input, channel)),
  });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) {
    throw new Error(`Slack notification failed: ${result.error ?? `HTTP ${response.status}`}`);
  }
}
