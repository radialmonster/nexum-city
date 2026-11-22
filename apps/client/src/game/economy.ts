import type { GoodName, MarketHistoryResponse, PlayerView } from '@nexum/contracts';
import {
  ATOMS_PER_UNIT,
  balance,
  fuelUnitsFor,
  shortestRoute,
  toUnits,
  type CarrierKind,
} from '@nexum/sim';
import { GOOD_KEYS } from './derive';
import { credits } from './market';

/**
 * Plain-language helpers for the economy screens (price board, haul card, shortages, tax notice).
 * Everything reads the player's view, so nothing here asks the server anything.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** "3h", "45m" or "under a minute": how long is left, rounded for a glance. */
export function timeLeft(ms: number): string {
  if (ms <= 0) return 'now';
  const mins = Math.ceil(ms / 60_000);
  if (mins < 1) return 'under a minute';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${String(m)}m`;
  return m === 0 ? `${String(h)}h` : `${String(h)}h ${String(m)}m`;
}

/** The shortage on this good at this hub, if one is running now. */
export function shortageAt(view: PlayerView, hub: string, good: GoodName) {
  return (
    view.shortages.find(
      (s) => s.hub === hub && s.good === good && s.startMs <= view.nowMs && s.endMs > view.nowMs,
    ) ?? null
  );
}

/** The hub's current price for a good (centi-credits), or null when it has no market. */
export function hubPrice(view: PlayerView, hub: string, good: GoodName): number | null {
  return view.markets[hub]?.[good]?.refCents ?? null;
}

/** "+3.10" or "-1.00": a signed price difference in credits. */
export const signedCredits = (cents: number): string =>
  `${cents < 0 ? '-' : '+'}${credits(Math.abs(cents))}`;

/**
 * One line that says why a price is what it is: the shortage first, then the biggest reasons
 * the hub's price sits above the plain base price.
 */
export function whyLine(
  view: PlayerView,
  hub: string,
  good: GoodName,
  nameOf: (id: string) => string = (id) => id,
): string {
  const book = view.markets[hub]?.[good];
  if (!book) return 'No market here yet.';
  const parts: string[] = [];
  const short = shortageAt(view, hub, good);
  if (short) {
    parts.push(
      `SHORTAGE +${String(balance.shortage.refPercent)}% for ${timeLeft(short.endMs - view.nowMs)}`,
    );
  }
  const { why } = book;
  const reasons: { cents: number; text: string }[] = [
    {
      cents: why.transport,
      text: `Far from ${why.from === null ? 'supply' : nameOf(why.from)} (${signedCredits(why.transport)})`,
    },
    { cents: why.raid, text: `Raids on route (${signedCredits(why.raid)})` },
    { cents: why.demand, text: `City demand (${signedCredits(why.demand)})` },
  ];
  reasons
    .filter((r) => r.cents > 0)
    .sort((a, b) => b.cents - a.cents)
    .slice(0, short ? 1 : 2)
    .forEach((r) => parts.push(r.text));
  return parts.length > 0 ? parts.join(', ') : 'Base price.';
}

export interface Haul {
  readonly good: GoodName;
  readonly from: string;
  readonly to: string;
  /** Centi-credits per unit gained after the fuel is paid for, always above zero. */
  readonly gainCents: number;
  readonly fuelCents: number;
}

/** Cargo a carrier of this kind can take, in units. */
const cargoOf = (kind: CarrierKind): number => balance.carriers[kind].cargo;

/** Power a full load of this trip burns, as centi-credits per unit carried (at the buy hub's power price). */
export function fuelCentsPerUnit(
  view: PlayerView,
  from: string,
  to: string,
  kind: CarrierKind = 'van',
): number {
  const route = shortestRoute(view.graph, from, to);
  const power = hubPrice(view, from, 'power');
  if (!route || power === null) return 0;
  const units = fuelUnitsFor(kind, route.lengthM);
  return Math.ceil((units * power) / cargoOf(kind));
}

/** The best hub-to-hub haul for each good: buy low at one hub, carry it, sell high at another. */
export function bestHauls(view: PlayerView, kind: CarrierKind = 'van'): Haul[] {
  const hubs = view.graph.hubs;
  const out: Haul[] = [];
  for (const good of GOOD_KEYS) {
    let best: Haul | null = null;
    for (const from of hubs) {
      const buy = hubPrice(view, from, good);
      if (buy === null) continue;
      for (const to of hubs) {
        if (to === from) continue;
        const sell = hubPrice(view, to, good);
        if (sell === null) continue;
        const fuelCents = fuelCentsPerUnit(view, from, to, kind);
        const gainCents = sell - buy - fuelCents;
        if (gainCents > 0 && (best === null || gainCents > best.gainCents)) {
          best = { good, from, to, gainCents, fuelCents };
        }
      }
    }
    if (best) out.push(best);
  }
  return out;
}

/** Your average cost per unit (centi-credits) of a good in one of your piles, or null when not held. */
export function costOf(
  view: PlayerView,
  pile: 'stash' | 'districts',
  id: string,
  good: GoodName,
): number | null {
  const goods = view.self.costs[pile][id];
  const cents = goods?.[good];
  return cents !== undefined && cents > 0 ? cents : null;
}

export interface SaleResult {
  /** Centi-credits gained (or lost, when negative) per unit. */
  readonly perUnit: number;
  readonly total: number;
  readonly text: string;
}

/** What a sale means against what you paid, in plain words. Null when your cost is unknown. */
export function saleVerdict(
  costCents: number | null,
  priceCents: number,
  qty: number,
): SaleResult | null {
  if (costCents === null) return null;
  const perUnit = priceCents - costCents;
  const total = perUnit * qty;
  const gain = perUnit >= 0 ? 'profit' : 'loss';
  const text =
    perUnit === 0
      ? `Selling at your cost of ${credits(costCents)}: you break even.`
      : `You paid ${credits(costCents)} each, so this is a ${gain} of ${credits(Math.abs(perUnit))} each` +
        (qty > 1 ? ` (${credits(Math.abs(total))} in total).` : '.');
  return { perUnit, total, text };
}

/** The power a haul needs, and whether the pooled power in your warehouses covers it. */
export interface FuelCheck {
  /** Units of power, rounded up to hundredths. */
  readonly units: number;
  readonly enough: boolean;
}

/**
 * Mirrors the sim's `no_fuel` rule: the start store plus your other warehouses must hold
 * the trip's power on top of any power you are carrying. A carrier on foot burns none.
 */
export function fuelCheck(
  view: PlayerView,
  from: string,
  kind: CarrierKind | 'foot',
  lengthM: number,
  cargoPower: number,
): FuelCheck {
  if (kind === 'foot') return { units: 0, enough: true };
  const units = fuelUnitsFor(kind, lengthM);
  if (units <= 0) return { units: 0, enough: true };
  // The start store, plus your other warehouses (stashes at other hubs do not count).
  const start = view.districts[from];
  let held =
    start?.relation === 'own'
      ? toUnits(start.warehouse.power)
      : toUnits(view.self.stash[from]?.power ?? 0);
  for (const d of Object.values(view.districts)) {
    if (d.relation === 'own' && d.id !== from) held += toUnits(d.warehouse.power);
  }
  return { units, enough: held - cargoPower >= units };
}

/** The hub whose street route from here is shortest, so "Buy power" can open the nearest market. */
export function nearestHub(view: PlayerView, from: string): string | null {
  let best: { hub: string; len: number } | null = null;
  for (const hub of view.graph.hubs) {
    const r = shortestRoute(view.graph, from, hub);
    if (r && (best === null || r.lengthM < best.len)) best = { hub, len: r.lengthM };
  }
  return best?.hub ?? null;
}

/** What selling the cargo at the far end brings, after the fuel, in whole credits; null if no market. */
export function expectedSale(
  view: PlayerView,
  to: string,
  cargo: Readonly<Record<string, number>>,
  fuelUnits: number,
): { hubGross: number; netCents: number } | null {
  let gross = 0;
  let any = false;
  for (const g of GOOD_KEYS) {
    const n = cargo[g] ?? 0;
    if (n <= 0) continue;
    const p = hubPrice(view, to, g);
    if (p === null) continue;
    any = true;
    gross += p * n;
  }
  if (!any) return null;
  const power = hubPrice(view, to, 'power') ?? 0;
  return { hubGross: gross, netCents: gross - Math.round(fuelUnits * power) };
}

/** The daily charges the city takes, worked out from your view (the same maths as the sim). */
export interface Charges {
  readonly upkeepCredits: number;
  readonly levyCredits: number;
  readonly freeCredits: number;
  readonly levyPercent: number;
  /** The next charge, in game ms. */
  readonly nextMs: number;
}

export function charges(view: PlayerView): Charges {
  const s = balance.sink;
  const owned = Object.values(view.districts).filter(
    (d) => d.relation === 'own' && d.kind !== 'hub',
  ).length;
  const due = Math.max(0, owned - s.freeDistricts) * s.upkeepCreditsPerDay;
  const credits = toUnits(view.self.credits);
  const afterUpkeep = Math.max(0, credits - Math.min(credits, due));
  const levy = Math.floor((Math.max(0, afterUpkeep - s.levyFreeCredits) * s.levyPercent) / 100);
  const sinceStart = Math.max(0, view.nowMs - view.season.startMs);
  const nextMs = view.season.startMs + (Math.floor(sinceStart / DAY_MS) + 1) * DAY_MS;
  return {
    upkeepCredits: due,
    levyCredits: levy,
    freeCredits: s.levyFreeCredits,
    levyPercent: s.levyPercent,
    nextMs,
  };
}

/** The one-line tax notice: what is coming tonight, and what to do about it. */
export function taxNotice(view: PlayerView): string {
  const c = charges(view);
  const when = timeLeft(c.nextMs - view.nowMs);
  const upkeep =
    c.upkeepCredits > 0
      ? ` Upkeep for your extra districts is ${String(c.upkeepCredits)} cr a day.`
      : '';
  if (c.levyCredits <= 0) {
    return `The city takes ${String(c.levyPercent)}% of credits over ${String(c.freeCredits)} each night, in ${when}. You are under the line.${upkeep}`;
  }
  return `Tonight's city tax (in ${when}) takes ${String(c.levyPercent)}% of credits over ${String(c.freeCredits)}: about ${String(c.levyCredits)} cr. Spend or invest before then.${upkeep}`;
}

/** Totals the sinks had taken, in whole credits, from a view. */
export function sinkTotals(view: PlayerView): { upkeep: number; levy: number } {
  return {
    upkeep: Math.round(view.sink.upkeepAtoms / ATOMS_PER_UNIT),
    levy: Math.round(view.sink.levyAtoms / ATOMS_PER_UNIT),
  };
}

/** True when the shared sink totals went up between two views: a daily charge just happened. */
export function chargeHappened(prev: PlayerView | null, next: PlayerView): boolean {
  if (!prev) return false;
  return next.sink.upkeepAtoms > prev.sink.upkeepAtoms || next.sink.levyAtoms > prev.sink.levyAtoms;
}

/** Chart points for the sparkline: closes by hour, plus the index of your last visit. */
export function trendPoints(
  h: MarketHistoryResponse,
  lastVisitMs: number | null,
): { points: number[]; markAt: number | null } {
  const points = h.buckets.map((b) => b.close);
  if (h.civic.lastCents !== null && points.length === 0) points.push(h.civic.lastCents);
  let markAt: number | null = null;
  if (lastVisitMs !== null) {
    h.buckets.forEach((b, i) => {
      if (b.t <= lastVisitMs) markAt = i;
    });
  }
  return { points, markAt };
}

/** A daily charge the city just took, shown in the feed (the sim sends no event for it). */
export interface ChargeNotice {
  /** The game time of the charge, which is also its identity. */
  readonly atMs: number;
  readonly upkeepCredits: number;
  readonly levyCredits: number;
  readonly text: string;
}

/** The notice for a charge between two views, worked out from what the earlier view showed. */
export function chargeNotice(prev: PlayerView | null, next: PlayerView): ChargeNotice | null {
  if (!chargeHappened(prev, next) || !prev) return null;
  const c = charges(prev);
  const sinceStart = Math.max(0, next.nowMs - next.season.startMs);
  const atMs = next.season.startMs + Math.floor(sinceStart / DAY_MS) * DAY_MS;
  const bits: string[] = [];
  if (c.levyCredits > 0) {
    bits.push(
      `City tax took about ${String(c.levyCredits)} cr (${String(c.levyPercent)}% of credits over ${String(c.freeCredits)})`,
    );
  }
  if (c.upkeepCredits > 0) {
    bits.push(`upkeep for your extra districts cost ${String(c.upkeepCredits)} cr`);
  }
  const text =
    bits.length > 0
      ? `${bits.join('; ')}.`.replace(/^./, (m) => m.toUpperCase())
      : `The daily city tax ran. You were under ${String(c.freeCredits)} cr, so it took nothing from you.`;
  return {
    atMs,
    upkeepCredits: c.upkeepCredits,
    levyCredits: c.levyCredits,
    text,
  };
}

/** Power in hundredths shown plainly: 0.28, 0.6, 12 (never rounded to a whole unit). */
export function powerText(units: number): string {
  return String(Number(units.toFixed(2)));
}
