import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/backend-config";

export function createSupabasePublicClient() {
  const config = getSupabaseConfig();
  if (!config) return null;
  return createClient(config.url, config.key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "medivault-public-share" } },
  });
}
