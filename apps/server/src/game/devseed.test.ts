import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDevClock } from './devseed.js';
import { createGame } from './index.js';
import type { Game } from './index.js';

const T0 = Date.UTC(2026, 10, 22, 12, 0, 0);
const dirs: string[] = [];
const games: Game[] = [];

afterEach(() => {
  for (const g of games.splice(0)) g.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function boot(dev: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'nexum-dev-'));
  dirs.push(dir);
  const clock = createDevClock(() => T0);
  const game = createGame({
    dataDir: dir,
    now: clock.now,
    tickMs: 2000,
    snapshotMs: 300_000,
    seed: 7,
    cookieSecure: false,
    trustProxy: false,
  });
  games.push(game);
  const app = createApp({ version: 't', game, ...(dev ? { dev: clock } : {}) });
  return { app, game, clock };
}

const post = (app: ReturnType<typeof boot>['app'], path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('dev seed routes', () => {
  it('is off by default: the config flag is false and the routes do not exist', async () => {
    expect(loadConfig({}).devSeed).toBe(false);
    expect(loadConfig({ DEV_SEED: 'true' }).devSeed).toBe(true);
    const { app } = boot(false);
    expect((await post(app, '/api/dev/seed', {})).status).toBe(404);
    expect((await post(app, '/api/dev/advance', { hours: 1 })).status).toBe(404);
  });

  it('seeds bots and fast-forwards the game clock when enabled', async () => {
    const { app, game, clock } = boot(true);
    const res = await post(app, '/api/dev/seed', { bots: 2, hours: 6 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bots: { username: string }[]; nowMs: number };
    expect(body.bots).toHaveLength(2);
    expect(clock.offsetMs()).toBe(6 * 3_600_000);
    expect(game.engine.current.nowMs).toBe(T0 + 6 * 3_600_000);
    expect(Object.keys(game.engine.current.players)).toHaveLength(2);
    // Seeding again reuses the same bot accounts.
    const again = await post(app, '/api/dev/seed', { bots: 2, hours: 0 });
    expect(((await again.json()) as { bots: unknown[] }).bots).toHaveLength(2);
    expect(Object.keys(game.engine.current.players)).toHaveLength(2);
    const adv = await post(app, '/api/dev/advance', { hours: 2 });
    expect(((await adv.json()) as { nowMs: number }).nowMs).toBe(T0 + 8 * 3_600_000);
  });
});
