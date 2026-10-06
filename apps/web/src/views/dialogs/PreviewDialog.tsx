import type { DocumentRecord } from '@appfolio/shared';
import { Dialog } from '../../components/Dialog';
import { IconDownload } from '../../components/Icons';
import { urls } from '../../lib/api';
import { formatBytes } from '../../lib/format';

/** PDFs open in the browser's built-in viewer; other types download. */
export function PreviewDialog({ doc, onClose }: { doc: DocumentRecord; onClose: () => void }) {
  const isPdf = doc.mimeType === 'application/pdf';
  return (
    <Dialog
      title={doc.label}
      description={`${doc.originalFilename} · ${formatBytes(doc.byteSize)} · SHA-256 ${doc.contentHash.slice(0, 12)}…`}
      onClose={onClose}
      wide
      footer={
        <>
          <a className="btn" href={urls.documentFile(doc.id)} download={doc.originalFilename}><IconDownload /> Download original</a>
          <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
        </>
      }
    >
      {isPdf ? (
        <>
          <iframe title={`Preview of ${doc.originalFilename}`} src={urls.documentFile(doc.id, true)} style={{ width: '100%', height: '70vh', border: '1px solid var(--border)', borderRadius: 8 }} />
          <p className="small muted">If the preview is blank, your browser’s PDF viewer may be turned off. Download the original instead — it’s byte-for-byte the file you uploaded.</p>
        </>
      ) : (
        <div className="banner">
          <span>Preview isn’t available for DOCX files. Download the original to open it in Word, Pages or Google Docs.</span>
        </div>
      )}
    </Dialog>
  );
}
