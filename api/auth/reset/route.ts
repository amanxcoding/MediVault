import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppBaseUrl, getSupabaseConfig } from "@/lib/backend-config";
import { errorResponse, HttpError, json, readJson, requireSameOrigin } from "@/lib/http";

export async function POST(request: Request) {
  try {
    await requireSameOrigin(request);
    if (!getSupabaseConfig()) throw new HttpError(503, "BACKEND_NOT_CONFIGURED", "Supabase is not configured.");
    const input = z.object({ email: z.string().trim().email().max(254) }).strict().parse(await readJson(request));
    const supabase = await createSupabaseServerClient();
    const base = getAppBaseUrl();
    if (!supabase || !base) throw new HttpError(503, "AUTH_NOT_CONFIGURED", "Set up Supabase Auth and APP_BASE_URL first.");
    const { error } = await supabase.auth.resetPasswordForEmail(input.email, { redirectTo: `${base}/` });
    if (error) throw new HttpError(503, "RESET_UNAVAILABLE", "Password reset is unavailable. Check email provider settings.");
    return json({ requested: true, message: "If this address has an account, password reset instructions will be sent." });
  } catch (error) {
    return error instanceof z.ZodError
      ? json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid email address." } }, 400)
      : errorResponse(error);
  }
}
