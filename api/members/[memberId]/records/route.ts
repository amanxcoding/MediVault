import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rate-limit";
import { errorResponse, HttpError, json, requireSameOrigin } from "@/lib/http";
import { paginationSchema, recordMetadataSchema, uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ memberId: string }> };
const categories = ["Prescription / medication","Laboratory report","Imaging / diagnostic report","Diagnosis / illness","Hospitalization / discharge","Vaccination","Allergies","Doctor visit / follow-up","Other medical document"] as const;
const maxMultipartBytes = 20 * 1024 * 1024 + 64_000;

async function readBoundedFormData(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "INVALID_FORM", "Upload form is missing.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxMultipartBytes) {
        await reader.cancel();
        throw new HttpError(413, "FILE_TOO_LARGE", "Maximum upload size is 20 MB.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "INVALID_FORM", "Upload form could not be read.");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return await new Request(request.url, { method: "POST", headers: request.headers, body: bytes }).formData();
  } catch {
    throw new HttpError(400, "INVALID_FORM", "Upload form could not be parsed.");
  }
}

function sniffFile(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return { mime: "application/pdf", extension: "pdf" };
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((x, i) => bytes[i] === x)) return { mime: "image/png", extension: "png" };
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", extension: "webp" };
  return null;
}

export async function GET(request: Request, { params }: Context) {
  try {
    const { memberId } = await params;
    if (!uuidSchema.safeParse(memberId).success) throw new HttpError(400, "INVALID_MEMBER", "Member ID is invalid.");
    const url = new URL(request.url);
    const paging = paginationSchema.parse({ limit: url.searchParams.get("limit") || undefined, offset: url.searchParams.get("offset") || undefined });
    const category = url.searchParams.get("category");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
    if (category && category !== "all" && !categories.includes(category as typeof categories[number])) throw new HttpError(400, "INVALID_CATEGORY", "Record category is invalid.");
    if (from && !z.string().date().safeParse(from).success) throw new HttpError(400, "INVALID_DATE", "Start date is invalid.");
    if (to && !z.string().date().safeParse(to).success) throw new HttpError(400, "INVALID_DATE", "End date is invalid.");
    if (from && to && from > to) throw new HttpError(400, "INVALID_DATE_RANGE", "Start date must not be after end date.");
    const { supabase } = await requireUser();
    let query = supabase.from("medical_records").select("id,family_id,member_id,title,category,document_date,original_filename,file_size_bytes,notes,verification_status,processing_status,created_at,updated_at", { count: "exact" })
      .eq("member_id", memberId).is("archived_at", null).order("document_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).range(paging.offset, paging.offset + paging.limit - 1);
    if (category && category !== "all") query = query.eq("category", category);
    if (from) query = query.gte("document_date", from);
    if (to) query = query.lte("document_date", to);
    if (q) query = query.textSearch("title", q, { type: "websearch", config: "simple" });
    const { data, count, error } = await query;
    if (error) throw new HttpError(404, "RECORDS_UNAVAILABLE", "Records could not be loaded for this patient.");
    return json({ records: data || [], total: count || 0, limit: paging.limit, offset: paging.offset });
  } catch (error) {
    return error instanceof z.ZodError
      ? json({ error: { code: "VALIDATION_ERROR", message: "Pagination values are invalid." } }, 400)
      : errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  let uploadedPath: string | null = null;
  let createdRecordId: string | null = null;
  try {
    await requireSameOrigin(request);
    const { memberId } = await params;
    if (!uuidSchema.safeParse(memberId).success) throw new HttpError(400, "INVALID_MEMBER", "Member ID is invalid.");
    const length = Number(request.headers.get("content-length") || 0);
    if (length > maxMultipartBytes) throw new HttpError(413, "FILE_TOO_LARGE", "Maximum upload size is 20 MB.");
    const form = await readBoundedFormData(request);
    const input = recordMetadataSchema.parse({
      title: form.get("title"), category: form.get("category"), documentDate: form.get("documentDate") || undefined, notes: form.get("notes") || undefined,
    });
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > 20 * 1024 * 1024) throw new HttpError(400, "INVALID_FILE", "Choose a PDF or image up to 20 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = sniffFile(bytes);
    if (!detected) throw new HttpError(415, "UNSUPPORTED_FILE", "The file contents are not a supported PDF or image.");
    if (input.documentDate && input.documentDate > new Date().toISOString().slice(0, 10)) throw new HttpError(422, "FUTURE_DOCUMENT_DATE", "Document date cannot be in the future.");
    const { supabase, user } = await requireUser();
    enforceRateLimit(`record-upload:${user.id}`, 12, 60 * 60 * 1000);
    const { data: member, error: memberError } = await supabase.from("family_members").select("id,family_id").eq("id", memberId).is("archived_at", null).maybeSingle();
    if (memberError || !member) throw new HttpError(404, "MEMBER_UNAVAILABLE", "Patient profile is unavailable.");
    const id = randomUUID();
    const extension = detected.extension;
    uploadedPath = `${member.family_id}/${member.id}/${id}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("medical-records").upload(uploadedPath, bytes, { contentType: detected.mime, upsert: false });
    if (uploadError) throw new HttpError(422, "UPLOAD_FAILED", "Private document upload failed. Retry the upload.");
    const safeName = (file.name.split(/[\\/]/).pop() || `medical-record.${extension}`).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || `medical-record.${extension}`;
    const { data: record, error: recordError } = await supabase.from("medical_records").insert({
      id, family_id: member.family_id, member_id: member.id, uploaded_by: user.id,
      title: input.title, category: input.category, document_date: input.documentDate || null,
      original_file_path: uploadedPath, original_filename: safeName, detected_mime_type: detected.mime, file_size_bytes: file.size,
      notes: input.notes || "", verification_status: "needs_review", processing_status: "not_configured",
    }).select("id,family_id,member_id,title,category,document_date,original_filename,file_size_bytes,notes,verification_status,processing_status,created_at").single();
    if (recordError || !record) {
      await supabase.storage.from("medical-records").remove([uploadedPath]);
      uploadedPath = null;
      throw new HttpError(403, "RECORD_SAVE_FAILED", "Record metadata could not be saved. No record was added.");
    }
    createdRecordId = record.id;
    await writeAudit(supabase, { familyId: member.family_id, memberId: member.id, action: "medical_record_created", resourceType: "medical_record", resourceId: record.id });
    uploadedPath = null;
    createdRecordId = null;
    return json({ record, extraction: { status: "not_configured", message: "OCR is not configured; no extraction has been run." } }, 201);
  } catch (error) {
    // Best-effort rollback prevents orphaned private objects when later steps fail.
    if (uploadedPath) {
      try {
        const { supabase } = await requireUser();
        if (createdRecordId) await supabase.from("medical_records").delete().eq("id", createdRecordId);
        await supabase.storage.from("medical-records").remove([uploadedPath]);
      } catch { /* keep response generic */ }
    }
    return error instanceof z.ZodError
      ? json({ error: { code: "VALIDATION_ERROR", message: "Check the record title, category, date and notes." } }, 400)
      : errorResponse(error);
  }
}
