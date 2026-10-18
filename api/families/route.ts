import { errorResponse, HttpError, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("family_memberships")
      .select("family_id,role,families(id,name,created_at)").eq("membership_status", "active");
    if (error) throw new HttpError(500, "FAMILY_READ_FAILED", "Family list could not be loaded.");
    return json({ families: data || [] });
  } catch (error) { return errorResponse(error); }
}
