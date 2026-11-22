import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getConnInfo } from '@hono/node-server/conninfo';
import { eta, standings, viewFor } from '@nexum/sim';
import type { Book, Good, Order } from '@nexum/sim';
import {
  FEED_DEFAULT_LIMIT,
  MARKET_HISTORY_BUCKET_MS,
  MARKET_HISTORY_MAX_BUCKETS,
  marketHistoryQuerySchema,
  credentialsSchema,
  etaQuerySchema,
  feedQuerySchema,
  loginRequestSchema,
  placeOrderRequestSchema,
} from '@nexum/contracts';
import type {
  AuthResponse,
  EtaResponse,
  ErrorResponse,
  FeedResponse,
  MarketHistoryResponse,
  MeResponse,
  PlaceOrderResponse,
  SeasonsResponse,
  StandingsResponse,
} from '@nexum/contracts';
import type { ZodType } from 'zod';
import type { Game } from './index.js';
import { dummyHash, hashPassword, verifyPassword } from './passwords.js';
import { SESSION_COOKIE, SESSION_TTL_MS } from './sessions.js';
import type { AccountRow } from './store.js';

interface Env {
  Variables: { account: AccountRow; token: string };
}
type Err = ErrorResponse['error'];

function fail(
  c: Context,
  status: ContentfulStatusCode,
  error: Err,
  extra: Partial<Omit<ErrorResponse, 'ok' | 'error'>> = {},
): Response {
  const body: ErrorResponse = { ok: false, error, ...extra };
  return c.json(body, status);
}

/** Parses a JSON body against a contract schema; returns the value or a ready 4xx response. */
async function readJson<T>(c: Context, schema: ZodType<T>): Promise<T | Response> {
  const type = c.req.header('content-type') ?? '';
  // Requiring JSON also blocks cross-site form posts, which cannot send this content type.
  if (!type.toLowerCase().startsWith('application/json')) {
    return fail(c, 415, 'unsupported_media_type');
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return fail(c, 400, 'invalid_request', { issues: ['body is not valid JSON'] });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return fail(c, 400, 'invalid_request', {
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`),
    });
  }
  return parsed.data;
}

function parseQuery<T>(c: Context, schema: ZodType<T>): T | Response {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) {
    return fail(c, 400, 'invalid_request', {
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(query)'}: ${i.message}`),
    });
  }
  return parsed.data;
}

const isResponse = (v: unknown): v is Response => v instanceof Response;

export function gameRoutes(game: Game): Hono<Env> {
  const { engine, store, sessions } = game;
  const api = new Hono<Env>();

  api.use('*', bodyLimit({ maxSize: 32 * 1024, onError: (c) => fail(c, 400, 'invalid_request') }));

  function clientKey(c: Context): string {
    if (game.options.trustProxy) {
      const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (fwd) return fwd;
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  const limited = (c: Context): Response | undefined => {
    const wait = game.authLimiter.hit(clientKey(c));
    if (!wait) return undefined;
    c.header('Retry-After', String(wait));
    return fail(c, 429, 'rate_limited', { retryAfterS: wait });
  };

  function startSession(c: Context, accountId: number): void {
    const token = sessions.create(accountId);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: game.options.cookieSecure,
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  }

  const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const account = sessions.account(token);
    if (!account || !token) return fail(c, 401, 'unauthorized');
    c.set('account', account);
    c.set('token', token);
    await next();
    return undefined;
  };

  // ---- accounts

  api.post('/auth/register', async (c) => {
    const blocked = limited(c);
    if (blocked) return blocked;
    const body = await readJson(c, credentialsSchema);
    if (isResponse(body)) return body;
    if (store.accountByUsername(body.username)) return fail(c, 409, 'username_taken');
    const pwHash = await hashPassword(body.password);
    let account: AccountRow | undefined;
    try {
      const created = engine.createPlayer((playerId) => {
        account = store.insertAccount(body.username, pwHash, playerId, game.now());
      }, body.username);
      if (!created.ok) return fail(c, 503, created.error);
      if (!account) throw new Error('account was not created');
      startSession(c, account.id);
      const res: AuthResponse = {
        ok: true,
        account: { id: account.id, username: account.username },
        playerId: created.playerId,
      };
      return c.json(res, 201);
    } catch (err) {
      // Lost a race with a concurrent registration of the same name.
      if (String(err).includes('UNIQUE')) return fail(c, 409, 'username_taken');
      throw err;
    }
  });

  api.post('/auth/login', async (c) => {
    const blocked = limited(c);
    if (blocked) return blocked;
    const body = await readJson(c, loginRequestSchema);
    if (isResponse(body)) return body;
    const key = `user:${body.username.toLowerCase()}`;
    const wait = game.loginFailures.blocked(key);
    if (wait) {
      c.header('Retry-After', String(wait));
      return fail(c, 429, 'rate_limited', { retryAfterS: wait });
    }
    const account = store.accountByUsername(body.username);
    // Always run one scrypt, so an unknown name is not distinguishable by timing.
    const ok = await verifyPassword(body.password, account?.pwHash ?? (await dummyHash()));
    if (!account || !ok) {
      game.loginFailures.hit(key);
      return fail(c, 401, 'invalid_credentials');
    }
    game.loginFailures.reset(key);
    startSession(c, account.id);
    const res: AuthResponse = {
      ok: true,
      account: { id: account.id, username: account.username },
      playerId: account.playerId,
    };
    return c.json(res);
  });

  api.post('/auth/logout', requireAuth, (c) => {
    sessions.destroy(c.get('token'));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true as const });
  });

  // ---- game

  api.get('/me', requireAuth, (c) => {
    const account = c.get('account');
    const state = engine.current;
    if (!state.players[account.playerId]) return fail(c, 404, 'not_found');
    const view = viewFor(state, account.playerId);
    const res: MeResponse = {
      ok: true,
      account: { id: account.id, username: account.username },
      playerId: account.playerId,
      view,
      names: store.crewNames(),
    };
    return c.json(res);
  });

  api.get('/standings', requireAuth, (c) => {
    const state = engine.current;
    const res: StandingsResponse = {
      ok: true,
      nowMs: state.nowMs,
      standings: standings(state),
      names: store.crewNames(),
    };
    return c.json(res);
  });

  api.get('/seasons', requireAuth, (c) => {
    const res: SeasonsResponse = {
      ok: true,
      nowMs: engine.current.nowMs,
      current: game.seasons.current(),
      seasons: store.listSeasons().map((r) => ({
        number: r.number,
        startMs: r.startMs,
        endMs: r.endMs,
        reason: r.reason,
        standings: r.standings,
        names: r.names,
        stats: r.stats,
      })),
    };
    return c.json(res);
  });

  api.post('/orders', requireAuth, async (c) => {
    const account = c.get('account');
    const wait = game.orderLimiter.hit(account.playerId);
    if (wait) {
      c.header('Retry-After', String(wait));
      return fail(c, 429, 'rate_limited', { retryAfterS: wait });
    }
    const body = await readJson(c, placeOrderRequestSchema);
    if (isResponse(body)) return body;
    // The schema mirrors the sim's Order union (checked in packages/contracts); zod types
    // optional cargo keys as `T | undefined`, hence the cast.
    const result = engine.acceptOrder(account.playerId, body.order as Order);
    if (!result.ok) return fail(c, 400, result.error);
    const res: PlaceOrderResponse = { ok: true, seq: result.seq, atMs: result.atMs };
    return c.json(res, 202);
  });

  api.get('/eta', requireAuth, (c) => {
    const q = parseQuery(c, etaQuerySchema);
    if (isResponse(q)) return q;
    const graph = engine.current.graph;
    if (!graph.nodes[q.from] || !graph.nodes[q.to]) return fail(c, 404, 'not_found');
    const result = eta(graph, q.from, q.to, q.carrier);
    if (!result) return fail(c, 404, 'no_route');
    const res: EtaResponse = {
      ok: true,
      eta: { route: result.route, lengthM: result.lengthM, durationMs: result.durationMs },
    };
    return c.json(res);
  });

  api.get('/feed', requireAuth, (c) => {
    const q = parseQuery(c, feedQuerySchema);
    if (isResponse(q)) return q;
    const { items, hasMore } = store.feed({
      playerId: c.get('account').playerId,
      sinceMs: q.since,
      afterSeq: q.after,
      limit: q.limit ?? FEED_DEFAULT_LIMIT,
    });
    const res: FeedResponse = {
      ok: true,
      nowMs: engine.current.nowMs,
      items,
      cursor: items.at(-1)?.seq ?? q.after ?? 0,
      hasMore,
    };
    return c.json(res);
  });

  api.get('/market/history', requireAuth, (c) => {
    const q = parseQuery(c, marketHistoryQuerySchema);
    if (isResponse(q)) return q;
    const book = (engine.current.markets[q.hub] as Partial<Record<Good, Book>> | undefined)?.[
      q.good as Good
    ];
    if (!book) return fail(c, 404, 'not_found');
    const res: MarketHistoryResponse = {
      ok: true,
      nowMs: engine.current.nowMs,
      hub: q.hub,
      good: q.good,
      bucketMs: MARKET_HISTORY_BUCKET_MS,
      buckets: store.tradeSeries(
        q.hub,
        q.good,
        MARKET_HISTORY_BUCKET_MS,
        MARKET_HISTORY_MAX_BUCKETS,
      ),
      civic: { refCents: book.refCents, baseCents: book.baseCents, lastCents: book.lastCents },
    };
    return c.json(res);
  });

  api.get('/stream', requireAuth, (c) => {
    const { playerId } = c.get('account');
    c.header('X-Accel-Buffering', 'no'); // keep nginx from buffering the stream
    return streamSSE(c, async (stream) => {
      let finish!: () => void;
      const closed = new Promise<void>((resolve) => (finish = resolve));
      const send = (event: string, data: unknown, id?: number): void => {
        void stream
          .writeSSE({
            event,
            data: JSON.stringify(data),
            ...(id === undefined ? {} : { id: String(id) }),
          })
          .catch(finish);
      };

      send('hello', { nowMs: engine.current.nowMs, playerId });
      // Resume after a dropped connection: replay what the client missed.
      const last = Number(c.req.header('last-event-id'));
      if (Number.isInteger(last) && last >= 0 && c.req.header('last-event-id')) {
        const { items } = store.feed({ playerId, afterSeq: last, limit: FEED_DEFAULT_LIMIT });
        for (const item of items) send('game', item, item.seq);
      }

      const unsubscribe = game.hub.subscribe({
        playerId,
        send: (e, d, id) => send(e, d, id),
        close: finish,
      });
      const beat = setInterval(
        () => send('heartbeat', { nowMs: engine.current.nowMs }),
        game.options.heartbeatMs ?? 25_000,
      );
      stream.onAbort(finish);
      await closed;
      clearInterval(beat);
      unsubscribe();
    });
  });

  return api;
}
