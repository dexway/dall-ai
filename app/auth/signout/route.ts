import { NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const db = await supabaseUser();
  await db.auth.signOut();
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
