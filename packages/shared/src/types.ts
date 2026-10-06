import type {
  AssessmentType,
  CaptureMethod,
  DocumentType,
  InterviewFormat,
  LinkRelationship,
  Platform,
  Status,
} from './constants.js';

export interface SourceLink {
  id: string;
  applicationId: string;
  url: string;
  normalizedUrl: string;
  platform: Platform;
  relationship: LinkRelationship;
  jobId: string | null;
  addedAt: string;
}

export interface SnapshotSummary {
  id: string;
  applicationId: string;
  sourceLinkId: string | null;
  sourceUrl: string | null;
  capturedAt: string;
  method: CaptureMethod;
  warnings: string[];
  reviewConfirmedAt: string;
  contentHash: string;
  charCount: number;
  /** True when the reviewed text differs from what was originally captured. */
  edited: boolean;
  pageTitle: string | null;
}

export interface Snapshot extends SnapshotSummary {
  rawText: string;
  reviewedText: string;
}

export interface DocumentRecord {
  id: string;
  type: DocumentType;
  label: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  createdAt: string;
  isDemo: boolean;
  linkedApplications: Array<{ id: string; company: string; title: string; as: DocumentType }>;
}

export interface Assessment {
  id: string;
  applicationId: string;
  type: AssessmentType;
  title: string;
  url: string | null;
  dueAt: string | null;
  timezone: string;
  completedAt: string | null;
  reminderOffsetsMinutes: number[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Interview {
  id: string;
  applicationId: string;
  title: string | null;
  startsAt: string | null;
  timezone: string;
  format: InterviewFormat;
  notes: string | null;
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  applicationId: string;
  type: string;
  at: string;
  data: Record<string, unknown>;
}

export interface ApplicationSummary {
  id: string;
  company: string;
  title: string;
  location: string | null;
  status: Status;
  foundOn: Platform;
  appliedThrough: Platform | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  isDemo: boolean;
  tags: string[];
  hasSnapshot: boolean;
  resumeNeeded: boolean;
  nextAssessment: { id: string; title: string; dueAt: string; timezone: string; overdue: boolean } | null;
  /** When searching: where the term matched (e.g. "saved JD"). */
  matchedIn?: string[];
  snippet?: string | null;
}

export interface ApplicationDetail extends ApplicationSummary {
  jobType: string | null;
  program: string | null;
  season: string | null;
  jobId: string | null;
  notes: string | null;
  primarySnapshotId: string | null;
  submittedResume: DocumentRecord | null;
  submittedCoverLetter: DocumentRecord | null;
  links: SourceLink[];
  snapshots: SnapshotSummary[];
  primarySnapshot: Snapshot | null;
  assessments: Assessment[];
  interviews: Interview[];
  activity: ActivityEvent[];
}

export interface Summary {
  applications: number;
  interviews: number;
  assessmentsDue: number;
  assessmentsOverdue: number;
  jdsPreserved: number;
  totalRecords: number;
  hasDemoData: boolean;
}

export interface MatchCandidate {
  application: ApplicationSummary;
  kind: 'exact_url' | 'job_id' | 'similar';
  score: number;
  reasons: string[];
}

export type CaptureOutcome =
  | 'created'
  | 'linked'
  | 'link_exists'
  | 'snapshot_added'
  | 'snapshot_reused';

export interface CaptureResult {
  captureId: string;
  applicationId: string;
  outcomes: CaptureOutcome[];
  snapshotId: string | null;
  linkId: string | null;
  /** True when this capture ID had already been processed (a retry); nothing new was written. */
  replayed: boolean;
}

export interface UpcomingAssessment extends Assessment {
  company: string;
  applicationTitle: string;
  overdue: boolean;
}

export interface Settings {
  timezone: string | null;
  defaultReminderOffsetsMinutes: number[];
}

export interface PairingInfo {
  id: string;
  origin: string;
  name: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  lastReminderSyncAt: string | null;
}

export interface SystemStatus {
  version: string;
  schemaVersion: number;
  dataDir: string;
  maxUploadBytes: number;
  pairings: PairingInfo[];
  storage: { documents: number; missingFiles: number; orphanFilesRemoved: number };
}

export interface RestoreSummary {
  stagingId: string;
  createdAt: string;
  schemaVersion: number;
  counts: Record<string, number>;
  documentBytes: number;
  warnings: string[];
  currentWorkspaceEmpty: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
