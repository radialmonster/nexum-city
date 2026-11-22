import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { MiddlewareHandler } from 'hono';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function readIfFile(path: string): Promise<Buffer | undefined> {
  try {
    if (!(await stat(path)).isFile()) return undefined;
    return await readFile(path);
  } catch {
    return undefined;
  }
}

/**
 * Serve the built client. A path with a file extension that does not exist is a
 * 404; any other unknown path gets `index.html` so client-side routes (`/kit`) work.
 * `/api` paths are never handled here.
 */
export function serveClient(clientDir: string): MiddlewareHandler {
  const root = resolve(clientDir);
  return async (c, next) => {
    const path = c.req.path;
    if (
      (c.req.method !== 'GET' && c.req.method !== 'HEAD') ||
      path === '/api' ||
      path.startsWith('/api/')
    ) {
      return next();
    }
    let rel: string;
    try {
      rel = normalize(decodeURIComponent(path));
    } catch {
      return c.text('Bad request', 400);
    }
    const file = join(root, rel);
    if (file !== root && !file.startsWith(root + sep)) return c.text('Not found', 404);

    const ext = extname(file);
    const hit = ext ? await readIfFile(file) : undefined;
    if (hit) {
      // Vite fingerprints everything under /assets/, so it is safe to cache forever.
      const cache = path.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
      return c.body(new Uint8Array(hit), 200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': cache,
      });
    }
    if (ext) return c.text('Not found', 404);

    const index = await readIfFile(join(root, 'index.html'));
    if (!index) return c.text('Client not built', 404);
    return c.body(new Uint8Array(index), 200, {
      'Content-Type': MIME['.html'] ?? 'text/html',
      'Cache-Control': 'no-cache',
    });
  };
}
