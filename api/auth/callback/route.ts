import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppBaseUrl, getSupabaseConfig } from "@/lib/backend-config";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const base = getAppBaseUrl() || requestUrl.origin;
  const rawNext = requestUrl.searchParams.get("next") || "/";
  const candidate = new URL(rawNext, base);
  const safeNext = rawNext.startsWith("/") && candidate.origin === new URL(base).origin ? candidate : new URL("/", base);
  const code = requestUrl.searchParams.get("code");
  if (!code || !getSupabaseConfig()) return NextResponse.redirect(new URL("/?auth=callback-error", base));
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.redirect(new URL("/?auth=callback-error", base));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/?auth=callback-error", base));
  return NextResponse.redirect(safeNext);
}
