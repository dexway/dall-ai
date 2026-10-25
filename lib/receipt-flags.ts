// Pure receipt comparison (no I/O) so it can be unit-tested.
export type ReceiptFields = {
  amount_naira: number | null;
  reference: string | null;
  date: string | null;
  sender_name: string | null;
  recipient_name: string | null;
  recipient_account: string | null;
  bank: string | null;
  status_text: string | null;
  readable: boolean;
};

/** Pure comparison so it can be tested. Flags describe what a person should look at; they never approve anything. */
export function receiptFlags(f: ReceiptFields, expected: { amount_kobo: number; account_number?: string | null; account_name?: string | null; reference: string; created_at: string }): string[] {
  const flags: string[] = [];
  if (!f.readable) return ["unreadable"];
  if (f.amount_naira == null) flags.push("amount_missing");
  else if (Math.round(f.amount_naira * 100) !== expected.amount_kobo) flags.push(Math.round(f.amount_naira * 100) < expected.amount_kobo ? "amount_short" : "amount_over");
  if (expected.account_number && f.recipient_account) {
    const last4 = expected.account_number.slice(-4);
    if (!f.recipient_account.replace(/\D/g, "").endsWith(last4)) flags.push("account_mismatch");
  }
  if (expected.account_name && f.recipient_name) {
    const want = expected.account_name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (!want.some((w) => f.recipient_name!.toLowerCase().includes(w))) flags.push("name_mismatch");
  }
  if (f.status_text && /fail|pending|revers|declin/i.test(f.status_text)) flags.push("status_not_successful");
  if (f.date) {
    const d = Date.parse(f.date);
    if (!Number.isNaN(d) && d < Date.parse(expected.created_at) - 24 * 3600_000) flags.push("dated_before_order");
  }
  if (!f.reference) flags.push("no_transaction_reference");
  return flags;
}

