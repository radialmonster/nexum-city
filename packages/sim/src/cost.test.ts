import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, toAtoms } from './balance.js';
import { costCents, share, take, put, emptyValue } from './cost.js';
import { clone, crewsOf, scenario, vanOf } from './fixtures.js';
import { hashState } from './hash.js';
import { checkInvariants } from './invariants.js';
import { createWorld } from './world.js';
import { step } from './step.js';
import type { GameState, Goods, Input } from './types.js';

const goods = (p = 0, w = 0, d = 0, s = 0): Goods => ({
  parts: toAtoms(p),
  power: toAtoms(w),
  data: toAtoms(d),
  supplies: toAtoms(s),
});

describe('cost basis arithmetic', () => {
  it('averages, takes a share and merges exactly', () => {
    const g = goods(10);
    const v = emptyValue();
    v.parts = g.parts * 2000; // 10 units at 20.00
    expect(costCents(g.parts, v.parts)).toBe(2000);
    const out = take(g, v, goods(4));
    expect(out.parts).toBe(toAtoms(4) * 2000);
    expect(costCents(g.parts, v.parts)).toBe(2000);
    // merging 6 units at 20.00 with 4 at 30.00 averages to 24.00
    put(g, v, goods(4), { ...emptyValue(), parts: toAtoms(4) * 3000 });
    expect(costCents(g.parts, v.parts)).toBe(2400);
    expect(share(100, 0, 10)).toBe(0);
    expect(share(100, 10, 10)).toBe(100);
  });
  it('zeroes the value when a pile empties', () => {
    const g = goods(3);
    const v = emptyValue();
    v.parts = g.parts * 1234 + 7;
    take(g, v, goods(3));
    expect(v.parts).toBe(0);
  });
});

describe('cost basis through the world', () => {
  it('production adds goods at the local hub reference', () => {
    const s0 = clone(scenario());
    const d0 = s0.districts['d2_1']!;
    d0.warehouseValue = emptyValue();
    d0.warehouse = goods();
    const s = step(s0, [], s0.nowMs + 3 * MS_PER_HOUR).state;
    const d = s.districts['d2_1']!;
    const made = Object.keys(d.warehouse).find(
      (g) => d.warehouse[g as keyof Goods] > 0,
    ) as keyof Goods;
    expect(made).toBeDefined();
    const ref = s.markets[d.nearHub ?? 'hubW']![made].refCents;
    // the reference drifts hourly, so the average sits close to (not exactly at) the current one
    expect(Math.abs(costCents(d.warehouse[made], d.warehouseValue[made]) - ref)).toBeLessThan(
      ref * 0.15,
    );
    expect(checkInvariants(s)).toEqual([]);
  });

  it('a haul carries its cost to the destination and merges there', () => {
    const s0 = clone(scenario());
    const from = s0.districts['d2_1']!;
    const to = s0.districts['d3_1']!;
    from.warehouseValue.parts = from.warehouse.parts * 3000; // 40 units at 30.00
    to.warehouse.parts = toAtoms(10);
    to.warehouseValue.parts = toAtoms(10) * 2000; // 10 units at 20.00
    const [c1] = crewsOf(s0, 'p1') as [string];
    const input: Input = {
      actorId: 'p1',
      order: {
        type: 'haul',
        carrierId: vanOf(s0, 'p1'),
        crewIds: [c1],
        to: 'd3_1',
        cargo: { parts: 30 },
      },
    };
    let s = step(s0, [input], s0.nowMs + 1).state;
    const van = Object.values(s.movements).find((m) => m.owner === 'p1')!;
    expect(costCents(van.cargo.parts, van.value.parts)).toBe(3000);
    expect(checkInvariants(s)).toEqual([]);
    s = step(s, [], s.nowMs + 6 * MS_PER_HOUR).state;
    const d = s.districts['d3_1']!;
    expect(d.warehouse.parts).toBe(toAtoms(40));
    // (30 at 30.00 + 10 at 20.00) / 40 = 27.50, give or take production that landed meanwhile
    expect(costCents(d.warehouse.parts, d.warehouseValue.parts)).toBeGreaterThan(2000);
    expect(costCents(d.warehouse.parts, d.warehouseValue.parts)).toBeLessThanOrEqual(3000);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('a buy sets the stash cost to the fill price', () => {
    const s0 = clone(scenario());
    const p = s0.players['p1']!;
    p.credits = toAtoms(10_000);
    const ask = s0.markets['hubW']!.parts;
    const r = step(
      s0,
      [
        {
          actorId: 'p1',
          order: {
            type: 'market.place',
            hub: 'hubW',
            side: 'buy',
            good: 'parts',
            price: ask.refCents * 2,
            qty: 5,
          },
        },
      ],
      s0.nowMs + 1,
    );
    const stash = r.state.players['p1']!.stash['hubW']!;
    const value = r.state.players['p1']!.stashValue['hubW']!;
    expect(stash.parts).toBeGreaterThan(0);
    const fills = r.events.filter((e) => e.kind === 'trade.filled');
    expect(fills.length).toBeGreaterThan(0);
    expect(costCents(stash.parts, value.parts)).toBeGreaterThan(0);
    expect(checkInvariants(r.state)).toEqual([]);
  });
});

describe('cost basis over a long bot run', () => {
  it('keeps every pile consistent and replays identically', () => {
    const run = (): GameState => {
      let s = createWorld(5);
      for (let h = 0; h < 6; h++) s = step(s, [], s.nowMs + 12 * MS_PER_HOUR).state;
      return s;
    };
    const a = run();
    expect(checkInvariants(a)).toEqual([]);
    expect(hashState(run())).toBe(hashState(a));
  });
});
