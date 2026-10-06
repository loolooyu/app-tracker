import { useEffect, useState } from 'react';
import { CAPTURE_METHOD_LABELS, type ApplicationDetail, type Snapshot } from '@appfolio/shared';
import { Dialog } from '../../components/Dialog';
import { IconDownload, IconExternal } from '../../components/Icons';
import { useToast } from '../../components/Toasts';
import { api, urls } from '../../lib/api';
import { useApp } from '../../lib/app-context';
import { formatDateTime, safeHref } from '../../lib/format';

/** Reads the stored snapshot only. It never fetches the original posting. */
export function JDReaderDialog({ app, onClose, onPrimaryChanged }: { app: ApplicationDetail; onClose: () => void; onPrimaryChanged: (a: ApplicationDetail) => void }) {
  const { tz, reportError } = useApp();
  const { notify } = useToast();
  const [snapId, setSnapId] = useState(app.primarySnapshotId ?? app.snapshots[app.snapshots.length - 1]?.id ?? null);
  const [snap, setSnap] = useState<Snapshot | null>(app.primarySnapshot);
  const [version, setVersion] = useState<'reviewed' | 'raw'>('reviewed');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!snapId) return;
    if (snap?.id === snapId) return;
    setSnap(null);
    api.snapshot(snapId).then(setSnap).catch((e) => setLoadError(reportError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapId]);

  const text = snap ? (version === 'raw' ? snap.rawText : snap.reviewedText) : '';
  const source = safeHref(snap?.sourceUrl);
  return (
    <Dialog
      title={`${app.title} — ${app.company}`}
      description="Saved job description (from your local archive)"
      onClose={onClose}
      wide
      footer={
        <>
          {source && (
            <a className="btn" href={source} target="_blank" rel="noopener noreferrer" title="The live posting may have expired">
              Open original posting <IconExternal />
            </a>
          )}
          <span className="spacer" />
          {snap && (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => navigator.clipboard.writeText(text).then(() => notify('Copied to clipboard'), () => notify('Copy failed — select the text instead', 'error'))}
              >
                Copy text
              </button>
              <a className="btn" href={urls.snapshotDownload(snap.id, version)} download><IconDownload /> Download .txt</a>
            </>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
        </>
      }
    >
      {app.snapshots.length > 1 && (
        <div className="row">
          <label htmlFor="snap-sel" className="small" style={{ fontWeight: 600 }}>Snapshot</label>
          <select id="snap-sel" className="select" style={{ width: 'auto', flex: 1 }} value={snapId ?? ''} onChange={(e) => { setSnapId(e.target.value); setVersion('reviewed'); }}>
            {app.snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {formatDateTime(s.capturedAt, tz)} · {CAPTURE_METHOD_LABELS[s.method]} · {s.charCount.toLocaleString()} chars{s.id === app.primarySnapshotId ? ' · primary' : ''}
              </option>
            ))}
          </select>
          {snapId && snapId !== app.primarySnapshotId && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                try {
                  onPrimaryChanged(await api.update(app.id, { primarySnapshotId: snapId }));
                } catch (e) {
                  notify(reportError(e), 'error');
                }
              }}
            >
              Make primary
            </button>
          )}
        </div>
      )}
      {loadError && <div className="banner error" role="alert"><span>{loadError}</span></div>}
      {!snap && !loadError && <div className="skeleton" style={{ height: 200 }} aria-busy="true" />}
      {snap && (
        <>
          <div className="row small muted">
            <span>Saved {formatDateTime(snap.capturedAt, tz)}</span>
            <span aria-hidden="true">·</span>
            <span>{CAPTURE_METHOD_LABELS[snap.method]}</span>
            {snap.sourceUrl && <><span aria-hidden="true">·</span><span className="truncate" style={{ maxWidth: 360 }} title={snap.sourceUrl}>{snap.sourceUrl}</span></>}
          </div>
          {snap.edited && (
            <div className="row" role="group" aria-label="Which version to show">
              <button type="button" className="chip-toggle" aria-pressed={version === 'reviewed'} onClick={() => setVersion('reviewed')}>Reviewed version</button>
              <button type="button" className="chip-toggle" aria-pressed={version === 'raw'} onClick={() => setVersion('raw')}>Original capture</button>
              <span className="small muted">You edited this text during review; both are kept.</span>
            </div>
          )}
          {snap.warnings.length > 0 && (
            <details className="small">
              <summary>Capture warnings at save time ({snap.warnings.length})</summary>
              <ul>{snap.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}
          {/* Plain text only: captured content is never rendered as HTML. */}
          <div className="jd-full" tabIndex={0} aria-label="Job description text">{text}</div>
        </>
      )}
    </Dialog>
  );
}
