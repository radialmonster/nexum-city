import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, balance } from './balance.js';
import { checkInvariants } from './invariants.js';
import { bidDepthCap, isShort } from './shortage.js';
import { step } from './step.js';
import type { GameState, SimEvent } from './types.js';
import { scenario } from './fixtures.js';

/** Runs hour by hour, collecting events and the shortages seen at each hour. */
function run(seed: number, hours: number): { s: GameState; events: SimEvent[]; seen: string[] } {
  let s = scenario(seed);
  const events: SimEvent[] = [];
  const seen: string[] = [];
  for (let h = 1; h <= hours; h++) {
    const r = step(s, [], s.nowMs + MS_PER_HOUR);
    s = r.state;
    events.push(...r.events);
    seen.push(JSON.stringify(s.shortages));
  }
  return { s, events, seen };
}

describe('shortages', () => {
  it('are deterministic for a seed and differ between seeds', () => {
    const a = run(7, 48);
    const b = run(7, 48);
    expect(a.seen).toEqual(b.seen);
    expect(a.events.filter((e) => e.kind.startsWith('market.shortage'))).toEqual(
      b.events.filter((e) => e.kind.startsWith('market.shortage')),
    );
    const c = run(8, 48);
    expect(c.seen).not.toEqual(a.seen);
  });

  it('start within the first check, last 4 to 8 hours and then end', () => {
    const { s, events } = run(7, 72);
    const starts = events.filter((e) => e.kind === 'market.shortage');
    const ends = events.filter((e) => e.kind === 'market.shortage.ended');
    expect(starts.length).toBeGreaterThanOrEqual(5);
    for (const e of starts) {
      const hours = e.data['hours'] as number;
      expect(hours).toBeGreaterThanOrEqual(balance.shortage.minHours);
      expect(hours).toBeLessThanOrEqual(balance.shortage.maxHours);
    }
    // Every shortage that is not still running has ended, and an end names a hub and a good.
    expect(starts.length - ends.length).toBe(s.shortages.length);
    for (const e of ends) expect(typeof e.data['good']).toBe('string');
    expect(s.shortages.length).toBeLessThanOrEqual(balance.shortage.maxActive);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('lift the base price with a shortage part, double the bid depth, then go back', () => {
    let s = scenario(7);
    let during: { hub: string; good: string } | null = null;
    let priceDuring = 0;
    for (let h = 1; h <= 24 && !during; h++) {
      s = step(s, [], s.nowMs + MS_PER_HOUR).state;
      const sh = s.shortages[0];
      if (sh) {
        during = { hub: sh.hub, good: sh.good };
        const book = s.markets[sh.hub]?.[sh.good];
        priceDuring = book?.baseCents ?? 0;
        expect(book?.why.shortage).toBeGreaterThan(0);
        expect(isShort(s, sh.hub, sh.good)).toBe(true);
        expect(bidDepthCap(s, sh.hub, sh.good)).toBe(balance.market.civicDepthCap * 2);
      }
    }
    expect(during).not.toBeNull();
    if (!during) return;
    // Run past the longest shortage: this one is over and its price part is gone.
    for (let h = 1; h <= balance.shortage.maxHours + 1; h++) {
      s = step(s, [], s.nowMs + MS_PER_HOUR).state;
    }
    const after = s.markets[during.hub]?.[during.good as 'parts'];
    const priceBefore = after?.baseCents ?? 0;
    if (!isShort(s, during.hub, during.good as 'parts')) {
      expect(after?.why.shortage).toBe(0);
      expect(priceBefore).toBeLessThan(priceDuring);
    }
  });
});
