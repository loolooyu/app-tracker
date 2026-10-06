import { z } from 'zod';
import {
  ASSESSMENT_TYPES,
  CAPTURE_METHODS,
  DOCUMENT_TYPES,
  INTERVIEW_FORMATS,
  JD_LIMITS,
  LINK_RELATIONSHIPS,
  PLATFORMS,
  STATUSES,
} from './constants.js';
import { isValidTimeZone } from './time.js';

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Only http(s) URLs are stored as source links; anything else (javascript:, data:, file:) is rejected. */
export const httpUrl = z
  .string()
  .trim()
  .max(4096)
  .refine((value) => {
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be an http(s) URL');

export const isoInstant = z.iso.datetime({ offset: true });
export const timeZone = z.string().refine(isValidTimeZone, 'Unknown IANA time zone');

export const statusSchema = z.enum(STATUSES);
export const platformSchema = z.enum(PLATFORMS);
export const relationshipSchema = z.enum(LINK_RELATIONSHIPS);
export const captureMethodSchema = z.enum(CAPTURE_METHODS);
export const assessmentTypeSchema = z.enum(ASSESSMENT_TYPES);
export const interviewFormatSchema = z.enum(INTERVIEW_FORMATS);
export const documentTypeSchema = z.enum(DOCUMENT_TYPES);

export const tagsSchema = z.array(trimmed(40).min(1)).max(30).default([]);

export const applicationFieldsSchema = z.object({
  company: trimmed(200).min(1, 'Company is required'),
  title: trimmed(300).min(1, 'Title is required'),
  location: optionalText(200),
  jobType: optionalText(100),
  program: optionalText(100),
  season: optionalText(100),
  jobId: optionalText(200),
  foundOn: platformSchema.default('other'),
  appliedThrough: platformSchema.nullish().transform((v) => v ?? null),
  notes: optionalText(50_000),
  tags: tagsSchema,
});
export type ApplicationFields = z.infer<typeof applicationFieldsSchema>;

export const applicationPatchSchema = z
  .object({
    company: trimmed(200).min(1),
    title: trimmed(300).min(1),
    location: optionalText(200),
    jobType: optionalText(100),
    program: optionalText(100),
    season: optionalText(100),
    jobId: optionalText(200),
    foundOn: platformSchema,
    appliedThrough: platformSchema.nullable(),
    notes: optionalText(50_000),
    tags: z.array(trimmed(40).min(1)).max(30),
    archived: z.boolean(),
    /** Correcting the submission date (or clearing it) is allowed and recorded in activity. */
    submittedAt: isoInstant.nullable(),
    primarySnapshotId: z.string().min(1).nullable(),
  })
  .partial()
  .strict();
export type ApplicationPatch = z.infer<typeof applicationPatchSchema>;

export const statusChangeSchema = z.object({
  status: statusSchema,
  note: optionalText(2000),
});

export const markAppliedSchema = z.object({
  submittedAt: isoInstant,
  resumeDocumentId: z.string().min(1).nullish().transform((v) => v ?? null),
  coverLetterDocumentId: z.string().min(1).nullish().transform((v) => v ?? null),
  appliedThrough: platformSchema.nullish().transform((v) => v ?? null),
  note: optionalText(2000),
});

export const assignDocumentSchema = z.object({
  kind: documentTypeSchema,
  documentId: z.string().min(1).nullable(),
  reason: optionalText(500),
});

export const linkInputSchema = z.object({
  url: httpUrl,
  platform: platformSchema,
  relationship: relationshipSchema,
});
export type LinkInput = z.infer<typeof linkInputSchema>;

export const snapshotInputSchema = z
  .object({
    sourceUrl: httpUrl.nullish().transform((v) => v ?? null),
    rawText: z.string().max(JD_LIMITS.maxChars),
    reviewedText: z
      .string()
      .max(JD_LIMITS.maxChars, `Job description exceeds ${JD_LIMITS.maxChars.toLocaleString()} characters`)
      .refine((t) => t.trim().length > 0, 'Job description text is empty'),
    method: captureMethodSchema,
    warnings: z.array(trimmed(300)).max(20).default([]),
    /** The user must confirm they reviewed the text before it is committed. */
    reviewConfirmed: z.literal(true, { error: 'Review confirmation is required before saving a job description' }),
    pageTitle: optionalText(500),
  })
  .strict();
export type SnapshotInput = z.infer<typeof snapshotInputSchema>;

export const addSnapshotSchema = z.object({
  snapshot: snapshotInputSchema,
  makePrimary: z.boolean().default(false),
  /** When identical text already exists, the API returns it instead of duplicating unless this is set. */
  allowDuplicate: z.boolean().default(false),
});

export const captureSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('new'),
    captureId: z.uuid(),
    application: applicationFieldsSchema,
    link: linkInputSchema.nullish().transform((v) => v ?? null),
    snapshot: snapshotInputSchema.nullish().transform((v) => v ?? null),
  }),
  z.object({
    mode: z.literal('link'),
    captureId: z.uuid(),
    applicationId: z.string().min(1),
    link: linkInputSchema,
    /** Optional: a JD found on the destination page. Omit when the page is only an application form. */
    snapshot: snapshotInputSchema.nullish().transform((v) => v ?? null),
    makePrimary: z.boolean().default(false),
    setAppliedThrough: z.boolean().default(false),
  }),
]);
export type CaptureInput = z.infer<typeof captureSchema>;

export const matchQuerySchema = z.object({
  url: httpUrl.nullish(),
  platform: platformSchema.nullish(),
  jobId: z.string().trim().max(200).nullish(),
  company: z.string().trim().max(200).nullish(),
  title: z.string().trim().max(300).nullish(),
  location: z.string().trim().max(200).nullish(),
});
export type MatchQuery = z.infer<typeof matchQuerySchema>;

const reminderOffsets = z.array(z.number().int().min(1).max(60 * 24 * 30)).max(6);

export const assessmentInputSchema = z.object({
  type: assessmentTypeSchema,
  title: trimmed(200).min(1),
  url: httpUrl.nullish().transform((v) => v ?? null),
  dueAt: isoInstant.nullable(),
  timezone: timeZone,
  reminderOffsetsMinutes: reminderOffsets.nullish().transform((v) => v ?? null),
  notes: optionalText(5000),
});

export const assessmentPatchSchema = z
  .object({
    type: assessmentTypeSchema,
    title: trimmed(200).min(1),
    url: httpUrl.nullable(),
    dueAt: isoInstant.nullable(),
    timezone: timeZone,
    reminderOffsetsMinutes: reminderOffsets,
    notes: optionalText(5000),
    completed: z.boolean(),
  })
  .partial()
  .strict();

export const interviewInputSchema = z.object({
  title: optionalText(200),
  startsAt: isoInstant.nullable(),
  timezone: timeZone,
  format: interviewFormatSchema,
  notes: optionalText(20_000),
});
export const interviewPatchSchema = interviewInputSchema.partial().strict();

export const settingsPatchSchema = z
  .object({
    timezone: timeZone.nullable(),
    defaultReminderOffsetsMinutes: reminderOffsets,
  })
  .partial()
  .strict();

export const documentPatchSchema = z
  .object({
    label: trimmed(200).min(1),
  })
  .strict();

export const pairSchema = z.object({
  code: z.string().trim().min(6).max(32),
  extensionName: optionalText(100),
});

export const restoreApplySchema = z.object({
  stagingId: z.string().regex(/^[a-f0-9-]{36}$/),
  mode: z.enum(['empty', 'replace']),
  confirm: z.string().optional(),
});
