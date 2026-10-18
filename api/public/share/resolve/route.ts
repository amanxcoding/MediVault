import { z } from "zod";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse, HttpError, json, readJson } from "@/lib/http";
import { hashShareToken } from "@/lib/share-token";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
const schema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

export async function POST(request: Request) {
  try {
    const address = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    enforceRateLimit(`share-read:${address}`, 60, 60_000);
    const { token } = schema.parse(await readJson(request));
    const supabase = createSupabasePublicClient();
    if (!supabase) throw new HttpError(503, "BACKEND_NOT_CONFIGURED", "Share service is unavailable.");
    const hash = hashShareToken(token);
    const { data, error } = await supabase.rpc("resolve_share_session", { p_token_hash: hash });
    if (error || !data) throw new HttpError(404, "SHARE_UNAVAILABLE", "This share is unavailable.");
    return json({ share: data }, 200, noStore);
  } catch (error) {
    const response = errorResponse(error);
    Object.entries(noStore).forEach(([name, value]) => response.headers.set(name, value));
    if (error instanceof z.ZodError) return json({ error: { code: "SHARE_UNAVAILABLE", message: "This share is unavailable." } }, 404, noStore);
    return response;
  }
}
