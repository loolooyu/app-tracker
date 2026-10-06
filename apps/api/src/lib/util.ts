import { createHash, randomUUID } from 'node:crypto';

export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const bool = (v: unknown) => v === 1 || v === true;
export const json = <T>(text: unknown, fallback: T): T => {
  if (typeof text !== 'string') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};
/** Normalize an ISO instant to canonical UTC form. */
export const toUtcIso = (value: string | null | undefined) => (value ? new Date(value).toISOString() : null);
