import type { SupabaseClient } from "@supabase/supabase-js";

export async function writeAudit(
  supabase: SupabaseClient,
  event: { familyId?: string | null; memberId?: string | null; action: string; resourceType: string; resourceId?: string | null },
) {
  const { error } = await supabase.from("audit_events").insert({
    family_id: event.familyId || null,
    member_id: event.memberId || null,
    action: event.action,
    resource_type: event.resourceType,
    resource_id: event.resourceId || null,
  });
  if (error) throw new Error("Audit event could not be recorded.");
}
