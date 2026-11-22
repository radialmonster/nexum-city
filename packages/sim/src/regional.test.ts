import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, balance } from './balance.js';
import { clone, scenario } from './fixtures.js';
import { hashState } from './hash.js';
import { refreshRegional, addHeat } from './regional.js';
import { step } from './step.js';

describe('regional prices', () => {
  it('splits every hub base into global + transport + raid + demand', () => {
    const s = scenario();
    for (const hub of Object.keys(s.markets)) {
      for (const g of ['parts', 'power', 'data', 'supplies'] as const) {
        const b = s.markets[hub]![g];
        const w = b.why;
        expect(b.baseCents).toBe(w.global + w.transport + w.raid + w.demand);
        expect(w.global).toBeLessThanOrEqual(balance.market.baseRefCents[g]);
      }
    }
  });

  it('is deterministic and recomputed hourly', () => {
    const a = clone(scenario());
    const b = clone(scenario());
    refreshRegional(a);
    refreshRegional(b);
    expect(hashState(a)).toBe(hashState(b));
    const r = step(a, [], a.nowMs + 3 * MS_PER_HOUR).state;
    expect(r.markets['hubW']!.parts.baseCents).toBeGreaterThan(0);
  });

  it('recent raids on a street raise the delivered cost, and the heat fades', () => {
    const s = clone(scenario());
    refreshRegional(s);
    const hub = Object.keys(s.markets).sort()[0]!;
    const before = Object.values(s.markets[hub]!).reduce((n, b) => n + b.baseCents, 0);
    for (const e of s.graph.edges ?? []) addHeat(s, e.a, e.b, 50);
    refreshRegional(s);
    const hot = Object.values(s.markets[hub]!).reduce((n, b) => n + b.baseCents, 0);
    expect(hot).toBeGreaterThanOrEqual(before);
    for (let i = 0; i < 60; i++) refreshRegional(s);
    expect(Object.keys(s.heat).length).toBe(0);
  });
});
