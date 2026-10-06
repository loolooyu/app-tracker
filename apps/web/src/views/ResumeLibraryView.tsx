import { useCallback, useEffect, useRef, useState } from 'react';
import { DOCUMENT_TYPE_LABELS, type DocumentRecord, type DocumentType } from '@appfolio/shared';
import { api, urls } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatBytes, formatDate } from '../lib/format';
import { href } from '../lib/route';
import { IconDownload, IconSearch } from '../components/Icons';
import { useToast } from '../components/Toasts';
import { Dialog } from '../components/Dialog';
import { PreviewDialog } from './dialogs/PreviewDialog';
import { ConfirmDialog } from './dialogs/ConfirmDialog';

export function ResumeLibraryView() {
  const { tz, version, reportError, status, connection } = useApp();
  const { notify } = useToast();
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<DocumentRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [type, setType] = useState<DocumentType>('resume');
  const [label, setLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<DocumentRecord | null>(null);
  const [renaming, setRenaming] = useState<DocumentRecord | null>(null);
  const [deleting, setDeleting] = useState<DocumentRecord | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const maxMb = Math.round((status?.maxUploadBytes ?? 20 * 1048576) / 1048576);

  const load = useCallback(async () => {
    try {
      setDocs(await api.documents(q || undefined));
      setLoadError(null);
    } catch (e) {
      setLoadError(reportError(e));
    }
  }, [q, reportError]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 150);
    return () => clearTimeout(t);
  }, [load, version]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const r = await api.uploadDocument(file, type, label || undefined);
      notify(r.reused ? `Identical to “${r.document.label}” — no duplicate stored, existing label kept.` : `Uploaded “${r.document.label}”`);
      setLabel('');
      await load();
    } catch (e) {
      notify(reportError(e), 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Resume Library</h1>
          <p className="subtitle">Exact versions, stored unchanged. Each upload is its own version.</p>
        </div>
      </header>

      <section className="card card-pad stack" aria-labelledby="up-h">
        <h2 id="up-h" style={{ fontSize: 18 }}>Add a version</h2>
        <div className="grid-3" style={{ alignItems: 'end' }}>
          <div className="field">
            <label htmlFor="up-type">Type</label>
            <select id="up-type" className="select" value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
              <option value="resume">Resume</option>
              <option value="cover_letter">Cover letter</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="up-label">Label</label>
            <input id="up-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Robotics SWE — v3" />
          </div>
          <div className="field">
            <label htmlFor="up-file">File (PDF or DOCX, up to {maxMb} MB)</label>
            <input
              id="up-file"
              ref={fileRef}
              className="input"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={uploading || connection === 'offline'}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </div>
        </div>
        {uploading && <span className="small muted" role="status"><span className="spinner" /> Uploading…</span>}
      </section>

      <div className="search" style={{ maxWidth: 420 }}>
        <IconSearch />
        <label htmlFor="lib-q" className="sr-only">Search by label or filename</label>
        <input id="lib-q" className="input" type="search" placeholder="Search by label or filename…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loadError && !docs ? (
        <div className="banner error" role="alert"><span>{loadError}</span><button type="button" className="btn btn-sm" onClick={() => void load()}>Retry</button></div>
      ) : !docs ? (
        <div className="lib-grid" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="card lib-card"><div className="skeleton" /><div className="skeleton" style={{ width: '60%' }} /></div>)}</div>
      ) : docs.length === 0 ? (
        <div className="card empty">
          <h2 style={{ fontSize: 20 }}>{q ? 'No files match' : 'No resumes yet'}</h2>
          <p>{q ? `Nothing labelled or named “${q}”.` : 'Upload each version you send out. When you mark an application applied, you’ll pick the exact one.'}</p>
        </div>
      ) : (
        <div className="lib-grid">
          {docs.map((d) => (
            <article key={d.id} className="card lib-card" aria-labelledby={`doc-${d.id}`}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <span className="doc-icon" aria-hidden="true">{d.mimeType === 'application/pdf' ? 'PDF' : 'DOCX'}</span>
                <div style={{ flex: 1, minWidth: 0 }} className="stack-sm">
                  <h3 id={`doc-${d.id}`}>{d.label}</h3>
                  <div className="chips">
                    <span className="badge outline plain">{DOCUMENT_TYPE_LABELS[d.type]}</span>
                    {d.isDemo && <span className="badge demo plain">Demo</span>}
                  </div>
                </div>
              </div>
              <dl className="kv small" style={{ gridTemplateColumns: '90px 1fr' }}>
                <dt>File</dt><dd>{d.originalFilename}</dd>
                <dt>Uploaded</dt><dd>{formatDate(d.createdAt, tz)}</dd>
                <dt>Size</dt><dd>{formatBytes(d.byteSize)}</dd>
                <dt>SHA-256</dt><dd className="mono" title={d.contentHash}>{d.contentHash.slice(0, 16)}…</dd>
              </dl>
              <div className="stack-sm">
                <span className="small" style={{ fontWeight: 650 }}>
                  {d.linkedApplications.length ? `Submitted to ${d.linkedApplications.length} application${d.linkedApplications.length === 1 ? '' : 's'}` : 'Not linked to any application'}
                </span>
                {d.linkedApplications.length > 0 && (
                  <ul className="link-list">
                    {d.linkedApplications.map((a) => (
                      <li key={a.id + a.as}>
                        <a href={href({ view: 'applications', id: a.id })} className="small">{a.company} — {a.title}</a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="row">
                {d.mimeType === 'application/pdf' && <button type="button" className="btn btn-sm" onClick={() => setPreview(d)}>Preview</button>}
                <a className="btn btn-sm" href={urls.documentFile(d.id)} download={d.originalFilename}><IconDownload /> Download</a>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRenaming(d)}>Rename</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDeleting(d)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {preview && <PreviewDialog doc={preview} onClose={() => setPreview(null)} />}
      {renaming && <RenameDialog doc={renaming} onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); void load(); notify('Label updated'); }} />}
      {deleting && (deleting.linkedApplications.length > 0 ? (
        <Dialog title="This file is in use" onClose={() => setDeleting(null)} footer={<button type="button" className="btn btn-primary" onClick={() => setDeleting(null)}>OK</button>}>
          <p>
            <strong>{deleting.label}</strong> is the submitted {DOCUMENT_TYPE_LABELS[deleting.type].toLowerCase()} for these applications. It can’t be deleted while they reference it, so the record of what you sent stays intact:
          </p>
          <ul>
            {deleting.linkedApplications.map((a) => (
              <li key={a.id}><a href={href({ view: 'applications', id: a.id })} onClick={() => setDeleting(null)}>{a.company} — {a.title}</a></li>
            ))}
          </ul>
          <p className="small muted">To delete it, open each application and choose a different file (or unlink it) first.</p>
        </Dialog>
      ) : (
        <ConfirmDialog
          title="Delete this file?"
          confirmLabel="Delete file"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteDocument(deleting.id);
            setDeleting(null);
            notify('File deleted');
            await load();
          }}
        >
          <p><strong>{deleting.label}</strong> ({deleting.originalFilename}) isn’t linked to any application. Deleting removes the stored bytes permanently.</p>
        </ConfirmDialog>
      ))}
    </>
  );
}

function RenameDialog({ doc, onClose, onDone }: { doc: DocumentRecord; onClose: () => void; onDone: () => void }) {
  const { reportError } = useApp();
  const [label, setLabel] = useState(doc.label);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="Rename label"
      description="Only the label changes. The file and its contents stay exactly as uploaded."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!label.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.renameDocument(doc.id, label.trim());
                onDone();
              } catch (e) {
                setError(reportError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save label
          </button>
        </>
      }
    >
      <div className="field"><label htmlFor="rn">Label</label><input id="rn" className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
      {error && <div className="banner error" role="alert"><span>{error}</span></div>}
    </Dialog>
  );
}
