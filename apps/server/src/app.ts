import { Hono } from 'hono';
import { serveClient } from './static.js';

export interface AppOptions {
  /** Directory of the built client; omit to serve the API only. */
  readonly clientDir?: string;
  readonly version: string;
  /** Called with one JSON-serialisable record per request. */
  readonly log?: (entry: Record<string, unknown>) => void;
  /** Injectable for tests. */
  readonly now?: () => number;
}

export function createApp(options: AppOptions): Hono {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const app = new Hono();

  app.use(async (c, next) => {
    const t0 = now();
    await next();
    options.log?.({
      time: new Date(t0).toISOString(),
      level: 'info',
      msg: 'request',
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: now() - t0,
    });
  });

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      version: options.version,
      uptimeS: Math.floor((now() - startedAt) / 1000),
    }),
  );

  // Future game API routes mount here (see src/game/).
  app.all('/api/*', (c) => c.json({ ok: false, error: 'not_found' }, 404));

  if (options.clientDir) app.use(serveClient(options.clientDir));

  app.notFound((c) => c.text('Not found', 404));
  app.onError((err, c) => {
    options.log?.({
      time: new Date(now()).toISOString(),
      level: 'error',
      msg: err.message,
      path: c.req.path,
    });
    return c.json({ ok: false, error: 'internal' }, 500);
  });
  return app;
}
