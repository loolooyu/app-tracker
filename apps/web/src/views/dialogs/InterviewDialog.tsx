import { useState } from 'react';
import { INTERVIEW_FORMATS, INTERVIEW_FORMAT_LABELS, type ApplicationDetail, type Interview, type InterviewFormat } from '@appfolio/shared';
import { Dialog } from '../../components/Dialog';
import { DateTimeField, type DateTimeValue } from '../../components/DateTimeField';
import { api } from '../../lib/api';
import { useApp } from '../../lib/app-context';
import { ErrorBanner, useSubmit } from './useSubmit';

export function InterviewDialog({ app, existing, onClose, onDone }: { app: ApplicationDetail; existing?: Interview; onClose: () => void; onDone: (m: string) => void }) {
  const { tz } = useApp();
  const { busy, error, submit } = useSubmit();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [format, setFormat] = useState<InterviewFormat>(existing?.format ?? 'video');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [when, setWhen] = useState<DateTimeValue>({ iso: existing?.startsAt ?? null, timezone: existing?.timezone ?? tz, incomplete: false });
  const [advance, setAdvance] = useState(!existing && app.status !== 'interview' && app.status !== 'offer');

  return (
    <Dialog
      title={existing ? 'Edit interview' : 'Add interview'}
      description={`${app.title} · ${app.company}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {existing && (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void submit(async () => { await api.removeInterview(app.id, existing.id); onDone('Interview removed'); })}>Remove</button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || when.incomplete}
            onClick={() =>
              void submit(async () => {
                const body = { title: title || null, startsAt: when.iso, timezone: when.timezone, format, notes: notes || null };
                if (existing) await api.updateInterview(app.id, existing.id, body);
                else await api.addInterview(app.id, body);
                if (advance) await api.setStatus(app.id, 'interview');
                onDone(existing ? 'Interview updated' : 'Interview added');
              })
            }
          >
            {busy ? 'Saving…' : 'Save interview'}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <div className="field"><label htmlFor="i-title">Round / title</label><input id="i-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Technical round 1" /></div>
        <div className="field">
          <label htmlFor="i-format">Format</label>
          <select id="i-format" className="select" value={format} onChange={(e) => setFormat(e.target.value as InterviewFormat)}>
            {INTERVIEW_FORMATS.map((f) => <option key={f} value={f}>{INTERVIEW_FORMAT_LABELS[f]}</option>)}
          </select>
        </div>
      </div>
      <DateTimeField label="When (optional)" initialIso={existing?.startsAt ?? null} initialTimezone={existing?.timezone ?? tz} displayTimezone={tz} onChange={setWhen} defaultTime="09:00" />
      <div className="field"><label htmlFor="i-notes">Notes</label><textarea id="i-notes" className="textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Interviewers, topics, prep…" /></div>
      {!existing && app.status !== 'interview' && (
        <label className="check"><input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} /> Also set status to Interview</label>
      )}
      <ErrorBanner error={error} />
    </Dialog>
  );
}
