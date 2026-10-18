import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/backend-config";
import { errorResponse, HttpError, json, readJson, requireSameOrigin } from "@/lib/http";

const schema = z.object({
  mode: z.enum(["signin", "signup"]),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(120).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    await requireSameOrigin(request);
    if (!getSupabaseConfig()) throw new HttpError(503, "BACKEND_NOT_CONFIGURED", "Supabase is not configured.");
    const input = schema.parse(await readJson(request));
    const supabase = await createSupabaseServerClient();
    if (!supabase) throw new HttpError(503, "BACKEND_NOT_CONFIGURED", "Supabase is not configured.");
    const result = input.mode === "signup"
      ? await supabase.auth.signUp({
          email: input.email,
          password: input.password,
          options: { data: { full_name: input.displayName || input.email.split("@")[0] } },
        })
      : await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
    if (result.error) throw new HttpError(400, "AUTHENTICATION_FAILED", "Sign-in could not be completed. Check your details or email verification.");
    return json({
      authenticated: Boolean(result.data.session),
      verificationRequired: input.mode === "signup" && !result.data.session,
      message: input.mode === "signup" && !result.data.session ? "Check your email to verify your account." : "Signed in.",
    });
  } catch (error) {
    return error instanceof z.ZodError
      ? json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid email and password (at least 8 characters)." } }, 400)
      : errorResponse(error);
  }
}
