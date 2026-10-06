import { useMemo, useState } from 'react';
import { LINK_RELATIONSHIPS, LINK_RELATIONSHIP_LABELS, PLATFORMS, PLATFORM_LABELS, detectPlatform, type ApplicationDetail, type LinkRelationship, type Platform } from '@appfolio/shared';
import { Dialog } from '../../components/Dialog';
import { api } from '../../lib/api';
import { ErrorBanner, useSubmit } from './useSubmit';

export function AddLinkDialog({ app, onClose, onDone }: { app: ApplicationDetail; onClose: () => void; onDone: (message: string) => void }) {
  const { busy, error, setError, submit } = useSubmit();
  const [url, setUrl] = useState('');
  const detected = useMemo(() => (url ? detectPlatform(url) : 'other'), [url]);
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [relationship, setRelationship] = useState<LinkRelationship>('application');
  const [setThrough, setSetThrough] = useState(!app.appliedThrough);
  const valid = /^https?:\/\/\S+$/i.test(url.trim());
  const effective = platform || detected;

  return (
    <Dialog
      title="Link another URL"
      description="For example the company’s Workday page where you actually applied. Links only record the route; they don’t change status."
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
                const r = await api.addLink(app.id, { url: url.trim(), platform: effective, relationship });
                if (relationship === 'application' && setThrough && app.appliedThrough !== effective) await api.update(app.id, { appliedThrough: effective });
                onDone(r.existed ? 'That URL was already linked to this application' : 'Link added');
              })
            }
          >
            {busy ? 'Saving…' : 'Add link'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="l-url">URL *</label>
        <input id="l-url" className="input" type="url" value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }} placeholder="https://company.wd1.myworkdayjobs.com/…" aria-invalid={!!url && !valid} />
        {url && !valid && <span className="error-text">Enter a full http(s) URL.</span>}
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="l-plat">Platform</label>
          <select id="l-plat" className="select" value={platform} onChange={(e) => setPlatform(e.target.value as Platform | '')}>
            <option value="">Detect from URL ({PLATFORM_LABELS[detected]})</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="l-rel">This page is</label>
          <select id="l-rel" className="select" value={relationship} onChange={(e) => setRelationship(e.target.value as LinkRelationship)}>
            {LINK_RELATIONSHIPS.map((r) => <option key={r} value={r}>{LINK_RELATIONSHIP_LABELS[r]}</option>)}
          </select>
        </div>
      </div>
      {relationship === 'application' && (
        <label className="check"><input type="checkbox" checked={setThrough} onChange={(e) => setSetThrough(e.target.checked)} /> Set “Applied through” to {PLATFORM_LABELS[effective]}</label>
      )}
      <p className="small muted">“Found on” stays {PLATFORM_LABELS[app.foundOn]}. The URL is stored exactly as entered.</p>
      <ErrorBanner error={error} />
    </Dialog>
  );
}
