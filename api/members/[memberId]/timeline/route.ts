import { requireUser } from "@/lib/auth";
import { errorResponse, HttpError, json } from "@/lib/http";
import { paginationSchema, uuidSchema } from "@/lib/validation";
import { z } from "zod";

type Context = { params: Promise<{ memberId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { memberId } = await params;
    if (!uuidSchema.safeParse(memberId).success) throw new HttpError(400, "INVALID_MEMBER", "Member ID is invalid.");
    const url = new URL(request.url);
    const paging = paginationSchema.parse({ limit: url.searchParams.get("limit") || undefined, offset: url.searchParams.get("offset") || undefined });
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (from && !z.string().date().safeParse(from).success || to && !z.string().date().safeParse(to).success) throw new HttpError(400, "INVALID_DATE", "Date filter is invalid.");
    if (from && to && from > to) throw new HttpError(400, "INVALID_DATE_RANGE", "Start date must not be after end date.");
    const { supabase } = await requireUser();
    let eventQuery = supabase.from("timeline_events").select("id,member_id,source_record_id,event_type,event_date,title,description,verification_status,created_at")
      .eq("member_id", memberId).order("event_date", { ascending: false }).range(0, 199);
    if (from) eventQuery = eventQuery.gte("event_date", from);
    if (to) eventQuery = eventQuery.lte("event_date", to);
    let recordQuery = supabase.from("medical_records").select("id,member_id,category,document_date,title,verification_status,created_at")
      .eq("member_id", memberId).is("archived_at", null).order("document_date", { ascending: false, nullsFirst: false }).range(0, 199);
    if (from) recordQuery = recordQuery.gte("document_date", from);
    if (to) recordQuery = recordQuery.lte("document_date", to);
    const [{ data: events, error: eventsError }, { data: records, error: recordsError }] = await Promise.all([eventQuery, recordQuery]);
    if (eventsError || recordsError) throw new HttpError(404, "TIMELINE_UNAVAILABLE", "Patient timeline is unavailable.");
    const sourceRecordIds = new Set((events || []).map((event) => event.source_record_id).filter(Boolean));
    const recordEvents = (records || []).filter((record) => !sourceRecordIds.has(record.id)).map((record) => ({
      id: `record:${record.id}`, member_id: record.member_id, source_record_id: record.id, event_type: "record",
      event_date: record.document_date || record.created_at.slice(0, 10), title: record.title, description: record.category,
      verification_status: record.verification_status, created_at: record.created_at,
    }));
    const all = [...(events || []), ...recordEvents].sort((a, b) => b.event_date.localeCompare(a.event_date) || b.created_at.localeCompare(a.created_at));
    return json({ events: all.slice(paging.offset, paging.offset + paging.limit), total: all.length, limit: paging.limit, offset: paging.offset });
  } catch (error) {
    return error instanceof z.ZodError
      ? json({ error: { code: "VALIDATION_ERROR", message: "Pagination values are invalid." } }, 400)
      : errorResponse(error);
  }
}
