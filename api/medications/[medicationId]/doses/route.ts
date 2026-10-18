import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { errorResponse, HttpError, json, readJson, requireSameOrigin } from "@/lib/http";
import { doseSchema, uuidSchema } from "@/lib/validation";

type Context = { params: Promise<{ medicationId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { medicationId } = await params;
    if (!uuidSchema.safeParse(medicationId).success) throw new HttpError(400, "INVALID_MEDICATION", "Medication ID is invalid.");
    const { supabase } = await requireUser();
    const { data: medication, error: medicationError } = await supabase.from("medications")
      .select("id")
      .eq("id", medicationId)
      .maybeSingle();
    if (medicationError || !medication) throw new HttpError(404, "MEDICATION_UNAVAILABLE", "Medication is unavailable.");
    const { data, error } = await supabase.from("medication_dose_logs")
      .select("id,medication_id,member_id,scheduled_at,status,logged_at,notes,created_at")
      .eq("medication_id", medicationId)
      .order("scheduled_at", { ascending: false })
      .limit(100);
    if (error) throw new HttpError(500, "DOSE_HISTORY_UNAVAILABLE", "Dose history could not be loaded.");
    return json({ doses: data || [] });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    await requireSameOrigin(request);
    const { medicationId } = await params;
    if (!uuidSchema.safeParse(medicationId).success) throw new HttpError(400, "INVALID_MEDICATION", "Medication ID is invalid.");
    const input = doseSchema.parse(await readJson(request));
    const { supabase, user } = await requireUser();
    const { data: medication, error: medicationError } = await supabase.from("medications").select("id,family_id,member_id,status")
      .eq("id", medicationId).is("archived_at", null).maybeSingle();
    if (medicationError || !medication || medication.status !== "active") throw new HttpError(404, "MEDICATION_UNAVAILABLE", "Medication is unavailable.");
    const { data, error } = await supabase.from("medication_dose_logs").insert({
      medication_id: medication.id, member_id: medication.member_id, scheduled_at: input.scheduledAt,
      status: input.status, logged_at: new Date().toISOString(), notes: input.notes || null, created_by: user.id,
    }).select("id,medication_id,member_id,scheduled_at,status,logged_at,notes,created_at").single();
    if (error || !data) throw new HttpError(409, "DOSE_ALREADY_RECORDED", "This scheduled dose could not be recorded. It may already have a log.");
    await writeAudit(supabase, { familyId: medication.family_id, memberId: medication.member_id, action: "medication_dose_logged", resourceType: "medication_dose_log", resourceId: data.id });
    return json({ dose: data }, 201);
  } catch (error) {
    return error instanceof z.ZodError
      ? json({ error: { code: "VALIDATION_ERROR", message: "Dose date or status is invalid." } }, 400)
      : errorResponse(error);
  }
}
