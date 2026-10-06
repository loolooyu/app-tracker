import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_MAX_UPLOAD_MB, DEFAULT_PORT } from '@appfolio/shared';

export interface Config {
  dataDir: string;
  host: '127.0.0.1';
  port: number;
  maxUploadBytes: number;
  /** Directory with the built dashboard to serve, or null (dev mode uses Vite). */
  webDist: string | null;
  /** Extra dashboard origins allowed to call the API (only for the Vite dev server). */
  devOrigins: string[];
  /** Upper bound for restore archives (compressed and expanded). */
  maxRestoreBytes: number;
  logLevel: 'info' | 'warn' | 'error' | 'silent';
}

export function defaultDataDir(): string {
  const home = homedir();
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Appfolio');
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Appfolio');
  return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'appfolio');
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(name + '='));
  return eq ? eq.slice(name.length + 1) : undefined;
}

export function loadConfig(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Config {
  const dev = argv.includes('--dev');
  const dataDir = resolve(argValue(argv, '--data-dir') ?? env.APPFOLIO_DATA_DIR ?? defaultDataDir());
  const port = Number(argValue(argv, '--port') ?? env.APPFOLIO_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid port: ${port}`);
  const maxMb = Number(env.APPFOLIO_MAX_UPLOAD_MB ?? DEFAULT_MAX_UPLOAD_MB);
  if (!Number.isFinite(maxMb) || maxMb <= 0 || maxMb > 200) throw new Error(`Invalid APPFOLIO_MAX_UPLOAD_MB: ${env.APPFOLIO_MAX_UPLOAD_MB}`);
  const devOrigins = (env.APPFOLIO_DEV_ORIGINS ?? (dev ? 'http://localhost:5173,http://127.0.0.1:5173' : ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    dataDir,
    host: '127.0.0.1',
    port,
    maxUploadBytes: Math.round(maxMb * 1024 * 1024),
    webDist: dev ? null : resolve(argValue(argv, '--web-dist') ?? env.APPFOLIO_WEB_DIST ?? join(import.meta.dirname, '..', '..', 'web', 'dist')),
    devOrigins,
    maxRestoreBytes: Number(env.APPFOLIO_MAX_RESTORE_MB ?? 2048) * 1024 * 1024,
    logLevel: (env.APPFOLIO_LOG_LEVEL as Config['logLevel']) ?? 'warn',
  };
}
