import { MS_PER_HOUR, balance, toAtoms, toUnits } from './balance.js';
import { buildCost } from './construction.js';
import { estimateClear, pickClearCrews, visibleAmbush } from './clear.js';
import { sightOf, strengthRange, towerReach } from './fog.js';
import { buildingLevel, totalGoods, warehouseCapacity } from './production.js';
import { civicAsk, civicBid } from './market.js';
import { depositFor, referenceValue } from './contracts.js';
import { shortestRoute, travelMs } from './routing.js';
import { validateOrder } from './orders.js';
import { fuelUnitsFor } from './fuel.js';
import { isPlayerProtected } from './raid.js';
import { isProtected } from './siege.js';
import {
  GOODS,
  type BuildingType,
  type Crew,
  type District,
  type GameState,
  type Good,
  type Goods,
  type Id,
  type Movement,
  type CargoRequest,
  type Order,
} from './types.js';

/**
 * Scripted players for the fast-forward harness. A bot is a pure function of the state and its
 * own id: it proposes orders, and the harness keeps only those `validateOrder` accepts. Bots read
 * the raw state (they are test fixtures, not clients), so they never see anything a player could
 * not act on. They are deliberately simple: they exist to exercise the rules, not to play well.
 */
export type BotKind = 'raider' | 'turtle' | 'merchant' | 'hunter';

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

/**
 * A bot with a Watchtower keeps its hauls off streets where it can see an ambush (the tower is what
 * lets it see that far). It holds the order and tries again next check-in; an ambush only lasts a
 * few hours. Reads only its own sight, so it is as fog-honest as a player.
 */
function avoidAmbushes(s: GameState, me: Id, orders: Order[]): Order[] {
  if (!mine(s, me).some((d) => buildingLevel(d, 'watchtower') > 0)) return orders;
  const sight = sightOf(s, me);
  const key = (a: Id, b: Id): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const hot = new Set<string>();
  for (const m of Object.values(s.movements)) {
    const r = m.raid;
    if (m.kind === 'ambush' && r && m.owner !== me && (sight.has(r.a) || sight.has(r.b))) {
      hot.add(key(r.a, r.b));
    }
  }
  if (hot.size === 0) return orders;
  return orders.filter((o) => {
    if (o.type !== 'haul' || !o.carrierId) return true;
    const loc = s.carriers[o.carrierId]?.loc;
    const route = loc && 'at' in loc ? shortestRoute(s.graph, loc.at, o.to) : null;
    if (!route) return true;
    return !route.route.some((n, i) => i > 0 && hot.has(key(route.route[i - 1] as Id, n)));
  });
}

type BuildList = BuildingType[] | ((d: District, index: number) => BuildingType[]);

const wantedAt = (d: District, index: number, list: BuildList): BuildingType[] =>
  (typeof list === 'function' ? list(d, index) : list).filter(
    (b) => !d.buildings.some((x) => x.type === b),
  );

const canBuildAt = (d: District): boolean => !d.construction && d.buildings.length < d.slots;

/**
 * What a bot is saving up goods for: the first building on its list that some district has room
 * for but cannot pay yet, and the goods it is short of. The bot shops for the shortfall (a player
 * would do the same: buy at the hub, haul it home), so building is not left to the odd district
 * that happens to make the right goods.
 */
interface Want {
  district: District;
  building: BuildingType;
  /** Goods still missing, in atoms; a zero entry means that good is covered. */
  short: Goods;
}

function nextWant(s: GameState, me: Id, list: BuildList): Want | null {
  for (const [index, d] of mine(s, me).entries()) {
    if (!canBuildAt(d)) continue;
    const building = wantedAt(d, index, list)[0];
    if (!building) continue;
    const cost = buildCost(building, 1);
    const short = { parts: 0, power: 0, data: 0, supplies: 0 };
    for (const g of GOODS) short[g] = Math.max(0, cost[g] - d.warehouse[g]);
    if (!GOODS.some((g) => short[g] > 0)) continue;
    return { district: d, building, short };
  }
  return null;
}

/** The goods a bot holds on to instead of selling back: what its next building needs. */
const keepGoods = (want: Want | null): Set<Good> =>
  new Set(
    GOODS.filter((g) => g === 'supplies' || g === 'power' || (want ? want.short[g] > 0 : false)),
  );

/** Power (units) a bot keeps in its home warehouse to fuel its carriers (sim-spec, "Fuel"). */
const TRIP_FUEL = fuelUnitsFor('van', 12_000);
const FUEL_RESERVE = Math.ceil(4 * TRIP_FUEL);
/** A bot skips a contract whose round-trip fuel would eat more than this share of the pay. */
const CONTRACT_FUEL_PERCENT = 35;
/** Fuel is bought a few trips at a time. */
const FUEL_BUY = Math.max(1, Math.ceil(10 * TRIP_FUEL));

/** Units of room in the district that is building, minus the goods it still has to receive. */
const roomFor = (want: Want): number =>
  Math.floor(toUnits(warehouseCapacity(want.district) - totalGoods(want.district.warehouse)));

/** The district that is building has no room for what it still needs: sell a surplus to make some. */
const needsRoom = (want: Want | null): boolean =>
  !!want &&
  roomFor(want) <
    Math.min(VAN_CARGO, Math.ceil(toUnits(GOODS.reduce((n, g) => n + want.short[g], 0)))) +
      ROOM_SLACK;

/** Growth every bot shares: recruit when it can pay, and put up one building per district. */
function economy(
  s: GameState,
  me: Id,
  budget: Budget,
  maxCrews: number,
  buildings: BuildList,
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
  for (const [index, d] of districts.entries()) {
    // One build at a time per district, and never into a full set of slots.
    if (!canBuildAt(d)) continue;
    // The first building on the list that the district can pay for goes up (list order is priority).
    const pick = wantedAt(d, index, buildings).find((b) => spend(budget, d.id, buildCost(b, 1)));
    if (pick) orders.push({ type: 'build', districtId: d.id, building: pick });
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
/** Units of warehouse room a bot leaves free when it shops for a building. */
const ROOM_SLACK = 4;

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
 * A raider only sets an ambush with its two strongest idle crews and when they total at least
 * this much (a full pair is 20): a beaten crew rests until it has healed instead of marching
 * out again to lose more (see sim-spec, "Raid balance after task 77").
 */
const AMBUSH_MIN_STRENGTH = 16;
/**
 * A newcomer whose protection ended less than this long ago is probed: the raider's ambush picks
 * that newcomer's street to the hub before any other, so a new player meets the raiding game
 * within about a day (sim-spec, "Bots and protection").
 */
const PROBE_WINDOW_HOURS = 24;

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
  // Rival Watchtowers that are in view cover the streets around them: an ambush there would be
  // seen at once, so the raider looks elsewhere.
  const sight = sightOf(s, me);
  const shadow = towerReach(s, (d) => d.owner !== me && sight.has(d.id));
  for (const base of mine(s, me)) {
    const crews = idleCrews(s, base.id, me).sort(
      (x, y) => y.strength - x.strength || (x.id < y.id ? -1 : 1),
    );
    const van = vanAt(s, base.id, me);
    if (crews.length < 2 || !van) continue;
    const full =
      crews.length >= 2 &&
      (crews[0] as Crew).strength + (crews[1] as Crew).strength >= AMBUSH_MIN_STRENGTH;
    if (!full) continue;
    const edges: { a: Id; b: Id; len: number; hot: boolean; short: boolean; fresh: boolean }[] = [];
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
      // A shortage at the hub means traders are racing there with loads (sim-spec, "Shortages").
      const short = s.shortages.some((x) => x.hub === hub.id);
      // Protection ended within the probe window: the owner is still a newcomer.
      const over = d.protectedUntilMs === undefined ? -1 : s.nowMs - d.protectedUntilMs;
      const fresh = over >= 0 && over <= PROBE_WINDOW_HOURS * MS_PER_HOUR;
      edges.push({
        a,
        b,
        len: Math.min(length(s, base.id, a), length(s, base.id, b)),
        hot,
        short,
        fresh,
      });
    }
    const edge = edges
      .filter((e) => Number.isFinite(e.len) && !shadow.has(e.a) && !shadow.has(e.b))
      .sort(
        (x, y) =>
          Number(y.fresh) - Number(x.fresh) ||
          Number(y.hot) - Number(x.hot) ||
          Number(y.short) - Number(x.short) ||
          x.len - y.len ||
          (x.a < y.a ? -1 : 1),
      )[0];
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

/**
 * A raider fixes its crews faster (Garage) and sees ambushes coming (Watchtower) at home; the
 * outer districts only get a Workshop. It shops only with credits to spare.
 */
const RAIDER_BUILDINGS = (_d: District, index: number): BuildingType[] =>
  index === 0 ? ['watchtower', 'garage', 'workshop'] : ['workshop'];

/** Sends its crews at the nearest district it does not own (neutral plots first on ties). */
export const raider: Bot = (s, me) => {
  const budget = budgetFor(s, me);
  const orders = economy(s, me, budget, 6, RAIDER_BUILDINGS);
  const want = nextWant(s, me, RAIDER_BUILDINGS);
  // Raiding comes first, and the raiders' one van is their raiding engine: every errand that
  // takes it away (shopping runs, staging, fetching) cost more raids than the buildings were
  // worth in the harness (see "Bot building" in the sim spec). So a raider builds from what its
  // districts make and sells the rest.
  const errands = (): Order[] => [
    ...sellStash(s, me, keepGoods(want)),
    // Out of fuel: fetch the power bought at the hub (only when the van is not out raiding).
    ...fetchOrders(s, me, new Set<Good>(['power'])),
  ];
  // One campaign at a time.
  const campaigning =
    Object.values(s.sieges).some((g) => g.attacker === me) ||
    Object.values(s.movements).some((m) => m.owner === me && m.kind === 'siege');
  if (campaigning) return [...orders, ...ambushOrders(s, me), ...errands()];
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
  return [...orders, ...errands()];
};

/**
 * Crews waiting at a hub carry what was bought there home (the goods the next building needs go
 * to that district, the rest to the home warehouse), or just walk home when nothing is left.
 */
function bringHome(s: GameState, me: Id, want: Want | null): Order[] {
  const keep = keepGoods(want);
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
      const stash = player.stash[here.id];
      // What was bought here (the goods the next building needs first, then supplies), one van-load.
      const cargo: Partial<Goods> = {};
      let room = VAN_CARGO;
      const order = [...GOODS].sort(
        (x, y) => Number(want?.short[y] ? 1 : 0) - Number(want?.short[x] ? 1 : 0),
      );
      // The van needs its fuel for the way home: power that is not in a warehouse stays behind.
      const inWarehouses = mine(s, me).reduce((n, d) => n + toUnits(d.warehouse.power), 0);
      const tripFuel =
        Math.ceil(
          fuelUnitsFor(
            'van',
            Math.max(length(s, here.id, home.id), want ? length(s, here.id, want.district.id) : 0),
          ),
        ) + 1;
      const fuelHere = Math.max(0, tripFuel - Math.floor(inWarehouses));
      for (const g of order) {
        const qty = Math.min(
          room,
          Math.floor(toUnits(stash?.[g] ?? 0)) - (g === 'power' ? fuelHere : 0),
        );
        if (!keep.has(g) || qty < 1) continue;
        cargo[g] = qty;
        room -= qty;
      }
      const forBuilding = !!want && GOODS.some((g) => want.short[g] > 0 && (cargo[g] ?? 0) > 0);
      // Carry the goods bought here back: to the district that is building, else the warehouse.
      const to = forBuilding && want ? want.district.id : home.id;
      if (van && Object.keys(cargo).length > 0) {
        orders.push({ type: 'haul', carrierId: van, crewIds: [crew.id], to, cargo });
      } else {
        orders.push({ type: 'move', carrierId: van, crewIds: [crew.id], to: home.id });
      }
    }
  }
  return orders;
}

/**
 * Keeps a base in supplies the way a player would: when a settlement is wanted but the home
 * warehouse is short, a van-load is bought from the civic traders at the nearest hub (spending
 * from `budget`), and the crews waiting at a hub bring it home (`bringHome`).
 */
function resupply(
  s: GameState,
  me: Id,
  budget: Budget,
  want: Want | null,
  reserve = SETTLE_RESERVE,
): Order[] {
  const keep = keepGoods(want);
  const orders: Order[] = bringHome(s, me, want);
  const player = s.players[me];
  if (!player) return orders;
  // Short on supplies for the next settlement: buy a van-load from the civic traders.
  const home = mine(s, me)[0];
  const hasStash = Object.values(player.stash).some((st) =>
    GOODS.some(
      (g) => keep.has(g) && toUnits(st[g]) >= (g === 'power' ? Math.max(1, FUEL_RESERVE) : 1),
    ),
  );
  const inFlight = Object.values(s.movements).some((m) => m.owner === me && m.kind === 'haul');
  const wantsPlot = Object.values(s.districts).some(
    (d) => d.kind !== 'hub' && d.owner === 'neutral' && d.frontier === 'open',
  );
  if (home && wantsPlot && !hasStash && !inFlight) {
    const have = toUnits(budget.warehouse[home.id]?.supplies ?? 0);
    const hub = cheapestHubFor(s, home.id, 'supplies');
    const book = hub ? s.markets[hub.id]?.supplies : undefined;
    if (hub && book && have < balance.settle.supplies + 30) {
      // Buy a little over the target: crew upkeep eats supplies while the van is on the road.
      const need = Math.ceil(balance.settle.supplies + reserve + BUY_MARGIN - have);
      const price = civicAsk(book);
      const spare = toUnits(budget.credits) - fuelCredits(s, home.id, hub.id);
      const affordable = Math.floor((Math.max(0, spare) * 100) / price);
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
 * Sends an idle crew and van from home to the hub holding goods it bought, so the next
 * check-in can haul them home (a move, exactly what a player would order).
 */
function fetchOrders(s: GameState, me: Id, keep: Set<Good>): Order[] {
  const player = s.players[me];
  const home = mine(s, me)[0];
  if (!player || !home) return [];
  const inFlight = Object.values(s.movements).some((m) => m.owner === me);
  if (inFlight) return [];
  const hub = Object.entries(player.stash).find(([, st]) =>
    GOODS.some(
      (g) => keep.has(g) && toUnits(st[g]) >= (g === 'power' ? Math.max(1, FUEL_RESERVE) : 1),
    ),
  )?.[0];
  if (!hub) return [];
  // Any own district that has a van and a crew standing by can go (the kit's van is not always at home).
  for (const base of mine(s, me)) {
    const crew = idleCrews(s, base.id, me)[0];
    const van = vanAt(s, base.id, me);
    if (crew && van) return [{ type: 'move', carrierId: van, crewIds: [crew.id], to: hub }];
  }
  return [];
}

/** Sells whatever sits in the hub stash to the civic traders, except goods the bot is keeping. */
function sellStash(s: GameState, me: Id, keep: Set<Good>): Order[] {
  const orders: Order[] = [];
  const player = s.players[me];
  if (!player) return orders;
  for (const [hub, stash] of Object.entries(player.stash)) {
    for (const good of GOODS) {
      // Goods bought here for settling or building are not for sale.
      // (Power is kept only up to a trip's worth of fuel; the rest is sold.)
      if (keep.has(good) && good !== 'power') continue;
      const qty = Math.floor(toUnits(stash[good])) - (keep.has(good) ? FUEL_BUY : 0);
      const book = s.markets[hub]?.[good];
      if (qty >= 1 && book) {
        orders.push({ type: 'market.place', hub, side: 'sell', good, price: civicBid(book), qty });
      }
    }
  }
  return orders;
}

/**
 * Moves what the next building needs from another own warehouse (docks districts pile up parts)
 * to the district that is building, one van and one crew, one trip at a time. Own stores only.
 */
function stageGoods(s: GameState, me: Id, want: Want | null): Order[] {
  if (!want || Object.values(s.movements).some((m) => m.owner === me && m.kind === 'haul')) {
    return [];
  }
  const goods = GOODS.filter((g) => want.short[g] > 0);
  for (const base of mine(s, me)) {
    if (base.id === want.district.id) continue;
    const cargo: Partial<Goods> = {};
    let room = VAN_CARGO;
    for (const g of goods) {
      const qty = Math.min(
        room,
        Math.floor(toUnits(base.warehouse[g])),
        Math.ceil(toUnits(want.short[g])),
      );
      if (qty < 1) continue;
      cargo[g] = qty;
      room -= qty;
    }
    const crew = idleCrews(s, base.id, me)[0];
    const van = vanAt(s, base.id, me);
    if (Object.keys(cargo).length === 0 || !crew || !van) continue;
    return [{ type: 'haul', carrierId: van, crewIds: [crew.id], to: want.district.id, cargo }];
  }
  return [];
}

/**
 * Buys one good the next building is short of at the nearest hub (the civic ask), when the bot can
 * pay it and still keep `reserve` credits. The goods wait in the hub stash for a van to fetch.
 */
function shopOrders(
  s: GameState,
  me: Id,
  budget: Budget,
  want: Want | null,
  reserve: number,
): Order[] {
  const player = s.players[me];
  const home = mine(s, me)[0];
  if (!want || !player || !home) return [];
  // Goods already waiting at a hub for the next building: fetch those before buying more.
  if (
    Object.values(player.stash).some((st) =>
      GOODS.some((g) => want.short[g] > 0 && toUnits(st[g]) >= 1),
    )
  ) {
    return [];
  }
  if (!nearestHubTo(s, home.id)) return [];
  // A full warehouse turns goods away at the door: only buy what fits (keeping a little slack
  // for what the district makes while the van is on the road).
  const free = roomFor(want);
  for (const good of GOODS) {
    const short = Math.ceil(toUnits(want.short[good]));
    const hub = cheapestHubFor(s, home.id, good);
    const book = hub && s.markets[hub.id]?.[good];
    if (short < 1 || !hub || !book) continue;
    // Another own warehouse that can hand the goods over is free (see stageGoods).
    if (mine(s, me).some((b) => b.id !== want.district.id && toUnits(b.warehouse[good]) >= short)) {
      continue;
    }
    const price = civicAsk(book);
    const room = toUnits(budget.credits) - reserve - fuelCredits(s, home.id, hub.id);
    const qty = Math.min(
      VAN_CARGO,
      short,
      free - ROOM_SLACK,
      Math.floor(book.askDepth),
      Math.floor((room * 100) / price),
    );
    if (qty < 1) continue;
    budget.credits -= toAtoms((price * qty) / 100);
    return [{ type: 'market.place', hub: hub.id, side: 'buy', good, price, qty }];
  }
  return [];
}

/** Hauls the biggest spare pile from a home warehouse to the nearest hub. */
function haulToHub(s: GameState, me: Id, keep: Set<Good>, escort = false): Order[] {
  const orders: Order[] = [];
  for (const base of mine(s, me)) {
    const idle = idleCrews(s, base.id, me);
    const crew = idle[0];
    const van = vanAt(s, base.id, me);
    if (!crew || !van) continue;
    let best: { good: Good; qty: number } | null = null;
    for (const good of GOODS) {
      // Keep supplies for recruiting, and whatever the next building still needs.
      if (good !== 'supplies' && good !== 'power' && keep.has(good)) continue;
      // Power above a couple of trips' fuel is surplus (sim-spec, "Fuel").
      const spare =
        Math.floor(toUnits(base.warehouse[good])) -
        (good === 'supplies' ? balance.settle.supplies + 25 : 0) -
        (good === 'power' ? 2 * FUEL_RESERVE : 0);
      if (spare >= 10 && (!best || spare > best.qty)) best = { good, qty: spare };
    }
    if (!best) continue;
    // Delivered profit: each hub's civic bid less the transport charge for the street distance
    // (the same rate that sets the regional base), so a farther hub that pays more wins.
    const good = best.good;
    const rate = balance.market.regional.transportPercentPerKm;
    const net = (d: District): number => {
      const book = s.markets[d.id]?.[good];
      const bid = book ? civicBid(book) : 0;
      return bid - Math.floor((bid * rate * length(s, base.id, d.id)) / 100_000);
    };
    // Sell low when the warehouse is nearly full or the bot is starved of cash: the nearest hub
    // takes the goods now, rather than a longer trip to the best-paying one.
    const crowded = totalGoods(base.warehouse) >= 0.85 * warehouseCapacity(base);
    const short = starved(s, me, SETTLE_RESERVE);
    const hub =
      crowded || short
        ? nearestHubTo(s, base.id)
        : Object.values(s.districts)
            .filter((d) => d.kind === 'hub')
            .sort((a, b) => net(b) - net(a) || a.id.localeCompare(b.id))[0];
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

/**
 * The hub where a good costs least delivered to the `from` district: the civic ask plus the
 * transport charge for the street distance (the rate that builds the regional base), ties to the
 * nearer hub.
 */
function cheapestHubFor(s: GameState, from: Id, good: Good): District | undefined {
  const rate = balance.market.regional.transportPercentPerKm;
  const cost = (d: District): number => {
    const book = s.markets[d.id]?.[good];
    const ask = book ? civicAsk(book) : Number.MAX_SAFE_INTEGER;
    return ask + Math.floor((ask * rate * length(s, from, d.id)) / 100_000);
  };
  return Object.values(s.districts)
    .filter((d) => d.kind === 'hub')
    .sort((x, y) => cost(x) - cost(y) || length(s, from, x.id) - length(s, from, y.id))[0];
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

const spareUnits = (base: District, good: Good): number =>
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
      // The van's power for the round trip should leave most of the pay (a runner burns little).
      const fuelCost =
        2 *
        fuelUnitsFor(byRunner ? 'runner' : 'van', len) *
        (balance.market.baseRefCents.power / 100);
      if (fuelCost * 100 > c.reward * CONTRACT_FUEL_PERCENT) continue;
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

/**
 * Walls first, then a Watchtower (it sees ambushes coming), a Workshop and a Depot at home; the
 * outer districts get walls, a tower and a workshop.
 */
const TURTLE_BUILDINGS = (_d: District, index: number): BuildingType[] =>
  index === 0 ? ['workshop', 'walls', 'watchtower', 'depot'] : ['walls', 'watchtower', 'workshop'];
const TURTLE_SHOP_RESERVE = 120;
const MERCHANT_SHOP_RESERVE = 400;

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
  const want = nextWant(s, me, TURTLE_BUILDINGS);
  const keep = keepGoods(want);
  const plan = [
    ...(saving ? [] : economy(s, me, budget, 6, TURTLE_BUILDINGS)),
    ...(saving ? [] : stageGoods(s, me, want)),
    ...settleOrders(s, me, budget, SETTLE_RESERVE, 1),
    ...jobs,
    ...runnerOrders(s, me, budget, TURTLE_RUNNER_SPARE),
    ...(jobs.length > 0 ? [] : fetchOrders(s, me, keep)),
    ...sellStash(s, me, keep),
    // Out of supplies and credits: sell a pile of what the district makes, as a player would.
    ...(jobs.length === 0 && (starved(s, me, SETTLE_RESERVE) || needsRoom(want))
      ? haulToHub(s, me, keep)
      : []),
    ...resupply(s, me, budget, want, SETTLE_RESERVE),
    ...(saving ? [] : shopOrders(s, me, budget, want, TURTLE_SHOP_RESERVE)),
    ...mine(s, me).map((d): Order => ({ type: 'stance', districtId: d.id, stance: 'hold' })),
  ];
  return avoidAmbushes(s, me, plan);
};

/**
 * Carries its best stocked good to the nearest hub, sells whatever it holds there to the civic
 * traders, and buys supplies back when it is rich.
 */
export const merchant: Bot = (s, me) => {
  const budget = budgetFor(s, me);
  const carriers = Object.values(s.carriers).filter((c) => c.owner === me).length;
  // A Depot and a Garage (once it runs more than one carrier) at home; a Workshop elsewhere.
  const merchantBuildings = (_d: District, index: number): BuildingType[] =>
    index === 0
      ? ['workshop', 'depot', ...(carriers >= 2 ? (['garage'] as const) : [])]
      : ['workshop'];
  const want = nextWant(s, me, merchantBuildings);
  const keep = keepGoods(want);
  const orders = [
    ...economy(s, me, budget, 3, merchantBuildings),
    ...settleOrders(s, me, budget, SETTLE_RESERVE, 1),
    ...stageGoods(s, me, want),
  ];
  // Goods bought at a hub wait in the stash for a van: fetching them comes before the next job.
  const fetch = fetchOrders(s, me, keep);
  const jobs =
    fetch.length > 0
      ? []
      : contractOrders(s, me, budget, {
          maxQty: VAN_CARGO,
          tripPercent: 60,
          prefer: 'pay',
          escort: true,
        });
  orders.push(
    ...sellStash(s, me, keep),
    ...jobs,
    ...runnerOrders(s, me, budget, MERCHANT_RUNNER_SPARE),
    ...fetch,
    ...(jobs.length > 0 || fetch.length > 0 ? [] : haulToHub(s, me, keep, true)),
    ...postSupplyContract(s, me, budget),
    ...resupply(s, me, budget, want),
    ...shopOrders(s, me, budget, want, MERCHANT_SHOP_RESERVE),
  );
  return orders;
};

const HUNTER_BUILDINGS = (_d: District, index: number): BuildingType[] =>
  index === 0 ? ['watchtower', 'workshop', 'garage'] : ['watchtower', 'workshop'];

/**
 * Watches the streets: a Watchtower in every district (raiders skip streets under a rival tower
 * they can see), escorted jobs with two crews in the van, and it holds hauls back while its own
 * sight shows an ambush on the route. It never attacks.
 */
export const hunter: Bot = (s, me) => {
  const budget = budgetFor(s, me);
  const want = nextWant(s, me, HUNTER_BUILDINGS);
  const keep = keepGoods(want);
  const orders = [
    ...economy(s, me, budget, 6, HUNTER_BUILDINGS),
    ...settleOrders(s, me, budget, SETTLE_RESERVE, 1),
    ...stageGoods(s, me, want),
  ];
  const fetch = fetchOrders(s, me, keep);
  const jobs =
    fetch.length > 0
      ? []
      : contractOrders(s, me, budget, {
          maxQty: VAN_CARGO,
          tripPercent: 60,
          prefer: 'pay',
          escort: true,
        });
  orders.push(
    ...sellStash(s, me, keep),
    ...jobs,
    ...runnerOrders(s, me, budget, MERCHANT_RUNNER_SPARE),
    ...fetch,
    ...(jobs.length > 0 || fetch.length > 0 ? [] : haulToHub(s, me, keep, true)),
    ...resupply(s, me, budget, want),
    ...shopOrders(s, me, budget, want, MERCHANT_SHOP_RESERVE),
    ...mine(s, me).map((d): Order => ({ type: 'stance', districtId: d.id, stance: 'hold' })),
  );
  return avoidAmbushes(s, me, orders);
};

/**
 * One street job per check-in, taken last so every other plan keeps its crews. A bot takes the
 * first offer that the normal order check accepts, with the van when one is idle at the
 * same district, and never uses a crew or carrier another order of this turn already names.
 */
export function streetJobOrders(s: GameState, me: Id, taken: Order[]): Order[] {
  const player = s.players[me];
  if (!player || player.jobs.length === 0) return [];
  const used = new Set<Id>();
  for (const o of taken) {
    if ('crewIds' in o) for (const id of o.crewIds) used.add(id);
    if ('carrierId' in o && o.carrierId) used.add(o.carrierId);
  }
  for (const base of mine(s, me)) {
    if (base.kind === 'hub') continue;
    const crew = idleCrews(s, base.id, me).find((c) => !used.has(c.id));
    if (!crew) continue;
    const van = vanAt(s, base.id, me);
    const carriers = van && !used.has(van) ? [van, null] : [null];
    for (const job of player.jobs) {
      for (const carrierId of carriers) {
        const order: Order = { type: 'job.take', jobId: job.id, crewId: crew.id, carrierId };
        if (validateOrder(s, { actorId: me, order }).ok) return [order];
      }
    }
  }
  return [];
}

/**
 * "Break it up": once per check-in a bot may send its free crews at an ambush it can see, when the
 * fogged estimate says it is likely to win. `nearOwn` limits it to ambushes on a street with an end
 * at one of its own districts (the Turtle defends its doorstep and does not go looking). Taken after
 * every other plan so it only uses crews nothing else wanted.
 */
export function clearOrders(s: GameState, me: Id, taken: Order[], nearOwn: boolean): Order[] {
  const used = new Set<Id>();
  for (const o of taken) {
    if ('crewIds' in o) for (const id of o.crewIds) used.add(id);
    if ('carrierId' in o && o.carrierId) used.add(o.carrierId);
  }
  const going = new Set(
    Object.values(s.movements)
      .filter((m) => m.kind === 'clear' && m.owner === me)
      .map((m) => m.clear?.ambushId),
  );
  const owned = new Set(mine(s, me).map((d) => d.id));
  for (const id of Object.keys(s.movements).sort()) {
    const m = s.movements[id] as Movement;
    const r = m.raid;
    if (going.has(id) || !r || !visibleAmbush(s, me, id)) continue;
    if (nearOwn && !owned.has(r.a) && !owned.has(r.b)) continue;
    const pick = pickClearCrews(s, me, r, used);
    if (!pick) continue;
    const range = strengthRange(m.crewIds.reduce((n, c) => n + (s.crews[c]?.strength ?? 0), 0));
    if (estimateClear(pick.strength, { strength: range }).label === 'risky') continue;
    const order: Order = {
      type: 'ambush.clear',
      ambushId: id,
      crewIds: pick.crewIds,
      carrierId: pick.carrierId,
    };
    if (validateOrder(s, { actorId: me, order }).ok) return [order];
  }
  return [];
}

/**
 * Keeps a bot in fuel: when the home warehouse runs low on power and none waits in a hub stash,
 * a load is bought at the nearest hub (fetched like any other shopping). Orders that would still
 * be refused for lack of fuel are dropped, so a bot never proposes a trip it cannot pay for.
 */
export function fuelOrders(s: GameState, me: Id, taken: Order[]): Order[] {
  const player = s.players[me];
  const home = mine(s, me)[0];
  if (!player || !home || FUEL_RESERVE === 0) return [];
  const pool = mine(s, me).reduce((n, d) => n + toUnits(d.warehouse.power), 0);
  if (pool >= FUEL_RESERVE) return [];
  if (Object.values(player.stash).some((st) => toUnits(st.power) >= 1)) return [];
  if (taken.some((o) => o.type === 'market.place' && o.good === 'power')) return [];
  const hub = cheapestHubFor(s, home.id, 'power');
  const book = hub && s.markets[hub.id]?.power;
  if (!hub || !book) return [];
  const price = civicAsk(book);
  // Buys a full load when it can, else whatever the credits stretch to (a broke bot still moves).
  const afford = Math.floor((toUnits(player.credits) * 100) / price);
  const qty = Math.min(FUEL_BUY, Math.floor(book.askDepth), afford);
  if (qty < 1) return [];
  return [{ type: 'market.place', hub: hub.id, side: 'buy', good: 'power', price, qty }];
}

/** Credits that keep a van's return trip from `hub` fuelled (a little over what it costs). */
function fuelCredits(s: GameState, homeId: Id, hubId: Id): number {
  const book = s.markets[hubId]?.power;
  if (!book) return 0;
  return (fuelUnitsFor('van', length(s, hubId, homeId)) + 1) * (civicAsk(book) / 100) + 5;
}

const withFuel =
  (bot: Bot): Bot =>
  (s, me) => {
    const orders = bot(s, me);
    const all = [...orders, ...fuelOrders(s, me, orders)];
    const out: Order[] = [];
    for (const o of all) {
      const r = validateOrder(s, { actorId: me, order: o, atMs: s.nowMs });
      if (r.ok || r.error !== 'no_fuel') out.push(o);
      else if (o.type === 'move' && o.carrierId !== null) {
        // Out of fuel everywhere: the crew walks (burning none).
        const foot: Order = { ...o, carrierId: null };
        if (validateOrder(s, { actorId: me, order: foot, atMs: s.nowMs }).ok) out.push(foot);
      } else if (o.type === 'haul' && o.carrierId !== null && !o.contractId) {
        // Carry what a crew on foot can (sim-spec, "Fuel"), a few units at a time.
        let room = balance.carriers.foot.cargo;
        const cargo: CargoRequest = {};
        for (const g of GOODS) {
          const qty = Math.min(room, o.cargo[g] ?? 0);
          if (qty >= 1) {
            cargo[g] = qty;
            room -= qty;
          }
        }
        const foot: Order = { ...o, carrierId: null, cargo };
        if (validateOrder(s, { actorId: me, order: foot, atMs: s.nowMs }).ok) out.push(foot);
      }
    }
    return out;
  };

const withJobs =
  (bot: Bot, clears?: 'any' | 'near'): Bot =>
  (s, me) => {
    const orders = bot(s, me);
    const jobs = streetJobOrders(s, me, orders);
    const all = [...orders, ...jobs];
    return clears ? [...all, ...clearOrders(s, me, all, clears === 'near')] : all;
  };

export const BOTS: Record<BotKind, Bot> = {
  raider: withFuel(withJobs(raider)),
  turtle: withFuel(withJobs(turtle, 'near')),
  merchant: withFuel(withJobs(merchant)),
  hunter: withFuel(withJobs(hunter, 'any')),
};
