import { DEFAULT_REMINDER_OFFSETS_MINUTES, type Settings } from '@appfolio/shared';
import { transaction } from '../db/index.js';
import type { Ctx } from './core.js';

export function getSettings(ctx: Ctx): Settings {
  const rows = ctx.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
  return {
    timezone: (map.get('timezone') as string | null | undefined) ?? null,
    defaultReminderOffsetsMinutes: (map.get('defaultReminderOffsetsMinutes') as number[] | undefined) ?? DEFAULT_REMINDER_OFFSETS_MINUTES,
  };
}

export function updateSettings(ctx: Ctx, patch: Partial<Settings>): Settings {
  transaction(ctx.db, () => {
    const upsert = ctx.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) upsert.run(k, JSON.stringify(v));
  });
  return getSettings(ctx);
}
