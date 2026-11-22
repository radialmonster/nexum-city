import { describe, expect, it } from 'vitest';
import { ATOMS_PER_CENT, ATOMS_PER_UNIT } from '@nexum/sim';
import type { FeedItem } from '@nexum/contracts';
import {
  bookTable,
  checkLimit,
  fillPrices,
  openOrders,
  parseCredits,
  placement,
  stashUnits,
} from './market';
import { makeView } from './testing';

const book = {
  bids: [
    { price: 90, qty: 5 },
    { price: 95, qty: 3 },
  ],
  asks: [{ price: 110, qty: 4 }],
  civic: { bid: 92, ask: 108, bidDepth: 60, askDepth: 60 },
  refCents: 100,
  lastCents: 101,
};

function view(over: { credits?: number; stash?: number } = {}) {
  return makeView({
    self: {
      credits: over.credits ?? 1000 * ATOMS_PER_CENT,
      stash: { h: { parts: (over.stash ?? 10) * ATOMS_PER_UNIT, power: 0, data: 0, supplies: 0 } },
      score: 0,
      rushUntilMs: 0,
      jobs: [],
      jobNextMs: 0,
    },
    markets: { h: { parts: book, power: book, data: book, supplies: book } },
    orders: [
      { id: 'o1', owner: 'me', hub: 'h', good: 'parts', side: 'buy', price: 90, qty: 5, seq: 2 },
      {
        id: 'o2',
        owner: 'rival',
        hub: 'h',
        good: 'parts',
        side: 'sell',
        price: 120,
        qty: 1,
        seq: 1,
      },
    ],
  });
}

describe('bookTable', () => {
  it('sorts levels best first with running depth and the civic offer merged in', () => {
    const t = bookTable(view(), 'h', 'parts');
    expect(t?.asks.map((r) => [r.price, r.depth, r.civic])).toEqual([
      [108, 60, true],
      [110, 64, false],
    ]);
    expect(t?.bids.map((r) => r.price)).toEqual([95, 92, 90]);
    expect(t?.bids.at(-1)?.depth).toBe(68);
    expect(t?.maxDepth).toBe(68);
  });
  it('is null without a book', () => {
    expect(bookTable(makeView(), 'h', 'parts')).toBeNull();
  });
});

describe('fillPrices', () => {
  it('keeps only fills of that hub and good, oldest first', () => {
    const fill = (seq: number, hub: string, good: string, price: number): FeedItem => ({
      seq,
      event: {
        id: `e${String(seq)}`,
        at: seq,
        kind: 'trade.filled',
        actors: [],
        districts: [hub],
        data: { hub, good, price },
      },
    });
    expect(
      fillPrices(
        [
          fill(1, 'h', 'parts', 100),
          fill(2, 'h', 'power', 5),
          fill(3, 'h', 'parts', 104),
          fill(4, 'x', 'parts', 9),
        ],
        'h',
        'parts',
      ),
    ).toEqual([100, 104]);
  });
});

describe('parseCredits', () => {
  it('reads up to two decimals and rejects junk', () => {
    expect(parseCredits('12.5')).toBe(1250);
    expect(parseCredits(' 3 ')).toBe(300);
    for (const bad of ['', '0', '-1', '1.234', 'abc', '1e3']) expect(parseCredits(bad)).toBeNull();
  });
});

describe('checkLimit', () => {
  const draft = {
    hub: 'h',
    good: 'parts' as const,
    side: 'sell' as const,
    price: '1.00',
    qty: '5',
  };
  it('accepts a sell within the stash and names the escrow', () => {
    expect(checkLimit(view(), draft)).toMatchObject({
      ok: true,
      priceCents: 100,
      qty: 5,
      escrow: '5 parts',
    });
  });
  it('rejects with the sim codes', () => {
    expect(checkLimit(view(), { ...draft, price: 'x' })).toEqual({ ok: false, code: 'bad_price' });
    expect(checkLimit(view(), { ...draft, price: '1000.01' })).toEqual({
      ok: false,
      code: 'bad_price',
    });
    expect(checkLimit(view(), { ...draft, qty: '1.5' })).toEqual({
      ok: false,
      code: 'bad_quantity',
    });
    expect(checkLimit(view(), { ...draft, qty: '1001' })).toEqual({
      ok: false,
      code: 'bad_quantity',
    });
    expect(checkLimit(view({ stash: 2 }), draft)).toEqual({
      ok: false,
      code: 'insufficient_goods',
    });
    expect(checkLimit(view({ credits: 0 }), { ...draft, side: 'buy' })).toEqual({
      ok: false,
      code: 'insufficient_credits',
    });
  });
  it('a buy escrows credits', () => {
    expect(checkLimit(view(), { ...draft, side: 'buy', qty: '10' })).toMatchObject({
      ok: true,
      escrow: '10.00 credits',
    });
  });
});

describe('helpers', () => {
  it('lists only my orders and stash units', () => {
    expect(openOrders(view()).map((o) => o.id)).toEqual(['o1']);
    expect(stashUnits(view(), 'h', 'parts')).toBe(10);
    expect(stashUnits(view(), 'zz', 'parts')).toBe(0);
  });
  it('says when an order would cross', () => {
    const t = bookTable(view(), 'h', 'parts');
    expect(placement(t, 'buy', 110)).toMatch(/fills at once/);
    expect(placement(t, 'buy', 100)).toMatch(/waits/);
    expect(placement(t, 'sell', 90)).toMatch(/fills at once/);
  });
});
