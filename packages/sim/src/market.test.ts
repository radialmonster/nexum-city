import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, balance, toAtoms } from './balance.js';
import { clone, scenario } from './fixtures.js';
import { checkInvariants } from './invariants.js';
import { civicAsk, civicBid } from './market.js';
import { hashState } from './hash.js';
import { step } from './step.js';
import { viewFor } from './fog.js';
import type { Book, GameState, Good, Id, Input, Order, SimEvent } from './types.js';

const HUB = 'hubW';
const who = (s: GameState, id: Id) => {
  const p = s.players[id];
  if (!p) throw new Error(`no player ${id}`);
  return p;
};
const place = (
  actorId: Id,
  side: 'buy' | 'sell',
  price: number,
  qty: number,
  good: Good = 'parts',
  atMs?: number,
): Input => ({
  actorId,
  order: { type: 'market.place', hub: HUB, side, good, price, qty },
  ...(atMs === undefined ? {} : { atMs }),
});

/** p1 and p2 with 100 parts / 100 power in their hub stash and plenty of credits. */
function base(): GameState {
  const s = clone(scenario());
  who(s, 'p1').stash[HUB] = { parts: toAtoms(100), power: toAtoms(100), data: 0, supplies: 0 };
  who(s, 'p2').stash[HUB] = { parts: toAtoms(100), power: toAtoms(100), data: 0, supplies: 0 };
  who(s, 'p1').credits = toAtoms(10_000);
  who(s, 'p2').credits = toAtoms(10_000);
  return s;
}

const run = (s: GameState, inputs: Input[], toMs = s.nowMs + 1) => step(s, inputs, toMs);
const trades = (events: SimEvent[]) => events.filter((e) => e.kind === 'trade.filled');
const stashOf = (s: GameState, id: Id, good: Good = 'parts') =>
  (s.players[id]?.stash[HUB]?.[good] ?? 0) / toAtoms(1);
const credits = (s: GameState, id: Id) => (s.players[id]?.credits ?? 0) / toAtoms(1);
const book = (s: GameState, good: Good = 'parts') => s.markets[HUB]?.[good] as Book;

describe('civic traders', () => {
  it('quote the reference plus and minus 8 percent', () => {
    const b = book(base());
    expect(b.refCents).toBe(1800);
    expect(civicBid(b)).toBe(1656);
    expect(civicAsk(b)).toBe(1944);
  });
  it('start at the spec references', () => {
    const s = base();
    expect(
      (['parts', 'power', 'data', 'supplies'] as const).map(
        (g) => (s.markets[HUB]?.[g] as Book).refCents,
      ),
    ).toEqual([1800, 1400, 2400, 1000]);
  });
});

describe('placing orders', () => {
  it('rests a sell and locks the goods', () => {
    const { state, events } = run(base(), [place('p1', 'sell', 3000, 10)]);
    expect(book(state).asks).toHaveLength(1);
    expect(stashOf(state, 'p1')).toBe(90);
    expect(trades(events)).toHaveLength(0);
    expect(checkInvariants(state)).toEqual([]);
  });
  it('rests a buy and locks credits at the limit price', () => {
    const { state } = run(base(), [place('p1', 'buy', 1000, 10)]);
    expect(book(state).bids).toHaveLength(1);
    expect(credits(state, 'p1')).toBe(10_000 - 100);
  });
  it('rejects bad input with typed codes', () => {
    const s = base();
    const err = (order: Order, actor = 'p1'): string | undefined => {
      const { events } = run(s, [{ actorId: actor, order }]);
      return events.find((e) => e.kind === 'order.rejected')?.data['error'] as string | undefined;
    };
    const mk = (o: Partial<Extract<Order, { type: 'market.place' }>>): Order => ({
      type: 'market.place',
      hub: HUB,
      side: 'sell',
      good: 'parts',
      price: 3000,
      qty: 1,
      ...o,
    });
    expect(err(mk({ hub: 'nope' }))).toBe('unknown_district');
    expect(err(mk({ hub: 'd2_1' }))).toBe('invalid_target');
    expect(err(mk({ good: 'gold' as Good }))).toBe('unknown_good');
    expect(err(mk({ price: 0 }))).toBe('bad_price');
    expect(err(mk({ price: 1.5 }))).toBe('bad_price');
    expect(err(mk({ qty: 0 }))).toBe('bad_quantity');
    expect(err(mk({ qty: 101 }))).toBe('insufficient_goods');
    expect(err(mk({ side: 'buy', price: 100_000, qty: 200 }))).toBe('insufficient_credits');
    expect(err({ type: 'market.cancel', orderId: 'o99' })).toBe('unknown_order');
    expect(err(mk({}), 'ghost')).toBe('unknown_actor');
  });
  it('limits open orders per player', () => {
    const inputs = Array.from({ length: balance.market.maxOrdersPerPlayer + 1 }, () =>
      place('p1', 'sell', 9000, 1),
    );
    const { state, events } = run(base(), inputs);
    expect(book(state).asks).toHaveLength(balance.market.maxOrdersPerPlayer);
    expect(events.find((e) => e.kind === 'order.rejected')?.data['error']).toBe('too_many_orders');
  });
});

describe('matching', () => {
  it('fills a crossing order instantly at the resting price and refunds the gap', () => {
    const { state, events } = run(base(), [
      place('p1', 'sell', 1750, 10),
      place('p2', 'buy', 1900, 10),
    ]);
    const t = trades(events);
    expect(t).toHaveLength(1);
    expect(t[0]?.data).toMatchObject({
      price: 1750,
      qty: 10,
      buyer: 'p2',
      seller: 'p1',
      taker: 'buy',
    });
    expect(t[0]?.actors).toEqual(['p2', 'p1']);
    expect(stashOf(state, 'p2')).toBe(110);
    expect(credits(state, 'p2')).toBe(10_000 - 175);
    expect(credits(state, 'p1')).toBe(10_000 + 175);
    expect(book(state).asks).toHaveLength(0);
    expect(book(state).bids).toHaveLength(0);
  });
  it('fills partially and rests the remainder', () => {
    const { state, events } = run(base(), [
      place('p1', 'sell', 1750, 4),
      place('p2', 'buy', 1750, 10),
    ]);
    expect(trades(events)).toHaveLength(1);
    expect(book(state).bids[0]?.qty).toBe(6);
    expect(credits(state, 'p2')).toBe(10_000 - 175);
    expect(stashOf(state, 'p2')).toBe(104);
    expect(checkInvariants(state)).toEqual([]);
  });
  it('matches best price first, then earliest', () => {
    // Prices inside the civic spread so only players trade.
    const s = base();
    s.players['p3'] = { ...clone(who(s, 'p1')), id: 'p3', stash: {} };
    const { state, events } = run(s, [
      place('p1', 'sell', 1800, 5),
      place('p2', 'sell', 1750, 5),
      place('p1', 'sell', 1750, 5),
      place('p3', 'buy', 1800, 12),
    ]);
    const t = trades(events).map((e) => [e.data['seller'], e.data['price'], e.data['qty']]);
    expect(t).toEqual([
      ['p2', 1750, 5],
      ['p1', 1750, 5],
      ['p1', 1800, 2],
    ]);
    expect(book(state).asks[0]?.qty).toBe(3);
  });
  it('does not match when prices do not cross', () => {
    const { events } = run(base(), [place('p1', 'sell', 1900, 5), place('p2', 'buy', 1800, 5)]);
    expect(trades(events)).toHaveLength(0);
  });
  it('trades with the civic ask when it is the best price', () => {
    const { state, events } = run(base(), [place('p1', 'buy', 2000, 10)]);
    const t = trades(events);
    expect(t).toHaveLength(1);
    expect(t[0]?.data).toMatchObject({ price: 1944, qty: 10, seller: 'civic', buyer: 'p1' });
    expect(t[0]?.actors).toEqual(['p1']);
    expect(stashOf(state, 'p1')).toBe(110);
    expect(credits(state, 'p1')).toBe(10_000 - 194.4);
    expect(book(state).askDepth).toBe(50);
  });
  it('sells to the civic bid', () => {
    const { state, events } = run(base(), [place('p1', 'sell', 1000, 10)]);
    expect(trades(events)[0]?.data).toMatchObject({ price: 1656, buyer: 'civic' });
    expect(credits(state, 'p1')).toBeCloseTo(10_000 + 165.6, 6);
    expect(stashOf(state, 'p1')).toBe(90);
  });
  it('lets a player order beat the civic quote at the same price', () => {
    const { events } = run(base(), [place('p1', 'sell', 1944, 5), place('p2', 'buy', 1944, 5)]);
    expect(trades(events)[0]?.data['seller']).toBe('p1');
  });
  it('limits civic depth and rests what the civic traders will not take', () => {
    const { state, events } = run(base(), [place('p1', 'sell', 1000, 100)]);
    const total = trades(events).reduce((n, e) => n + (e.data['qty'] as number), 0);
    expect(total).toBe(balance.market.civicDepthCap);
    expect(book(state).bidDepth).toBe(0);
    // The fill pulls the reference down toward the trade price.
    expect(book(state).refCents).toBeLessThan(1800);
    expect(book(state).asks[0]?.qty).toBe(40);
    expect(checkInvariants(state)).toEqual([]);
  });
  it('refills depth hourly, pulls the reference back, and sweeps resting orders', () => {
    let s = run(base(), [place('p1', 'sell', 1000, 100)]).state;
    expect(book(s).bidDepth).toBe(0);
    const ref = book(s).refCents;
    expect(ref).toBeLessThan(1800);
    const next = step(s, [], s.nowMs + MS_PER_HOUR + 1);
    s = next.state;
    // Hourly: +20 depth, reference back toward base, then the resting ask is swept.
    expect(trades(next.events).reduce((n, e) => n + (e.data['qty'] as number), 0)).toBe(20);
    expect(book(s).asks[0]?.qty).toBe(20);
    expect(book(s).refCents).toBeGreaterThan(ref - 100);
  });
});

describe('cancelling', () => {
  it('refunds a sell escrow', () => {
    let s = run(base(), [place('p1', 'sell', 3000, 10)]).state;
    const id = String(book(s).asks[0]?.id);
    s = run(s, [{ actorId: 'p1', order: { type: 'market.cancel', orderId: id } }]).state;
    expect(stashOf(s, 'p1')).toBe(100);
    expect(book(s).asks).toHaveLength(0);
  });
  it('refunds the unfilled part of a buy escrow', () => {
    let s = run(base(), [place('p1', 'sell', 1750, 4), place('p2', 'buy', 1750, 10)]).state;
    expect(credits(s, 'p2')).toBe(10_000 - 175);
    const id = String(book(s).bids[0]?.id);
    s = run(s, [{ actorId: 'p2', order: { type: 'market.cancel', orderId: id } }]).state;
    expect(credits(s, 'p2')).toBe(10_000 - 70);
    expect(stashOf(s, 'p2')).toBe(104);
  });
  it("rejects cancelling someone else's order", () => {
    const s = run(base(), [place('p1', 'sell', 3000, 10)]).state;
    const id = String(book(s).asks[0]?.id);
    const { events } = run(s, [{ actorId: 'p2', order: { type: 'market.cancel', orderId: id } }]);
    expect(events.find((e) => e.kind === 'order.rejected')?.data['error']).toBe('not_owner');
  });
});

describe('invariants', () => {
  it('never goes negative under a barrage of orders', () => {
    let s = base();
    const inputs: Input[] = [];
    for (let i = 0; i < 60; i++) {
      const who = i % 2 === 0 ? 'p1' : 'p2';
      const good = (['parts', 'power'] as const)[i % 2] ?? 'parts';
      inputs.push(
        place(
          who,
          i % 3 === 0 ? 'buy' : 'sell',
          1000 + ((i * 337) % 2500),
          1 + (i % 17),
          good,
          i * 60_000,
        ),
      );
    }
    s = step(s, inputs, 3 * MS_PER_HOUR).state;
    expect(checkInvariants(s)).toEqual([]);
  });
});

describe('the view', () => {
  it('shows public books and only your own orders', () => {
    const s = run(base(), [place('p1', 'sell', 3000, 10), place('p2', 'sell', 3000, 5)]).state;
    const v1 = viewFor(s, 'p1');
    expect(v1.markets[HUB]?.['parts']?.asks).toEqual([{ price: 3000, qty: 15 }]);
    expect(v1.orders).toHaveLength(1);
    expect(v1.orders[0]?.owner).toBe('p1');
    expect(viewFor(s, 'p2').orders[0]?.qty).toBe(5);
    expect(v1.markets[HUB]?.['parts']?.civic).toMatchObject({ bid: 1656, ask: 1944 });
  });
});

describe('determinism', () => {
  it('gives the same state in 2 s ticks as in one jump, with orders in between', () => {
    const s = base();
    const inputs: Input[] = [
      place('p1', 'sell', 1000, 30, 'parts', 1_000),
      place('p2', 'buy', 2500, 20, 'parts', 5_000),
      place('p2', 'sell', 3200, 10, 'power', 9_000),
      place('p1', 'buy', 1500, 15, 'power', 12_000),
      place('p1', 'sell', 1000, 50, 'parts', 20_000),
    ];
    const end = 2 * MS_PER_HOUR + 5_000;
    const jump = step(s, inputs, end);
    let cur = s;
    const events: SimEvent[] = [];
    for (let t = s.nowMs; t < end;) {
      t = Math.min(end, t + 2_000);
      const due = inputs.filter((i) => (i.atMs ?? 0) > t - 2_000 && (i.atMs ?? 0) <= t);
      const r = step(cur, due, t);
      cur = r.state;
      events.push(...r.events);
    }
    expect(hashState(cur)).toBe(hashState(jump.state));
    expect(events).toEqual(jump.events);
    expect(trades(jump.events).length).toBeGreaterThan(0);
  });
});

describe('trade score', () => {
  const ms = (p: string, s: GameState) => who(s, p).tradeMs;

  it('pays 1 point per 100 credits to both sides of a player trade', () => {
    // 5 parts at 18.00 = 90 credits = 0.9 point = 3,240,000 ms for each side.
    const { state } = run(base(), [place('p1', 'sell', 1800, 5), place('p2', 'buy', 1800, 5)]);
    expect(ms('p1', state)).toBe(3_240_000);
    expect(ms('p2', state)).toBe(3_240_000);
    // Trade points are part of the total score.
    expect(who(state, 'p1').score).toBeGreaterThanOrEqual(3_240_000);
  });
  it('pays on civic fills too, but only to the player', () => {
    const { state } = run(base(), [place('p1', 'sell', 1000, 10)]);
    // 10 parts at the civic bid 16.56 = 165.6 credits.
    expect(ms('p1', state)).toBe(16_560 * 360);
    expect(ms('p2', state)).toBe(0);
  });
  it('does not pay for trading with yourself', () => {
    const { state } = run(base(), [place('p1', 'sell', 1800, 5), place('p1', 'buy', 1800, 5)]);
    expect(ms('p1', state)).toBe(0);
  });
  it('stops at the daily cap and starts again the next season day', () => {
    const s = base();
    const p = who(s, 'p1');
    const day = Math.floor((s.nowMs - s.season.startMs) / (24 * MS_PER_HOUR));
    p.tradeDay = day;
    p.tradeDayMs = balance.tradeScore.dailyCapPoints * MS_PER_HOUR - 1000;
    const first = run(s, [place('p1', 'sell', 1000, 10)]);
    // Only the last 1000 ms of the cap are paid out.
    expect(ms('p1', first.state)).toBe(1000);
    const again = run(first.state, [place('p1', 'sell', 1000, 10)], first.state.nowMs + 1);
    expect(ms('p1', again.state)).toBe(1000);
    const at = again.state.nowMs + 24 * MS_PER_HOUR;
    const next = run(again.state, [place('p1', 'sell', 1000, 10, 'parts', at)], at);
    expect(ms('p1', next.state)).toBeGreaterThan(1000);
    expect(checkInvariants(next.state)).toEqual([]);
  });
});
