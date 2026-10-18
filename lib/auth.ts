import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/backend-config";
import { HttpError } from "@/lib/http";

export async function requireUser(): Promise<{ supabase: SupabaseClient; user: User }> {
  if (!getSupabaseConfig()) {
    throw new HttpError(503, "BACKEND_NOT_CONFIGURED", "Supabase is not configured. The app remains in local demo mode.");
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new HttpError(503, "BACKEND_NOT_CONFIGURED", "Supabase is not configured.");
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return { supabase, user: data.user };
}
