import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { errorResponse, HttpError, json, readJson, requireSameOrigin } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";

type Context = { params: Promise<{ recordId: string }> };
const updateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  documentDate: z.string().date().nullable().optional(),
  notes: z.string().trim().max(4000).optional(),
  archive: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one update.");

export async function GET(_request: Request, { params }: Context) {
  try {
    const { recordId } = await params;
    if (!uuidSchema.safeParse(recordId).success) throw new HttpError(400, "INVALID_RECORD", "Record ID is invalid.");
    const { supabase } = await requireUser();
    const { data: record, error } = await supabase.from("medical_records")
      .select("id,family_id,member_id,title,category,document_date,original_filename,file_size_bytes,notes,verification_status,processing_status,created_at,updated_at,original_file_path")
      .eq("id", recordId).is("archived_at", null).maybeSingle();
    if (error || !record) throw new HttpError(404, "RECORD_UNAVAILABLE", "Record is unavailable.");
    const { data: signed, error: signedError } = await supabase.storage.from("medical-records").createSignedUrl(record.original_file_path, 60, { download: record.original_filename });
    if (signedError || !signed?.signedUrl) throw new HttpError(404, "DOCUMENT_UNAVAILABLE", "The private document preview is unavailable.");
    await writeAudit(supabase, { familyId: record.family_id, memberId: record.member_id, action: "medical_document_accessed", resourceType: "medical_record", resourceId: record.id });
    const safeRecord = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "original_file_path"));
    return json({ record: safeRecord, previewUrl: signed.signedUrl, previewExpiresInSeconds: 60 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    await requireSameOrigin(request);
    const { recordId } = await params;
    if (!uuidSchema.safeParse(recordId).success) throw new HttpError(400, "INVALID_RECORD", "Record ID is invalid.");
    const input = updateSchema.parse(await readJson(request));
    if (input.documentDate && input.documentDate > new Date().toISOString().slice(0, 10)) throw new HttpError(422, "FUTURE_DOCUMENT_DATE", "Document date cannot be in the future.");
    const { supabase } = await requireUser();
    const { data: current, error: currentError } = await supabase.from("medical_records").select("family_id,member_id").eq("id", recordId).is("archived_at", null).maybeSingle();
    if (currentError || !current) throw new HttpError(404, "RECORD_UNAVAILABLE", "Record is unavailable.");
    const update: Record<string, unknown> = {};
    if (input.title !== undefined) update.title = input.title;
    if (input.documentDate !== undefined) update.document_date = input.documentDate;
    if (input.notes !== undefined) update.notes = input.notes;
    if (input.archive) update.archived_at = new Date().toISOString();
    const { data, error } = await supabase.from("medical_records").update(update).eq("id", recordId)
      .select("id,member_id,title,category,document_date,original_filename,notes,verification_status,processing_status,updated_at,archived_at").single();
    if (error || !data) throw new HttpError(403, "RECORD_UPDATE_DENIED", "Record could not be updated.");
    await writeAudit(supabase, { familyId: current.family_id, memberId: current.member_id, action: input.archive ? "medical_record_archived" : "medical_record_updated", resourceType: "medical_record", resourceId: recordId });
    return json({ record: data });
  } catch (error) {
    return error instanceof z.ZodError
      ? json({ error: { code: "VALIDATION_ERROR", message: "Record update is invalid." } }, 400)
      : errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await requireSameOrigin(request);
    const forwarded = new Request(request.url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archive: true }),
    });
    return await PATCH(forwarded, context);
  }
  catch (error) { return errorResponse(error); }
}
