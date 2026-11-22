import { ATOMS_PER_UNIT, MS_PER_HOUR, balance, toAtoms } from './balance.js';
import { emit, schedule, type Ctx } from './ctx.js';
import { put, share, take } from './cost.js';
import { emptyGoods } from './production.js';
import { refreshRegional } from './regional.js';
import { addTradeScore } from './score.js';
import { bidDepthCap } from './shortage.js';
import { feeOn } from './sink.js';
import type { System } from './systems.js';
import {
  GOODS,
  type Book,
  type GameState,
  type Good,
  type Id,
  type MarketOrder,
  type OrderError,
  type Side,
} from './types.js';

/** Credit atoms in one centi-credit of price for one unit of goods. */
export const ATOMS_PER_CENT = ATOMS_PER_UNIT / balance.market.priceScale;

const M = balance.market;

export function newBook(good: Good): Book {
  return {
    bids: [],
    asks: [],
    refCents: M.baseRefCents[good],
    baseCents: M.baseRefCents[good],
    why: {
      from: null,
      distM: 0,
      global: M.baseRefCents[good],
      transport: 0,
      demand: 0,
      raid: 0,
      shortage: 0,
    },
    bidDepth: M.civicDepthCap,
    askDepth: M.civicDepthCap,
    lastCents: null,
  };
}

/** One empty book per good for a hub. */
export function newHubBooks(): Record<Good, Book> {
  return {
    parts: newBook('parts'),
    power: newBook('power'),
    data: newBook('data'),
    supplies: newBook('supplies'),
  };
}

/** The civic traders' standing prices (integer centi-credits). */
export const civicBid = (book: Book): number =>
  Math.floor((book.refCents * (100 - M.civicSpreadPercent)) / 100);
export const civicAsk = (book: Book): number =>
  Math.floor((book.refCents * (100 + M.civicSpreadPercent) + 99) / 100);

/** Keeps a reference price within the band around the hub's own base for the good. */
function clampRef(book: Book, ref: number): number {
  const base = book.baseCents;
  const lo = Math.ceil((base * M.refMinPercent) / 100);
  const hi = Math.floor((base * M.refMaxPercent) / 100);
  return Math.min(hi, Math.max(lo, ref));
}

/** Moves a hub's reference price for a good up by a percent (raids use it: scarcity raises prices). */
export function nudgeRef(state: GameState, hub: Id, good: Good, percent: number): void {
  const book = state.markets[hub]?.[good];
  if (!book) return;
  book.refCents = clampRef(book, book.refCents + Math.ceil((book.refCents * percent) / 100));
}

/** Checks a placement without changing anything. */
export function validatePlace(
  ctx: Pick<Ctx, 'state'>,
  actorId: Id,
  o: { hub: Id; side: Side; good: Good; price: number; qty: number },
): OrderError | null {
  const { state } = ctx;
  const hub = state.districts[o.hub];
  if (!hub) return 'unknown_district';
  if (hub.kind !== 'hub') return 'invalid_target';
  if (!(GOODS as readonly string[]).includes(o.good)) return 'unknown_good';
  if (o.side !== 'buy' && o.side !== 'sell') return 'invalid_target';
  if (!Number.isInteger(o.price) || o.price < 1 || o.price > M.maxPrice) return 'bad_price';
  if (!Number.isInteger(o.qty) || o.qty < 1 || o.qty > M.maxQty) return 'bad_quantity';
  const player = state.players[actorId];
  if (!player) return 'unknown_actor';
  let open = 0;
  for (const books of Object.values(state.markets)) {
    for (const g of GOODS) {
      for (const order of [...(books[g]?.bids ?? []), ...(books[g]?.asks ?? [])]) {
        if (order.owner === actorId) open += 1;
      }
    }
  }
  if (open >= M.maxOrdersPerPlayer) return 'too_many_orders';
  if (o.side === 'sell') {
    if ((player.stash[o.hub]?.[o.good] ?? 0) < toAtoms(o.qty)) return 'insufficient_goods';
  } else if (player.credits < o.price * o.qty * ATOMS_PER_CENT) {
    return 'insufficient_credits';
  }
  return null;
}

/** Finds an open order anywhere. */
export function findOrder(
  ctx: Pick<Ctx, 'state'>,
  orderId: Id,
): { order: MarketOrder; book: Book } | null {
  for (const hub of Object.keys(ctx.state.markets)) {
    for (const g of GOODS) {
      const book = ctx.state.markets[hub]?.[g];
      if (!book) continue;
      for (const order of [...book.bids, ...book.asks]) {
        if (order.id === orderId) return { order, book };
      }
    }
  }
  return null;
}

function insertSorted(list: MarketOrder[], order: MarketOrder, side: Side): void {
  // Bids: higher price first. Asks: lower price first. Ties: older (lower seq) first.
  const before = (a: MarketOrder): boolean =>
    side === 'buy' ? a.price >= order.price : a.price <= order.price;
  let i = 0;
  while (i < list.length && before(list[i] as MarketOrder)) i++;
  list.splice(i, 0, order);
}

function stashValue(ctx: Ctx, owner: Id, hub: Id) {
  const player = ctx.state.players[owner];
  if (!player) throw new Error(`unknown player ${owner}`);
  return (player.stashValue[hub] ??= emptyGoods());
}

function stash(ctx: Ctx, owner: Id, hub: Id) {
  const player = ctx.state.players[owner];
  if (!player) throw new Error(`unknown player ${owner}`);
  return (player.stash[hub] ??= emptyGoods());
}

/**
 * Executes one fill. `buy` / `sell` are the player orders involved (`null` for a
 * civic trader). Escrow moved at placement, so the buyer is refunded the gap
 * between their limit and the trade price, and the seller is paid.
 */
function fill(
  ctx: Ctx,
  book: Book,
  buy: MarketOrder | null,
  sell: MarketOrder | null,
  hub: Id,
  good: Good,
  price: number,
  qty: number,
  taker: Side,
): void {
  const { state } = ctx;
  let costOfSold = 0;
  if (buy) {
    const buyer = state.players[buy.owner];
    if (buyer) buyer.credits += (buy.price - price) * qty * ATOMS_PER_CENT;
    const bought = emptyGoods();
    const boughtValue = emptyGoods();
    bought[good] = toAtoms(qty);
    boughtValue[good] = toAtoms(qty) * price;
    put(stash(ctx, buy.owner, hub), stashValue(ctx, buy.owner, hub), bought, boughtValue);
    buy.qty -= qty;
  } else {
    book.bidDepth -= qty;
  }
  if (sell) {
    const seller = state.players[sell.owner];
    if (seller) {
      // The hub keeps a small cut of what a seller is paid (sim-spec, "Credit sinks").
      const gross = price * qty * ATOMS_PER_CENT;
      const fee = feeOn(gross);
      seller.credits += gross - fee;
      state.sink.feesAtoms += fee;
    }
    // The goods leave with their share of the escrowed cost basis.
    const part = share(sell.value, toAtoms(qty), toAtoms(sell.qty));
    sell.value -= part;
    sell.qty -= qty;
    costOfSold = part;
  } else {
    book.askDepth -= qty;
  }
  book.lastCents = price;
  book.refCents = clampRef(
    book,
    book.refCents + Math.trunc((price - book.refCents) / M.refDriftDivisor),
  );
  // Trade earns score, but a player trading with themselves does not.
  if (!buy || !sell || buy.owner !== sell.owner) {
    if (buy) addTradeScore(ctx, buy.owner, price * qty);
    if (sell) addTradeScore(ctx, sell.owner, price * qty);
  }
  const actors = [buy?.owner, sell?.owner].filter((a): a is Id => a !== undefined);
  emit(ctx, 'trade.filled', actors, [hub], {
    hub,
    good,
    price,
    qty,
    buyer: buy?.owner ?? 'civic',
    seller: sell?.owner ?? 'civic',
    taker,
    buyOrder: buy?.id ?? null,
    sellOrder: sell?.id ?? null,
    costCents: sell && qty > 0 ? Math.floor(costOfSold / toAtoms(qty)) : null,
  });
}

function prune(list: MarketOrder[]): void {
  for (let i = list.length - 1; i >= 0; i--)
    if ((list[i] as MarketOrder).qty <= 0) list.splice(i, 1);
}

/** Matches an incoming order against the book and the civic traders. Returns the unfilled remainder. */
function match(ctx: Ctx, book: Book, order: MarketOrder): void {
  const { hub, good } = order;
  if (order.side === 'buy') {
    while (order.qty > 0) {
      const maker = book.asks[0];
      const cAsk = book.askDepth > 0 ? civicAsk(book) : Infinity;
      const best = Math.min(maker?.price ?? Infinity, cAsk);
      if (best > order.price) break;
      if (maker && maker.price <= cAsk) {
        const qty = Math.min(order.qty, maker.qty);
        fill(ctx, book, order, maker, hub, good, maker.price, qty, 'buy');
        prune(book.asks);
      } else {
        fill(ctx, book, order, null, hub, good, cAsk, Math.min(order.qty, book.askDepth), 'buy');
      }
    }
  } else {
    while (order.qty > 0) {
      const maker = book.bids[0];
      const cBid = book.bidDepth > 0 ? civicBid(book) : -Infinity;
      const best = Math.max(maker?.price ?? -Infinity, cBid);
      if (best < order.price) break;
      if (maker && maker.price >= cBid) {
        const qty = Math.min(order.qty, maker.qty);
        fill(ctx, book, maker, order, hub, good, maker.price, qty, 'sell');
        prune(book.bids);
      } else {
        fill(ctx, book, null, order, hub, good, cBid, Math.min(order.qty, book.bidDepth), 'sell');
      }
    }
  }
}

/** Escrows and places a validated order; fills what crosses and rests the remainder. */
export function placeOrder(
  ctx: Ctx,
  actorId: Id,
  o: { hub: Id; side: Side; good: Good; price: number; qty: number },
): MarketOrder {
  const { state } = ctx;
  const player = state.players[actorId];
  if (!player) throw new Error(`unknown player ${actorId}`);
  const book = state.markets[o.hub]?.[o.good];
  if (!book) throw new Error(`no book for ${o.good} at ${o.hub}`);
  let value = 0;
  if (o.side === 'sell') {
    const want = emptyGoods();
    want[o.good] = toAtoms(o.qty);
    value = take(stash(ctx, actorId, o.hub), stashValue(ctx, actorId, o.hub), want)[o.good];
  } else player.credits -= o.price * o.qty * ATOMS_PER_CENT;
  state.counters.order += 1;
  const order: MarketOrder = {
    id: `o${state.counters.order}`,
    owner: actorId,
    hub: o.hub,
    good: o.good,
    side: o.side,
    price: o.price,
    qty: o.qty,
    seq: state.counters.order,
    value,
  };
  match(ctx, book, order);
  if (order.qty > 0) insertSorted(o.side === 'buy' ? book.bids : book.asks, order, o.side);
  return order;
}

/** Removes an open order and returns its remaining escrow. */
export function cancelOrder(ctx: Ctx, order: MarketOrder, book: Book): void {
  const list = order.side === 'buy' ? book.bids : book.asks;
  const i = list.indexOf(order);
  if (i >= 0) list.splice(i, 1);
  const player = ctx.state.players[order.owner];
  if (!player) return;
  if (order.side === 'sell') {
    const back = emptyGoods();
    const backValue = emptyGoods();
    back[order.good] = toAtoms(order.qty);
    backValue[order.good] = order.value;
    put(
      stash(ctx, order.owner, order.hub),
      stashValue(ctx, order.owner, order.hub),
      back,
      backValue,
    );
  } else player.credits += order.price * order.qty * ATOMS_PER_CENT;
}

/** Resting orders that now cross the civic prices trade with the civic traders. */
function sweep(ctx: Ctx, hub: Id, good: Good, book: Book): void {
  for (;;) {
    const bid = book.bids[0];
    if (!bid || book.askDepth <= 0 || bid.price < civicAsk(book)) break;
    fill(ctx, book, bid, null, hub, good, civicAsk(book), Math.min(bid.qty, book.askDepth), 'sell');
    prune(book.bids);
  }
  for (;;) {
    const ask = book.asks[0];
    if (!ask || book.bidDepth <= 0 || ask.price > civicBid(book)) break;
    fill(ctx, book, null, ask, hub, good, civicBid(book), Math.min(ask.qty, book.bidDepth), 'buy');
    prune(book.asks);
  }
}

/** Hourly: refill civic depth, pull references back toward their base, then sweep resting orders. */
function hourly(ctx: Ctx): void {
  refreshRegional(ctx.state);
  for (const hub of Object.keys(ctx.state.markets).sort()) {
    for (const good of GOODS) {
      const book = ctx.state.markets[hub]?.[good];
      if (!book) continue;
      book.bidDepth = Math.min(
        bidDepthCap(ctx.state, hub, good),
        book.bidDepth + M.civicRefillPerHour,
      );
      book.askDepth = Math.min(M.civicDepthCap, book.askDepth + M.civicRefillPerHour);
      const base = book.baseCents;
      book.refCents = clampRef(
        book,
        book.refCents + Math.trunc(((base - book.refCents) * M.reversionPercent) / 100),
      );
      sweep(ctx, hub, good, book);
    }
  }
}

export const marketSystem: System = {
  name: 'market',
  handlers: {
    'market.tick': (ctx, ev) => {
      hourly(ctx);
      if (ev.at + MS_PER_HOUR <= ctx.state.season.endMs) {
        schedule(ctx, ev.at + MS_PER_HOUR, { kind: 'market.tick' });
      }
    },
  },
};
