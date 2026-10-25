import "server-only";
import { gatewayCall } from "@/lib/ai/gateway";
import { AI } from "@/lib/config";

import { type ReceiptFields } from "@/lib/receipt-flags";
export { receiptFlags, type ReceiptFields } from "@/lib/receipt-flags";

export async function extractReceipt(args: { workspaceId: string; mediaType: string; base64: string }): Promise<ReceiptFields> {
  const blank: ReceiptFields = { amount_naira: null, reference: null, date: null, sender_name: null, recipient_name: null, recipient_account: null, bank: null, status_text: null, readable: false };
  if (!/^image\/(png|jpeg|webp|gif)$/.test(args.mediaType)) return blank; // PDFs etc. go straight to a person
  const res = await gatewayCall({
    workspaceId: args.workspaceId, feature: "receipt_check", model: AI.receiptModel, maxTokens: 400,
    system: "You read Nigerian bank transfer receipts and app screenshots. Reply with JSON only, no prose.",
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: args.mediaType as "image/png", data: args.base64 } },
        { type: "text", text: `Extract exactly these keys: amount_naira (number), reference (transaction/session id), date (ISO 8601 if possible), sender_name, recipient_name, recipient_account, bank, status_text (the success/failed wording shown), readable (false if this is not a legible transfer receipt). Use null when absent.` },
      ],
    }],
  });
  const text = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
  try {
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return { ...blank, ...json, amount_naira: json.amount_naira == null ? null : Number(String(json.amount_naira).replace(/[₦,\s]/g, "")) };
  } catch {
    return blank;
  }
}
