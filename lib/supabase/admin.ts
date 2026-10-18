import { createClient } from "@supabase/supabase-js";
import { getAdminKey, getSupabaseConfig } from "@/lib/backend-config";

export function createSupabaseAdminClient() {
  const config = getSupabaseConfig();
  const serviceRoleKey = getAdminKey();
  if (!config || !serviceRoleKey) return null;
  return createClient(config.url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "medivault-server" } },
  });
}
