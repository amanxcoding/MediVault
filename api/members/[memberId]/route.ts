import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { errorResponse, HttpError, json, readJson, requireSameOrigin } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";

type Context = { params: Promise<{ memberId: string }> };
const memberUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  relationship: z.string().trim().min(1).max(40).optional(),
  dateOfBirth: z.string().date().nullable().optional(),
  archive: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one update.");

export async function PATCH(request: Request, { params }: Context) {
  try {
    await requireSameOrigin(request);
    const { memberId } = await params;
    if (!uuidSchema.safeParse(memberId).success) throw new HttpError(400, "INVALID_MEMBER", "Member ID is invalid.");
    const input = memberUpdateSchema.parse(await readJson(request));
    const { supabase } = await requireUser();
    const { data: current, error: readError } = await supabase.from("family_members")
      .select("id,family_id,is_dependent,archived_at")
      .eq("id", memberId)
      .maybeSingle();
    if (readError || !current) throw new HttpError(404, "MEMBER_UNAVAILABLE", "Patient profile is unavailable.");
    if (input.archive && !current.is_dependent) {
      throw new HttpError(422, "SELF_ARCHIVE_UNSUPPORTED", "An adult member profile cannot be archived through this endpoint.");
    }
    const update: Record<string, unknown> = {};
    if (input.displayName !== undefined) update.display_name = input.displayName;
    if (input.relationship !== undefined) update.relationship = input.relationship;
    if (input.dateOfBirth !== undefined) update.date_of_birth = input.dateOfBirth;
    if (input.archive) update.archived_at = new Date().toISOString();
    const { data, error } = await supabase.from("family_members")
      .update(update)
      .eq("id", memberId)
      .select("id,family_id,display_name,relationship,date_of_birth,is_dependent,archived_at,updated_at")
      .maybeSingle();
    if (error) throw new HttpError(403, "MEMBER_UPDATE_DENIED", "Patient profile could not be updated.");
    if (!data) throw new HttpError(403, "MEMBER_UPDATE_DENIED", "Patient profile could not be updated.");
    await writeAudit(supabase, {
      familyId: current.family_id,
      memberId,
      action: input.archive ? "family_member_archived" : "family_member_updated",
      resourceType: "family_member",
      resourceId: memberId,
    });
    return json({ member: data });
  } catch (error) {
    return error instanceof z.ZodError
      ? json({ error: { code: "VALIDATION_ERROR", message: "Patient profile updates are invalid." } }, 400)
      : errorResponse(error);
  }
}
