export type SmtpFailureOutcome = 'not-delivered' | 'unknown';

/** Socket failures (including Nodemailer's CONN errors) can happen after DATA.
 * Only affirmative pre-delivery failures or explicit SMTP rejection are safe
 * to retry. Unknown error shapes deliberately require operator review.
 */
export function classifySmtpFailure(error: unknown): SmtpFailureOutcome {
  if (!error || typeof error !== 'object') return 'unknown';
  const { code, responseCode, command, errno } = error as {
    code?: string; responseCode?: number; command?: string; errno?: string;
  };
  if (responseCode && responseCode >= 400 && responseCode <= 599 && command !== 'QUIT') return 'not-delivered';
  if (['EAUTH', 'EENVELOPE', 'EMESSAGE', 'EDNS'].includes(code ?? '')) return 'not-delivered';
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code ?? '') ||
      ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(errno ?? '')) return 'not-delivered';
  return 'unknown';
}

/**
 * Keep the SMTP acceptance and database persistence steps explicit. They are
 * separate systems and cannot be committed atomically.
 */
export async function deliverAndPersist<T>(
  deliver: () => Promise<T>,
  persist: (delivery: T) => Promise<void>,
  onDeliveryFailure: (error: unknown, outcome: SmtpFailureOutcome) => Promise<void>
): Promise<T> {
  let result: T;
  try {
    result = await deliver();
  } catch (error) {
    await onDeliveryFailure(error, classifySmtpFailure(error));
    throw error;
  }

  // A failure here means SMTP may have accepted the message while the DB still
  // reports SENDING. Lease recovery quarantines it as DELIVERY_UNKNOWN rather
  // than risking a second SMTP send.
  await persist(result);
  return result;
}
