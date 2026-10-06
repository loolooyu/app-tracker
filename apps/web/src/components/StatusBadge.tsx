import type { Status } from '@appfolio/shared';
import { statusLabel } from '../lib/format';

/** Status is always shown as text; color only reinforces it. */
export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge st-${status}`}>{statusLabel(status)}</span>;
}
