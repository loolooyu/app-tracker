export const APP_NAME = 'Appfolio';
export const APP_VERSION = '1.0.0';
export const DEFAULT_PORT = 4317;
export const BACKUP_FORMAT = 'appfolio-backup';
export const BACKUP_FORMAT_VERSION = 1;

export const STATUSES = ['saved', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<Status, string> = {
  saved: 'Saved',
  applied: 'Applied',
  assessment: 'OA/HireVue',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const PLATFORMS = ['nuworks', 'linkedin', 'handshake', 'greenhouse', 'workday', 'company', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABELS: Record<Platform, string> = {
  nuworks: 'NUworks',
  linkedin: 'LinkedIn',
  handshake: 'Handshake',
  greenhouse: 'Greenhouse',
  workday: 'Workday',
  company: 'Company site',
  other: 'Other',
};

export const LINK_RELATIONSHIPS = ['discovery', 'application', 'additional'] as const;
export type LinkRelationship = (typeof LINK_RELATIONSHIPS)[number];
export const LINK_RELATIONSHIP_LABELS: Record<LinkRelationship, string> = {
  discovery: 'Found on (discovery posting)',
  application: 'Applied through (application destination)',
  additional: 'Additional posting',
};

export const CAPTURE_METHODS = ['adapter', 'structured_data', 'generic_dom', 'selected_text', 'manual_paste'] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];
export const CAPTURE_METHOD_LABELS: Record<CaptureMethod, string> = {
  adapter: 'Platform adapter',
  structured_data: 'Structured data (JobPosting)',
  generic_dom: 'Page content (generic)',
  selected_text: 'Selected text',
  manual_paste: 'Manual paste',
};

export const ASSESSMENT_TYPES = ['oa', 'hirevue', 'take_home', 'other'] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];
export const ASSESSMENT_TYPE_LABELS: Record<AssessmentType, string> = {
  oa: 'Online assessment',
  hirevue: 'HireVue',
  take_home: 'Take-home',
  other: 'Other assessment',
};

export const INTERVIEW_FORMATS = ['phone', 'video', 'onsite', 'other'] as const;
export type InterviewFormat = (typeof INTERVIEW_FORMATS)[number];
export const INTERVIEW_FORMAT_LABELS: Record<InterviewFormat, string> = {
  phone: 'Phone',
  video: 'Video',
  onsite: 'On-site',
  other: 'Other',
};

export const DOCUMENT_TYPES = ['resume', 'cover_letter'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  resume: 'Resume',
  cover_letter: 'Cover letter',
};

export const DOCUMENT_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

/** Job-description limits. We never truncate silently: these drive warnings and validation. */
export const JD_LIMITS = {
  /** Below this many characters a capture is flagged as possibly incomplete. */
  shortChars: 600,
  /** Above this many characters a capture is flagged as unusually long (likely includes page clutter). */
  longWarningChars: 60_000,
  /** Hard maximum accepted by the API. The review form blocks saving above this instead of cutting. */
  maxChars: 400_000,
} as const;

export const DEFAULT_REMINDER_OFFSETS_MINUTES = [24 * 60, 2 * 60];
export const DEFAULT_MAX_UPLOAD_MB = 20;
