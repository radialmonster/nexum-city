import { MS_PER_HOUR, balance } from './balance.js';
import { emit, schedule, type Ctx } from './ctx.js';
import { refreshRegional } from './regional.js';
import { nextInt, nextRange } from './rng.js';
import type { System } from './systems.js';
import { GOODS, type GameState, type Good, type Id } from './types.js';

/**
 * Shortages (economy plan, stage 3; docs/rewrite/sim-spec.md "Shortages"). Every few hours the
 * city picks one hub and one good, seeded from the game's RNG, and that hub runs short of it
 * for a few hours: the base price gains a `shortage` part (so the reference jumps and stays up
 * while the shortage lasts) and the civic traders will buy twice as many units. A trader who
 * brings the good in time is paid more; one who sits on stock until it is over is not.
 */

const S = balance.shortage;

/** Is this hub short of this good right now? */
export function isShort(state: GameState, hub: Id, good: Good): boolean {
  return state.shortages.some((s) => s.hub === hub && s.good === good);
}

/** The civic bid depth cap of a book: doubled while the hub is short of the good. */
export function bidDepthCap(state: GameState, hub: Id, good: Good): number {
  return balance.market.civicDepthCap * (isShort(state, hub, good) ? S.bidDepthFactor : 1);
}

function start(ctx: Ctx): void {
  const { state } = ctx;
  const hubs = Object.keys(state.markets).sort();
  if (hubs.length === 0) return;
  // Always draw, so the stream does not depend on whether a shortage could start.
  const hub = hubs[nextInt(state.rng, hubs.length)] as Id;
  const good = GOODS[nextInt(state.rng, GOODS.length)] as Good;
  const hours = nextRange(state.rng, S.minHours, S.maxHours);
  if (state.shortages.length >= S.maxActive || isShort(state, hub, good)) return;
  const endMs = state.nowMs + hours * MS_PER_HOUR;
  if (endMs > state.season.endMs) return;
  state.shortages.push({ hub, good, startMs: state.nowMs, endMs });
  refreshRegional(state);
  const book = state.markets[hub]?.[good];
  if (book) {
    book.refCents = Math.max(book.refCents, book.baseCents);
    book.bidDepth = bidDepthCap(state, hub, good);
  }
  schedule(ctx, endMs, { kind: 'shortage.end', hub, good });
  emit(ctx, 'market.shortage', [], [hub], {
    hub,
    good,
    hours,
    endMs,
    refPercent: S.refPercent,
    refCents: book?.refCents ?? 0,
  });
}

function end(ctx: Ctx, hub: Id, good: Good): void {
  const { state } = ctx;
  if (!isShort(state, hub, good)) return;
  state.shortages = state.shortages.filter((s) => !(s.hub === hub && s.good === good));
  refreshRegional(state);
  const book = state.markets[hub]?.[good];
  if (book) book.bidDepth = Math.min(book.bidDepth, balance.market.civicDepthCap);
  emit(ctx, 'market.shortage.ended', [], [hub], { hub, good });
}

export const shortageSystem: System = {
  name: 'shortage',
  handlers: {
    'shortage.check': (ctx, ev) => {
      if (ctx.state.nowMs < ctx.state.season.endMs) start(ctx);
      const next = ev.at + S.everyHours * MS_PER_HOUR;
      if (next <= ctx.state.season.endMs) schedule(ctx, next, { kind: 'shortage.check' });
    },
    'shortage.end': (ctx, ev) => end(ctx, ev.hub, ev.good),
  },
};
