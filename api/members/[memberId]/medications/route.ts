import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { errorResponse, HttpError, json, readJson, requireSameOrigin } from "@/lib/http";
import { medicationSchema, uuidSchema } from "@/lib/validation";

type Context = { params: Promise<{ memberId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { memberId } = await params;
    if (!uuidSchema.safeParse(memberId).success) throw new HttpError(400, "INVALID_MEMBER", "Member ID is invalid.");
    const { supabase } = await requireUser();
    const [{ data: medications, error }, { data: member }] = await Promise.all([
      supabase.from("medications").select("id,member_id,source_record_id,medicine_name,strength,dosage_instructions,route,frequency,start_date,end_date,status,created_at,updated_at")
        .eq("member_id", memberId).is("archived_at", null).order("created_at", { ascending: false }).limit(100),
      supabase.from("family_members").select("id").eq("id", memberId).is("archived_at", null).maybeSingle(),
    ]);
    if (error || !member) throw new HttpError(404, "MEDICATIONS_UNAVAILABLE", "Medications are unavailable for this patient.");
    return json({ medications: medications || [] });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    await requireSameOrigin(request);
    const { memberId } = await params;
    if (!uuidSchema.safeParse(memberId).success) throw new HttpError(400, "INVALID_MEMBER", "Member ID is invalid.");
    const input = medicationSchema.parse(await readJson(request));
    const { supabase, user } = await requireUser();
    const { data: member, error: memberError } = await supabase.from("family_members").select("id,family_id").eq("id", memberId).is("archived_at", null).maybeSingle();
    if (memberError || !member) throw new HttpError(404, "MEMBER_UNAVAILABLE", "Patient profile is unavailable.");
    if (input.sourceRecordId) {
      const { data: record } = await supabase.from("medical_records").select("id").eq("id", input.sourceRecordId).eq("member_id", memberId).is("archived_at", null).maybeSingle();
      if (!record) throw new HttpError(422, "INVALID_SOURCE_RECORD", "Source prescription is not available for this patient.");
    }
    const { data, error } = await supabase.from("medications").insert({
      family_id: member.family_id, member_id: memberId, source_record_id: input.sourceRecordId || null,
      medicine_name: input.medicineName, strength: input.strength || null, dosage_instructions: input.dosageInstructions || null,
      route: input.route || null, frequency: input.frequency || null, start_date: input.startDate || null, end_date: input.endDate || null,
      status: "active", created_by: user.id,
    }).select("id,member_id,source_record_id,medicine_name,strength,dosage_instructions,route,frequency,start_date,end_date,status,created_at").single();
    if (error || !data) throw new HttpError(403, "MEDICATION_CREATE_DENIED", "Medication could not be saved for this patient.");
    await writeAudit(supabase, { familyId: member.family_id, memberId, action: "medication_created", resourceType: "medication", resourceId: data.id });
    return json({ medication: data, reminderDelivery: "not_configured" }, 201);
  } catch (error) {
    return error instanceof z.ZodError
      ? json({ error: { code: "VALIDATION_ERROR", message: "Medication details are invalid." } }, 400)
      : errorResponse(error);
  }
}
