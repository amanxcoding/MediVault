import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { errorResponse, HttpError, json, readJson, requireSameOrigin } from "@/lib/http";

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
}).strict();

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("profiles")
      .select("id,display_name,avatar_path,created_at,updated_at")
      .eq("id", user.id).maybeSingle();
    if (error) throw new HttpError(500, "PROFILE_READ_FAILED", "Profile could not be loaded.");
    if (!data) throw new HttpError(404, "PROFILE_UNAVAILABLE", "Profile is unavailable.");
    return json({ profile: data });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    await requireSameOrigin(request);
    const { displayName } = profileSchema.parse(await readJson(request));
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("profiles")
      .update({ display_name: displayName })
      .eq("id", user.id)
      .select("id,display_name,avatar_path,created_at,updated_at")
      .maybeSingle();
    if (error) throw new HttpError(500, "PROFILE_UPDATE_FAILED", "Profile could not be updated.");
    if (!data) throw new HttpError(403, "PROFILE_UPDATE_DENIED", "Profile could not be updated.");
    return json({ profile: data });
  } catch (error) {
    return error instanceof z.ZodError
      ? json({ error: { code: "VALIDATION_ERROR", message: "Enter a display name up to 120 characters." } }, 400)
      : errorResponse(error);
  }
}
