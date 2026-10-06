import { useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { ErrorBanner, useSubmit } from './useSubmit';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** If set, the user must type this text to enable the confirm button. */
  requireText?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function ConfirmDialog({ title, children, confirmLabel, danger, requireText, onConfirm, onClose }: Props) {
  const { busy, error, submit } = useSubmit();
  const [typed, setTyped] = useState('');
  const ok = !requireText || typed.trim() === requireText.trim();
  return (
    <Dialog
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy} data-autofocus>Cancel</button>
          <button type="button" className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={!ok || busy} onClick={() => void submit(onConfirm)}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {children}
      {requireText && (
        <div className="field">
          <label htmlFor="confirm-text">Type <strong>{requireText}</strong> to confirm</label>
          <input id="confirm-text" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      )}
      <ErrorBanner error={error} />
    </Dialog>
  );
}
