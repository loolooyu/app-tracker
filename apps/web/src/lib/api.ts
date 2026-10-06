import type {
  ApplicationDetail,
  ApplicationSummary,
  CaptureResult,
  DocumentRecord,
  MatchCandidate,
  RestoreSummary,
  Settings,
  Summary,
  SystemStatus,
  UpcomingAssessment,
} from '@appfolio/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get offline() {
    return this.code === 'offline';
  }
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Appfolio-Client': 'dashboard' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, 'offline', 'Can’t reach the local Appfolio server. Is it running? Start it with `npm start` in the project folder.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    if ((res.status === 502 || res.status === 503 || res.status === 504) && !data) {
      throw new ApiError(0, 'offline', 'Can’t reach the local Appfolio server. Is it running?');
    }
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

export interface ListParams {
  q?: string;
  platform?: string;
  status?: string;
  missingResume?: boolean;
  assessmentDue?: boolean;
  archived?: 'active' | 'archived' | 'all';
  sort?: 'submitted' | 'updated' | 'company' | 'next_due';
}

function qs(params: Record<string, unknown>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || v === false || v === null) continue;
    u.set(k, v === true ? '1' : String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const api = {
  health: () => request<{ ok: boolean; version: string }>('GET', '/api/health'),
  status: () => request<SystemStatus>('GET', '/api/status'),
  summary: () => request<Summary>('GET', '/api/summary'),
  settings: () => request<Settings>('GET', '/api/settings'),
  updateSettings: (patch: Partial<Settings>) => request<Settings>('PATCH', '/api/settings', patch),

  list: (p: ListParams) => request<ApplicationSummary[]>('GET', `/api/applications${qs({ ...p })}`),
  get: (id: string) => request<ApplicationDetail>('GET', `/api/applications/${id}`),
  update: (id: string, patch: Record<string, unknown>) => request<ApplicationDetail>('PATCH', `/api/applications/${id}`, patch),
  remove: (id: string) => request<void>('DELETE', `/api/applications/${id}`),
  setStatus: (id: string, status: string, note?: string) => request<ApplicationDetail>('POST', `/api/applications/${id}/status`, { status, note }),
  markApplied: (id: string, body: Record<string, unknown>) => request<ApplicationDetail>('POST', `/api/applications/${id}/mark-applied`, body),
  assignDocument: (id: string, kind: 'resume' | 'cover_letter', documentId: string | null, reason?: string) =>
    request<ApplicationDetail>('POST', `/api/applications/${id}/documents`, { kind, documentId, reason }),
  addLink: (id: string, body: { url: string; platform: string; relationship: string }) => request<{ existed: boolean }>('POST', `/api/applications/${id}/links`, body),
  removeLink: (id: string, linkId: string) => request<void>('DELETE', `/api/applications/${id}/links/${linkId}`),
  addSnapshot: (id: string, body: Record<string, unknown>) => request<{ snapshotId: string; reused: boolean }>('POST', `/api/applications/${id}/snapshots`, body),
  snapshot: (id: string) => request<import('@appfolio/shared').Snapshot>('GET', `/api/snapshots/${id}`),
  capture: (body: Record<string, unknown>) => request<CaptureResult>('POST', '/api/captures', body),
  match: (body: Record<string, unknown>) => request<MatchCandidate[]>('POST', '/api/match', body),

  addAssessment: (id: string, body: Record<string, unknown>) => request('POST', `/api/applications/${id}/assessments`, body),
  updateAssessment: (id: string, aid: string, body: Record<string, unknown>) => request('PATCH', `/api/applications/${id}/assessments/${aid}`, body),
  removeAssessment: (id: string, aid: string) => request('DELETE', `/api/applications/${id}/assessments/${aid}`),
  upcoming: () => request<UpcomingAssessment[]>('GET', '/api/assessments/upcoming'),
  addInterview: (id: string, body: Record<string, unknown>) => request('POST', `/api/applications/${id}/interviews`, body),
  updateInterview: (id: string, iid: string, body: Record<string, unknown>) => request('PATCH', `/api/applications/${id}/interviews/${iid}`, body),
  removeInterview: (id: string, iid: string) => request('DELETE', `/api/applications/${id}/interviews/${iid}`),

  documents: (q?: string, type?: string) => request<DocumentRecord[]>('GET', `/api/documents${qs({ q, type })}`),
  uploadDocument: (file: File, type: 'resume' | 'cover_letter', label?: string) => {
    const fd = new FormData();
    fd.append('type', type);
    if (label) fd.append('label', label);
    fd.append('file', file, file.name);
    return request<{ document: DocumentRecord; reused: boolean }>('POST', '/api/documents', fd);
  },
  renameDocument: (id: string, label: string) => request<DocumentRecord>('PATCH', `/api/documents/${id}`, { label }),
  deleteDocument: (id: string) => request<void>('DELETE', `/api/documents/${id}`),

  pairingCode: () => request<{ code: string; expiresAt: string }>('POST', '/api/pairing/code'),
  revokePairing: (id: string | 'all') => request<void>('DELETE', `/api/pairings/${id}`),

  stageRestore: (file: File) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return request<RestoreSummary>('POST', '/api/restore/stage', fd);
  },
  applyRestore: (stagingId: string, mode: 'empty' | 'replace', confirm?: string) =>
    request<{ recoveryBackup: string | null }>('POST', '/api/restore/apply', { stagingId, mode, confirm }),
  discardRestore: (stagingId: string) => request<void>('DELETE', `/api/restore/${stagingId}`),
  seedDemo: (timezone: string) => request<Summary>('POST', '/api/demo', { timezone }),
  removeDemo: () => request<Summary>('DELETE', '/api/demo'),
};

export const urls = {
  documentFile: (id: string, inline = false) => `/api/documents/${id}/file${inline ? '?disposition=inline' : ''}`,
  snapshotDownload: (id: string, version: 'reviewed' | 'raw' = 'reviewed') => `/api/snapshots/${id}/download?version=${version}`,
  ics: (id: string) => `/api/assessments/${id}/ics`,
  csv: '/api/export/csv',
  backup: '/api/export/backup',
};
