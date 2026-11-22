import { describe, expect, it } from 'vitest';
import { ATOMS_PER_UNIT } from '@nexum/sim';
import type { MarketHistoryResponse, PlayerView } from '@nexum/contracts';
import {
  bestHauls,
  chargeHappened,
  chargeNotice,
  charges,
  costOf,
  expectedSale,
  fuelCheck,
  nearestHub,
  powerText,
  saleVerdict,
  shortageAt,
  taxNotice,
  timeLeft,
  trendPoints,
  whyLine,
} from './economy';
import { makeView } from './testing';

const why = { from: 'a', distM: 800, global: 100, transport: 0, demand: 0, raid: 0, shortage: 0 };
const book = (refCents: number, over: Partial<typeof why> = {}) => ({
  bids: [],
  asks: [],
  civic: { bid: refCents - 5, ask: refCents + 5, bidDepth: 10, askDepth: 10 },
  refCents,
  lastCents: null,
  baseCents: refCents,
  why: { ...why, ...over },
});
const goods = (parts = 0, power = 0) => ({ parts, power, data: 0, supplies: 0 });

/** Two hubs, h1 and h2, joined to a by streets of 1 km and 3 km. */
function world(over: Parameters<typeof makeView>[0] = {}) {
  return makeView({
    graph: {
      nodes: {
        a: { id: 'a', type: 'district', pos: { x: 0, y: 0 } },
        h1: { id: 'h1', type: 'district', pos: { x: 1, y: 0 } },
        h2: { id: 'h2', type: 'district', pos: { x: 2, y: 0 } },
      },
      edges: [
        { a: 'a', b: 'h1', lengthM: 1000 },
        { a: 'h1', b: 'h2', lengthM: 2000 },
      ],
      hubs: ['h1', 'h2'],
    },
    markets: {
      h1: { parts: book(100), power: book(50), data: book(100), supplies: book(100) },
      h2: {
        parts: book(300, { transport: 310 }),
        power: book(50),
        data: book(100),
        supplies: book(100),
      },
    },
    ...over,
  });
}

describe('timeLeft', () => {
  it('rounds for a glance', () => {
    expect(timeLeft(0)).toBe('now');
    expect(timeLeft(30_000)).toBe('1m');
    expect(timeLeft(45 * 60_000)).toBe('45m');
    expect(timeLeft(3 * 3_600_000)).toBe('3h');
    expect(timeLeft(3 * 3_600_000 + 20 * 60_000)).toBe('3h 20m');
  });
});

describe('whyLine', () => {
  it('names the biggest reasons', () => {
    const v = world({
      markets: {
        h1: { parts: book(100, { transport: 310, raid: 120 }) } as never,
      },
    });
    expect(whyLine(v, 'h1', 'parts', () => 'the docks')).toBe(
      'Far from the docks (+3.10), Raids on route (+1.20)',
    );
  });

  it('leads with a running shortage and its time left', () => {
    const v = world({
      shortages: [{ hub: 'h2', good: 'parts', startMs: 0, endMs: 1_000_000 + 3 * 3_600_000 }],
    });
    expect(shortageAt(v, 'h2', 'parts')).not.toBeNull();
    expect(whyLine(v, 'h2', 'parts', () => 'the docks')).toBe(
      'SHORTAGE +40% for 3h, Far from the docks (+3.10)',
    );
  });

  it('says so when nothing moves the price', () => {
    expect(whyLine(world(), 'h1', 'parts')).toBe('Base price.');
    expect(whyLine(world(), 'nowhere', 'parts')).toBe('No market here yet.');
  });

  it('ignores a shortage that has ended', () => {
    const v = world({ shortages: [{ hub: 'h2', good: 'parts', startMs: 0, endMs: 5 }] });
    expect(shortageAt(v, 'h2', 'parts')).toBeNull();
  });
});

describe('bestHauls', () => {
  it('finds the gain per unit after fuel', () => {
    const hauls = bestHauls(world());
    const parts = hauls.find((h) => h.good === 'parts');
    expect(parts).toMatchObject({ from: 'h1', to: 'h2' });
    // 2 km by van burns 0.1 power, at 0.50 a unit, shared over 40 units: rounds up to 1 centi-credit
    expect(parts?.fuelCents).toBe(1);
    expect(parts?.gainCents).toBe(300 - 100 - 1);
  });

  it('skips goods that gain nothing', () => {
    expect(bestHauls(world()).find((h) => h.good === 'data')).toBeUndefined();
  });
});

describe('cost and sale', () => {
  it('reads your cost per pile', () => {
    const v = world({
      self: {
        credits: 0,
        stash: {},
        costs: { stash: { h1: goods(1640) }, districts: {}, cargo: {} },
        score: 0,
        rushUntilMs: 0,
        jobs: [],
        jobNextMs: 0,
      },
    });
    expect(costOf(v, 'stash', 'h1', 'parts')).toBe(1640);
    expect(costOf(v, 'stash', 'h1', 'power')).toBeNull();
    expect(costOf(v, 'districts', 'a', 'parts')).toBeNull();
  });

  it('says profit or loss in plain words', () => {
    expect(saleVerdict(null, 100, 5)).toBeNull();
    expect(saleVerdict(1000, 1300, 10)?.text).toBe(
      'You paid 10.00 each, so this is a profit of 3.00 each (30.00 in total).',
    );
    expect(saleVerdict(1000, 800, 1)?.text).toBe(
      'You paid 10.00 each, so this is a loss of 2.00 each.',
    );
    expect(saleVerdict(1000, 1000, 3)?.text).toContain('break even');
    expect(saleVerdict(1000, 800, 5)?.total).toBe(-1000);
  });
});

describe('fuel', () => {
  const ownA = (power: number) =>
    makeView().districts['a'] && {
      ...makeView().districts['a'],
      warehouse: goods(0, power * ATOMS_PER_UNIT),
    };

  it('needs nothing on foot', () => {
    expect(fuelCheck(makeView(), 'a', 'foot', 5000, 0)).toEqual({ units: 0, enough: true });
  });

  it('checks the start store and your other warehouses', () => {
    const base = makeView();
    const a = ownA(0.05);
    // a van over 2 km burns 0.1 power
    const v = makeView({ districts: { ...base.districts, a: a as never } });
    expect(fuelCheck(v, 'a', 'van', 2000, 0)).toEqual({ units: 0.1, enough: false });
    const v2 = makeView({
      districts: {
        ...base.districts,
        a: ownA(0.2) as never,
      },
    });
    expect(fuelCheck(v2, 'a', 'van', 2000, 0).enough).toBe(true);
    // power in the cargo cannot also be burned
    expect(fuelCheck(v2, 'a', 'van', 2000, 0.15).enough).toBe(false);
  });

  it('finds the nearest hub', () => {
    expect(nearestHub(world(), 'a')).toBe('h1');
  });

  it('works out the sale after fuel', () => {
    const sale = expectedSale(world(), 'h2', { parts: 10 }, 0.5);
    // 10 x 3.00 = 3000, less 0.5 power at 0.50 = 25
    expect(sale).toEqual({ hubGross: 3000, netCents: 2975 });
    expect(expectedSale(world(), 'h2', {}, 0)).toBeNull();
  });
});

describe('city tax', () => {
  const rich = (credits: number, extra = 0) => {
    const base = makeView();
    const districts = { ...base.districts };
    for (let i = 0; i < extra; i++) {
      districts[`x${String(i)}`] = {
        ...(Object.values(base.districts)[0] as object),
        id: `x${String(i)}`,
      } as never;
    }
    return makeView({
      nowMs: 10 * 3_600_000,
      districts,
      self: { ...base.self, credits: credits * ATOMS_PER_UNIT },
    });
  };

  it('charges upkeep only: the nightly levy is off, and the next charge counts down', () => {
    const c = charges(rich(800, 1));
    expect(c.upkeepCredits).toBe(20);
    expect(c.levyCredits).toBe(0);
    expect(c.levyPercent).toBe(0);
    expect(c.nextMs).toBe(24 * 3_600_000);
  });

  it('is free for a single district, whatever you hold', () => {
    for (const held of [100, 5_000]) {
      const c = charges(rich(held));
      expect(c.upkeepCredits).toBe(0);
      expect(c.levyCredits).toBe(0);
    }
    expect(taxNotice(rich(5_000))).toContain('first district is free');
  });

  it('says what upkeep costs for extra districts, and never mentions a tax', () => {
    const text = taxNotice(rich(800, 2));
    expect(text).toBe('Upkeep for your extra districts is 40 cr a day, next due in 14h.');
    expect(text).not.toContain('tax');
  });

  it('spots a charge from the sink totals', () => {
    const a = makeView();
    const b = makeView({ sink: { feesAtoms: 0, upkeepAtoms: 0, levyAtoms: 5 } });
    expect(chargeHappened(null, b)).toBe(false);
    expect(chargeHappened(a, a)).toBe(false);
    expect(chargeHappened(a, b)).toBe(true);
  });
});

describe('trendPoints', () => {
  const hist = (ts: number[]): MarketHistoryResponse => ({
    ok: true,
    nowMs: 0,
    hub: 'h1',
    good: 'parts',
    bucketMs: 3_600_000,
    buckets: ts.map((t, i) => ({ t, open: 1, low: 1, high: 1, close: 100 + i, qty: 1, n: 1 })),
    civic: { refCents: 100, baseCents: 100, lastCents: 99 },
  });

  it('marks your last visit', () => {
    expect(trendPoints(hist([0, 10, 20]), 12)).toEqual({ points: [100, 101, 102], markAt: 1 });
    expect(trendPoints(hist([0, 10, 20]), null).markAt).toBeNull();
    expect(trendPoints(hist([5, 10]), 1).markAt).toBeNull();
  });

  it('falls back to the last civic quote', () => {
    expect(trendPoints(hist([]), null).points).toEqual([99]);
  });
});

describe('chargeNotice', () => {
  const at = (ms: number, levy: number, credits = 1000, upkeep = 0) =>
    makeView({
      nowMs: ms,
      season: { startMs: 0, endMs: 10_000_000_000, finaleStartMs: 9_000_000_000, finale: false },
      self: { ...makeView().self, credits: credits * ATOMS_PER_UNIT },
      sink: {
        feesAtoms: 0,
        upkeepAtoms: upkeep * ATOMS_PER_UNIT,
        levyAtoms: levy * ATOMS_PER_UNIT,
      },
    });

  it('stays silent until the shared totals rise', () => {
    expect(chargeNotice(null, at(1000, 0))).toBeNull();
    expect(chargeNotice(at(1000, 0), at(2000, 0))).toBeNull();
  });

  it('reports the upkeep taken, estimated from the view before it', () => {
    const base = makeView();
    const districts = {
      ...base.districts,
      x0: { ...(Object.values(base.districts)[0] as object), id: 'x0' } as never,
    };
    const withExtra = (v: PlayerView) => ({ ...v, districts });
    const n = chargeNotice(
      withExtra(at(86_000_000, 0, 1000)),
      withExtra(at(87_000_000, 0, 980, 20)),
    );
    expect(n?.upkeepCredits).toBe(20);
    expect(n?.levyCredits).toBe(0);
    expect(n?.atMs).toBe(86_400_000);
    expect(n?.text).toBe('Upkeep for your extra districts cost 20 cr.');
  });

  it('stays silent when a charge ran but took nothing from you', () => {
    expect(chargeNotice(at(86_000_000, 0, 100), at(87_000_000, 50, 100))).toBeNull();
  });
});

describe('powerText', () => {
  it('keeps the hundredths and drops trailing zeros', () => {
    expect(powerText(0.28)).toBe('0.28');
    expect(powerText(0.6)).toBe('0.6');
    expect(powerText(12)).toBe('12');
  });
});
