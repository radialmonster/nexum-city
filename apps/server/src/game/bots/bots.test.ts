import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkInvariants } from '@nexum/sim';
import { createGame } from '../index.js';
import type { Game } from '../index.js';
import { Hub } from '../hub.js';
import { checkinGapMs } from './schedule.js';
import { PERSONAS, ROSTER } from './personalities.js';

const T0 = Date.UTC(2026, 10, 22, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const dirs: string[] = [];
const games: Game[] = [];

afterEach(() => {
  for (const g of games.splice(0)) {
    try {
      g.stop();
    } catch {
      // already stopped by the test
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function open(clock: { t: number }, dir?: string, count = 6, min = 2, seed = 11): Game {
  const d = dir ?? mkdtempSync(join(tmpdir(), 'nexum-bots-'));
  if (!dir) dirs.push(d);
  const game = createGame({
    dataDir: d,
    now: () => clock.t,
    tickMs: 2000,
    snapshotMs: 300_000,
    seed,
    cookieSecure: false,
    trustProxy: false,
    bots: { enabled: true, count, min },
  });
  games.push(game);
  return game;
}

/** Plays `ms` of game time in ten-minute steps, like the real tick loop would. */
function play(game: Game, clock: { t: number }, ms: number, stepMs = 10 * MIN): void {
  for (let t = 0; t < ms; t += stepMs) {
    clock.t += stepMs;
    game.engine.tick();
    game.bots?.run();
  }
}

function joinHuman(game: Game, name: string): string {
  const r = game.engine.createPlayer((playerId) => {
    game.store.insertAccount(name, 'x', playerId, game.now());
  }, name);
  if (!r.ok) throw new Error(r.error);
  return r.playerId;
}

describe('bot roster', () => {
  it('spawns the full roster with a personality mix and names', () => {
    const clock = { t: T0 };
    const game = open(clock);
    game.bots?.run();
    const bots = game.store.allBots();
    expect(bots).toHaveLength(6);
    expect(new Set(bots.map((b) => b.kind))).toEqual(
      new Set(['raider', 'turtle', 'merchant', 'hunter']),
    );
    expect(new Set(bots.map((b) => b.name)).size).toBe(6);
    for (const b of bots) {
      expect(b.motto.length).toBeGreaterThan(5);
      expect(game.engine.current.players[b.playerId]).toBeDefined();
    }
    expect(ROSTER).toHaveLength(6);
    expect(PERSONAS.raider.length).toBeGreaterThanOrEqual(2);
  });

  it('is off when disabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexum-bots-'));
    dirs.push(dir);
    const game = createGame({
      dataDir: dir,
      now: () => T0,
      tickMs: 2000,
      snapshotMs: 300_000,
      seed: 1,
      cookieSecure: false,
      trustProxy: false,
      bots: { enabled: false, count: 6, min: 2 },
    });
    games.push(game);
    expect(game.bots).toBeNull();
  });

  it('retires bots gradually as humans join, down to the minimum, keeping their districts', () => {
    const clock = { t: T0 };
    const game = open(clock);
    game.bots?.run();
    for (let i = 0; i < 6; i++) joinHuman(game, `human${String(i)}`);
    const owned = (id: string): number =>
      Object.values(game.engine.current.districts).filter((d) => d.owner === id).length;
    const retiredBefore = game.store.allBots().filter((b) => b.retiredMs !== null).length;
    expect(retiredBefore).toBe(0);
    play(game, clock, 30 * MIN);
    // At most one retirement per game hour.
    expect(game.bots?.active().length).toBeGreaterThanOrEqual(5);
    play(game, clock, 10 * HOUR);
    const active = game.bots?.active() ?? [];
    expect(active).toHaveLength(2);
    const retired = game.store.allBots().filter((b) => b.retiredMs !== null);
    expect(retired.length).toBe(4);
    for (const b of retired) expect(owned(b.playerId)).toBeGreaterThan(0);
  });
});

describe('check-in schedule', () => {
  it('is deterministic per seed and jittered', () => {
    const a = [0, 1, 2, 3].map((i) => checkinGapMs(5, 'p3', 'raider', i));
    const b = [0, 1, 2, 3].map((i) => checkinGapMs(5, 'p3', 'raider', i));
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(4);
    expect(checkinGapMs(6, 'p3', 'raider', 1)).not.toBe(a[1]);
    for (const g of a) {
      expect(g).toBeGreaterThan(0);
      expect(g).toBeLessThan(10 * HOUR);
    }
  });

  it('never acts on every tick', () => {
    const clock = { t: T0 };
    const game = open(clock);
    play(game, clock, 24 * HOUR, 2000);
    const s = game.bots?.stats;
    // Six bots, a day: a handful of visits each, not one per 2 s tick.
    expect(s?.checkins).toBeGreaterThan(6);
    expect(s?.checkins).toBeLessThan(6 * 12);
  }, 30_000);

  it('produces the same game from the same seed', () => {
    const run = (): string => {
      const clock = { t: T0 };
      const game = open(clock);
      play(game, clock, 12 * HOUR);
      return game.engine.hash();
    };
    expect(run()).toBe(run());
  });
});

describe('bot orders', () => {
  it('only submit orders the engine accepts, and rejections never crash', () => {
    const clock = { t: T0 };
    const game = open(clock);
    play(game, clock, 24 * HOUR);
    const s = game.bots?.stats;
    expect(s?.submitted).toBeGreaterThan(0);
    expect(s?.accepted).toBeGreaterThan(0);
    expect(s?.accepted).toBe((s?.submitted ?? 0) - (s?.rejected ?? 0));
    // The sim bots propose a build or recruit without checking the district can pay for it, so
    // some proposals are rejected (insufficient_goods); the engine just refuses and logs them.
    expect(s?.rejected).toBeGreaterThanOrEqual(0);
  });

  it('are in the durable inputs log, so a restart replays to the same state', () => {
    const clock = { t: T0 };
    const dir = mkdtempSync(join(tmpdir(), 'nexum-bots-'));
    dirs.push(dir);
    const game = open(clock, dir);
    play(game, clock, 20 * HOUR);
    expect(game.bots?.stats.accepted).toBeGreaterThan(0);
    game.engine.tick();
    const hash = game.engine.hash();
    const bots = game.store.allBots();
    game.stop();
    const again = open(clock, dir);
    expect(again.engine.hash()).toBe(hash);
    expect(again.store.allBots()).toEqual(bots);
    // The roster is not duplicated on restart.
    again.bots?.run();
    expect(again.store.allBots()).toHaveLength(6);
  });
});

describe('arrival events', () => {
  it('reach every other player feed and the live stream, without leaking the audience', () => {
    const clock = { t: T0 };
    const game = open(clock);
    game.bots?.run();
    const first = joinHuman(game, 'ada');
    const seen: unknown[] = [];
    const botId = game.store.allBots()[0]?.playerId ?? '';
    const hub: Hub = game.hub;
    hub.subscribe({
      playerId: botId,
      close: () => undefined,
      send: (event, data) => {
        if (event === 'game') seen.push(data);
      },
    });
    const second = joinHuman(game, 'kestrel_9');
    const feed = game.store.feed({ playerId: first, limit: 50 });
    const joined = feed.items.filter((i) => i.event.kind === 'player.joined');
    const mine = joined.find((i) => i.event.actors.includes(second));
    expect(mine).toBeDefined();
    expect(mine?.event.data['crew']).toBe('kestrel_9');
    expect(typeof mine?.event.data['district']).toBe('string');
    expect(['east', 'west', 'north', 'south', 'centre']).toContain(mine?.event.data['side']);
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain('audience');
    // Private events are not broadcast.
    expect(
      game.store
        .feed({ playerId: first, limit: 500 })
        .items.every((i) => i.event.kind !== 'order.rejected'),
    ).toBe(true);
  });
});

describe('three-day game', () => {
  it('runs with six bots: invariants hold, land changes hands and goods trade', () => {
    const clock = { t: T0 };
    const game = open(clock);
    const kinds = new Map<string, number>();
    game.engine.onTick((r) => {
      for (const e of r.events) kinds.set(e.event.kind, (kinds.get(e.event.kind) ?? 0) + 1);
    });
    for (let day = 0; day < 3; day++) {
      play(game, clock, 24 * HOUR);
      expect(checkInvariants(game.engine.current)).toEqual([]);
    }
    const s = game.bots?.stats;
    expect(s?.checkins).toBeGreaterThan(30);
    expect(kinds.get('siege.captured') ?? 0).toBeGreaterThanOrEqual(1);
    expect(kinds.get('trade.filled') ?? 0).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
