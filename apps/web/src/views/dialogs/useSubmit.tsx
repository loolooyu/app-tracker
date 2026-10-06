import { useCallback, useState } from 'react';
import { useApp } from '../../lib/app-context';

/** Busy/error state for a dialog's primary action. */
export function useSubmit() {
  const { reportError } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(reportError(e));
      } finally {
        setBusy(false);
      }
    },
    [reportError],
  );
  return { busy, error, setError, submit };
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="banner error" role="alert">
      <span>{error}</span>
    </div>
  );
}
