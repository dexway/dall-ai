// Early-payment bonus maths. Pure (no I/O) so it can be unit-tested.

/** The discounted amount for paying inside the countdown. Rounded to the kobo, never above the full total. */
export function earlyPayAmount(totalKobo: number, pct: number): number {
  if (!pct || pct <= 0) return totalKobo;
  return Math.min(totalKobo, Math.round((totalKobo * (100 - pct)) / 100));
}

/**
 * Amounts a receipt may show for this order at this moment.
 * The full total always counts. The early amount counts only while the countdown is still running.
 */
export function acceptableAmounts(
  order: { total_kobo: number; early_total_kobo: number | null; expires_at: string | null },
  now: Date,
): number[] {
  const out = [order.total_kobo];
  const stillInTime = !order.expires_at || now.getTime() <= new Date(order.expires_at).getTime();
  if (order.early_total_kobo != null && stillInTime && order.early_total_kobo !== order.total_kobo) {
    out.push(order.early_total_kobo);
  }
  return out;
}
