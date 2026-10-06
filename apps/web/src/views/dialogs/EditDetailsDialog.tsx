import { useState } from 'react';
import { PLATFORMS, PLATFORM_LABELS, type ApplicationDetail, type Platform } from '@appfolio/shared';
import { Dialog } from '../../components/Dialog';
import { DateTimeField, type DateTimeValue } from '../../components/DateTimeField';
import { api } from '../../lib/api';
import { useApp } from '../../lib/app-context';
import { ErrorBanner, useSubmit } from './useSubmit';

export function EditDetailsDialog({ app, onClose, onDone }: { app: ApplicationDetail; onClose: () => void; onDone: (a: ApplicationDetail) => void }) {
  const { tz } = useApp();
  const { busy, error, submit } = useSubmit();
  const [f, setF] = useState({
    company: app.company,
    title: app.title,
    location: app.location ?? '',
    jobType: app.jobType ?? '',
    program: app.program ?? '',
    season: app.season ?? '',
    jobId: app.jobId ?? '',
    foundOn: app.foundOn,
    appliedThrough: (app.appliedThrough ?? '') as Platform | '',
    tags: app.tags.join(', '),
  });
  const [submitted, setSubmitted] = useState<DateTimeValue>({ iso: app.submittedAt, timezone: tz, incomplete: false });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const valid = f.company.trim() && f.title.trim() && !submitted.incomplete;

  return (
    <Dialog
      title="Edit details"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !valid}
            onClick={() =>
              void submit(async () => {
                const patch: Record<string, unknown> = {
                  company: f.company,
                  title: f.title,
                  location: f.location,
                  jobType: f.jobType,
                  program: f.program,
                  season: f.season,
                  jobId: f.jobId,
                  foundOn: f.foundOn,
                  appliedThrough: f.appliedThrough || null,
                  tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
                };
                if (submitted.iso !== app.submittedAt) patch.submittedAt = submitted.iso;
                onDone(await api.update(app.id, patch));
              })
            }
          >
            {busy ? 'Saving…' : 'Save details'}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <div className="field"><label htmlFor="e-company">Company *</label><input id="e-company" className="input" value={f.company} onChange={set('company')} aria-invalid={!f.company.trim()} /></div>
        <div className="field"><label htmlFor="e-title">Title *</label><input id="e-title" className="input" value={f.title} onChange={set('title')} aria-invalid={!f.title.trim()} /></div>
        <div className="field"><label htmlFor="e-loc">Location</label><input id="e-loc" className="input" value={f.location} onChange={set('location')} /></div>
        <div className="field"><label htmlFor="e-type">Job type</label><input id="e-type" className="input" value={f.jobType} onChange={set('jobType')} placeholder="Co-op, internship, full-time…" /></div>
        <div className="field"><label htmlFor="e-prog">Program</label><input id="e-prog" className="input" value={f.program} onChange={set('program')} /></div>
        <div className="field"><label htmlFor="e-season">Season</label><input id="e-season" className="input" value={f.season} onChange={set('season')} placeholder="Spring 2027" /></div>
        <div className="field"><label htmlFor="e-jobid">Job / requisition ID</label><input id="e-jobid" className="input" value={f.jobId} onChange={set('jobId')} /></div>
        <div className="field"><label htmlFor="e-tags">Tags</label><input id="e-tags" className="input" value={f.tags} onChange={set('tags')} placeholder="comma, separated" /></div>
        <div className="field">
          <label htmlFor="e-found">Found on</label>
          <select id="e-found" className="select" value={f.foundOn} onChange={set('foundOn')}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="e-through">Applied through</label>
          <select id="e-through" className="select" value={f.appliedThrough} onChange={set('appliedThrough')}>
            <option value="">Not recorded</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
          </select>
        </div>
      </div>
      {app.submittedAt && (
        <DateTimeField label="Submission date (correction)" initialIso={app.submittedAt} initialTimezone={tz} displayTimezone={tz} onChange={setSubmitted} defaultTime="12:00" />
      )}
      <ErrorBanner error={error} />
    </Dialog>
  );
}
