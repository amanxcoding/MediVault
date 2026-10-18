import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { errorResponse, HttpError, json, requireSameOrigin } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";

type Context = { params: Promise<{ shareId: string }> };

export async function DELETE(request: Request, { params }: Context) {
  try {
    await requireSameOrigin(request);
    const { shareId } = await params;
    if (!uuidSchema.safeParse(shareId).success) throw new HttpError(400, "INVALID_SHARE", "Share ID is invalid.");
    const { supabase } = await requireUser();
    const { data: share } = await supabase.from("share_sessions").select("member_id").eq("id", shareId).maybeSingle();
    const { data: revoked, error } = await supabase.rpc("revoke_share_session", { p_share_id: shareId });
    if (error || !revoked) throw new HttpError(404, "SHARE_UNAVAILABLE", "Share could not be revoked.");
    await writeAudit(supabase, { memberId: share?.member_id, action: "medical_share_revoked", resourceType: "share_session", resourceId: shareId });
    return json({ revoked: true, shareId });
  } catch (error) { return errorResponse(error); }
}
