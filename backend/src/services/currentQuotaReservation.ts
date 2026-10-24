/** A sender can wait across an hour boundary after its initial admission.
 * Reuse the ordinary quota path until it covers the actual sending window.
 * Null means that path deferred the email rather than admitting it.
 */
export async function ensureCurrentQuotaReservation<T extends { nextWindowAt: Date }>(
  initial: T,
  reserve: () => Promise<T | null>,
  now: () => number = Date.now
): Promise<T | null> {
  let reservation: T | null = initial;
  while (reservation && now() >= reservation.nextWindowAt.getTime()) {
    reservation = await reserve();
  }
  return reservation;
}
