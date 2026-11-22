import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify(entry));
}

const config = loadConfig(process.env);
const pkg = JSON.parse(readFileSync(here('../package.json'), 'utf8')) as { version: string };

// src/ and dist/ both sit one level below apps/server, so this resolves to apps/client/dist.
const clientDir = config.clientDir ?? here('../../client/dist');

const app = createApp({ clientDir, version: pkg.version, log });
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  log({
    time: new Date().toISOString(),
    level: 'info',
    msg: 'listening',
    port: info.port,
    dataDir: config.dataDir,
    clientDir,
  });
});

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  log({ time: new Date().toISOString(), level: 'info', msg: 'shutting down', signal });
  // Stop the tick loop and close SQLite here once src/game/ exists.
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close(() => process.exit(0));
  if ('closeIdleConnections' in server) server.closeIdleConnections();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
