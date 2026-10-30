// Seedance 2.5 text-to-video with the official Higgsfield SDK. Makes one billable generation.
// Run: node --env-file=.env.local --experimental-strip-types scripts/higgsfield/index.ts
// HF_CREDENTIALS ("KEY_ID:KEY_SECRET") is read from the server environment and never printed.
import { config, higgsfield, AuthenticationError, NotEnoughCreditsError, ValidationError, BadInputError, TimeoutError, APIError } from "@higgsfield/client/v2";

const MODEL = "bytedance/seedance-2.5/text-to-video";

async function main(): Promise<number> {
  if (!process.env.HF_CREDENTIALS) {
    console.error("HF_CREDENTIALS is not set. Add it to .env.local as KEY_ID:KEY_SECRET.");
    return 1;
  }
  config({ credentials: process.env.HF_CREDENTIALS });

  const result = await higgsfield.subscribe(MODEL, {
    input: { prompt: "A cinematic scene at sunset", duration: 5, resolution: "720p", aspect_ratio: "16:9" },
    withPolling: true,
  });

  // Only a completed request with a video URL counts as success.
  const status: string = result.status;
  if (status === "completed" && result.video?.url) {
    console.log(`Completed (request ${result.request_id}).`);
    console.log(`Video URL: ${result.video.url}`);
    return 0;
  }
  const why: Record<string, string> = {
    failed: "The generation failed on Higgsfield's side (not charged).",
    nsfw: "The request was blocked by content moderation (not charged).",
    canceled: "The request was canceled (not charged).",
  };
  console.error(`No video: status "${status}" (request ${result.request_id}). ${why[status] ?? (status === "completed" ? "Completed but no video URL was returned." : "Unexpected status.")}`);
  return 1;
}

main().then((code) => process.exit(code)).catch((e: unknown) => {
  // Errors carry no credentials; print only the type and message.
  const kind = e instanceof AuthenticationError ? "Invalid API credentials (check the key ID and secret)."
    : e instanceof NotEnoughCreditsError ? "Not enough Higgsfield credits on this account."
    : e instanceof ValidationError || e instanceof BadInputError ? `Higgsfield rejected the input: ${(e as Error).message}`
    : e instanceof TimeoutError ? "Timed out waiting for the video; it may still finish. Check the Higgsfield console."
    : e instanceof APIError ? `Higgsfield API error: ${(e as Error).message}`
    : `Request failed: ${(e as Error).message}`;
  console.error(kind);
  process.exit(1);
});
