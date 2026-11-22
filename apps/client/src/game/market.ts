import type { FeedItem, GoodName, PlayerView } from '@nexum/contracts';
import { ATOMS_PER_CENT, balance, toUnits } from '@nexum/sim';

const M = balance.market;

export type Side = 'buy' | 'sell';

/** One price level in the order book table. */
export interface BookRow {
  /** Centi-credits per unit. */
  readonly price: number;
  readonly qty: number;
  /** Units available at this price or better, counted from the best price. */
  readonly depth: number;
  /** The city's own standing offer rather than a player's. */
  readonly civic: boolean;
}

export interface BookTable {
  /** Best (lowest) price first. */
  readonly asks: readonly BookRow[];
  /** Best (highest) price first. */
  readonly bids: readonly BookRow[];
  readonly refCents: number;
  readonly lastCents: number | null;
  /** The largest depth on either side, for scaling depth bars. */
  readonly maxDepth: number;
}

/** Formats centi-credits as credits with two decimals. */
export const credits = (cents: number): string => (cents / 100).toFixed(2);

function levels(
  rows: readonly { price: number; qty: number }[],
  civic: { price: number; qty: number },
  descending: boolean,
): BookRow[] {
  const all = [
    ...rows.map((r) => ({ ...r, civic: false })),
    ...(civic.qty > 0 ? [{ ...civic, civic: true }] : []),
  ].sort((a, b) => (descending ? b.price - a.price : a.price - b.price));
  let depth = 0;
  return all.map((r) => {
    depth += r.qty;
    return { price: r.price, qty: r.qty, depth, civic: r.civic };
  });
}

/** The hub's public book for one good as table rows with running depth, or null if there is none. */
export function bookTable(view: PlayerView, hub: string, good: GoodName): BookTable | null {
  const book = view.markets[hub]?.[good];
  if (!book) return null;
  const asks = levels(book.asks, { price: book.civic.ask, qty: book.civic.askDepth }, false);
  const bids = levels(book.bids, { price: book.civic.bid, qty: book.civic.bidDepth }, true);
  return {
    asks,
    bids,
    refCents: book.refCents,
    lastCents: book.lastCents,
    maxDepth: Math.max(1, asks.at(-1)?.depth ?? 0, bids.at(-1)?.depth ?? 0),
  };
}

/** Recent fill prices (centi-credits) at a hub for a good, oldest first. */
export function fillPrices(
  feed: readonly FeedItem[],
  hub: string,
  good: GoodName,
  limit = 24,
): number[] {
  const out: number[] = [];
  for (const { event } of feed) {
    if (event.kind !== 'trade.filled') continue;
    if (event.data['hub'] !== hub || event.data['good'] !== good) continue;
    const price = event.data['price'];
    if (typeof price === 'number') out.push(price);
  }
  return out.slice(-limit);
}

/** Whole units of a good you hold in your stash at a hub. */
export function stashUnits(view: PlayerView, hub: string, good: GoodName): number {
  return Math.floor(toUnits(view.self.stash[hub]?.[good] ?? 0));
}

/** Your open orders, at one hub when given, otherwise everywhere. */
export function openOrders(view: PlayerView, hub?: string) {
  return view.orders
    .filter((o) => o.owner === view.playerId && (hub === undefined || o.hub === hub))
    .sort((a, b) => a.seq - b.seq);
}

/** Reads "12.5" credits into centi-credits; null for anything that is not a positive amount. */
export function parseCredits(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  return cents > 0 ? cents : null;
}

export interface LimitDraft {
  readonly hub: string;
  readonly good: GoodName;
  readonly side: Side;
  /** What the player typed. */
  readonly price: string;
  readonly qty: string;
}

export type LimitCheck =
  | {
      readonly ok: true;
      readonly priceCents: number;
      readonly qty: number;
      readonly escrow: string;
    }
  | { readonly ok: false; readonly code: string };

/**
 * Mirrors the sim's `validatePlace` against what the view shows, so the form can refuse before
 * sending. The codes are the sim's, so `messageFor` words them. The server still decides.
 */
export function checkLimit(view: PlayerView, d: LimitDraft): LimitCheck {
  const priceCents = parseCredits(d.price);
  if (priceCents === null || priceCents > M.maxPrice) return { ok: false, code: 'bad_price' };
  const qty = Number(d.qty.trim());
  if (!/^\d+$/.test(d.qty.trim()) || qty < 1 || qty > M.maxQty) {
    return { ok: false, code: 'bad_quantity' };
  }
  if (openOrders(view).length >= M.maxOrdersPerPlayer)
    return { ok: false, code: 'too_many_orders' };
  if (d.side === 'sell') {
    if (stashUnits(view, d.hub, d.good) < qty) return { ok: false, code: 'insufficient_goods' };
    return { ok: true, priceCents, qty, escrow: `${String(qty)} ${d.good}` };
  }
  const cost = priceCents * qty;
  if (view.self.credits < cost * ATOMS_PER_CENT) return { ok: false, code: 'insufficient_credits' };
  return { ok: true, priceCents, qty, escrow: `${credits(cost)} credits` };
}

/** Where a limit order would sit against the book, as a plain sentence. */
export function placement(table: BookTable | null, side: Side, priceCents: number): string {
  if (!table) return 'There is no book here yet.';
  const best = side === 'buy' ? table.asks[0] : table.bids[0];
  const crosses =
    best !== undefined && (side === 'buy' ? priceCents >= best.price : priceCents <= best.price);
  if (crosses) {
    return `This crosses the book and fills at once, starting at ${credits(best.price)}.`;
  }
  return 'This waits in the book until someone takes it.';
}

export const ESCROW_LINE =
  'Escrow: a buy order sets its credits aside and a sell order sets its goods aside until it fills or you cancel.';
