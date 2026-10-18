import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppBaseUrl, getSupabaseConfig } from "@/lib/backend-config";
import { errorResponse, HttpError, json, requireSameOrigin } from "@/lib/http";
export async function GET() {
  if (!getSupabaseConfig()) return NextResponse.json({ error: { code: "BACKEND_NOT_CONFIGURED", message: "Connect Supabase and enable Google OAuth to use this sign-in option." } }, { status: 503 });
  const baseUrl = getAppBaseUrl();
  const supabase = await createSupabaseServerClient();
  if (!baseUrl || !supabase) return NextResponse.json({ error: { code: "OAUTH_NOT_CONFIGURED", message: "Set APP_BASE_URL and configure the Google provider in Supabase Auth." } }, { status: 503 });
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${baseUrl}/api/auth/callback?next=%2F` },
  });
  if (error || !data.url) return NextResponse.json({ error: { code: "OAUTH_NOT_CONFIGURED", message: "Google sign-in could not be started. Check the provider configuration." } }, { status: 503 });
  return NextResponse.redirect(data.url);
}

export async function POST(request: Request) {
  try {
    await requireSameOrigin(request);
    if (!getSupabaseConfig()) throw new HttpError(503, "BACKEND_NOT_CONFIGURED", "Connect Supabase and enable Google OAuth to use this sign-in option.");
    const baseUrl = getAppBaseUrl();
    const supabase = await createSupabaseServerClient();
    if (!baseUrl || !supabase) throw new HttpError(503, "OAUTH_NOT_CONFIGURED", "Set APP_BASE_URL and configure Google OAuth in Supabase Auth.");
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${baseUrl}/api/auth/callback?next=%2F` },
    });
    if (error || !data.url) throw new HttpError(503, "OAUTH_NOT_CONFIGURED", "Google sign-in could not be started. Check the provider configuration.");
    return json({ url: data.url });
  } catch (error) { return errorResponse(error); }
}
