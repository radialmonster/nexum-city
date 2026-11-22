import { MS_PER_HOUR, balance, toUnits } from './balance.js';
import { emit, schedule, unschedule, type Ctx } from './ctx.js';
import { deliverToContract } from './contracts.js';
import { finishJob } from './jobs.js';
import { deposit } from './production.js';
import { beginAmbush, scheduleStrikes } from './raid.js';
import type { Route } from './routing.js';
import { beginSettle } from './settle.js';
import { joinSiege, onCrewArrived, onCrewLeft } from './siege.js';
import type { System } from './systems.js';
import {
  GOODS,
  type Carrier,
  type Crew,
  type Goods,
  type Id,
  type JobOffer,
  type Movement,
  type MovementKind,
  type RaidInfo,
} from './types.js';

/** Puts a crew at a node. It joins the garrison when the node is its owner's district. */
export function placeCrew(ctx: Ctx, crew: Crew, nodeId: Id): void {
  crew.loc = { at: nodeId };
  const d = ctx.state.districts[nodeId];
  if (d && d.owner === crew.owner && !d.garrison.includes(crew.id)) d.garrison.push(crew.id);
  onCrewArrived(ctx, nodeId);
}

function leaveGarrison(ctx: Ctx, crew: Crew): void {
  if (!('at' in crew.loc)) return;
  const d = ctx.state.districts[crew.loc.at];
  if (d) d.garrison = d.garrison.filter((id) => id !== crew.id);
}

export interface MovementSpec {
  owner: Id;
  kind: MovementKind;
  carrier: Carrier | null;
  crews: Crew[];
  cargo: Goods;
  route: Route;
  durationMs: number;
  /** Raids only. */
  raid?: RaidInfo;
  /** Hauls only: the contract this haul delivers to. */
  contractId?: Id;
  /** Street jobs only: the errand being run. */
  job?: JobOffer;
}

/** Moves units out of their location and into a new movement. Units are never in two places. */
export function startMovement(ctx: Ctx, spec: MovementSpec): Movement {
  const { state } = ctx;
  state.counters.movement += 1;
  const id = `m${state.counters.movement}`;
  const from = spec.route.route[0] as Id;
  const to = spec.route.route[spec.route.route.length - 1] as Id;
  const movement: Movement = {
    id,
    owner: spec.owner,
    kind: spec.kind,
    carrierId: spec.carrier?.id ?? null,
    carrierKind: spec.carrier?.kind ?? 'foot',
    crewIds: spec.crews.map((c) => c.id),
    cargo: spec.cargo,
    route: spec.route.route,
    lengthM: spec.route.lengthM,
    from,
    to,
    departMs: state.nowMs,
    arriveMs: state.nowMs + spec.durationMs,
  };
  if (spec.raid) movement.raid = spec.raid;
  if (spec.contractId) movement.contractId = spec.contractId;
  if (spec.job) movement.job = { ...spec.job };
  if (spec.kind === 'haul' || spec.kind === 'settle')
    movement.sent = GOODS.reduce((n, g) => n + spec.cargo[g], 0);
  for (const crew of spec.crews) {
    const node = 'at' in crew.loc ? crew.loc.at : null;
    leaveGarrison(ctx, crew);
    crew.loc = { movement: id };
    if (node !== null) onCrewLeft(ctx, node, crew.id);
  }
  if (spec.carrier) spec.carrier.loc = { movement: id };
  state.movements[id] = movement;
  schedule(ctx, movement.arriveMs, { kind: 'arrive', movementId: id });
  scheduleStrikes(ctx, movement);
  return movement;
}

/** Turns a movement around: it returns to where it started, taking as long as it has travelled. */
export function recallMovement(ctx: Ctx, movement: Movement): void {
  const { state } = ctx;
  const elapsed = state.nowMs - movement.departMs;
  const total = movement.arriveMs - movement.departMs;
  unschedule(state, (e) => e.kind === 'arrive' && e.movementId === movement.id);
  movement.recalledAtMs = state.nowMs;
  movement.recallFraction = total <= 0 ? 1 : Math.min(1, elapsed / total);
  movement.to = movement.from;
  movement.arriveMs = state.nowMs + Math.max(1, elapsed);
  schedule(ctx, movement.arriveMs, { kind: 'arrive', movementId: movement.id });
  scheduleStrikes(ctx, movement);
}

export const travelSystem: System = {
  name: 'travel',
  handlers: {
    arrive: (ctx, ev) => {
      const { state } = ctx;
      const m = state.movements[ev.movementId];
      if (!m) return;
      if (m.kind === 'raid' && m.recalledAtMs === undefined) {
        beginAmbush(ctx, m);
        return;
      }
      if (m.job) {
        finishJob(ctx, m);
        return;
      }
      for (const crewId of m.crewIds) {
        const crew = state.crews[crewId];
        if (crew) placeCrew(ctx, crew, m.to);
      }
      const carrier = m.carrierId ? state.carriers[m.carrierId] : undefined;
      if (carrier) carrier.loc = { at: m.to };
      const recalled = m.recalledAtMs !== undefined;
      // Settlers spend their supplies on arrival; a recalled trip brings them home.
      if (m.contractId && !recalled) deliverToContract(ctx, m);
      else if (m.kind !== 'settle' || recalled) deposit(ctx, m.owner, m.to, m.cargo);
      if (m.kind === 'settle' && !recalled) {
        beginSettle(
          ctx,
          m,
          m.crewIds.flatMap((id) => state.crews[id] ?? []),
        );
      }
      if (m.kind === 'siege' && !recalled) {
        const crews = m.crewIds.flatMap((id) => state.crews[id] ?? []);
        joinSiege(ctx, m.to, m.owner, crews);
      }
      if (m.kind === 'scout' && !recalled) {
        const key = `${m.owner}|${m.to}`;
        const until = state.nowMs + balance.scout.revealHours * MS_PER_HOUR;
        state.reveals[key] = Math.max(state.reveals[key] ?? 0, until);
      }
      Reflect.deleteProperty(state.movements, m.id);
      emit(ctx, 'arrived', [m.owner], [m.to], {
        movementId: m.id,
        movement: m.kind,
        carrier: m.carrierKind,
        crewIds: m.crewIds,
        recalled,
        contractId: m.contractId ?? null,
        cargo: GOODS.reduce((n, g) => n + toUnits(m.cargo[g]), 0),
        sent: m.sent === undefined ? 0 : toUnits(m.sent),
      });
    },
  },
};
