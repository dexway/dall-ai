import "server-only";

// Pulls plain text out of an uploaded business document so it can seed the agent's knowledge.
export async function extractText(name: string, type: string, buf: ArrayBuffer): Promise<string> {
  const lower = name.toLowerCase();

  if (type.includes("pdf") || lower.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buf });
    try {
      const r = await parser.getText();
      return (r.text ?? "").replace(/\n-- \d+ of \d+ --/g, "").trim();
    } finally {
      try { await parser.destroy(); } catch { /* ignore */ }
    }
  }

  if (lower.endsWith(".docx") || type.includes("wordprocessingml")) {
    const mod = await import("mammoth");
    const mammoth = (mod as unknown as { default?: typeof mod }).default ?? mod;
    const r = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
    return (r.value ?? "").trim();
  }

  if (type.startsWith("text/") || /\.(txt|csv|md|tsv)$/.test(lower)) {
    return Buffer.from(buf).toString("utf8").trim();
  }

  throw new Error("unsupported");
}
