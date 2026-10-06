import { useState } from 'react';
import type { ApplicationDetail } from '@appfolio/shared';
import { Dialog } from '../../components/Dialog';
import { api } from '../../lib/api';
import { DocumentPicker } from './DocumentPicker';
import { ErrorBanner, useSubmit } from './useSubmit';

export function AssignDocumentDialog({ app, kind, onClose, onDone }: { app: ApplicationDetail; kind: 'resume' | 'cover_letter'; onClose: () => void; onDone: (a: ApplicationDetail) => void }) {
  const current = kind === 'resume' ? app.submittedResume : app.submittedCoverLetter;
  const [docId, setDocId] = useState<string | null>(current?.id ?? null);
  const [reason, setReason] = useState('');
  const { busy, error, submit } = useSubmit();
  const noun = kind === 'resume' ? 'resume' : 'cover letter';
  const changing = !!current && docId !== current.id;
  return (
    <Dialog
      title={current ? `Correct the submitted ${noun}` : `Record the submitted ${noun}`}
      description={`${app.title} · ${app.company}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || docId === (current?.id ?? null)}
            onClick={() => void submit(async () => onDone(await api.assignDocument(app.id, kind, docId, reason || undefined)))}
          >
            {busy ? 'Saving…' : docId ? `Save ${noun}` : `Unlink ${noun}`}
          </button>
        </>
      }
    >
      {current && (
        <p className="small">
          Currently recorded: <strong>{current.label}</strong> ({current.originalFilename}). Changing it is saved as a correction in the activity history.
        </p>
      )}
      <DocumentPicker type={kind} value={docId} onChange={setDocId} noneLabel={`— No ${noun} —`} />
      {changing && (
        <div className="field">
          <label htmlFor="reason">Reason for the correction (optional)</label>
          <input id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Picked the wrong version earlier" maxLength={500} />
        </div>
      )}
      <ErrorBanner error={error} />
    </Dialog>
  );
}
