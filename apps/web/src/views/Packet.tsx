import { useCallback, useEffect, useState } from 'react';
import {
  ASSESSMENT_TYPE_LABELS,
  CAPTURE_METHOD_LABELS,
  INTERVIEW_FORMAT_LABELS,
  LINK_RELATIONSHIP_LABELS,
  STATUSES,
  STATUS_LABELS,
  describeOffset,
  relativeDue,
  type ApplicationDetail,
  type Assessment,
  type DocumentRecord,
  type Interview,
  type Status,
} from '@appfolio/shared';
import { api, urls } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatBytes, formatDate, formatDateTime, hostOf, platformLabel, safeHref } from '../lib/format';
import { href, navigate } from '../lib/route';
import { useToast } from '../components/Toasts';
import { IconArrow, IconBack, IconDownload, IconExternal, IconPlus } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import { MarkAppliedDialog } from './dialogs/MarkAppliedDialog';
import { EditDetailsDialog } from './dialogs/EditDetailsDialog';
import { AddLinkDialog } from './dialogs/AddLinkDialog';
import { AddSnapshotDialog } from './dialogs/AddSnapshotDialog';
import { AssessmentDialog } from './dialogs/AssessmentDialog';
import { InterviewDialog } from './dialogs/InterviewDialog';
import { JDReaderDialog } from './dialogs/JDReaderDialog';
import { AssignDocumentDialog } from './dialogs/AssignDocumentDialog';
import { ConfirmDialog } from './dialogs/ConfirmDialog';
import { PreviewDialog } from './dialogs/PreviewDialog';
import { describeActivity } from './activity';

type Modal =
  | { kind: 'applied' }
  | { kind: 'edit' }
  | { kind: 'link' }
  | { kind: 'snapshot' }
  | { kind: 'reader' }
  | { kind: 'assessment'; existing?: Assessment }
  | { kind: 'interview'; existing?: Interview }
  | { kind: 'assign'; docKind: 'resume' | 'cover_letter' }
  | { kind: 'preview'; doc: DocumentRecord }
  | { kind: 'delete' }
  | null;

export function Packet({ id, onChanged, notInList }: { id: string; onChanged: () => void; notInList: boolean }) {
  const { tz, version, reportError } = useApp();
  const { notify } = useToast();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [docLabels, setDocLabels] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const a = await api.get(id);
      setApp(a);
      setError(null);
    } catch (e) {
      const msg = reportError(e);
      setError({ message: msg, notFound: (e as { status?: number }).status === 404 });
    }
  }, [id, reportError]);

  useEffect(() => {
    setApp(null);
    void load();
  }, [load, version]);

  useEffect(() => {
    api.documents().then((docs) => setDocLabels(Object.fromEntries(docs.map((d) => [d.id, d.label])))).catch(() => undefined);
  }, [id, version]);

  const after = useCallback(
    async (message?: string, updated?: ApplicationDetail) => {
      if (message) notify(message);
      setModal(null);
      if (updated) setApp(updated);
      else await load();
      onChanged();
    },
    [load, notify, onChanged],
  );

  const run = useCallback(
    async (fn: () => Promise<unknown>, message: string) => {
      try {
        const r = await fn();
        await after(message, r && typeof r === 'object' && 'activity' in (r as object) ? (r as ApplicationDetail) : undefined);
      } catch (e) {
        notify(reportError(e), 'error');
      }
    },
    [after, notify, reportError],
  );

  if (error) {
    return (
      <div className="empty" role="alert">
        <h2 style={{ fontSize: 20 }}>{error.notFound ? 'This application no longer exists' : 'Couldn’t load this application'}</h2>
        <p>{error.message}</p>
        <div className="row">
          <a className="btn" href={href({ view: 'applications', id: null })}>Back to list</a>
          {!error.notFound && <button type="button" className="btn" onClick={() => void load()}>Try again</button>}
        </div>
      </div>
    );
  }
  if (!app) {
    return (
      <div className="stack" style={{ padding: 24 }} aria-busy="true" aria-label="Loading application">
        <div className="skeleton" style={{ height: 26, width: '60%' }} />
        <div className="skeleton" style={{ width: '35%' }} />
        <div className="skeleton" style={{ height: 160 }} />
      </div>
    );
  }

  const discovery = app.links.find((l) => l.relationship === 'discovery') ?? app.links[0] ?? null;
  const destination = app.links.find((l) => l.relationship === 'application') ?? null;
  const originalUrl = safeHref(discovery?.url);

  const changeStatus = (status: Status) => {
    if (status === app.status) return;
    if (status === 'applied' && !app.submittedAt) {
      setModal({ kind: 'applied' });
      return;
    }
    void run(() => api.setStatus(app.id, status), `Status changed to ${STATUS_LABELS[status]}`);
  };

  return (
    <article aria-labelledby="packet-title">
      <header className="packet-head">
        <div className="row">
          <a className="btn btn-ghost btn-sm back-btn" href={href({ view: 'applications', id: null })}>
            <IconBack /> All applications
          </a>
        </div>
        {notInList && (
          <div className="banner" role="note">This record doesn’t match the current search or filters, so it isn’t shown in the list.</div>
        )}
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
            <h2 id="packet-title">{app.title}</h2>
            <p className="packet-company">
              {app.company}
              {app.location ? ` · ${app.location}` : ''}
              {app.jobType ? ` · ${app.jobType}` : ''}
              {app.season ? ` · ${app.season}` : ''}
            </p>
            <div className="row small">
              <StatusBadge status={app.status} />
              <span className="muted">{app.submittedAt ? `Submitted ${formatDateTime(app.submittedAt, tz)}` : 'Not submitted yet'}</span>
              {app.archived && <span className="badge outline plain">Archived</span>}
              {app.isDemo && <span className="badge demo plain">Demo data</span>}
              {app.tags.filter((t) => t !== 'demo').map((t) => <span key={t} className="badge outline plain">{t}</span>)}
            </div>
          </div>
        </div>
        <div className="packet-actions">
          {!app.submittedAt && (
            <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: 'applied' })}>
              Mark applied
            </button>
          )}
          {originalUrl && (
            <a className="btn" href={originalUrl} target="_blank" rel="noopener noreferrer" title="Opens the live posting. It may have expired; your saved copy is below.">
              Open original posting <IconExternal />
            </a>
          )}
          <label className="sr-only" htmlFor="status-select">Change status</label>
          <select id="status-select" className="select" style={{ width: 'auto' }} value={app.status} onChange={(e) => changeStatus(e.target.value as Status)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>Status: {STATUS_LABELS[s]}</option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => setModal({ kind: 'edit' })}>Edit details</button>
        </div>
      </header>

      <div className="packet-body">
        {app.resumeNeeded && (
          <div className="banner warn" role="alert" style={{ marginTop: 16 }}>
            <span>
              <strong>Resume needed.</strong> You marked this as applied without recording which resume you sent. Choose the exact version so it’s here when the interview comes.
            </span>
            <button type="button" className="btn btn-sm" onClick={() => setModal({ kind: 'assign', docKind: 'resume' })}>Choose resume</button>
          </div>
        )}

        <section className="section" aria-labelledby="route-h">
          <div className="section-head"><h3 id="route-h">Application route</h3><button type="button" className="btn btn-sm" onClick={() => setModal({ kind: 'link' })}><IconPlus /> Link another URL</button></div>
          <div className="route">
            <div className="route-step">
              <div className="label">Found on</div>
              <div className="value">{platformLabel(app.foundOn)}</div>
              {discovery && <div className="small muted truncate">{hostOf(discovery.url)}</div>}
            </div>
            <div className="route-arrow" aria-hidden="true"><IconArrow /></div>
            <div className="route-step">
              <div className="label">Applied through</div>
              <div className="value">{app.appliedThrough ? platformLabel(app.appliedThrough) : 'Not recorded'}</div>
              {destination && <div className="small muted truncate">{hostOf(destination.url)}</div>}
            </div>
          </div>
          {app.links.length > 0 && (
            <ul className="link-list" aria-label="Source links">
              {app.links.map((l) => (
                <li key={l.id} className="link-item">
                  <span className="grow">
                    <span className="small" style={{ fontWeight: 650 }}>{LINK_RELATIONSHIP_LABELS[l.relationship]} · {platformLabel(l.platform)}</span>
                    <span className="small muted truncate" title={l.url}>{l.url}</span>
                  </span>
                  {safeHref(l.url) && (
                    <a className="btn btn-sm" href={safeHref(l.url)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${hostOf(l.url)} in a new tab`}>
                      Open <IconExternal />
                    </a>
                  )}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void run(() => api.removeLink(app.id, l.id), 'Link removed')} aria-label={`Remove link ${hostOf(l.url)}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="small muted">Opening a link never changes the status. Use “Mark applied” once you’ve actually submitted.</p>
        </section>

        <section className="section" aria-labelledby="jd-h">
          <div className="section-head">
            <h3 id="jd-h">Saved job description</h3>
            <div className="row">
              <button type="button" className="btn btn-sm" onClick={() => setModal({ kind: 'snapshot' })}><IconPlus /> Add snapshot</button>
            </div>
          </div>
          {app.primarySnapshot ? (
            <>
              <div className="row small muted">
                <span>Saved {formatDateTime(app.primarySnapshot.capturedAt, tz)}</span>
                <span aria-hidden="true">·</span>
                <span>{CAPTURE_METHOD_LABELS[app.primarySnapshot.method]}</span>
                <span aria-hidden="true">·</span>
                <span>{app.primarySnapshot.charCount.toLocaleString()} characters</span>
                {app.snapshots.length > 1 && (<><span aria-hidden="true">·</span><span>{app.snapshots.length} snapshots</span></>)}
              </div>
              <div className="jd-preview" aria-label="Saved job description preview">{app.primarySnapshot.reviewedText}</div>
              <div className="row">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ kind: 'reader' })}>Read full JD</button>
                <a className="btn btn-sm" href={urls.snapshotDownload(app.primarySnapshot.id)} download>
                  <IconDownload /> Download .txt
                </a>
                <span className="small muted">Read from your saved copy, not the live site.</span>
              </div>
            </>
          ) : (
            <div className="banner warn">
              <span><strong>No job description saved.</strong> Capture it with the extension while the posting is still up, or paste it now.</span>
              <button type="button" className="btn btn-sm" onClick={() => setModal({ kind: 'snapshot' })}>Paste JD</button>
            </div>
          )}
        </section>

        <section className="section" aria-labelledby="docs-h">
          <div className="section-head"><h3 id="docs-h">Submitted documents</h3></div>
          <DocCard
            title="Resume"
            doc={app.submittedResume}
            emptyText={app.resumeNeeded ? 'Resume needed — not recorded yet.' : 'No resume recorded. You’ll choose it when you mark this applied.'}
            onChoose={() => setModal({ kind: 'assign', docKind: 'resume' })}
            onPreview={(doc) => setModal({ kind: 'preview', doc })}
            tz={tz}
          />
          <DocCard
            title="Cover letter"
            doc={app.submittedCoverLetter}
            emptyText="No cover letter recorded (optional)."
            onChoose={() => setModal({ kind: 'assign', docKind: 'cover_letter' })}
            onPreview={(doc) => setModal({ kind: 'preview', doc })}
            tz={tz}
          />
        </section>

        <section className="section" aria-labelledby="as-h">
          <div className="section-head">
            <h3 id="as-h">Assessments</h3>
            <button type="button" className="btn btn-sm" onClick={() => setModal({ kind: 'assessment' })}><IconPlus /> Add OA / HireVue</button>
          </div>
          {app.assessments.length === 0 ? (
            <p className="small muted">No OA or HireVue tasks. Add one when an invitation arrives so its deadline shows up front.</p>
          ) : (
            <div className="stack-sm">
              {app.assessments.map((a) => (
                <AssessmentRow
                  key={a.id}
                  a={a}
                  tz={tz}
                  onToggle={() => void run(() => api.updateAssessment(app.id, a.id, { completed: !a.completedAt }), a.completedAt ? 'Marked not done' : 'Marked complete — reminders stop')}
                  onEdit={() => setModal({ kind: 'assessment', existing: a })}
                />
              ))}
            </div>
          )}
        </section>

        <section className="section" aria-labelledby="iv-h">
          <div className="section-head">
            <h3 id="iv-h">Interviews</h3>
            <button type="button" className="btn btn-sm" onClick={() => setModal({ kind: 'interview' })}><IconPlus /> Add interview</button>
          </div>
          {app.interviews.length === 0 ? (
            <p className="small muted">No interviews recorded.</p>
          ) : (
            <ul className="link-list">
              {app.interviews.map((i) => (
                <li key={i.id} className="link-item" style={{ alignItems: 'flex-start' }}>
                  <span className="grow">
                    <span style={{ fontWeight: 650 }}>{i.title || 'Interview'} · {INTERVIEW_FORMAT_LABELS[i.format]}</span>
                    <span className="small muted">{i.startsAt ? formatDateTime(i.startsAt, tz) : 'Time not set'}</span>
                    {i.notes && <span className="small" style={{ whiteSpace: 'pre-wrap' }}>{i.notes}</span>}
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => setModal({ kind: 'interview', existing: i })}>Edit</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <NotesSection app={app} onSaved={(a) => void after('Notes saved', a)} />

        <section className="section" aria-labelledby="act-h">
          <div className="section-head"><h3 id="act-h">Activity</h3></div>
          <ol className="timeline">
            {app.activity.map((e) => (
              <li key={e.id}>
                <span className="tl-dot" aria-hidden="true" />
                <span>
                  {describeActivity(e, docLabels, tz)}
                  <br />
                  <time dateTime={e.at}>{formatDateTime(e.at, tz)}</time>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="section" aria-labelledby="mgmt-h">
          <div className="section-head"><h3 id="mgmt-h">Manage record</h3></div>
          <div className="row">
            <button type="button" className="btn" onClick={() => void run(() => api.update(app.id, { archived: !app.archived }), app.archived ? 'Restored from archive' : 'Archived — find it with the Archived filter')}>
              {app.archived ? 'Unarchive' : 'Archive'}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setModal({ kind: 'delete' })}>Delete record…</button>
          </div>
          <p className="small muted">Archiving hides a record from active views and counts but keeps everything. Offers, rejections and withdrawals keep their full archive too.</p>
        </section>
      </div>

      {modal?.kind === 'applied' && <MarkAppliedDialog app={app} onClose={() => setModal(null)} onDone={(a) => void after('Marked applied', a)} />}
      {modal?.kind === 'edit' && <EditDetailsDialog app={app} onClose={() => setModal(null)} onDone={(a) => void after('Details saved', a)} />}
      {modal?.kind === 'link' && <AddLinkDialog app={app} onClose={() => setModal(null)} onDone={(msg) => void after(msg)} />}
      {modal?.kind === 'snapshot' && <AddSnapshotDialog app={app} onClose={() => setModal(null)} onDone={(msg) => void after(msg)} />}
      {modal?.kind === 'reader' && <JDReaderDialog app={app} onClose={() => setModal(null)} onPrimaryChanged={(a) => void after('Primary snapshot changed', a)} />}
      {modal?.kind === 'assessment' && <AssessmentDialog app={app} existing={modal.existing} onClose={() => setModal(null)} onDone={(msg) => void after(msg)} />}
      {modal?.kind === 'interview' && <InterviewDialog app={app} existing={modal.existing} onClose={() => setModal(null)} onDone={(msg) => void after(msg)} />}
      {modal?.kind === 'assign' && <AssignDocumentDialog app={app} kind={modal.docKind} onClose={() => setModal(null)} onDone={(a) => void after('Document recorded', a)} />}
      {modal?.kind === 'preview' && <PreviewDialog doc={modal.doc} onClose={() => setModal(null)} />}
      {modal?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete this application?"
          confirmLabel="Delete permanently"
          danger
          requireText={app.company}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api.remove(app.id);
            notify('Application deleted');
            onChanged();
            navigate({ view: 'applications', id: null });
          }}
        >
          <p>
            This permanently removes <strong>{app.title}</strong> at <strong>{app.company}</strong>, including its saved job descriptions, links, assessments, interviews and history.
            Resume files stay in your Resume Library. Consider <em>Archive</em> instead if you might need it later.
          </p>
        </ConfirmDialog>
      )}
    </article>
  );
}

function DocCard({ title, doc, emptyText, onChoose, onPreview, tz }: { title: string; doc: DocumentRecord | null; emptyText: string; onChoose: () => void; onPreview: (d: DocumentRecord) => void; tz: string }) {
  if (!doc) {
    return (
      <div className="doc-card">
        <span className="doc-icon" aria-hidden="true">—</span>
        <span className="grow" style={{ flex: 1 }}>
          <span style={{ fontWeight: 650 }}>{title}</span>
          <br />
          <span className="small muted">{emptyText}</span>
        </span>
        <button type="button" className="btn btn-sm" onClick={onChoose}>Choose {title.toLowerCase()}</button>
      </div>
    );
  }
  const isPdf = doc.mimeType === 'application/pdf';
  return (
    <div className="doc-card">
      <span className="doc-icon" aria-hidden="true">{isPdf ? 'PDF' : 'DOCX'}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="small muted">{title} submitted</span>
        <br />
        <span style={{ fontWeight: 650 }}>{doc.label}</span>
        <br />
        <span className="small muted truncate" style={{ display: 'block' }}>
          {doc.originalFilename} · {formatBytes(doc.byteSize)} · uploaded {formatDate(doc.createdAt, tz)}
        </span>
      </span>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {isPdf && <button type="button" className="btn btn-sm" onClick={() => onPreview(doc)}>Preview</button>}
        <a className="btn btn-sm" href={urls.documentFile(doc.id)} download={doc.originalFilename}>
          <IconDownload /> Download
        </a>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onChoose}>Change…</button>
      </div>
    </div>
  );
}

function AssessmentRow({ a, tz, onToggle, onEdit }: { a: Assessment; tz: string; onToggle: () => void; onEdit: () => void }) {
  const overdue = !a.completedAt && a.dueAt && new Date(a.dueAt).getTime() < Date.now();
  const rel = a.dueAt ? relativeDue(a.dueAt) : null;
  return (
    <div className={`task${overdue ? ' overdue' : ''}${a.completedAt ? ' done' : ''}`}>
      <input type="checkbox" checked={!!a.completedAt} onChange={onToggle} aria-label={`Mark “${a.title}” ${a.completedAt ? 'not done' : 'complete'}`} style={{ width: 18, height: 18, marginTop: 3, accentColor: 'var(--primary)' }} />
      <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
        <span className="task-title">{a.title}</span>
        <span className="small muted">
          {ASSESSMENT_TYPE_LABELS[a.type]}
          {' · '}
          {a.dueAt ? (
            <>
              Due {formatDateTime(a.dueAt, tz)}
              {a.timezone !== tz && <> ({formatDateTime(a.dueAt, a.timezone)} in {a.timezone.replace(/_/g, ' ')})</>}
            </>
          ) : (
            'No due time'
          )}
        </span>
        <span className="small">
          {a.completedAt ? (
            <span className="badge st-offer plain">Completed {formatDate(a.completedAt, tz)}</span>
          ) : rel ? (
            <span className={`badge plain ${overdue ? 'danger' : 'st-assessment'}`}>{rel.text}</span>
          ) : null}{' '}
          {!a.completedAt && a.reminderOffsetsMinutes.length > 0 && <span className="muted">Reminders: {a.reminderOffsetsMinutes.map(describeOffset).join(', ')}</span>}
        </span>
        {a.notes && <span className="small" style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</span>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {safeHref(a.url) && (
          <a className="btn btn-sm" href={safeHref(a.url)} target="_blank" rel="noopener noreferrer">
            Open <IconExternal />
          </a>
        )}
        {a.dueAt && (
          <a className="btn btn-sm" href={urls.ics(a.id)} download title="Add to your calendar">
            .ics
          </a>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={onEdit}>Edit</button>
      </div>
    </div>
  );
}

function NotesSection({ app, onSaved }: { app: ApplicationDetail; onSaved: (a: ApplicationDetail) => void }) {
  const { reportError } = useApp();
  const { notify } = useToast();
  const [text, setText] = useState(app.notes ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(app.notes ?? ''), [app.id, app.notes]);
  const dirty = text !== (app.notes ?? '');
  return (
    <section className="section" aria-labelledby="notes-h">
      <div className="section-head"><h3 id="notes-h">Notes</h3></div>
      <label htmlFor="notes" className="sr-only">Notes</label>
      <textarea id="notes" className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Recruiter name, referral, what to emphasize in the interview…" />
      <div className="row">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            try {
              onSaved(await api.update(app.id, { notes: text }));
            } catch (e) {
              notify(reportError(e), 'error');
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? 'Saving…' : 'Save notes'}
        </button>
        {dirty && <span className="small muted">Unsaved changes</span>}
      </div>
    </section>
  );
}
