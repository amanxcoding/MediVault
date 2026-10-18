import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getAppBaseUrl } from "@/lib/backend-config";
import { writeAudit } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse, HttpError, json, readJson, requireSameOrigin } from "@/lib/http";
import { shareSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("share_sessions")
      .select("id,member_id,share_scope,expires_at,revoked_at,created_at,last_accessed_at")
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw new HttpError(403, "SHARES_UNAVAILABLE", "Share history is unavailable.");
    return json({ shares: data || [] });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    await requireSameOrigin(request);
    const baseUrl = getAppBaseUrl();
    if (!baseUrl) throw new HttpError(503, "APP_URL_NOT_CONFIGURED", "Set APP_BASE_URL before creating share links.");
    const input = shareSchema.parse(await readJson(request));
    const { supabase, user } = await requireUser();
    enforceRateLimit(`share-create:${user.id}`, 10, 60 * 60 * 1000);
    const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.rpc("create_share_session", {
      p_member_id: input.memberId,
      p_scope: input.scope,
      p_expires_at: expiresAt,
      p_record_ids: input.recordIds,
    });
    const created = Array.isArray(data) ? data[0] : null;
    const shareId = created?.share_id;
    const rawToken = created?.raw_token;
    if (error || !shareId || !rawToken) throw new HttpError(403, "SHARE_CREATE_DENIED", "Share could not be created for the selected patient and scope.");
    const { data: member } = await supabase.from("family_members").select("family_id").eq("id", input.memberId).maybeSingle();
    await writeAudit(supabase, { familyId: member?.family_id, memberId: input.memberId, action: "medical_share_created", resourceType: "share_session", resourceId: shareId });
    const shareUrl = new URL("/", baseUrl);
    shareUrl.hash = `doctor-share/${rawToken}`;
    return json({ share: { id: shareId, memberId: input.memberId, scope: input.scope, expiresAt, url: shareUrl.toString() }, token: rawToken }, 201);
  } catch (error) {
    return error instanceof z.ZodError
      ? json({ error: { code: "VALIDATION_ERROR", message: "Share scope, patient, expiry or selected records are invalid." } }, 400)
      : errorResponse(error);
  }
}
