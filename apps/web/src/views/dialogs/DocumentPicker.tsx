import { useEffect, useId, useRef, useState } from 'react';
import { DOCUMENT_TYPE_LABELS, type DocumentRecord, type DocumentType } from '@appfolio/shared';
import { api } from '../../lib/api';
import { useApp } from '../../lib/app-context';
import { formatBytes, formatDate } from '../../lib/format';

interface Props {
  type: DocumentType;
  value: string | null;
  onChange: (id: string | null) => void;
  /** Label for the "none" option. */
  noneLabel: string;
}

/**
 * Choose an existing immutable version or upload the exact file you submitted.
 * Nothing is preselected: we never guess which resume you sent.
 */
export function DocumentPicker({ type, value, onChange, noneLabel }: Props) {
  const { tz, reportError, status } = useApp();
  const id = useId();
  const [docs, setDocs] = useState<DocumentRecord[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [label, setLabel] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const maxMb = Math.round((status?.maxUploadBytes ?? 20 * 1048576) / 1048576);

  useEffect(() => {
    api.documents(undefined, type).then(setDocs).catch((e) => setMessage({ kind: 'error', text: reportError(e) }));
  }, [type, reportError]);

  const upload = async (file: File) => {
    setUploading(true);
    setMessage(null);
    try {
      const r = await api.uploadDocument(file, type, label || undefined);
      setDocs((d) => (d && !d.some((x) => x.id === r.document.id) ? [r.document, ...d] : d));
      onChange(r.document.id);
      setMessage(
        r.reused
          ? { kind: 'info', text: `This file is byte-for-byte identical to “${r.document.label}” (uploaded ${formatDate(r.document.createdAt, tz)}). Using that existing version; its label was not changed.` }
          : { kind: 'ok', text: `Uploaded “${r.document.label}”.` },
      );
      setLabel('');
    } catch (e) {
      setMessage({ kind: 'error', text: reportError(e) });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const noun = DOCUMENT_TYPE_LABELS[type].toLowerCase();
  return (
    <div className="stack-sm">
      <div className="field">
        <label htmlFor={`${id}-sel`}>Choose a saved {noun} version</label>
        <select id={`${id}-sel`} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} disabled={!docs}>
          <option value="">{docs ? noneLabel : 'Loading…'}</option>
          {docs?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} — {d.originalFilename} ({formatBytes(d.byteSize)}, {formatDate(d.createdAt, tz)})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="label">…or upload the exact file you submitted</span>
        <div className="grid-2">
          <input aria-label={`Label for the new ${noun} (optional)`} className="input" placeholder="Label (optional), e.g. Robotics v3" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input
            ref={fileRef}
            aria-label={`Upload ${noun} file (PDF or DOCX)`}
            className="input"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
        </div>
        <span className="hint">PDF or DOCX, up to {maxMb} MB. The file is stored unchanged; a new upload is always a new version.</span>
      </div>
      {uploading && <span className="small muted" role="status"><span className="spinner" /> Uploading…</span>}
      {message && <div className={`banner ${message.kind === 'error' ? 'error' : message.kind === 'ok' ? 'ok' : ''}`} role={message.kind === 'error' ? 'alert' : 'status'}><span>{message.text}</span></div>}
    </div>
  );
}
