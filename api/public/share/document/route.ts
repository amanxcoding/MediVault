import { z } from "zod";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse, HttpError, json, readJson } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { hashShareToken } from "@/lib/share-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
const schema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), recordId: uuidSchema }).strict();

export async function POST(request: Request) {
  try {
    const address = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    enforceRateLimit(`share-document:${address}`, 30, 60_000);
    const { token, recordId } = schema.parse(await readJson(request));
    const publicClient = createSupabasePublicClient();
    if (!publicClient) throw new HttpError(503, "BACKEND_NOT_CONFIGURED", "Share service is unavailable.");
    const tokenHash = hashShareToken(token);
    const { data, error: authorizationError } = await publicClient.rpc("authorize_shared_document", { p_token_hash: tokenHash, p_record_id: recordId }).maybeSingle();
    const authorized = data as { storage_path: string; member_id: string } | null;
    if (authorizationError || !authorized?.storage_path) throw new HttpError(404, "DOCUMENT_UNAVAILABLE", "Document is unavailable.");
    // The privileged client is used only after the hash, scope, expiry, revocation and record ID check above.
    const admin = createSupabaseAdminClient();
    if (!admin) throw new HttpError(503, "PRIVATE_STORAGE_NOT_CONFIGURED", "Private document access is not configured.");
    const { data: record, error: recordError } = await admin.from("medical_records")
      .select("family_id")
      .eq("id", recordId)
      .eq("member_id", authorized.member_id)
      .maybeSingle();
    if (recordError || !record) throw new HttpError(404, "DOCUMENT_UNAVAILABLE", "Document is unavailable.");
    const { data: signed, error: signError } = await admin.storage.from("medical-records").createSignedUrl(authorized.storage_path, 45, { download: true });
    if (signError || !signed?.signedUrl) throw new HttpError(404, "DOCUMENT_UNAVAILABLE", "Document is unavailable.");
    const { error: auditError } = await admin.from("audit_events").insert({
      actor_user_id: null, family_id: record.family_id, member_id: authorized.member_id, action: "shared_medical_document_accessed",
      resource_type: "medical_record", resource_id: recordId,
    });
    if (auditError) throw new HttpError(503, "AUDIT_UNAVAILABLE", "Document access could not be completed.");
    return new Response(null, { status: 303, headers: { ...noStore, Location: signed.signedUrl } });
  } catch (error) {
    const response = errorResponse(error);
    Object.entries(noStore).forEach(([name, value]) => response.headers.set(name, value));
    if (error instanceof z.ZodError) return json({ error: { code: "DOCUMENT_UNAVAILABLE", message: "Document is unavailable." } }, 404, noStore);
    return response;
  }
}
