import { useState } from 'react';
import { PLATFORMS, PLATFORM_LABELS, type ApplicationDetail, type Platform } from '@appfolio/shared';
import { Dialog } from '../../components/Dialog';
import { DateTimeField, type DateTimeValue } from '../../components/DateTimeField';
import { api } from '../../lib/api';
import { useApp } from '../../lib/app-context';
import { DocumentPicker } from './DocumentPicker';
import { ErrorBanner, useSubmit } from './useSubmit';

export function MarkAppliedDialog({ app, onClose, onDone }: { app: ApplicationDetail; onClose: () => void; onDone: (a: ApplicationDetail) => void }) {
  const { tz } = useApp();
  const { busy, error, submit } = useSubmit();
  const [when, setWhen] = useState<DateTimeValue>({ iso: new Date().toISOString(), timezone: tz, incomplete: false });
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [showCover, setShowCover] = useState(false);
  const destination = app.links.find((l) => l.relationship === 'application');
  const [through, setThrough] = useState<Platform | ''>(app.appliedThrough ?? destination?.platform ?? '');
  const [note, setNote] = useState('');

  return (
    <Dialog
      title="Mark applied"
      description={`${app.title} · ${app.company}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !when.iso}
            onClick={() =>
              void submit(async () => {
                onDone(
                  await api.markApplied(app.id, {
                    submittedAt: when.iso,
                    resumeDocumentId: resumeId,
                    coverLetterDocumentId: coverId,
                    appliedThrough: through || null,
                    note: note || null,
                  }),
                );
              })
            }
          >
            {busy ? 'Saving…' : resumeId ? 'Mark applied' : 'Mark applied without resume'}
          </button>
        </>
      }
    >
      <p className="small muted">Do this after you’ve actually submitted on the company’s site. Opening an application form doesn’t count.</p>
      <DateTimeField label="Submitted" initialIso={when.iso} initialTimezone={tz} displayTimezone={tz} required defaultTime="12:00" onChange={setWhen} />
      <div className="field">
        <span className="label" style={{ fontWeight: 600, fontSize: 13 }}>Resume you submitted</span>
        <DocumentPicker type="resume" value={resumeId} onChange={setResumeId} noneLabel="— Not recorded yet (I’ll add it later) —" />
        {!resumeId && <div className="banner warn"><span>Without a resume this record will show <strong>Resume needed</strong> until you choose the exact version.</span></div>}
      </div>
      {showCover ? (
        <div className="field">
          <span className="label" style={{ fontWeight: 600, fontSize: 13 }}>Cover letter (optional)</span>
          <DocumentPicker type="cover_letter" value={coverId} onChange={setCoverId} noneLabel="— No cover letter —" />
        </div>
      ) : (
        <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setShowCover(true)}>Attach a cover letter</button>
      )}
      <div className="grid-2">
        <div className="field">
          <label htmlFor="through">Applied through</label>
          <select id="through" className="select" value={through} onChange={(e) => setThrough(e.target.value as Platform | '')}>
            <option value="">Not recorded</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="applied-note">Short note (optional)</label>
          <input id="applied-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Referral from Sam" maxLength={2000} />
        </div>
      </div>
      <ErrorBanner error={error} />
    </Dialog>
  );
}
