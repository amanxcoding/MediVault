import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { errorResponse, HttpError, json, readJson, requireSameOrigin } from "@/lib/http";
import { memberCreateSchema, uuidSchema } from "@/lib/validation";

type Context = { params: Promise<{ familyId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { familyId } = await params;
    if (!uuidSchema.safeParse(familyId).success) throw new HttpError(400, "INVALID_FAMILY", "Family ID is invalid.");
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("family_members")
      .select("id,family_id,display_name,relationship,date_of_birth,is_dependent,created_at,updated_at")
      .eq("family_id", familyId).is("archived_at", null).order("display_name");
    if (error) throw new HttpError(404, "FAMILY_UNAVAILABLE", "Family members could not be loaded.");
    return json({ members: data || [] });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    await requireSameOrigin(request);
    const { familyId } = await params;
    if (!uuidSchema.safeParse(familyId).success) throw new HttpError(400, "INVALID_FAMILY", "Family ID is invalid.");
    const input = memberCreateSchema.parse(await readJson(request));
    if (!input.isDependent) throw new HttpError(422, "CONSENT_REQUIRED", "Creating an adult member profile requires a separate consent and account-linking workflow.");
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("family_members").insert({
      family_id: familyId,
      display_name: input.displayName,
      relationship: input.relationship,
      date_of_birth: input.dateOfBirth || null,
      is_dependent: true,
      created_by: user.id,
    }).select("id,family_id,display_name,relationship,date_of_birth,is_dependent,created_at").single();
    if (error || !data) throw new HttpError(403, "MEMBER_CREATE_DENIED", "Member profile could not be created for this family.");
    await writeAudit(supabase, { familyId, memberId: data.id, action: "family_member_created", resourceType: "family_member", resourceId: data.id });
    return json({ member: data }, 201);
  } catch (error) {
    return error instanceof z.ZodError
      ? json({ error: { code: "VALIDATION_ERROR", message: "Enter a name, relationship and valid date of birth." } }, 400)
      : errorResponse(error);
  }
}
