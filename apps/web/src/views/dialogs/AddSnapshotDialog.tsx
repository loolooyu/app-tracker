import { useMemo, useState } from 'react';
import { JD_LIMITS, type ApplicationDetail } from '@appfolio/shared';
import { computeCaptureWarnings } from '@appfolio/shared/extract';
import { Dialog } from '../../components/Dialog';
import { api } from '../../lib/api';
import { ErrorBanner, useSubmit } from './useSubmit';

export function AddSnapshotDialog({ app, onClose, onDone }: { app: ApplicationDetail; onClose: () => void; onDone: (message: string) => void }) {
  const { busy, error, submit } = useSubmit();
  const [text, setText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [makePrimary, setMakePrimary] = useState(!app.primarySnapshotId);
  const warnings = useMemo(() => (text.trim() ? computeCaptureWarnings(text, { method: 'manual_paste' }) : []), [text]);
  const tooLong = text.length > JD_LIMITS.maxChars;
  const urlOk = !sourceUrl || /^https?:\/\/\S+$/i.test(sourceUrl.trim());

  return (
    <Dialog
      title="Add a job description snapshot"
      description="Paste the full description. Earlier snapshots are kept unchanged; this adds a new dated one."
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !text.trim() || !reviewed || tooLong || !urlOk}
            onClick={() =>
              void submit(async () => {
                const r = await api.addSnapshot(app.id, {
                  snapshot: { sourceUrl: sourceUrl.trim() || null, rawText: text, reviewedText: text, method: 'manual_paste', warnings, reviewConfirmed: true },
                  makePrimary,
                });
                onDone(r.reused ? 'Identical to a snapshot you already saved — nothing was duplicated' : 'Snapshot saved');
              })
            }
          >
            {busy ? 'Saving…' : 'Save snapshot'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="s-text">Job description *</label>
        <textarea id="s-text" className="textarea jd" value={text} onChange={(e) => { setText(e.target.value); setReviewed(false); }} placeholder="Paste the full job description, including qualifications, pay and application instructions." aria-invalid={tooLong} />
        <span className="hint">{text.length.toLocaleString()} characters{tooLong ? ` — over the ${JD_LIMITS.maxChars.toLocaleString()} limit. Remove unrelated content; nothing is cut automatically.` : ''}</span>
      </div>
      {warnings.length > 0 && (
        <div className="banner warn" role="status"><span><strong>Check before saving:</strong> {warnings.join(' ')}</span></div>
      )}
      <div className="field">
        <label htmlFor="s-url">Where it came from (optional)</label>
        <input id="s-url" className="input" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" aria-invalid={!urlOk} />
      </div>
      <label className="check"><input type="checkbox" checked={makePrimary} onChange={(e) => setMakePrimary(e.target.checked)} /> Make this the primary JD shown in the packet</label>
      <label className="check"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I reviewed this text and it’s the full job description</label>
      <ErrorBanner error={error} />
    </Dialog>
  );
}
