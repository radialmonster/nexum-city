import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authResponseSchema,
  errorResponseSchema,
  etaResponseSchema,
  feedResponseSchema,
  meResponseSchema,
  placeOrderResponseSchema,
} from '@nexum/contracts';
import { balance, eta, hashState, validateOrder } from '@nexum/sim';
import type { GameState, Order } from '@nexum/sim';
import { createApp } from '../app.js';
import { createGame } from './index.js';
import type { Game } from './index.js';
import { openDatabase } from './db.js';
import { hashPassword, verifyPassword } from './passwords.js';

const T0 = Date.UTC(2026, 10, 22, 12, 0, 0);
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
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'nexum-test-'));
  dirs.push(d);
  return d;
}

interface Harness {
  game: Game;
  app: ReturnType<typeof createApp>;
  clock: { t: number };
  dir: string;
  /** JSON request; `cookie` is the raw session token. */
  call: (
    method: string,
    path: string,
    opts?: { body?: unknown; token?: string; raw?: boolean },
  ) => Promise<Response>;
}

function boot(
  opts: { dir?: string; clock?: { t: number }; heartbeatMs?: number; authMax?: number } = {},
): Harness {
  const dir = opts.dir ?? tempDir();
  const clock = opts.clock ?? { t: T0 };
  const game = createGame({
    dataDir: dir,
    now: () => clock.t,
    tickMs: 2000,
    snapshotMs: 300_000,
    seed: 7,
    cookieSecure: false,
    trustProxy: false,
    ...(opts.heartbeatMs ? { heartbeatMs: opts.heartbeatMs } : {}),
    authLimit: { max: opts.authMax ?? 1000, windowMs: 60_000 },
  });
  games.push(game);
  const app = createApp({ version: 'test', game, now: () => clock.t });
  const call: Harness['call'] = (method, path, o = {}) =>
    Promise.resolve(
      app.request(path, {
        method,
        headers: {
          ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(o.token ? { cookie: `nexum_session=${o.token}` } : {}),
        },
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
      }),
    );
  return { game, app, clock, dir, call };
}

/** A walk from the player's first crew to the first hub, with its arrival time. */
function walk(state: GameState, playerId: string): { order: Order; arriveMs: number } {
  const crew = Object.values(state.crews).find((c) => c.owner === playerId);
  const hub = Object.values(state.districts).find((d) => d.kind === 'hub');
  if (!crew || !('at' in crew.loc) || !hub) throw new Error('no crew or hub');
  const order: Order = { type: 'move', carrierId: null, crewIds: [crew.id], to: hub.id };
  const v = validateOrder(state, { actorId: playerId, order });
  if (!v.ok) throw new Error('walk invalid: ' + v.error);
  const t = eta(state.graph, crew.loc.at, hub.id, 'foot');
  if (!t) throw new Error('no route');
  return { order, arriveMs: state.nowMs + t.durationMs };
}

function tokenOf(res: Response): string {
  const m = /nexum_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
  if (!m?.[1]) throw new Error('no session cookie');
  return m[1];
}

async function register(h: Harness, username: string, password = 'correct horse') {
  const res = await h.call('POST', '/api/auth/register', { body: { username, password } });
  expect(res.status).toBe(201);
  const body = authResponseSchema.parse(await res.json());
  return { token: tokenOf(res), ...body };
}

describe('accounts', () => {
  it('registers, reads /me, logs out and logs back in', async () => {
    const h = boot();
    const res = await h.call('POST', '/api/auth/register', {
      body: { username: 'Ada', password: 'correct horse' },
    });
    expect(res.status).toBe(201);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
    const reg = authResponseSchema.parse(await res.json());
    const token = tokenOf(res);

    // the token is stored only as a hash
    const rows = h.game.db.prepare('SELECT token_hash FROM sessions').all() as {
      token_hash: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).not.toContain(token);

    const me = meResponseSchema.parse(await (await h.call('GET', '/api/me', { token })).json());
    expect(me.account.username).toBe('Ada');
    expect(me.playerId).toBe(reg.playerId);
    expect(me.view.player.id).toBe(reg.playerId);
    const owned = Object.values(me.view.districts).filter((d) => d.owner === reg.playerId);
    expect(owned).toHaveLength(1);
    // the view holds only own districts plus hubs
    for (const d of Object.values(me.view.districts)) {
      expect(d.owner === reg.playerId || d.kind === 'hub').toBe(true);
    }
    expect(Object.values(me.view.crews).length).toBeGreaterThan(0);

    const out = await h.call('POST', '/api/auth/logout', { token });
    expect(out.status).toBe(200);
    expect((await h.call('GET', '/api/me', { token })).status).toBe(401);

    const login = await h.call('POST', '/api/auth/login', {
      body: { username: 'ada', password: 'correct horse' },
    });
    expect(login.status).toBe(200);
    expect(authResponseSchema.parse(await login.json()).playerId).toBe(reg.playerId);
    expect((await h.call('GET', '/api/me', { token: tokenOf(login) })).status).toBe(200);
  });

  it('marks the cookie Secure when configured', async () => {
    const dir = tempDir();
    const game = createGame({
      dataDir: dir,
      now: () => T0,
      tickMs: 2000,
      snapshotMs: 300_000,
      seed: 7,
      cookieSecure: true,
      trustProxy: false,
    });
    games.push(game);
    const app = createApp({ version: 't', game });
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'correct horse' }),
    });
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  it('rejects duplicates, bad input and non-JSON bodies', async () => {
    const h = boot();
    await register(h, 'Ada');
    const dup = await h.call('POST', '/api/auth/register', {
      body: { username: 'ADA', password: 'another pass' },
    });
    expect(dup.status).toBe(409);
    expect(errorResponseSchema.parse(await dup.json()).error).toBe('username_taken');

    const short = await h.call('POST', '/api/auth/register', {
      body: { username: 'bob', password: 'short' },
    });
    expect(short.status).toBe(400);
    expect(errorResponseSchema.parse(await short.json()).error).toBe('invalid_request');

    const form = await h.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'username=ada&password=x',
    });
    expect(form.status).toBe(415);
    expect((await h.call('GET', '/api/me')).status).toBe(401);
  });

  it('rejects a wrong password and unknown users the same way', async () => {
    const h = boot();
    await register(h, 'Ada');
    for (const body of [
      { username: 'Ada', password: 'wrong password' },
      { username: 'nobody', password: 'wrong password' },
    ]) {
      const res = await h.call('POST', '/api/auth/login', { body });
      expect(res.status).toBe(401);
      expect(errorResponseSchema.parse(await res.json()).error).toBe('invalid_credentials');
    }
  });

  it('rate limits auth routes per client and per username', async () => {
    const h = boot({ authMax: 4 });
    await register(h, 'Ada');
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (
          await h.call('POST', '/api/auth/login', {
            body: { username: 'Ada', password: 'nope nope' },
          })
        ).status,
      );
    }
    // 1 registration + 4 logins = 5 hits against a limit of 4; the 4th login is already limited
    expect(statuses).toEqual([401, 401, 401, 429]);
    const limited = await h.call('POST', '/api/auth/login', {
      body: { username: 'Ada', password: 'correct horse' },
    });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // the window passes and the right password works again
    h.clock.t += 61_000;
    const ok = await h.call('POST', '/api/auth/login', {
      body: { username: 'Ada', password: 'correct horse' },
    });
    expect(ok.status).toBe(200);
  });

  it('locks a username after repeated failures even across clients', async () => {
    const h = boot();
    await register(h, 'Ada');
    for (let i = 0; i < 5; i++) {
      await h.call('POST', '/api/auth/login', {
        body: { username: 'Ada', password: 'bad bad bad' },
      });
    }
    const res = await h.call('POST', '/api/auth/login', {
      body: { username: 'Ada', password: 'correct horse' },
    });
    expect(res.status).toBe(429);
  });

  it('hashes passwords with a per-user salt and verifies them', async () => {
    const a = await hashPassword('hunter2hunter2');
    const b = await hashPassword('hunter2hunter2');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('hunter2hunter2', a)).toBe(true);
    expect(await verifyPassword('hunter2hunter3', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('orders', () => {
  it('accepts an order, rejects an invalid one with its code, and resolves it as time passes', async () => {
    const h = boot();
    const { token, playerId } = await register(h, 'Ada');
    const me = meResponseSchema.parse(await (await h.call('GET', '/api/me', { token })).json());
    const home = Object.values(me.view.districts).find((d) => d.owner === playerId);
    if (!home) throw new Error('no home district');

    // invalid: not a district at all
    const bad = await h.call('POST', '/api/orders', {
      token,
      body: { order: { type: 'build', districtId: 'nowhere', building: 'workshop' } },
    });
    expect(bad.status).toBe(400);
    expect(errorResponseSchema.parse(await bad.json()).error).toBe('unknown_district');

    // invalid: the schema rejects it before the sim sees it
    const junk = await h.call('POST', '/api/orders', { token, body: { order: { type: 'nuke' } } });
    expect(junk.status).toBe(400);
    expect(errorResponseSchema.parse(await junk.json()).error).toBe('invalid_request');
    expect((await h.call('POST', '/api/orders', { body: { order: {} } })).status).toBe(401);

    // valid: send a crew walking to a hub
    const { order, arriveMs } = walk(h.game.engine.current, playerId);
    const ok = await h.call('POST', '/api/orders', { token, body: { order } });
    expect(ok.status).toBe(202);
    const placed = placeOrderResponseSchema.parse(await ok.json());
    expect(placed.atMs).toBe(T0);
    const count = h.game.db.prepare('SELECT COUNT(*) AS n FROM inputs').get() as { n: number };
    expect(count.n).toBe(1);

    // it is under way straight away
    expect(Object.keys(h.game.engine.current.movements)).toHaveLength(1);

    // the same crew cannot be sent twice; the sim rejects it with a typed code
    const again = await h.call('POST', '/api/orders', { token, body: { order } });
    expect(again.status).toBe(400);
    expect(errorResponseSchema.parse(await again.json()).error).toBe('crew_busy');

    // advance the clock past arrival and tick
    h.clock.t = arriveMs + 1000;
    h.game.engine.tick();
    expect(Object.keys(h.game.engine.current.movements)).toHaveLength(0);

    const feed = feedResponseSchema.parse(
      await (await h.call('GET', '/api/feed?since=0', { token })).json(),
    );
    expect(feed.items.map((i) => i.event.kind)).toContain('arrived');
    expect(feed.items.length).toBeGreaterThan(0);
    expect(feed.cursor).toBe(feed.items.at(-1)?.seq);
    // another player's feed does not include it
    const other = await register(h, 'Bob');
    const otherFeed = feedResponseSchema.parse(
      await (await h.call('GET', '/api/feed', { token: other.token })).json(),
    );
    expect(otherFeed.items.map((i) => i.event.kind)).not.toContain('arrived');

    // `since` and `after` filter
    const last = feed.items.at(-1);
    const none = feedResponseSchema.parse(
      await (await h.call('GET', `/api/feed?after=${last?.seq ?? 0}`, { token })).json(),
    );
    expect(none.items).toEqual([]);
    const late = feedResponseSchema.parse(
      await (await h.call('GET', `/api/feed?since=${(last?.event.at ?? 0) + 1}`, { token })).json(),
    );
    expect(late.items).toEqual([]);
    expect((await h.call('GET', '/api/feed?limit=0', { token })).status).toBe(400);
  });

  it('previews an ETA', async () => {
    const h = boot();
    const { token } = await register(h, 'Ada');
    const res = await h.call('GET', '/api/eta?from=hubW&to=hubE&carrier=van', { token });
    expect(res.status).toBe(200);
    const eta = etaResponseSchema.parse(await res.json()).eta;
    expect(eta.route[0]).toBe('hubW');
    expect(eta.route.at(-1)).toBe('hubE');
    expect(eta.durationMs).toBeGreaterThan(0);
    const foot = etaResponseSchema.parse(
      await (await h.call('GET', '/api/eta?from=hubW&to=hubE&carrier=foot', { token })).json(),
    );
    expect(foot.eta.durationMs).toBeGreaterThan(eta.durationMs);
    expect(
      (await h.call('GET', '/api/eta?from=hubW&to=nowhere&carrier=van', { token })).status,
    ).toBe(404);
    expect((await h.call('GET', '/api/eta?from=hubW&to=hubE&carrier=jet', { token })).status).toBe(
      400,
    );
  });
});

describe('persistence', () => {
  /** The same scripted session, used for both the interrupted and the uninterrupted run. */
  async function script(h: Harness, phase: 1 | 2): Promise<void> {
    if (phase === 1) {
      const ada = await register(h, 'Ada');
      h.clock.t += 5_000;
      const bob = await register(h, 'Bob');
      h.clock.t += 5_000;
      const home = (id: string): string => {
        const d = Object.values(h.game.engine.current.districts).find((x) => x.owner === id);
        if (!d) throw new Error('no home');
        return d.id;
      };
      const build = (token: string, id: string) =>
        h.call('POST', '/api/orders', {
          token,
          body: { order: walk(h.game.engine.current, id).order },
        });
      expect((await build(ada.token, ada.playerId)).status).toBe(202);
      h.clock.t += 60_000;
      h.game.engine.tick();
      h.game.engine.snapshot(); // a snapshot, then more inputs after it
      h.clock.t += 7_000;
      expect((await build(bob.token, bob.playerId)).status).toBe(202);
      const hubOrder: Order = {
        type: 'stance',
        districtId: home(ada.playerId),
        stance: 'pullback',
      };
      expect(
        (await h.call('POST', '/api/orders', { token: ada.token, body: { order: hubOrder } }))
          .status,
      ).toBe(202);
      h.clock.t += 3_000;
    } else {
      h.clock.t += 2 * 3600_000; // the server was down for two hours
    }
    h.game.engine.tick();
  }

  it('recovers to exactly the state of an uninterrupted run', async () => {
    // Uninterrupted reference.
    const ref = boot({ clock: { t: T0 } });
    await script(ref, 1);
    await script(ref, 2);
    const wanted = ref.game.engine.hash();

    // Interrupted: crash after phase 1 (no shutdown snapshot), restart two hours later.
    const clock = { t: T0 };
    const first = boot({ clock });
    await script(first, 1);
    const hashBefore = first.game.engine.hash();
    const dir = first.dir;
    // simulate a crash: close the file without the shutdown snapshot
    first.game.db.close();
    games.splice(games.indexOf(first.game), 1);

    // inputs after the snapshot exist in the log and are replayed
    const check = openDatabase(join(dir, 'nexum.db'));
    const snap = check.prepare('SELECT MAX(last_seq) AS s FROM snapshots').get() as { s: number };
    const inputs = check.prepare('SELECT MAX(seq) AS s FROM inputs').get() as { s: number };
    expect(inputs.s).toBeGreaterThan(snap.s);
    check.close();

    clock.t += 2 * 3600_000;
    const second = boot({ dir, clock });
    expect(second.game.engine.hash()).toBe(wanted);
    expect(hashState(second.game.engine.current)).toBe(wanted);
    expect(hashBefore).not.toBe(wanted);

    // accounts and sessions survived too
    const login = await second.call('POST', '/api/auth/login', {
      body: { username: 'Ada', password: 'correct horse' },
    });
    expect(login.status).toBe(200);
  });

  it('survives a clean restart and keeps the event feed', async () => {
    const clock = { t: T0 };
    const first = boot({ clock });
    await script(first, 1);
    const feedBefore = first.game.store.feed({ playerId: 'p1', limit: 500 }).items.length;
    first.game.stop();
    games.splice(games.indexOf(first.game), 1);
    const hash = first.game.engine.hash();
    const second = boot({ dir: first.dir, clock });
    expect(second.game.engine.hash()).toBe(hash);
    expect(second.game.store.feed({ playerId: 'p1', limit: 500 }).items).toHaveLength(feedBefore);
  });

  it('applies migrations once and records them', () => {
    const dir = tempDir();
    const a = openDatabase(join(dir, 'x.db'));
    a.close();
    const b = openDatabase(join(dir, 'x.db'));
    const rows = b.prepare('SELECT id FROM schema_migrations').all();
    expect(rows).toEqual([{ id: 1 }]);
    const tables = (
      b.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((t) => t.name);
    for (const t of ['meta', 'snapshots', 'inputs', 'events', 'accounts', 'sessions']) {
      expect(tables).toContain(t);
    }
    expect((b.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe(
      'wal',
    );
    b.close();
  });

  it('writes a periodic snapshot as the clock advances', () => {
    const h = boot();
    const count = (): number =>
      (h.game.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number }).n;
    const before = count();
    h.clock.t += 10_000;
    h.game.engine.tick();
    expect(count()).toBe(before);
    h.clock.t += 300_000;
    h.game.engine.tick();
    expect(count()).toBe(before + 1);
  });

  it('backs up nightly with VACUUM INTO and keeps the last 7', () => {
    const h = boot({ clock: { t: Date.UTC(2026, 10, 1, 4, 0, 0) } });
    const dir = join(h.dir, 'backups');
    expect(h.game.backup()).toBeDefined();
    expect(h.game.backup()).toBeUndefined(); // already done today
    for (let day = 2; day <= 10; day++) {
      h.clock.t = Date.UTC(2026, 10, day, 4, 0, 0);
      h.game.backup();
    }
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(7);
    expect(files[0]).toBe('nexum-20261104.db');
    expect(existsSync(join(dir, 'nexum-20261101.db'))).toBe(false);
    const copy = openDatabase(join(dir, files[6] ?? ''));
    expect(copy.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toBeDefined();
    copy.close();
    // before the configured hour nothing is written
    h.clock.t = Date.UTC(2026, 10, 11, 1, 0, 0);
    expect(h.game.backup()).toBeUndefined();
  });
});

describe('live updates', () => {
  it('streams per-player events and ticks over SSE, and cleans up on disconnect', async () => {
    const h = boot({ heartbeatMs: 30 });
    const { token, playerId } = await register(h, 'Ada');
    const other = await register(h, 'Bob');
    const home = Object.values(h.game.engine.current.districts).find((d) => d.owner === playerId);
    if (!home) throw new Error('no home');

    const res = await h.call('GET', '/api/stream', { token });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(h.game.hub.size).toBe(1);

    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const until = async (needle: string): Promise<void> => {
      const deadline = Date.now() + 3000;
      while (!buffer.includes(needle)) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${needle}\n${buffer}`);
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
      }
    };

    await until('event: hello');
    await until('event: heartbeat');

    const { order, arriveMs } = walk(h.game.engine.current, playerId);
    expect(home.id).toBeTruthy();
    expect((await h.call('POST', '/api/orders', { token, body: { order } })).status).toBe(202);
    h.clock.t = arriveMs + 1000;
    h.game.engine.tick();
    await until('event: game');
    await until('"kind":"arrived"');
    await until('event: tick');
    expect(buffer).toContain(`"playerId":"${playerId}"`);

    // another player's stream does not get it
    expect(other.playerId).not.toBe(playerId);

    await reader.cancel();
    const deadline = Date.now() + 2000;
    while (h.game.hub.size > 0 && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 10));
    expect(h.game.hub.size).toBe(0);
  });

  it('requires a session and resumes from Last-Event-ID', async () => {
    const h = boot();
    expect((await h.call('GET', '/api/stream')).status).toBe(401);
    const { token, playerId } = await register(h, 'Ada');
    const { order, arriveMs } = walk(h.game.engine.current, playerId);
    await h.call('POST', '/api/orders', { token, body: { order } });
    h.clock.t = arriveMs + 1000;
    h.game.engine.tick();

    const res = await h.app.request('/api/stream', {
      headers: { cookie: `nexum_session=${token}`, 'last-event-id': '0' },
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    let text = '';
    const deadline = Date.now() + 3000;
    while (!text.includes('arrived') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    expect(text).toContain('arrived');
    await reader.cancel();
  });
});

describe('sanity', () => {
  it('uses the sim balance the tests assume', () => {
    expect(balance.player.startCrews).toBeGreaterThan(0);
  });
});
