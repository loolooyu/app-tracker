import type { CaptureMethod, CaptureResult, LinkRelationship, Platform } from '@appfolio/shared';
import type { ExtractedJob } from '@appfolio/shared/extract';

export interface ExtSettings {
  /** Local API origin, e.g. http://127.0.0.1:4317. Only loopback origins are accepted. */
  apiBase: string;
  /** Hostnames the user has identified as NUworks (never guessed). */
  nuworksHosts: string[];
  notifications: boolean;
}

export const DEFAULT_SETTINGS: ExtSettings = { apiBase: 'http://127.0.0.1:4317', nuworksHosts: [], notifications: false };

export interface DraftForm {
  mode: 'new' | 'link';
  company: string;
  title: string;
  location: string;
  platform: Platform;
  jobId: string;
  url: string;
  /** Text the user is reviewing/editing. */
  text: string;
  /** The unedited text from the chosen extraction method. */
  rawText: string;
  method: CaptureMethod;
  linkApplicationId: string | null;
  linkApplicationLabel: string | null;
  relationship: LinkRelationship;
  saveSnapshot: boolean;
  setAppliedThrough: boolean;
  makePrimary: boolean;
  reviewed: boolean;
  rememberNuworksHost: boolean;
}

export interface Draft {
  /** Doubles as the capture ID sent to the API, so retries are idempotent. */
  id: string;
  createdAt: string;
  source: { url: string; title: string | null };
  extracted: ExtractedJob | null;
  /** Set when capture failed (restricted page, no access); the user can still paste manually. */
  captureError: string | null;
  form: DraftForm;
}

export interface QueueItem {
  captureId: string;
  payload: Record<string, unknown>;
  summary: { title: string; company: string; mode: 'new' | 'link' };
  createdAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  /** pending: will retry automatically. attention: the API rejected it; the user must fix or delete it. */
  state: 'pending' | 'attention';
  /** Kept so a rejected item can be moved back to drafts for editing. */
  draft: Draft;
}

export interface SavedRecord {
  captureId: string;
  result: CaptureResult;
  title: string;
  company: string;
  at: string;
}

export type SubmitOutcome = { state: 'saved'; record: SavedRecord } | { state: 'queued'; reason: string } | { state: 'rejected'; reason: string };

/** Messages accepted by the service worker from the extension's own pages. */
export type PanelMessage =
  | { type: 'capture-active-tab' }
  | { type: 'new-manual-draft' }
  | { type: 'discard-draft'; id: string }
  | { type: 'submit-draft'; id: string }
  | { type: 'flush-queue' }
  | { type: 'delete-queued'; captureId: string }
  | { type: 'queued-to-draft'; captureId: string }
  | { type: 'sync-reminders' };

export const MESSAGE_TYPES = new Set<PanelMessage['type']>([
  'capture-active-tab',
  'new-manual-draft',
  'discard-draft',
  'submit-draft',
  'flush-queue',
  'delete-queued',
  'queued-to-draft',
  'sync-reminders',
]);
