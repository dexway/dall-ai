// What the assistant knows about the business beyond the catalogue. Pure, so it can be tested and shared.
export type BusinessProfile = {
  delivery_time?: string;   // e.g. "Same day for Lekki and VI before 2pm; 1–2 days elsewhere in Lagos"
  opening_hours?: string;   // e.g. "Mon–Sat 9am–7pm, Sun closed"
  delivery_areas?: string;  // e.g. "Lagos mainland and island; we ship to other states with GIG"
  returns_policy?: string;  // e.g. "Damaged items replaced within 24 hours with a photo"
  notes?: string;           // anything else customers ask about often
};

export const PROFILE_LABELS: Record<keyof BusinessProfile, string> = {
  delivery_time: "Usual delivery time",
  opening_hours: "Opening hours",
  delivery_areas: "Where you deliver",
  returns_policy: "Returns and damages",
  notes: "Other things customers ask",
};

/** Turns the saved profile into plain lines for the system prompt. Empty fields are left out. */
export function profileText(p: BusinessProfile | null | undefined): string {
  if (!p) return "";
  return (Object.keys(PROFILE_LABELS) as (keyof BusinessProfile)[])
    .map((k) => [PROFILE_LABELS[k], (p[k] ?? "").trim()] as const)
    .filter(([, v]) => v.length > 0)
    .map(([label, v]) => `- ${label}: ${v.slice(0, 500)}`)
    .join("\n");
}
