import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/backend-config";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!getSupabaseConfig()) return json({ authenticated: false });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return json({ authenticated: false });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return json({ authenticated: false });
  return json({ authenticated: true, user: { id: data.user.id, email: data.user.email || null } });
}
