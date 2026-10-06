import { useState } from 'react';
import { ASSESSMENT_TYPES, ASSESSMENT_TYPE_LABELS, describeOffset, type ApplicationDetail, type Assessment, type AssessmentType } from '@appfolio/shared';
import { Dialog } from '../../components/Dialog';
import { DateTimeField, type DateTimeValue } from '../../components/DateTimeField';
import { api } from '../../lib/api';
import { useApp } from '../../lib/app-context';
import { ErrorBanner, useSubmit } from './useSubmit';

const OFFSET_CHOICES = [10080, 4320, 1440, 360, 120, 30];

export function AssessmentDialog({ app, existing, onClose, onDone }: { app: ApplicationDetail; existing?: Assessment; onClose: () => void; onDone: (m: string) => void }) {
  const { tz, settings } = useApp();
  const { busy, error, submit } = useSubmit();
  const [type, setType] = useState<AssessmentType>(existing?.type ?? 'oa');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [url, setUrl] = useState(existing?.url ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [due, setDue] = useState<DateTimeValue>({ iso: existing?.dueAt ?? null, timezone: existing?.timezone ?? tz, incomplete: false });
  const [offsets, setOffsets] = useState<number[]>(existing?.reminderOffsetsMinutes ?? settings?.defaultReminderOffsetsMinutes ?? [1440, 120]);
  const [advance, setAdvance] = useState(!existing && (app.status === 'applied' || app.status === 'saved'));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const urlOk = !url || /^https?:\/\/\S+$/i.test(url.trim());
  const finalTitle = title.trim() || ASSESSMENT_TYPE_LABELS[type];

  const save = () =>
    submit(async () => {
      const body = { type, title: finalTitle, url: url.trim() || null, dueAt: due.iso, timezone: due.timezone, reminderOffsetsMinutes: [...offsets].sort((a, b) => b - a), notes: notes || null };
      if (existing) await api.updateAssessment(app.id, existing.id, body);
      else await api.addAssessment(app.id, body);
      if (advance) await api.setStatus(app.id, 'assessment');
      onDone(existing ? 'Assessment updated — reminders will be rescheduled' : 'Assessment added');
    });

  return (
    <Dialog
      title={existing ? 'Edit assessment' : 'Add OA / HireVue'}
      description={`${app.title} · ${app.company}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {existing && (
            confirmDelete ? (
              <button type="button" className="btn btn-danger-solid" disabled={busy} onClick={() => void submit(async () => { await api.removeAssessment(app.id, existing.id); onDone('Assessment removed'); })}>Confirm remove</button>
            ) : (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Remove</button>
            )
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || due.incomplete || !due.iso || !urlOk} onClick={() => void save()}>
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Add assessment'}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <div className="field">
          <label htmlFor="a-type">Type</label>
          <select id="a-type" className="select" value={type} onChange={(e) => setType(e.target.value as AssessmentType)}>
            {ASSESSMENT_TYPES.map((t) => <option key={t} value={t}>{ASSESSMENT_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="a-title">Title</label>
          <input id="a-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={ASSESSMENT_TYPE_LABELS[type]} />
        </div>
      </div>
      <DateTimeField label="Due" required initialIso={existing?.dueAt ?? null} initialTimezone={existing?.timezone ?? tz} displayTimezone={tz} onChange={setDue} />
      <div className="field">
        <label htmlFor="a-url">Assessment link</label>
        <input id="a-url" className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-invalid={!urlOk} />
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 5 }}>Browser reminders</legend>
        <div className="chips">
          {OFFSET_CHOICES.map((o) => (
            <button key={o} type="button" className="chip-toggle" aria-pressed={offsets.includes(o)} onClick={() => setOffsets(offsets.includes(o) ? offsets.filter((x) => x !== o) : [...offsets, o])}>
              {describeOffset(o)}
            </button>
          ))}
        </div>
        <span className="hint">Shown by the paired extension when Chrome is running and notifications are allowed. Reminders already in the past are skipped. The due list here is always the source of truth.</span>
      </fieldset>
      <div className="field">
        <label htmlFor="a-notes">Notes</label>
        <textarea id="a-notes" className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {!existing && app.status !== 'assessment' && (
        <label className="check"><input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} /> Also set status to OA/HireVue</label>
      )}
      <ErrorBanner error={error} />
    </Dialog>
  );
}
