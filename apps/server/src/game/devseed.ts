import { Hono } from 'hono';
import { BOTS } from '@nexum/sim';
import type { BotKind } from '@nexum/sim';
import { hashPassword } from './passwords.js';
import type { Game } from './index.js';

const HOUR_MS = 3_600_000;
const BEAT_MS = 30 * 60_000;
const MAX_HOURS = 24 * 7;

/** A wall clock with a forward offset, so a dev server can fast-forward the game. */
export interface DevClock {
  readonly now: () => number;
  /** Moves the clock forward by `ms` (never back). */
  advance(ms: number): void;
  readonly offsetMs: () => number;
}

export function createDevClock(base: () => number = Date.now): DevClock {
  let offset = 0;
  return {
    now: () => base() + offset,
    advance(ms) {
      if (ms > 0) offset += ms;
    },
    offsetMs: () => offset,
  };
}

export interface SeedResult {
  readonly bots: { username: string; playerId: string; kind: BotKind }[];
  readonly advancedHours: number;
  readonly nowMs: number;
}

const KINDS: BotKind[] = ['raider', 'merchant', 'turtle', 'raider', 'merchant'];

/**
 * Creates scripted bot players (once per name) and plays them forward `hours` of game time in
 * half-hour beats, so a dev game has sieges, trades and a moved clock. Development only: it is
 * mounted solely when `DEV_SEED=true`, and bots use the sim's own order validation.
 */
export async function seedGame(game: Game, clock: DevClock, bots: number, hours: number) {
  const { engine, store } = game;
  const made: SeedResult['bots'] = [];
  const pw = await hashPassword(`seed-${String(game.now())}-unused`);
  for (let i = 0; i < bots; i++) {
    const kind = KINDS[i % KINDS.length] ?? 'turtle';
    const username = `bot_${kind}_${String(i + 1)}`;
    const existing = store.accountByUsername(username);
    if (existing) {
      made.push({ username, playerId: existing.playerId, kind });
      continue;
    }
    const created = engine.createPlayer((playerId) => {
      store.insertAccount(username, pw, playerId, game.now());
    }, username);
    if (!created.ok) break;
    made.push({ username, playerId: created.playerId, kind });
  }
  const beats = Math.ceil((hours * HOUR_MS) / BEAT_MS);
  for (let b = 0; b < beats; b++) {
    clock.advance(BEAT_MS);
    engine.tick();
    for (const bot of made) {
      for (const order of BOTS[bot.kind](engine.current, bot.playerId)) {
        engine.acceptOrder(bot.playerId, order);
      }
    }
  }
  engine.tick();
  return { bots: made, advancedHours: hours, nowMs: engine.current.nowMs } satisfies SeedResult;
}

/** `POST /seed {bots?, hours?}` and `POST /advance {hours}`. Mount under `/api/dev`. */
export function devRoutes(game: Game, clock: DevClock): Hono {
  const app = new Hono();
  const num = (v: unknown, fallback: number, max: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : fallback;
  app.post('/seed', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await seedGame(
      game,
      clock,
      Math.floor(num(body['bots'], 3, 5)),
      num(body['hours'], 12, MAX_HOURS),
    );
    return c.json({ ok: true, ...result });
  });
  app.post('/advance', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    clock.advance(num(body['hours'], 1, MAX_HOURS) * HOUR_MS);
    game.engine.tick();
    return c.json({ ok: true, nowMs: game.engine.current.nowMs });
  });
  return app;
}
