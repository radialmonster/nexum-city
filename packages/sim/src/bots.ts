import { MS_PER_HOUR, balance, toAtoms, toUnits } from './balance.js';
import { buildCost } from './construction.js';
import { civicAsk, civicBid } from './market.js';
import { depositFor, referenceValue } from './contracts.js';
import { shortestRoute, travelMs } from './routing.js';
import { isPlayerProtected } from './raid.js';
import { isProtected } from './siege.js';
import {
  GOODS,
  type Crew,
  type District,
  type GameState,
  type Goods,
  type Id,
  type Order,
} from './types.js';

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

function carrierAt(s: GameState, at: Id, me: Id, kind: 'van' | 'runner'): Id | null {
  const found = Object.values(s.carriers)
    .filter((c) => c.owner === me && c.kind === kind && 'at' in c.loc && c.loc.at === at)
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  return found?.id ?? null;
}

const vanAt = (s: GameState, at: Id, me: Id): Id | null => carrierAt(s, at, me, 'van');

/**
 * What a bot may still spend this check-in. Orders in one batch are each checked against the
 * same snapshot, so a bot keeps its own running tally and only proposes what it can afford
 * (an unaffordable order is rejected, which is wasted noise for a real player and the server).
 */
interface Budget {
  credits: number;
  warehouse: Record<Id, Goods>;
}

function budgetFor(s: GameState, me: Id): Budget {
  const warehouse: Record<Id, Goods> = {};
  for (const d of mine(s, me)) warehouse[d.id] = { ...d.warehouse };
  return { credits: s.players[me]?.credits ?? 0, warehouse };
}

function spend(budget: Budget, at: Id, cost: Partial<Goods>): boolean {
  const w = budget.warehouse[at];
  if (!w) return false;
  for (const g of GOODS) if (w[g] < (cost[g] ?? 0)) return false;
  for (const g of GOODS) w[g] -= cost[g] ?? 0;
  return true;
}

/** Growth every bot shares: recruit when it can pay, and put up one building per district. */
function economy(
  s: GameState,
  me: Id,
  budget: Budget,
  maxCrews: number,
  buildings: ('workshop' | 'depot' | 'walls')[],
): Order[] {
  const orders: Order[] = [];
  const crews = Object.values(s.crews).filter((c) => c.owner === me).length;
  const districts = mine(s, me);
  const home = districts[0];
  const recruitCredits = toAtoms(balance.recruit.credits);
  if (
    home &&
    crews < maxCrews &&
    budget.credits >= recruitCredits &&
    spend(budget, home.id, { supplies: toAtoms(balance.recruit.supplies) })
  ) {
    budget.credits -= recruitCredits;
    orders.push({ type: 'recruit', districtId: home.id });
  }
  for (const d of districts) {
    // One build at a time per district, and never into a full set of slots.
    if (d.construction || d.buildings.length >= d.slots) continue;
    const building = buildings.find((b) => !d.buildings.some((x) => x.type === b));
    if (building && spend(budget, d.id, buildCost(building, 1))) {
      orders.push({ type: 'build', districtId: d.id, building });
    }
  }
  return orders;
}

const length = (s: GameState, from: Id, to: Id): number =>
  shortestRoute(s.graph, from, to)?.lengthM ?? Infinity;

/**
 * Settles the nearest open plot when a district has spare supplies and an idle crew. One settler
 * at a time (a trip in flight or a crew waiting out the timer counts), so supplies are never
 * over-committed. Reads only what a player's view carries: own crews, carriers, movements and
 * warehouses, and neutral plots that are visible or remembered.
 */
function settleOrders(
  s: GameState,
  me: Id,
  budget: Budget,
  reserve: number,
  maxSettlers: number,
): Order[] {
  const settlersOnTheWay = Object.values(s.movements).filter(
    (m) => m.owner === me && m.kind === 'settle',
  ).length;
  const settlersWaiting = Object.values(s.crews).filter((c) => {
    if (c.owner !== me || !('at' in c.loc)) return false;
    const here = s.districts[c.loc.at];
    return !!here && here.kind !== 'hub' && here.owner === 'neutral';
  }).length;
  if (settlersOnTheWay + settlersWaiting >= maxSettlers) return [];
  const cost = toAtoms(balance.settle.supplies);
  for (const base of mine(s, me)) {
    const spare = (budget.warehouse[base.id]?.supplies ?? 0) - toAtoms(reserve);
    if (spare < cost) continue;
    const crew = idleCrews(s, base.id, me)[0];
    if (!crew) continue;
    const target = Object.values(s.districts)
      .filter((d) => d.kind !== 'hub' && d.owner === 'neutral' && d.frontier === 'open')
      .map((d) => ({ d, len: length(s, base.id, d.id) }))
      .filter((x) => Number.isFinite(x.len))
      .sort((x, y) => x.len - y.len || (x.d.id < y.d.id ? -1 : 1))[0];
    if (!target) return [];
    if (!spend(budget, base.id, { supplies: cost })) return [];
    return [
      { type: 'settle', carrierId: vanAt(s, base.id, me), crewIds: [crew.id], target: target.d.id },
    ];
  }
  return [];
}

/** Supplies a bot keeps back when it settles. */
const SETTLE_RESERVE = 20;
const BUY_MARGIN = 10;

/** What a van carries (balance.carriers.van.cargo), so a haul is never over capacity. */
const VAN_CARGO = balance.carriers.van.cargo;

/** What a Runner carries: a job this small goes by Runner when one is idle (fast, but one seat). */
const RUNNER_CARGO = balance.carriers.runner.cargo;

/**
 * A bot with credits to spare and no Runner buys one at its first district.
 * Runners are for small urgent jobs, so this is only done by bots that take contracts.
 */
function runnerOrders(s: GameState, me: Id, budget: Budget, spareCredits: number): Order[] {
  const owned = Object.values(s.carriers).filter((c) => c.owner === me && c.kind === 'runner');
  if (owned.length > 0) return [];
  const cost = toAtoms(balance.runner.credits);
  if (budget.credits < cost + toAtoms(spareCredits)) return [];
  const base = mine(s, me)[0];
  if (!base) return [];
  budget.credits -= cost;
  return [{ type: 'carrier.buy', districtId: base.id, kind: 'runner' }];
}

/** A merchant escorts hauls of at least this many units. */
const ESCORT_FROM_UNITS = 30;

/** Credits a bot keeps in hand after buying a Runner. */
const MERCHANT_RUNNER_SPARE = 500;
const TURTLE_RUNNER_SPARE = 700;

/** A weaker rival's district is picked over a neutral plot unless it is this much farther. */
const WEAK_RIVAL_DISCOUNT = 0.5;

/** The raider sets an ambush on every this-many-th hour of the season, so it is not constant. */
const AMBUSH_EVERY_HOURS = 1;
const AMBUSH_HOURS = 6;

/**
 * A street edge on a rival's way to its nearest hub (the last street into the hub, where hauls
 * from that district are most likely to pass). Bots guess; they do not watch convoys. That is
 * intentional: bots stay fog-honest and never read enemy convoys they could not see.
 */
export function ambushOrders(s: GameState, me: Id): Order[] {
  if (Math.floor(s.nowMs / MS_PER_HOUR) % AMBUSH_EVERY_HOURS !== 0) return [];
  // Protected players may not set ambushes (validateOrder refuses them).
  if (isPlayerProtected(s, me)) return [];
  if (
    Object.values(s.movements).some(
      (m) => m.owner === me && ['raid', 'ambush', 'return'].includes(m.kind),
    )
  ) {
    return [];
  }
  for (const base of mine(s, me)) {
    const crews = idleCrews(s, base.id, me);
    const van = vanAt(s, base.id, me);
    if (crews.length < 2 || !van) continue;
    const edges: { a: Id; b: Id; len: number; hot: boolean }[] = [];
    for (const d of Object.values(s.districts)) {
      if (d.kind === 'hub' || d.owner === me || d.owner === 'neutral') continue;
      // Protected players' convoys cannot be struck, and that flag is public, so skip them.
      if (isProtected(d, s.nowMs)) continue;
      const hub = nearestHubTo(s, d.id);
      const route = hub && shortestRoute(s.graph, d.id, hub.id);
      if (!route || route.route.length < 2) continue;
      const a = route.route[route.route.length - 2] as Id;
      const b = route.route[route.route.length - 1] as Id;
      // The board is public and shows who took what: a rival with a job open at this hub has a
      // load on the way, so that street is the better bet.
      const hot = Object.values(s.contracts).some(
        (c) => c.status === 'taken' && c.hub === hub.id && c.taker === d.owner,
      );
      edges.push({ a, b, len: Math.min(length(s, base.id, a), length(s, base.id, b)), hot });
    }
    const edge = edges
      .filter((e) => Number.isFinite(e.len))
      .sort((x, y) => Number(y.hot) - Number(x.hot) || x.len - y.len || (x.a < y.a ? -1 : 1))[0];
    if (!edge) continue;
    return [
      {
        type: 'raid',
        carrierId: van,
        crewIds: crews.slice(0, 2).map((c) => c.id),
        a: edge.a,
        b: edge.b,
        hours: AMBUSH_HOURS,
      },
    ];
  }
  return [];
}

/** Sends its crews at the nearest district it does not own (neutral plots first on ties). */
export const raider: Bot = (s, me) => {
  const budget = budgetFor(s, me);
  const orders = economy(s, me, budget, 6, ['workshop']);
  // One campaign at a time.
  const campaigning =
    Object.values(s.sieges).some((g) => g.attacker === me) ||
    Object.values(s.movements).some((m) => m.owner === me && m.kind === 'siege');
  if (campaigning) return [...orders, ...ambushOrders(s, me)];
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
      .map((d) => {
        const len = length(s, base.id, d.id);
        // A rival who scores less than me is the softer target: it counts as closer.
        const rival = d.owner !== 'neutral' ? s.players[d.owner] : undefined;
        const weak = !!rival && rival.score < (s.players[me]?.score ?? 0);
        return { d, len, cost: weak ? len * WEAK_RIVAL_DISCOUNT : len };
      })
      .filter((t) => Number.isFinite(t.len))
      .sort((a, b) => a.cost - b.cost || (a.d.id < b.d.id ? -1 : 1));
    const target = targets[0];
    if (!target) continue;
    orders.push({ type: 'siege', carrierId: van, crewIds: squad, target: target.d.id });
    break;
  }
  return orders;
};

/**
 * Keeps a base in supplies the way a player would: crews waiting at a hub carry the supplies
 * bought there home, and when a settlement is wanted but the home warehouse is short, a van-load
 * is bought from the civic traders at the nearest hub (spending from `budget`).
 */
function resupply(s: GameState, me: Id, budget: Budget, reserve = SETTLE_RESERVE): Order[] {
  const orders: Order[] = [];
  const player = s.players[me];
  if (!player) return orders;
  // The van waits at the hub: send the crew home once the hub stash is sold out.
  for (const crew of Object.values(s.crews)) {
    if (crew.owner !== me || !('at' in crew.loc) || crew.readyAtMs > s.nowMs) continue;
    const here = s.districts[crew.loc.at];
    const home = mine(s, me)[0];
    if (here?.kind === 'hub' && home) {
      const van = vanAt(s, here.id, me);
      const bought = Math.floor(toUnits(player.stash[here.id]?.supplies ?? 0));
      if (van && bought >= 1) {
        // Carry the supplies bought here back to the warehouse.
        const cargo = { supplies: Math.min(bought, VAN_CARGO) };
        orders.push({ type: 'haul', carrierId: van, crewIds: [crew.id], to: home.id, cargo });
      } else {
        orders.push({ type: 'move', carrierId: van, crewIds: [crew.id], to: home.id });
      }
    }
  }
  // Short on supplies for the next settlement: buy a van-load from the civic traders.
  const home = mine(s, me)[0];
  const hasStash = Object.values(player.stash).some((st) => toUnits(st.supplies) >= 1);
  const inFlight = Object.values(s.movements).some((m) => m.owner === me && m.kind === 'haul');
  const wantsPlot = Object.values(s.districts).some(
    (d) => d.kind !== 'hub' && d.owner === 'neutral' && d.frontier === 'open',
  );
  if (home && wantsPlot && !hasStash && !inFlight) {
    const have = toUnits(budget.warehouse[home.id]?.supplies ?? 0);
    const hub = Object.values(s.districts)
      .filter((d) => d.kind === 'hub')
      .sort((a, b) => length(s, home.id, a.id) - length(s, home.id, b.id))[0];
    const book = hub ? s.markets[hub.id]?.supplies : undefined;
    if (hub && book && have < balance.settle.supplies + 30) {
      // Buy a little over the target: crew upkeep eats supplies while the van is on the road.
      const need = Math.ceil(balance.settle.supplies + reserve + BUY_MARGIN - have);
      const price = civicAsk(book);
      const affordable = Math.floor((toUnits(budget.credits) * 100) / price);
      const qty = Math.min(VAN_CARGO, Math.floor(book.askDepth), need, affordable);
      if (qty >= 1 && budget.credits >= toAtoms((price * qty) / 100)) {
        budget.credits -= toAtoms((price * qty) / 100);
        orders.push({
          type: 'market.place',
          hub: hub.id,
          side: 'buy',
          good: 'supplies',
          price,
          qty,
        });
      }
    }
  }
  return orders;
}

/**
 * Sends an idle crew and van from home to the hub holding supplies it bought, so the next
 * check-in can haul them home (a move, exactly what a player would order).
 */
function fetchOrders(s: GameState, me: Id): Order[] {
  const player = s.players[me];
  const home = mine(s, me)[0];
  if (!player || !home) return [];
  const inFlight = Object.values(s.movements).some((m) => m.owner === me);
  if (inFlight) return [];
  const hub = Object.entries(player.stash).find(([, st]) => toUnits(st.supplies) >= 1)?.[0];
  if (!hub) return [];
  const crew = idleCrews(s, home.id, me)[0];
  const van = vanAt(s, home.id, me);
  if (!crew || !van) return [];
  return [{ type: 'move', carrierId: van, crewIds: [crew.id], to: hub }];
}

/** Sells whatever sits in the hub stash to the civic traders (supplies are kept for settling). */
function sellStash(s: GameState, me: Id): Order[] {
  const orders: Order[] = [];
  const player = s.players[me];
  if (!player) return orders;
  for (const [hub, stash] of Object.entries(player.stash)) {
    for (const good of GOODS) {
      // Supplies bought here are for settling, not for sale.
      if (good === 'supplies') continue;
      const qty = Math.floor(toUnits(stash[good]));
      const book = s.markets[hub]?.[good];
      if (qty >= 1 && book) {
        orders.push({ type: 'market.place', hub, side: 'sell', good, price: civicBid(book), qty });
      }
    }
  }
  return orders;
}

/** Hauls the biggest spare pile from a home warehouse to the nearest hub. */
function haulToHub(s: GameState, me: Id, escort = false): Order[] {
  const orders: Order[] = [];
  for (const base of mine(s, me)) {
    const idle = idleCrews(s, base.id, me);
    const crew = idle[0];
    const van = vanAt(s, base.id, me);
    if (!crew || !van) continue;
    let best: { good: (typeof GOODS)[number]; qty: number } | null = null;
    for (const good of GOODS) {
      // Keep supplies for recruiting.
      const spare =
        Math.floor(toUnits(base.warehouse[good])) -
        (good === 'supplies' ? balance.settle.supplies + 25 : 0);
      if (spare >= 10 && (!best || spare > best.qty)) best = { good, qty: spare };
    }
    if (!best) continue;
    const hubs = Object.values(s.districts)
      .filter((d) => d.kind === 'hub')
      .sort((a, b) => length(s, base.id, a.id) - length(s, base.id, b.id));
    const hub = hubs[0];
    if (!hub) continue;
    const qty = Math.min(best.qty, 40);
    // A valuable load gets a second crew riding along as escort (the van has two seats).
    const guards =
      escort && qty >= ESCORT_FROM_UNITS && idle[1] ? [crew.id, idle[1].id] : [crew.id];
    orders.push({
      type: 'haul',
      carrierId: van,
      crewIds: guards,
      to: hub.id,
      cargo: { [best.good]: qty },
    });
    break;
  }
  return orders;
}

/** Settling is wanted but the home warehouse is short of supplies and the credits cannot cover them. */
function starved(s: GameState, me: Id, reserve: number): boolean {
  const home = mine(s, me)[0];
  const hub = home && nearestHubTo(s, home.id);
  const book = hub && s.markets[hub.id]?.supplies;
  if (!home || !book) return false;
  const need = Math.ceil(balance.settle.supplies + reserve - toUnits(home.warehouse.supplies));
  if (need <= 0) return false;
  return (s.players[me]?.credits ?? 0) < toAtoms((civicAsk(book) * need) / 100);
}

function nearestHubTo(s: GameState, from: Id): District | undefined {
  return Object.values(s.districts)
    .filter((d) => d.kind === 'hub')
    .sort((x, y) => length(s, from, x.id) - length(s, from, y.id))[0];
}

interface ContractPlan {
  /** Largest contract (units) the bot will take. */
  maxQty: number;
  /** Only take a job whose trip fits in this share of its window, in percent. */
  tripPercent: number;
  /** How to rank open contracts: by pay for the size, or by the shortest trip. */
  prefer: 'pay' | 'near';
  escort: boolean;
}

const spareUnits = (base: District, good: (typeof GOODS)[number]): number =>
  Math.floor(toUnits(base.warehouse[good])) -
  (good === 'supplies' ? balance.settle.supplies + 25 : 0);

/**
 * The contract side of a bot's turn, through the normal order path. Hauls the goods for a
 * contract it holds (partial loads count, so a raided or short load is topped up next time), or,
 * when it holds none, takes the best open one it can fill from a home warehouse in time. Reads
 * only the public board and its own stores. Returns no orders when the bot has nothing to do,
 * so the caller can fall back to its usual hauling (a take order also keeps the crew free for
 * the haul next check-in).
 */
export function contractOrders(s: GameState, me: Id, budget: Budget, plan: ContractPlan): Order[] {
  const held = Object.values(s.contracts)
    .filter((c) => c.taker === me)
    .sort((a, b) => a.dueMs - b.dueMs || (a.id < b.id ? -1 : 1));
  const sending = new Set(
    Object.values(s.movements)
      .filter((m) => m.owner === me && m.contractId)
      .map((m) => m.contractId),
  );
  for (const c of held) {
    if (sending.has(c.id)) continue;
    const missing = Math.ceil(c.qty - toUnits(c.delivered));
    for (const base of mine(s, me)) {
      const idle = idleCrews(s, base.id, me);
      const runner = carrierAt(s, base.id, me, 'runner');
      const van = vanAt(s, base.id, me);
      const small = Math.min(missing, spareUnits(base, c.good)) <= RUNNER_CARGO;
      const ride = runner && small ? runner : van;
      const qty = Math.min(
        missing,
        ride === runner ? RUNNER_CARGO : VAN_CARGO,
        spareUnits(base, c.good),
      );
      if (!idle[0] || !ride || qty < 1) continue;
      if (!Number.isFinite(length(s, base.id, c.hub))) continue;
      const guards =
        ride !== runner && plan.escort && qty >= ESCORT_FROM_UNITS && idle[1]
          ? [idle[0].id, idle[1].id]
          : [idle[0].id];
      return [
        {
          type: 'haul',
          carrierId: ride,
          crewIds: guards,
          to: c.hub,
          cargo: { [c.good]: qty },
          contractId: c.id,
        },
      ];
    }
  }
  if (held.length > 0) return [];
  let best: { id: Id; score: number } | null = null;
  for (const c of Object.values(s.contracts)) {
    if (c.status !== 'open' || c.poster === me || c.qty > plan.maxQty) continue;
    if (budget.credits < depositFor(c.reward)) continue;
    for (const base of mine(s, me)) {
      const runner = carrierAt(s, base.id, me, 'runner');
      const byRunner = !!runner && c.qty <= RUNNER_CARGO;
      if (idleCrews(s, base.id, me).length === 0 || !(byRunner || vanAt(s, base.id, me))) continue;
      if (spareUnits(base, c.good) < c.qty) continue;
      const len = length(s, base.id, c.hub);
      if (!Number.isFinite(len)) continue;
      const tripMs = travelMs(len, byRunner ? 'runner' : 'van');
      if (tripMs * 100 > c.hours * MS_PER_HOUR * plan.tripPercent) continue;
      const score = plan.prefer === 'near' ? -len : c.reward / c.qty;
      if (!best || score > best.score) best = { id: c.id, score };
    }
  }
  return best ? [{ type: 'contract.take', contractId: best.id }] : [];
}

/**
 * A merchant who needs supplies posts a job for them at the nearest hub instead of buying from
 * the civic ask (it pays a little over the reference price, so takers earn a fair premium).
 */
function postSupplyContract(s: GameState, me: Id, budget: Budget): Order[] {
  const home = mine(s, me)[0];
  const hub = home && nearestHubTo(s, home.id);
  if (!home || !hub) return [];
  if (Object.values(s.contracts).some((c) => c.poster === me)) return [];
  if (toUnits(home.warehouse.supplies) >= balance.settle.supplies + SETTLE_RESERVE) return [];
  const wantsPlot = Object.values(s.districts).some(
    (d) => d.kind !== 'hub' && d.owner === 'neutral' && d.frontier === 'open',
  );
  if (
    !wantsPlot ||
    Object.values(s.players[me]?.stash ?? {}).some((g) => toUnits(g.supplies) >= 1)
  ) {
    return [];
  }
  const qty = 20;
  const reward = Math.ceil(toUnits(referenceValue(s, hub.id, 'supplies', qty)) * 1.1);
  // Only when flush: the escrow is idle money, and a merchant short of cash should not lock it up.
  if (budget.credits < toAtoms(reward) * 4) return [];
  budget.credits -= toAtoms(reward);
  return [{ type: 'contract.post', hub: hub.id, good: 'supplies', qty, reward, hours: 12 }];
}

/** Never attacks: recruits, walls and workshops everywhere, and keeps every district on hold. */
export const turtle: Bot = (s, me) => {
  const budget = budgetFor(s, me);
  // Saving for a settlement: recruits and buildings would eat the supplies it is buying.
  const home = mine(s, me)[0];
  const saving =
    !!home &&
    toUnits(home.warehouse.supplies) < balance.settle.supplies + SETTLE_RESERVE &&
    Object.values(s.districts).some(
      (d) => d.kind !== 'hub' && d.owner === 'neutral' && d.frontier === 'open',
    );
  // Small, nearby jobs: the early income a new player can reach with one van-load.
  const jobs = contractOrders(s, me, budget, {
    maxQty: 20,
    tripPercent: 50,
    prefer: 'near',
    escort: false,
  });
  return [
    ...(saving ? [] : economy(s, me, budget, 6, ['walls', 'workshop', 'depot'])),
    ...settleOrders(s, me, budget, SETTLE_RESERVE, 1),
    ...jobs,
    ...runnerOrders(s, me, budget, TURTLE_RUNNER_SPARE),
    ...(jobs.length > 0 ? [] : fetchOrders(s, me)),
    ...sellStash(s, me),
    // Out of supplies and credits: sell a pile of what the district makes, as a player would.
    ...(jobs.length === 0 && starved(s, me, SETTLE_RESERVE) ? haulToHub(s, me) : []),
    ...resupply(s, me, budget, SETTLE_RESERVE),
    ...mine(s, me).map((d): Order => ({ type: 'stance', districtId: d.id, stance: 'hold' })),
  ];
};

/**
 * Carries its best stocked good to the nearest hub, sells whatever it holds there to the civic
 * traders, and buys supplies back when it is rich.
 */
export const merchant: Bot = (s, me) => {
  const budget = budgetFor(s, me);
  const orders = [
    ...economy(s, me, budget, 3, ['workshop']),
    ...settleOrders(s, me, budget, SETTLE_RESERVE, 1),
  ];
  const jobs = contractOrders(s, me, budget, {
    maxQty: VAN_CARGO,
    tripPercent: 60,
    prefer: 'pay',
    escort: true,
  });
  orders.push(
    ...sellStash(s, me),
    ...jobs,
    ...runnerOrders(s, me, budget, MERCHANT_RUNNER_SPARE),
    ...(jobs.length > 0 ? [] : haulToHub(s, me, true)),
    ...postSupplyContract(s, me, budget),
    ...resupply(s, me, budget),
  );
  return orders;
};

export const BOTS: Record<BotKind, Bot> = { raider, turtle, merchant };
