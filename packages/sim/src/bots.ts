import { toUnits } from './balance.js';
import { civicBid } from './market.js';
import { shortestRoute } from './routing.js';
import { GOODS, type Crew, type District, type GameState, type Id, type Order } from './types.js';

/**
 * Scripted players for the fast-forward harness. A bot is a pure function of the state and its
 * own id: it proposes orders, and the harness keeps only those `validateOrder` accepts. Bots read
 * the raw state (they are test fixtures, not clients), so they never see anything a player could
 * not act on. They are deliberately simple: they exist to exercise the rules, not to play well.
 */
export type BotKind = 'raider' | 'turtle' | 'merchant';

export type Bot = (state: GameState, me: Id) => Order[];

const mine = (s: GameState, me: Id): District[] =>
  Object.values(s.districts)
    .filter((d) => d.owner === me)
    .sort((a, b) => (a.id < b.id ? -1 : 1));

const idleCrews = (s: GameState, at: Id, me: Id): Crew[] =>
  (s.districts[at]?.garrison ?? [])
    .map((id) => s.crews[id])
    .filter((c): c is Crew => !!c && c.owner === me && c.readyAtMs <= s.nowMs);

function vanAt(s: GameState, at: Id, me: Id): Id | null {
  const van = Object.values(s.carriers)
    .filter((c) => c.owner === me && c.kind === 'van' && 'at' in c.loc && c.loc.at === at)
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  return van?.id ?? null;
}

/** Growth every bot shares: recruit when it can, and put up one building per district. */
function economy(
  s: GameState,
  me: Id,
  maxCrews: number,
  buildings: ('workshop' | 'depot' | 'walls')[],
): Order[] {
  const orders: Order[] = [];
  const crews = Object.values(s.crews).filter((c) => c.owner === me).length;
  const districts = mine(s, me);
  const home = districts[0];
  if (home && crews < maxCrews) orders.push({ type: 'recruit', districtId: home.id });
  for (const d of districts) {
    for (const building of buildings) {
      if (!d.buildings.some((b) => b.type === building)) {
        orders.push({ type: 'build', districtId: d.id, building });
      }
    }
  }
  return orders;
}

const length = (s: GameState, from: Id, to: Id): number =>
  shortestRoute(s.graph, from, to)?.lengthM ?? Infinity;

/** Sends its crews at the nearest district it does not own (neutral plots first on ties). */
export const raider: Bot = (s, me) => {
  const orders = economy(s, me, 6, ['workshop']);
  // One campaign at a time.
  const campaigning =
    Object.values(s.sieges).some((g) => g.attacker === me) ||
    Object.values(s.movements).some((m) => m.owner === me && m.kind === 'siege');
  if (campaigning) return orders;
  for (const base of mine(s, me)) {
    const crews = idleCrews(s, base.id, me);
    if (crews.length === 0) continue;
    const van = vanAt(s, base.id, me);
    const squad = crews.slice(0, van ? 2 : 1).map((c) => c.id);
    const targets = Object.values(s.districts)
      .filter(
        (d) =>
          d.kind !== 'hub' &&
          d.owner !== me &&
          d.frontier !== 'surveying' &&
          !(d.protectedUntilMs && d.protectedUntilMs > s.nowMs),
      )
      .map((d) => ({ d, len: length(s, base.id, d.id), neutral: d.owner === 'neutral' ? 0 : 1 }))
      .filter((t) => Number.isFinite(t.len))
      .sort((a, b) => a.len - b.len || a.neutral - b.neutral || (a.d.id < b.d.id ? -1 : 1));
    const target = targets[0];
    if (!target) continue;
    orders.push({ type: 'siege', carrierId: van, crewIds: squad, target: target.d.id });
    break;
  }
  return orders;
};

/** Never attacks: recruits, walls and workshops everywhere, and keeps every district on hold. */
export const turtle: Bot = (s, me) => [
  ...economy(s, me, 6, ['walls', 'workshop', 'depot']),
  ...mine(s, me).map((d): Order => ({ type: 'stance', districtId: d.id, stance: 'hold' })),
];

/**
 * Carries its best stocked good to the nearest hub, sells whatever it holds there to the civic
 * traders, and buys supplies back when it is rich.
 */
export const merchant: Bot = (s, me) => {
  const orders = economy(s, me, 3, ['workshop']);
  const player = s.players[me];
  if (!player) return orders;
  // Sell what sits in the hub stash.
  for (const [hub, stash] of Object.entries(player.stash)) {
    for (const good of GOODS) {
      const qty = Math.floor(toUnits(stash[good]));
      const book = s.markets[hub]?.[good];
      if (qty >= 1 && book) {
        orders.push({ type: 'market.place', hub, side: 'sell', good, price: civicBid(book), qty });
      }
    }
  }
  // Haul the biggest pile to a hub.
  for (const base of mine(s, me)) {
    const crew = idleCrews(s, base.id, me)[0];
    const van = vanAt(s, base.id, me);
    if (!crew || !van) continue;
    let best: { good: (typeof GOODS)[number]; qty: number } | null = null;
    for (const good of GOODS) {
      // Keep supplies for recruiting.
      const spare = Math.floor(toUnits(base.warehouse[good])) - (good === 'supplies' ? 25 : 0);
      if (spare >= 10 && (!best || spare > best.qty)) best = { good, qty: spare };
    }
    if (!best) continue;
    const hubs = Object.values(s.districts)
      .filter((d) => d.kind === 'hub')
      .sort((a, b) => length(s, base.id, a.id) - length(s, base.id, b.id));
    const hub = hubs[0];
    if (!hub) continue;
    orders.push({
      type: 'haul',
      carrierId: van,
      crewIds: [crew.id],
      to: hub.id,
      cargo: { [best.good]: Math.min(best.qty, 40) },
    });
    break;
  }
  // The van waits at the hub: send the crew home once the hub stash is sold out.
  for (const crew of Object.values(s.crews)) {
    if (crew.owner !== me || !('at' in crew.loc) || crew.readyAtMs > s.nowMs) continue;
    const here = s.districts[crew.loc.at];
    const home = mine(s, me)[0];
    if (here?.kind === 'hub' && home) {
      const van = vanAt(s, here.id, me);
      orders.push({ type: 'move', carrierId: van, crewIds: [crew.id], to: home.id });
    }
  }
  return orders;
};

export const BOTS: Record<BotKind, Bot> = { raider, turtle, merchant };
