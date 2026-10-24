/**
 * Keep the SMTP acceptance and database persistence steps explicit. They are
 * separate systems and cannot be committed atomically.
 */
export async function deliverAndPersist<T>(
  deliver: () => Promise<T>,
  persist: (delivery: T) => Promise<void>,
  onDeliveryFailure: (error: unknown) => Promise<void>
): Promise<T> {
  let result: T;
  try {
    result = await deliver();
  } catch (error) {
    await onDeliveryFailure(error);
    throw error;
  }

  // A failure here means SMTP may have accepted the message while the DB still
  // reports SENDING. Recovery may send it again; exactly-once delivery is not
  // possible without provider-side idempotency or a shared transaction.
  await persist(result);
  return result;
}
