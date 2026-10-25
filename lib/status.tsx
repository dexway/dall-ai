// Order status → label + chip colour, shared by every screen.
export const ORDER_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "" }> = {
  order_created: { label: "Created", tone: "" },
  awaiting_payment: { label: "Awaiting payment", tone: "" },
  payment_evidence_submitted: { label: "Receipt received", tone: "warn" },
  verification_pending: { label: "Check payment", tone: "warn" },
  payment_confirmed: { label: "Paid", tone: "ok" },
  payment_rejected: { label: "Payment rejected", tone: "bad" },
  payment_failed: { label: "Payment failed", tone: "bad" },
  payment_expired: { label: "Expired", tone: "bad" },
  partially_paid: { label: "Part paid", tone: "warn" },
  refunded: { label: "Refunded", tone: "" },
  order_fulfilled: { label: "Fulfilled", tone: "ok" },
};

export const FLAG_TEXT: Record<string, string> = {
  unreadable: "Couldn't read the receipt",
  amount_missing: "No amount found",
  amount_short: "Amount is LESS than the order total",
  amount_over: "Amount is more than the order total",
  account_mismatch: "Paid to a different account number",
  name_mismatch: "Recipient name doesn't match yours",
  status_not_successful: "Receipt says failed / pending / reversed",
  dated_before_order: "Dated before the order was created",
  no_transaction_reference: "No transaction reference visible",
  not_auto_read: "Not read automatically (PDF or reader busy)",
  needs_manual_review: "Needs manual review",
};

export function StatusChip({ status }: { status: string }) {
  const s = ORDER_STATUS[status] ?? { label: status, tone: "" };
  return <span className={`chip${s.tone ? ` chip-${s.tone}` : ""}`}>{s.label}</span>;
}
