import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

// Temporary, token-locked route for adding landing-page images to public storage.
// Disabled unless ASSET_UPLOAD_TOKEN is set. Remove after use.
const ORIGIN = "https://www.canva.com";
const cors = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "x-upload-token" };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(req: Request) {
  const token = process.env.ASSET_UPLOAD_TOKEN;
  if (!token) return new NextResponse("Not found", { status: 404 });
  if (req.headers.get("x-upload-token") !== token) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: cors });

  const form = await req.formData();
  const file = form.get("file");
  const name = String(form.get("name") ?? "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  if (!(file instanceof File) || !name || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 6 * 1024 * 1024) {
    return NextResponse.json({ error: "bad file" }, { status: 400, headers: cors });
  }
  const ext = file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `site/hero/${name}.${ext}`;
  const { error } = await supabaseAdmin().storage.from("brand-assets").upload(path, file, { contentType: file.type, upsert: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: cors });
  return NextResponse.json({ path, url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/brand-assets/${path}` }, { headers: cors });
}
