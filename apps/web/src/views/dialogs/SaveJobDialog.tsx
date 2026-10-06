import { useEffect, useMemo, useRef, useState } from 'react';
import { JD_LIMITS, PLATFORMS, PLATFORM_LABELS, detectPlatform, jobIdFromUrl, type MatchCandidate, type Platform } from '@appfolio/shared';
import { computeCaptureWarnings } from '@appfolio/shared/extract';
import { Dialog } from '../../components/Dialog';
import { StatusBadge } from '../../components/StatusBadge';
import { api } from '../../lib/api';
import { href } from '../../lib/route';
import { ErrorBanner, useSubmit } from './useSubmit';

/**
 * Manual entry: the fallback for any site the extension can't read. Saves as Saved (never
 * Applied). Uses the same idempotent capture endpoint as the extension.
 */
export function SaveJobDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const { busy, error, submit } = useSubmit();
  const captureId = useRef(crypto.randomUUID()); // stable across retries/double clicks
  const [f, setF] = useState({ company: '', title: '', location: '', url: '', jobId: '', jobType: '', season: '' });
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [text, setText] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [matches, setMatches] = useState<MatchCandidate[]>([]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const urlOk = !f.url || /^https?:\/\/\S+$/i.test(f.url.trim());
  const detected: Platform = f.url && urlOk ? detectPlatform(f.url.trim()) : 'other';
  const foundOn = platform || detected;
  const warnings = useMemo(() => (text.trim() ? computeCaptureWarnings(text, { method: 'manual_paste' }) : []), [text]);
  const tooLong = text.length > JD_LIMITS.maxChars;
  const canSave = f.company.trim() && f.title.trim() && urlOk && !tooLong && (!text.trim() || reviewed);

  // Suggest existing records (exact URL / job ID first, similar ones only as suggestions).
  useEffect(() => {
    if (!f.company.trim() && !f.url.trim()) return setMatches([]);
    const t = setTimeout(() => {
      api
        .match({
          url: urlOk && f.url.trim() ? f.url.trim() : null,
          platform: foundOn,
          jobId: f.jobId.trim() || (urlOk && f.url ? jobIdFromUrl(f.url.trim(), foundOn) : null),
          company: f.company.trim() || null,
          title: f.title.trim() || null,
          location: f.location.trim() || null,
        })
        .then(setMatches)
        .catch(() => setMatches([]));
    }, 400);
    return () => clearTimeout(t);
  }, [f.company, f.title, f.location, f.url, f.jobId, foundOn, urlOk]);

  const save = () =>
    submit(async () => {
      const r = await api.capture({
        mode: 'new',
        captureId: captureId.current,
        application: {
          company: f.company,
          title: f.title,
          location: f.location || null,
          jobId: f.jobId || (f.url && urlOk ? jobIdFromUrl(f.url.trim(), foundOn) : null),
          jobType: f.jobType || null,
          season: f.season || null,
          foundOn,
          tags: [],
        },
        link: f.url.trim() ? { url: f.url.trim(), platform: foundOn, relationship: 'discovery' } : null,
        snapshot: text.trim() ? { sourceUrl: f.url.trim() || null, rawText: text, reviewedText: text, method: 'manual_paste', warnings, reviewConfirmed: true } : null,
      });
      onSaved(r.applicationId);
    });

  const exact = matches.filter((m) => m.kind !== 'similar');
  return (
    <Dialog
      title="Save a job"
      description={
        <>
          Fastest: open the job page and click the Appfolio extension (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>). Or enter it here — it’s saved as <strong>Saved</strong>, not Applied.
        </>
      }
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || !canSave} onClick={() => void save()}>
            {busy ? 'Saving…' : matches.length ? 'Save as a separate application' : 'Save job'}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <div className="field"><label htmlFor="j-company">Company *</label><input id="j-company" className="input" value={f.company} onChange={set('company')} data-autofocus /></div>
        <div className="field"><label htmlFor="j-title">Job title *</label><input id="j-title" className="input" value={f.title} onChange={set('title')} /></div>
        <div className="field"><label htmlFor="j-loc">Location</label><input id="j-loc" className="input" value={f.location} onChange={set('location')} /></div>
        <div className="field"><label htmlFor="j-type">Job type</label><input id="j-type" className="input" value={f.jobType} onChange={set('jobType')} placeholder="Co-op, internship…" /></div>
        <div className="field">
          <label htmlFor="j-url">Posting URL</label>
          <input id="j-url" className="input" type="url" value={f.url} onChange={set('url')} placeholder="https://…" aria-invalid={!urlOk} />
          {!urlOk && <span className="error-text">Enter a full http(s) URL.</span>}
        </div>
        <div className="field">
          <label htmlFor="j-plat">Found on</label>
          <select id="j-plat" className="select" value={platform} onChange={(e) => setPlatform(e.target.value as Platform | '')}>
            <option value="">{f.url ? `Detect from URL (${PLATFORM_LABELS[detected]})` : 'Choose…'}</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="j-id">Job / requisition ID</label><input id="j-id" className="input" value={f.jobId} onChange={set('jobId')} /></div>
        <div className="field"><label htmlFor="j-season">Season</label><input id="j-season" className="input" value={f.season} onChange={set('season')} placeholder="Spring 2027" /></div>
      </div>

      {matches.length > 0 && (
        <div className={`banner ${exact.length ? 'warn' : ''}`} role="status">
          <div className="stack-sm" style={{ width: '100%' }}>
            <strong>{exact.length ? 'This job may already be saved' : 'Possibly related records'}</strong>
            <span className="small">Nothing is merged automatically. Open one to link this page to it, or save separately (for example, a different office or season).</span>
            <ul className="link-list">
              {matches.slice(0, 4).map((m) => (
                <li key={m.application.id} className="link-item">
                  <span className="grow">
                    <span style={{ fontWeight: 650 }}>{m.application.title} · {m.application.company}</span>
                    <span className="small muted">{m.reasons.join(' · ')}{m.application.location ? ` · ${m.application.location}` : ''}</span>
                  </span>
                  <StatusBadge status={m.application.status} />
                  <a className="btn btn-sm" href={href({ view: 'applications', id: m.application.id })} onClick={onClose}>Open</a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="j-text">Job description</label>
        <textarea id="j-text" className="textarea jd" value={text} onChange={(e) => { setText(e.target.value); setReviewed(false); }} placeholder="Paste the full job description — responsibilities, qualifications, pay, and application instructions." aria-invalid={tooLong} />
        <span className="hint">
          {text.length.toLocaleString()} characters.{' '}
          {tooLong ? `Over the ${JD_LIMITS.maxChars.toLocaleString()}-character limit — remove unrelated content; nothing is cut automatically.` : 'You can add it later, but postings disappear — saving it now is safer.'}
        </span>
      </div>
      {warnings.length > 0 && <div className="banner warn" role="status"><span><strong>Check before saving:</strong> {warnings.join(' ')}</span></div>}
      {text.trim() && (
        <label className="check"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I reviewed this text and it’s the full job description</label>
      )}
      <ErrorBanner error={error} />
    </Dialog>
  );
}
