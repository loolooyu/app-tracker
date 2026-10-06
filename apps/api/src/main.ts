import { loadConfig } from './config.js';
import { buildServer } from './server.js';

async function main() {
  const config = loadConfig();
  const server = await buildServer(config);
  try {
    // Loopback only. Never 0.0.0.0: this server holds your resumes.
    await server.app.listen({ host: config.host, port: config.port });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Is Appfolio already running? Use --port <n> or APPFOLIO_PORT to choose another.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
  const url = `http://127.0.0.1:${config.port}`;
  console.log(`\nAppfolio is running at ${url}`);
  console.log(`Data directory: ${config.dataDir}`);
  if (!config.webDist) console.log('Dev mode: open the dashboard at http://localhost:5173');
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

void main();
