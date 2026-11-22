import { MS_PER_HOUR, MS_PER_MINUTE, balance, maxLevelOf, toAtoms } from './balance.js';
import { runnerPrice, wearOf } from './wear.js';
import {
  cancelContract,
  postContract,
  takeContract,
  validateCancel,
  validateContractHaul,
  validatePost,
  validateTake,
} from './contracts.js';
import { buildCost, startConstruction } from './construction.js';
import { emit, type Ctx } from './ctx.js';
import { jobTaken, resolveJob } from './jobs.js';
import { cancelOrder, findOrder, placeOrder, validatePlace } from './market.js';
import { take } from './cost.js';
import { addFuelCost, burnFuel, fuelFor } from './fuel.js';
import { afterWarehouseChange, buildingLevel, storeAt, valueStoreAt } from './production.js';
import { shortestRoute, travelMs, type Route } from './routing.js';
import { pickClearCrews, visibleAmbush } from './clear.js';
import { endAmbush, isPlayerProtected } from './raid.js';
import { isProtected, refreshSiege } from './siege.js';
import { placeCrew, recallMovement, startMovement } from './travel.js';
import {
  GOODS,
  type BuildingType,
  type Carrier,
  type ClearInfo,
  type Crew,
  type District,
  type GameState,
  type Goods,
  type Id,
  type Input,
  type JobOffer,
  type Movement,
  type MovementKind,
  type Order,
  type OrderError,
  type RaidInfo,
  type Validation,
} from './types.js';

/** An order that passed validation, with everything needed to apply it. */
type Plan =
  | {
      type: 'travel';
      owner: Id;
      kind: MovementKind;
      carrier: Carrier | null;
      crews: Crew[];
      cargo: Goods;
      /** Power atoms burned as fuel, drawn from the start store. */
      fuel: number;
      route: Route;
      durationMs: number;
      raid?: RaidInfo;
      clear?: ClearInfo;
      contractId?: Id;
      job?: JobOffer;
    }
  | { type: 'build'; district: District; building: BuildingType }
  | { type: 'stance'; district: District; stance: 'hold' | 'pullback' }
  | { type: 'recall'; movement: Movement }
  | { type: 'recruit'; district: District }
  | { type: 'buyCarrier'; district: District }
  | { type: 'place'; order: Extract<Order, { type: 'market.place' }> }
  | { type: 'cancel'; orderId: Id }
  | { type: 'post'; order: Extract<Order, { type: 'contract.post' }> }
  | { type: 'take'; contractId: Id }
  | { type: 'withdraw'; contractId: Id };

type Resolved = { plan: Plan } | { error: OrderError };

const fail = (error: OrderError): Resolved => ({ error });

function nodeOf(unit: { loc: Crew['loc'] }): Id | null {
  return 'at' in unit.loc ? unit.loc.at : null;
}

interface TravelRequest {
  kind: MovementKind;
  actorId: Id;
  carrierId: Id | null;
  crewIds: readonly Id[];
  to: Id;
  cargo?: Partial<Record<string, number>>;
  /** Raids only: the street to lie in wait on, and for how many hours. */
  edge?: { a: Id; b: Id; hours: number };
  /** Clears only: the ambush to break up. */
  clearAmbushId?: Id;
  /** Hauls only: deliver to this contract. */
  contractId?: Id;
  /** Street jobs: the errand (its route and duration replace the walk). */
  job?: JobOffer;
}

function resolveTravel(state: GameState, req: TravelRequest): Resolved {
  const crews: Crew[] = [];
  const seen = new Set<Id>();
  for (const id of req.crewIds) {
    if (seen.has(id)) return fail('duplicate_unit');
    seen.add(id);
    const crew = state.crews[id];
    if (!crew) return fail('unknown_crew');
    if (crew.owner !== req.actorId) return fail('not_owner');
    if (nodeOf(crew) === null) return fail('crew_busy');
    if (crew.readyAtMs > state.nowMs) return fail('crew_not_ready');
    crews.push(crew);
  }
  if (crews.length === 0) return fail('no_crew');

  let carrier: Carrier | null = null;
  if (req.carrierId !== null) {
    carrier = state.carriers[req.carrierId] ?? null;
    if (!carrier) return fail('unknown_carrier');
    if (carrier.owner !== req.actorId) return fail('not_owner');
    if (balance.carriers[carrier.kind].locked) return fail('carrier_locked');
    if (nodeOf(carrier) === null) return fail('carrier_busy');
  }
  const kind = carrier?.kind ?? 'foot';
  const spec = balance.carriers[kind];
  if (crews.length > spec.seats) return fail('too_many_crews');

  const from = nodeOf(crews[0] as Crew) as Id;
  if (crews.some((c) => nodeOf(c) !== from)) return fail('not_colocated');
  if (carrier && nodeOf(carrier) !== from) return fail('not_colocated');

  let to = req.to;
  let raid: RaidInfo | undefined;
  let clear: ClearInfo | undefined;
  let jobRun: { route: Route; durationMs: number } | undefined;
  if (req.job) {
    const run = resolveJob(state, req.actorId, req.job, from, carrier !== null);
    if ('error' in run) return fail(run.error);
    jobRun = run;
    to = run.route.route[run.route.route.length - 1] as Id;
  }
  if (req.kind === 'raid' && req.edge) {
    const { a, b, hours } = req.edge;
    // A player shielded from raids may not raid: immunity plus ambushes would be a free ride.
    if (isPlayerProtected(state, req.actorId)) return fail('protected_no_raid');
    if (!state.graph.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) {
      return fail('bad_edge');
    }
    if (!Number.isInteger(hours) || hours < 1 || hours > balance.raid.maxHours) {
      return fail('bad_window');
    }
    const active = Object.values(state.movements).filter(
      (m) => m.owner === req.actorId && (m.kind === 'raid' || m.kind === 'ambush'),
    ).length;
    if (active >= balance.raid.maxActive) return fail('too_many_raids');
    // Wait at the end of the street that is the shorter walk (ties: the smaller id).
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const toLo = shortestRoute(state.graph, from, lo);
    const toHi = shortestRoute(state.graph, from, hi);
    if (!toLo && !toHi) return fail('no_route');
    to = toLo && (!toHi || toLo.lengthM <= toHi.lengthM) ? lo : hi;
    raid = {
      a: lo,
      b: hi,
      near: to,
      home: from,
      windowMs: hours * MS_PER_HOUR,
      untilMs: 0,
      struck: [],
    };
  }
  if (req.kind === 'clear' && req.clearAmbushId !== undefined) {
    // A blind guess and an ambush that does not exist look the same: only what you see is a target.
    const ambush = visibleAmbush(state, req.actorId, req.clearAmbushId);
    if (!ambush?.raid) return fail('unknown_movement');
    const { a, b } = ambush.raid;
    const toA = shortestRoute(state.graph, from, a);
    const toB = shortestRoute(state.graph, from, b);
    if (!toA && !toB) return fail('no_route');
    to = toA && (!toB || toA.lengthM <= toB.lengthM) ? a : b;
    clear = { ambushId: ambush.id, a, b, near: to, home: from };
  }
  const target = state.districts[to];
  if (!target) return fail('unknown_district');
  if (req.kind !== 'raid' && req.kind !== 'clear' && to === from) return fail('invalid_target');
  if (req.kind === 'raid' || req.kind === 'clear') {
    // Any street will do; the checks above are all a raid or a clear needs.
  } else if (req.kind === 'job') {
    // resolveJob checked the origin and picked the destination.
  } else if (req.kind === 'scout') {
    if (target.kind === 'hub') return fail('invalid_target');
  } else if (req.kind === 'siege') {
    if (target.kind === 'hub' || target.owner === req.actorId) return fail('invalid_target');
    if (target.settling?.owner === req.actorId) return fail('invalid_target');
    if (isProtected(target, state.nowMs)) return fail('protected');
    const siege = state.sieges[target.id];
    if (siege && siege.attacker !== req.actorId && siege.crewIds.length > 0) {
      return fail('invalid_target');
    }
  } else if (req.kind === 'settle') {
    if (target.kind === 'hub' || target.owner !== 'neutral' || target.frontier !== 'open') {
      return fail('not_open_plot');
    }
    if (target.settling) return fail('already_settling');
  } else if (req.kind === 'reinforce') {
    if (target.kind === 'hub' || target.owner !== req.actorId) return fail('invalid_target');
  } else if (target.kind !== 'hub' && target.owner !== req.actorId) {
    return fail('invalid_target');
  }

  const cargo: Goods = { parts: 0, power: 0, data: 0, supplies: 0 };
  if (req.kind === 'settle') {
    const origin = state.districts[from];
    if (!origin || origin.kind === 'hub' || origin.owner !== req.actorId) {
      return fail('invalid_target');
    }
    cargo.supplies = toAtoms(balance.settle.supplies);
    if (origin.warehouse.supplies < cargo.supplies) return fail('insufficient_goods');
  }
  if (req.kind === 'haul') {
    let total = 0;
    for (const [good, qty] of Object.entries(req.cargo ?? {})) {
      if (!(GOODS as readonly string[]).includes(good)) return fail('bad_quantity');
      if (qty === undefined) continue;
      if (!Number.isInteger(qty) || qty <= 0) return fail('bad_quantity');
      cargo[good as keyof Goods] = toAtoms(qty);
      total += qty;
    }
    if (total === 0) return fail('empty_cargo');
    if (req.contractId !== undefined) {
      const error = validateContractHaul(state, req.actorId, req.contractId, to, req.cargo ?? {});
      if (error) return fail(error);
    }
    if (total > spec.cargo) return fail('over_capacity');
    const source = sourceStore(state, req.actorId, from);
    if (!source) return fail('invalid_target');
    for (const g of GOODS) if (source[g] < cargo[g]) return fail('insufficient_goods');
  }

  const route = jobRun?.route ?? shortestRoute(state.graph, from, to);
  if (!route) return fail('no_route');
  // Fuel: a carrier needs power in the start store for the whole trip, on top of any power cargo.
  // Errands and a carrier parked away from any store of its owner's burn nothing.
  const fuel = req.kind === 'job' ? 0 : fuelFor(kind, route.lengthM);
  if (fuel > 0) {
    const store = sourceStore(state, req.actorId, from);
    if (store && store.power - cargo.power + otherPower(state, req.actorId, from) < fuel) {
      return fail('no_fuel');
    }
  }
  return {
    plan: {
      type: 'travel',
      owner: req.actorId,
      kind: req.kind,
      carrier,
      crews,
      cargo,
      fuel,
      route,
      durationMs:
        jobRun?.durationMs ?? travelMs(route.lengthM, kind, carrier ? wearOf(carrier) : 0),
      ...(raid ? { raid } : {}),
      ...(clear ? { clear } : {}),
      ...(req.contractId !== undefined ? { contractId: req.contractId } : {}),
      ...(req.job ? { job: req.job } : {}),
    },
  };
}

/** Power atoms in an owner's district warehouses other than the one at `nodeId` (fuel top-up). */
function otherPower(state: GameState, owner: Id, nodeId: Id): number {
  let sum = 0;
  for (const d of Object.values(state.districts)) {
    if (d.id !== nodeId && d.kind !== 'hub' && d.owner === owner) sum += d.warehouse.power;
  }
  return sum;
}

/** Read-only view of the goods an actor can load at a node (no ctx needed). */
function sourceStore(state: GameState, owner: Id, nodeId: Id): Goods | null {
  const d = state.districts[nodeId];
  if (!d) return null;
  if (d.kind === 'hub') {
    return state.players[owner]?.stash[nodeId] ?? { parts: 0, power: 0, data: 0, supplies: 0 };
  }
  return d.owner === owner ? d.warehouse : null;
}

function resolve(state: GameState, input: Input): Resolved {
  const { actorId, order } = input;
  if (!state.players[actorId]) return fail('unknown_actor');
  switch (order.type) {
    case 'move':
      return resolveTravel(state, {
        kind: 'move',
        actorId,
        carrierId: order.carrierId,
        crewIds: order.crewIds,
        to: order.to,
      });
    case 'haul':
      return resolveTravel(state, {
        kind: 'haul',
        actorId,
        carrierId: order.carrierId,
        crewIds: order.crewIds,
        to: order.to,
        cargo: order.cargo,
        ...(order.contractId !== undefined ? { contractId: order.contractId } : {}),
      });
    case 'settle':
      return resolveTravel(state, {
        kind: 'settle',
        actorId,
        carrierId: order.carrierId,
        crewIds: order.crewIds,
        to: order.target,
      });
    case 'scout':
      return resolveTravel(state, {
        kind: 'scout',
        actorId,
        carrierId: order.carrierId,
        crewIds: [order.crewId],
        to: order.target,
      });
    case 'siege':
      return resolveTravel(state, {
        kind: 'siege',
        actorId,
        carrierId: order.carrierId,
        crewIds: order.crewIds,
        to: order.target,
      });
    case 'reinforce':
      return resolveTravel(state, {
        kind: 'reinforce',
        actorId,
        carrierId: order.carrierId,
        crewIds: order.crewIds,
        to: order.to,
      });
    case 'raid':
      return resolveTravel(state, {
        kind: 'raid',
        actorId,
        carrierId: order.carrierId,
        crewIds: order.crewIds,
        to: order.a,
        edge: { a: order.a, b: order.b, hours: order.hours },
      });
    case 'ambush.clear': {
      const ambush = visibleAmbush(state, actorId, order.ambushId);
      if (!ambush?.raid) return fail('unknown_movement');
      let crewIds = order.crewIds ?? [];
      let carrierId = order.carrierId ?? null;
      if (order.crewIds === undefined) {
        const pick = pickClearCrews(state, actorId, ambush.raid);
        if (!pick) return fail('no_crew');
        crewIds = pick.crewIds;
        if (order.carrierId === undefined) carrierId = pick.carrierId;
        else if (order.carrierId !== null) crewIds = crewIds.slice(0, 1);
      }
      return resolveTravel(state, {
        kind: 'clear',
        actorId,
        carrierId,
        crewIds,
        to: '',
        clearAmbushId: order.ambushId,
      });
    }
    case 'job.take': {
      const offer = state.players[actorId]?.jobs.find((j) => j.id === order.jobId);
      if (!offer) return fail('unknown_job');
      return resolveTravel(state, {
        kind: offer.kind === 'courier' ? 'haul' : 'job',
        actorId,
        carrierId: order.carrierId ?? null,
        crewIds: [order.crewId],
        to: '',
        job: offer,
        ...(offer.kind === 'courier' && offer.good && offer.qty
          ? { cargo: { [offer.good]: offer.qty } }
          : {}),
      });
    }
    case 'build': {
      const district = state.districts[order.districtId];
      if (!district) return fail('unknown_district');
      if (district.kind === 'hub' || district.owner !== actorId) return fail('not_owner');
      if (district.construction) return fail('already_building');
      const level = buildingLevel(district, order.building) + 1;
      if (level > maxLevelOf(order.building)) return fail('max_level');
      if (level === 1 && district.buildings.length >= district.slots)
        return fail('slot_unavailable');
      const cost = buildCost(order.building, level);
      for (const g of GOODS) if (district.warehouse[g] < cost[g]) return fail('insufficient_goods');
      return { plan: { type: 'build', district, building: order.building } };
    }
    case 'stance': {
      const district = state.districts[order.districtId];
      if (!district) return fail('unknown_district');
      if (district.kind === 'hub' || district.owner !== actorId) return fail('not_owner');
      return { plan: { type: 'stance', district, stance: order.stance } };
    }
    case 'recall': {
      const movement = state.movements[order.movementId];
      if (!movement) return fail('unknown_movement');
      if (movement.owner !== actorId) return fail('not_owner');
      if (movement.job) return fail('invalid_target');
      if (movement.recalledAtMs !== undefined || movement.kind === 'return') {
        return fail('already_recalled');
      }
      return { plan: { type: 'recall', movement } };
    }
    case 'market.place': {
      const error = validatePlace({ state }, actorId, order);
      return error ? fail(error) : { plan: { type: 'place', order } };
    }
    case 'market.cancel': {
      const found = findOrder({ state }, order.orderId);
      if (!found) return fail('unknown_order');
      if (found.order.owner !== actorId) return fail('not_owner');
      return { plan: { type: 'cancel', orderId: order.orderId } };
    }
    case 'contract.post': {
      const error = validatePost(state, actorId, order);
      return error ? fail(error) : { plan: { type: 'post', order } };
    }
    case 'contract.take': {
      const error = validateTake(state, actorId, order.contractId);
      return error ? fail(error) : { plan: { type: 'take', contractId: order.contractId } };
    }
    case 'contract.cancel': {
      const error = validateCancel(state, actorId, order.contractId);
      return error ? fail(error) : { plan: { type: 'withdraw', contractId: order.contractId } };
    }
    case 'carrier.buy': {
      const district = state.districts[order.districtId];
      if (!district) return fail('unknown_district');
      if (district.kind === 'hub' || district.owner !== actorId) return fail('not_owner');
      const owned = Object.values(state.carriers).filter(
        (c) => c.owner === actorId && c.kind === 'runner',
      ).length;
      if (owned >= balance.runner.maxOwned) return fail('too_many_carriers');
      const player = state.players[actorId];
      if (!player || player.credits < toAtoms(runnerPrice(district))) {
        return fail('insufficient_credits');
      }
      return { plan: { type: 'buyCarrier', district } };
    }
    case 'recruit': {
      const district = state.districts[order.districtId];
      if (!district) return fail('unknown_district');
      if (district.kind === 'hub' || district.owner !== actorId) return fail('not_owner');
      const player = state.players[actorId];
      if (!player || player.credits < toAtoms(balance.recruit.credits)) {
        return fail('insufficient_credits');
      }
      if (district.warehouse.supplies < toAtoms(balance.recruit.supplies)) {
        return fail('insufficient_goods');
      }
      return { plan: { type: 'recruit', district } };
    }
  }
}

/** Checks an input against the state without changing anything. */
export function validateOrder(state: GameState, input: Input): Validation {
  const r = resolve(state, input);
  return 'error' in r ? { ok: false, error: r.error } : { ok: true };
}

/**
 * Validates and applies an input at the state's current time. A rejected order
 * leaves the state alone and emits `order.rejected`.
 */
export function applyOrder(ctx: Ctx, input: Input): Validation {
  const { state } = ctx;
  const r = resolve(state, input);
  if ('error' in r) {
    emit(ctx, 'order.rejected', [input.actorId], [], { order: input.order.type, error: r.error });
    return { ok: false, error: r.error };
  }
  const plan = r.plan;
  switch (plan.type) {
    case 'travel': {
      const origin = plan.route.route[0] as Id;
      const loads = plan.kind === 'haul' || plan.kind === 'settle';
      const source = loads || plan.fuel > 0 ? storeAt(ctx, plan.owner, origin) : null;
      const sourceValue = source ? valueStoreAt(ctx, plan.owner, origin) : null;
      const carried =
        source && sourceValue && loads ? take(source, sourceValue, plan.cargo) : undefined;
      // Burn the fuel; what it cost joins the cargo's cost basis (see `burnFuel`).
      let burned: number | null = null;
      if (source && sourceValue && plan.fuel > 0) {
        // The start store pays first; whatever it lacks comes from the owner's other warehouses
        // (a carrier tops up from the depots, lowest id first).
        const own = Math.min(source.power, plan.fuel);
        burned = burnFuel(source, sourceValue, own);
        let left = plan.fuel - own;
        for (const d of Object.values(state.districts).sort((x, y) => (x.id < y.id ? -1 : 1))) {
          if (left <= 0) break;
          if (d.id === origin || d.kind === 'hub' || d.owner !== plan.owner) continue;
          const part = Math.min(d.warehouse.power, left);
          if (part <= 0) continue;
          burned += burnFuel(d.warehouse, d.warehouseValue, part);
          left -= part;
          afterWarehouseChange(ctx, d);
        }
      }
      if (carried && burned) addFuelCost(carried, plan.cargo, burned);
      startMovement(ctx, {
        ...plan,
        ...(carried ? { value: carried } : {}),
        ...(burned ? { fuel: plan.fuel } : {}),
      });
      if (plan.job) jobTaken(ctx, plan.owner, plan.job);
      const from = state.districts[plan.route.route[0] as Id];
      if (source && from && from.kind !== 'hub') afterWarehouseChange(ctx, from);
      break;
    }
    case 'build':
      startConstruction(ctx, plan.district, plan.building);
      break;
    case 'stance':
      plan.district.stance = plan.stance;
      refreshSiege(ctx, plan.district.id);
      break;
    case 'recall':
      if (plan.movement.kind === 'ambush') endAmbush(ctx, plan.movement, 'recalled');
      else recallMovement(ctx, plan.movement);
      break;
    case 'place': {
      placeOrder(ctx, input.actorId, plan.order);
      break;
    }
    case 'cancel': {
      const found = findOrder(ctx, plan.orderId);
      if (found) cancelOrder(ctx, found.order, found.book);
      break;
    }
    case 'post':
      postContract(ctx, input.actorId, plan.order);
      break;
    case 'take':
      takeContract(ctx, input.actorId, plan.contractId);
      break;
    case 'withdraw':
      cancelContract(ctx, plan.contractId);
      break;
    case 'buyCarrier': {
      const { district } = plan;
      const player = state.players[input.actorId] as { credits: number };
      player.credits -= toAtoms(runnerPrice(district));
      state.counters.carrier += 1;
      const carrier: Carrier = {
        id: `v${state.counters.carrier}`,
        owner: input.actorId,
        kind: 'runner',
        loc: { at: district.id },
      };
      state.carriers[carrier.id] = carrier;
      emit(ctx, 'carrier.bought', [input.actorId], [district.id], {
        carrierId: carrier.id,
        kind: 'runner',
        credits: runnerPrice(district),
      });
      break;
    }
    case 'recruit': {
      const { district } = plan;
      const player = state.players[input.actorId] as { credits: number };
      player.credits -= toAtoms(balance.recruit.credits);
      take(district.warehouse, district.warehouseValue, {
        parts: 0,
        power: 0,
        data: 0,
        supplies: toAtoms(balance.recruit.supplies),
      });
      state.counters.crew += 1;
      const catchUp = state.season.belowMedian.includes(input.actorId);
      const readyMinutes =
        balance.recruit.readyMinutes *
        (catchUp ? balance.season.belowMedianRecruitPercent / 100 : 1);
      const crew: Crew = {
        id: `c${state.counters.crew}`,
        owner: input.actorId,
        strength: balance.recruit.startStrength,
        loc: { at: district.id },
        readyAtMs: state.nowMs + Math.round(readyMinutes * MS_PER_MINUTE),
      };
      state.crews[crew.id] = crew;
      placeCrew(ctx, crew, district.id);
      afterWarehouseChange(ctx, district);
      break;
    }
  }
  return { ok: true };
}
