import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authResponseSchema, seasonsResponseSchema } from '@nexum/contracts';
import { createApp } from '../app.js';
import { createGame } from './index.js';
import type { Game, GameOptions } from './index.js';
import { SNAPSHOT_VERSION, RULES_VERSION, upgradeSnapshot } from './snapshot.js';
import { seasonSeed } from './seasons.js';
import { backupNow } from './backup.js';
import { DatabaseSync } from 'node:sqlite';

const T0 = Date.UTC(2026, 10, 22, 12, 0, 0);
const DAY = 86_400_000;
const dirs: string[] = [];
const games: Game[] = [];

afterEach(() => {
  for (const g of games.splice(0)) {
    try {
      g.stop();
    } catch {
      // already closed by the test
    }
  }
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows may still hold the sqlite file briefly
    }
  }
});

function boot(o: { dir?: string; clock?: { t: number }; extra?: Partial<GameOptions> } = {}) {
  const dir = o.dir ?? mkdtempSync(join(tmpdir(), 'nexum-season-'));
  if (!o.dir) dirs.push(dir);
  const clock = o.clock ?? { t: T0 };
  const logs: Record<string, unknown>[] = [];
  const game = createGame({
    dataDir: dir,
    now: () => clock.t,
    tickMs: 2000,
    snapshotMs: 300_000,
    seed: 7,
    cookieSecure: false,
    trustProxy: false,
    authLimit: { max: 1000, windowMs: 60_000 },
    log: (e) => logs.push(e),
    ...o.extra,
  });
  games.push(game);
  const app = createApp({ version: 'test', game, now: () => clock.t });
  const call = (method: string, path: string, opts: { body?: unknown; token?: string } = {}) =>
    Promise.resolve(
      app.request(path, {
        method,
        headers: {
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(opts.token ? { cookie: `nexum_session=${opts.token}` } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      }),
    );
  return { game, app, clock, dir, call, logs };
}
type H = ReturnType<typeof boot>;

async function register(h: H, username: string) {
  const res = await h.call('POST', '/api/auth/register', {
    body: { username, password: 'correct horse' },
  });
  expect(res.status).toBe(201);
  const m = /nexum_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
  return { token: m?.[1] ?? '', ...authResponseSchema.parse(await res.json()) };
}

describe('snapshot upgrades', () => {
  it('adds the trade fields to a version 0 snapshot without touching the rest', () => {
    const old = {
      nowMs: 5,
      players: { p1: { id: 'p1', credits: 12 }, p2: { id: 'p2', credits: 3, tradeMs: 9 } },
    };
    const up = upgradeSnapshot(old, 0) as unknown as {
      players: Record<string, Record<string, number>>;
    };
    expect(up.players['p1']).toEqual({
      id: 'p1',
      credits: 12,
      tradeMs: 0,
      tradeDay: 0,
      tradeDayMs: 0,
    });
    expect(up.players['p2']?.['tradeMs']).toBe(9);
  });

  it('is a no-op at the current version and rejects newer or malformed input', () => {
    const cur = { players: {} };
    expect(upgradeSnapshot(cur, SNAPSHOT_VERSION)).toBe(cur);
    expect(() => upgradeSnapshot(cur, SNAPSHOT_VERSION + 1)).toThrow(/newer/);
    expect(() => upgradeSnapshot('x', 0)).toThrow();
    expect(() => upgradeSnapshot([], 0)).toThrow();
  });

  it('boots from a legacy snapshot: archives it and starts a new season', async () => {
    const clock = { t: T0 };
    const a = boot({ clock });
    const ada = await register(a, 'Ada');
    // Rewrite the stored snapshot as a legacy one: old shape, version 0, rules version 0.
    const row = a.game.db
      .prepare('SELECT id, state FROM snapshots ORDER BY id DESC LIMIT 1')
      .get() as {
      id: number;
      state: string;
    };
    const legacy = JSON.parse(row.state) as { players: Record<string, Record<string, unknown>> };
    for (const p of Object.values(legacy.players)) {
      delete p['tradeMs'];
      delete p['tradeDay'];
      delete p['tradeDayMs'];
    }
    a.game.db
      .prepare('UPDATE snapshots SET state = ?, version = 0, rules_version = 0 WHERE id = ?')
      .run(JSON.stringify(legacy), row.id);
    a.game.db.prepare('UPDATE snapshots SET version = 0, rules_version = 0').run();
    a.game.engine.shutdown = () => undefined; // stop() would write a current-version snapshot
    a.game.stop();

    clock.t += 60_000;
    const b = boot({ dir: a.dir, clock });
    const seasons = b.game.store.listSeasons();
    expect(seasons).toHaveLength(1);
    expect(seasons[0]?.number).toBe(1);
    expect(seasons[0]?.reason).toBe('rules_change');
    expect(seasons[0]?.rulesVersion).toBe(0);
    expect(b.game.seasons.number()).toBe(2);
    expect(b.logs.some((l) => l['level'] === 'warn')).toBe(true);
    // the account lives on, with a crew in the new world
    const login = await b.call('POST', '/api/auth/login', {
      body: { username: 'Ada', password: 'correct horse' },
    });
    expect(login.status).toBe(200);
    const player = Object.values(b.game.engine.current.players);
    expect(player.length).toBe(1);
    expect(RULES_VERSION).toBeGreaterThan(0);
    expect(ada.account.username).toBe('Ada');
  });

  it('still boots when the stored world is too old to archive', async () => {
    const clock = { t: T0 };
    const a = boot({ clock });
    await register(a, 'Ada');
    const row = a.game.db
      .prepare('SELECT id, state FROM snapshots ORDER BY id DESC LIMIT 1')
      .get() as { id: number; state: string };
    const old = JSON.parse(row.state) as Record<string, unknown>;
    const { season: _s, markets: _m, memory: _y, sieges: _g, ...rest } = old;
    void [_s, _m, _y, _g];
    a.game.db
      .prepare('UPDATE snapshots SET state = ?, version = 0, rules_version = 0 WHERE id = ?')
      .run(JSON.stringify(rest), row.id);
    a.game.engine.shutdown = () => undefined;
    a.game.stop();

    clock.t += 60_000;
    const b = boot({ dir: a.dir, clock });
    expect(b.game.seasons.number()).toBe(2);
    expect(b.game.engine.current.season.endMs).toBeGreaterThan(clock.t);
    expect(b.logs.some((l) => l['msg'] === 'old season could not be archived')).toBe(true);
  });
});

describe('season lifecycle', () => {
  it('ends, archives, then starts a new world with the same accounts', async () => {
    const h = boot();
    const ada = await register(h, 'Ada');
    await register(h, 'Bob');
    const seed1 = Number(h.game.store.getMeta('seed'));
    expect(h.game.status().season).toEqual({ number: 1, phase: 'running' });

    // Past the finale: still season 1 and running, but registration closed.
    h.clock.t = T0 + 6 * DAY;
    h.game.tickOnce();
    expect(h.game.status().season.phase).toBe('finale');
    const late = await h.call('POST', '/api/auth/register', {
      body: { username: 'Cyrus', password: 'correct horse' },
    });
    expect(late.status).toBe(503);

    // The end: the default break is 0, so the next season starts in the same pass.
    h.clock.t = T0 + 7 * DAY + 5_000;
    h.game.tickOnce();
    const archive = h.game.store.listSeasons();
    expect(archive).toHaveLength(1);
    expect(archive[0]?.reason).toBe('ended');
    expect(archive[0]?.standings).toHaveLength(2);
    expect(Object.values(archive[0]?.names ?? {}).length).toBe(2);
    expect(h.game.seasons.number()).toBe(2);
    expect(Number(h.game.store.getMeta('seed'))).toBe(seasonSeed(7, 2));
    expect(Number(h.game.store.getMeta('seed'))).not.toBe(seed1);
    expect(h.game.engine.current.nowMs).toBe(h.clock.t);
    expect(Object.keys(h.game.engine.current.players)).toHaveLength(2);

    // accounts keep working: the old session sees /me with a crew in the new world
    const me = await h.call('GET', '/api/me', { token: ada.token });
    expect(me.status).toBe(200);
    const login = await h.call('POST', '/api/auth/login', {
      body: { username: 'Bob', password: 'correct horse' },
    });
    expect(login.status).toBe(200);

    // the hall of fame
    const res = await h.call('GET', '/api/seasons', { token: ada.token });
    expect(res.status).toBe(200);
    const body = seasonsResponseSchema.parse(await res.json());
    expect(body.current.number).toBe(2);
    expect(body.current.over).toBe(false);
    expect(body.seasons.map((s) => s.number)).toEqual([1]);
  });

  it('refuses orders and joins during a break, then resumes after a restart in the middle', async () => {
    const clock = { t: T0 };
    const extra = { seasonBreakHours: 6 };
    const h = boot({ clock, extra });
    const ada = await register(h, 'Ada');

    clock.t = T0 + 7 * DAY + 1_000;
    h.game.tickOnce();
    expect(h.game.store.listSeasons()).toHaveLength(1);
    expect(h.game.seasons.number()).toBe(1);
    expect(h.game.status().season.phase).toBe('break');
    const cur = h.game.seasons.current();
    expect(cur.over).toBe(true);
    expect(cur.nextStartMs).toBe(T0 + 7 * DAY + 6 * 3_600_000);

    const order = await h.call('POST', '/api/orders', {
      token: ada.token,
      body: { order: { type: 'stance', districtId: 'x', stance: 'pullback' } },
    });
    expect(order.status).toBe(400);
    expect(JSON.stringify(await order.json())).toContain('season_over');
    const join = await h.call('POST', '/api/auth/register', {
      body: { username: 'Late', password: 'correct horse' },
    });
    expect(join.status).toBe(503);

    // restart three hours into the break: still the frozen season, archived once
    clock.t += 3 * 3_600_000;
    h.game.stop();
    const h2 = boot({ dir: h.dir, clock, extra });
    expect(h2.game.seasons.number()).toBe(1);
    expect(h2.game.engine.seasonOver).toBe(true);
    expect(h2.game.store.listSeasons()).toHaveLength(1);

    // the break ends: season 2 starts and the account is in it
    clock.t = T0 + 7 * DAY + 6 * 3_600_000 + 1_000;
    h2.game.tickOnce();
    expect(h2.game.seasons.number()).toBe(2);
    expect(h2.game.store.listSeasons()).toHaveLength(1);
    expect(h2.game.engine.seasonOver).toBe(false);
    expect(Object.keys(h2.game.engine.current.players)).toHaveLength(1);
    const login = await h2.call('POST', '/api/auth/login', {
      body: { username: 'Ada', password: 'correct horse' },
    });
    expect(login.status).toBe(200);
  });
});

describe('health and the tick loop', () => {
  it('reports counts and timings without secrets, and 503s on a stale tick', async () => {
    const h = boot();
    await register(h, 'Ada');
    let res = await h.call('GET', '/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['ok']).toBe(true);
    expect(body['players']).toBe(1);
    expect(body['accounts']).toBe(1);
    expect(body['season']).toEqual({ number: 1, phase: 'running' });
    expect(body['tickLagMs']).toBeNull();
    expect(typeof body['snapshotAgeMs']).toBe('number');
    expect(JSON.stringify(body)).not.toMatch(/Ada|password|token|seed/i);

    h.game.tickOnce();
    h.clock.t += 5_000;
    res = await h.call('GET', '/api/health');
    expect(res.status).toBe(200);
    h.clock.t += 120_000;
    res = await h.call('GET', '/api/health');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  it('survives an exception in the loop, logs it and carries on', () => {
    const h = boot();
    const spy = vi.spyOn(h.game.engine, 'tick');
    spy.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => h.game.tickOnce()).not.toThrow();
    expect(h.game.status().tickErrors).toBe(1);
    const err = h.logs.find((l) => l['level'] === 'error');
    expect(err?.['msg']).toBe('tick failed');
    expect(String(err?.['err'])).toContain('boom');
    h.clock.t += 2_000;
    h.game.tickOnce();
    expect(h.game.status().tickErrors).toBe(1);
    expect(h.game.status().tickLagMs).toBe(0);
  });

  it('logs one summary line per interval, not per tick', () => {
    const h = boot({ extra: { tickLogMinutes: 10 } });
    for (let i = 0; i < 100; i++) {
      h.clock.t += 2_000;
      h.game.tickOnce();
    }
    expect(h.logs.filter((l) => l['msg'] === 'tick summary')).toHaveLength(0);
    h.clock.t += 10 * 60_000;
    h.game.tickOnce();
    const lines = h.logs.filter((l) => l['msg'] === 'tick summary');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'info', ticks: 101, errors: 0, season: 1 });
    h.game.tickOnce();
    expect(h.logs.filter((l) => l['msg'] === 'tick summary')).toHaveLength(1);
  });
});

describe('on-demand backup', () => {
  it('writes a restorable, uniquely named copy', () => {
    const h = boot();
    const dir = join(h.dir, 'backups');
    const file = backupNow(h.game.db, dir, T0);
    expect(file).toContain('nexum-manual-20261122T120000');
    const copy = new DatabaseSync(file);
    expect(
      (copy.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number }).n,
    ).toBeGreaterThan(0);
    copy.close();
    expect(() => backupNow(h.game.db, dir, T0)).toThrow(/already exists/);
  });
});
