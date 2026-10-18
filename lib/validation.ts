import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const dateSchema = z.string().date();
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const memberCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  relationship: z.string().trim().min(1).max(40),
  dateOfBirth: dateSchema.optional(),
  isDependent: z.boolean().default(false),
}).strict();

export const recordMetadataSchema = z.object({
  title: z.string().trim().min(1).max(160),
  category: z.enum([
    "Prescription / medication", "Laboratory report", "Imaging / diagnostic report",
    "Diagnosis / illness", "Hospitalization / discharge", "Vaccination", "Allergies",
    "Doctor visit / follow-up", "Other medical document",
  ]),
  documentDate: dateSchema.optional(),
  notes: z.string().trim().max(4000).optional(),
}).strict();

export const medicationSchema = z.object({
  medicineName: z.string().trim().min(1).max(160),
  strength: z.string().trim().max(100).optional(),
  dosageInstructions: z.string().trim().max(500).optional(),
  route: z.string().trim().max(60).optional(),
  frequency: z.string().trim().max(120).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  sourceRecordId: uuidSchema.optional(),
}).strict();

export const doseSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
  status: z.enum(["taken", "skipped", "missed"]),
  notes: z.string().trim().max(500).optional(),
}).strict();

export const shareSchema = z.object({
  memberId: uuidSchema,
  scope: z.enum(["full_history", "emergency_summary"]),
  expiresInHours: z.number().int().min(1).max(168),
  recordIds: z.array(uuidSchema).max(100).default([]),
}).strict();
