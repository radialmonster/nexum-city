import { MS_PER_HOUR, MS_PER_MINUTE, balance, toAtoms } from './balance.js';
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
import { cancelOrder, findOrder, placeOrder, validatePlace } from './market.js';
import { afterWarehouseChange, buildingLevel, storeAt } from './production.js';
import { shortestRoute, travelMs, type Route } from './routing.js';
import { endAmbush, isPlayerProtected } from './raid.js';
import { isProtected, refreshSiege } from './siege.js';
import { placeCrew, recallMovement, startMovement } from './travel.js';
import {
  GOODS,
  type BuildingType,
  type Carrier,
  type Crew,
  type District,
  type GameState,
  type Goods,
  type Id,
  type Input,
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
      route: Route;
      durationMs: number;
      raid?: RaidInfo;
      contractId?: Id;
    }
  | { type: 'build'; district: District; building: BuildingType }
  | { type: 'stance'; district: District; stance: 'hold' | 'pullback' }
  | { type: 'recall'; movement: Movement }
  | { type: 'recruit'; district: District }
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
  /** Hauls only: deliver to this contract. */
  contractId?: Id;
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
  const target = state.districts[to];
  if (!target) return fail('unknown_district');
  if (req.kind !== 'raid' && to === from) return fail('invalid_target');
  if (req.kind === 'raid') {
    // Any street will do; the checks above are all a raid needs.
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

  const route = shortestRoute(state.graph, from, to);
  if (!route) return fail('no_route');
  return {
    plan: {
      type: 'travel',
      owner: req.actorId,
      kind: req.kind,
      carrier,
      crews,
      cargo,
      route,
      durationMs: travelMs(route.lengthM, kind),
      ...(raid ? { raid } : {}),
      ...(req.contractId !== undefined ? { contractId: req.contractId } : {}),
    },
  };
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
    case 'build': {
      const district = state.districts[order.districtId];
      if (!district) return fail('unknown_district');
      if (district.kind === 'hub' || district.owner !== actorId) return fail('not_owner');
      if (district.construction) return fail('already_building');
      const level = buildingLevel(district, order.building) + 1;
      if (level > balance.buildings.maxLevel) return fail('max_level');
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
      const source =
        plan.kind === 'haul' || plan.kind === 'settle'
          ? storeAt(ctx, plan.owner, plan.route.route[0] as Id)
          : null;
      if (source) for (const g of GOODS) source[g] -= plan.cargo[g];
      startMovement(ctx, plan);
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
    case 'recruit': {
      const { district } = plan;
      const player = state.players[input.actorId] as { credits: number };
      player.credits -= toAtoms(balance.recruit.credits);
      district.warehouse.supplies -= toAtoms(balance.recruit.supplies);
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
