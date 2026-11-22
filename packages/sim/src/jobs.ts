import { MS_PER_MINUTE, balance, toAtoms, toUnits } from './balance.js';
import { emit, schedule, type Ctx } from './ctx.js';
import { deposit, mainGood } from './production.js';
import { nextInt, shuffle } from './rng.js';
import { shortestRoute, type Route } from './routing.js';
import { nearestOwned } from './siege.js';
import type { System } from './systems.js';
import { placeCrew } from './travel.js';
import {
  GOODS,
  type Good,
  type Goods,
  type Id,
  type JobKind,
  type JobOffer,
  type Movement,
  type OrderError,
  type Player,
  type GameState,
} from './types.js';

/**
 * Street jobs (docs/rewrite/sim-spec.md, "Newcomer rush and street jobs"): every player has a
 * personal list of at most `balance.jobs.cap` quick errands, each taking a few minutes with one
 * crew (and perhaps a carrier). One new offer arrives every `refillMinutes` while the list has
 * room, so logging off never costs anything. Jobs pay a little credit or a few parts and give no
 * score. The crew and carrier always walk home afterwards.
 *  - courier: carry goods from your district to the nearest hub and back; raidable like any haul;
 *  - salvage: scour the next street for a few parts;
 *  - patrol: walk the next street; it and its far end are revealed for a while.
 */

const J = balance.jobs;
const KINDS: readonly JobKind[] = ['courier', 'salvage', 'patrol'];

const span = (state: GameState, min: number, max: number): number =>
  min + nextInt(state.rng, max - min + 1);

/** Draws one offer from the seeded RNG. The number of draws never depends on the outcome. */
function drawOffer(ctx: Ctx, player: Player, kind: JobKind): JobOffer {
  const { state } = ctx;
  state.counters.job += 1;
  const id = `j${state.counters.job}`;
  const pick = nextInt(state.rng, 1000);
  const owned = new Set<Good>(['supplies']);
  for (const d of Object.values(state.districts)) {
    const good = d.owner === player.id ? mainGood(d.kind) : null;
    if (good && good !== 'credits') owned.add(good);
  }
  const goods = GOODS.filter((g) => owned.has(g));
  const goodDraw = nextInt(state.rng, goods.length);
  const c = J.courier;
  const s = J.salvage;
  const p = J.patrol;
  const courierMin = span(state, c.minMinutes, c.maxMinutes);
  const courierQty = span(state, c.minQty, c.maxQty);
  const courierPay = span(state, c.minCredits, c.maxCredits);
  const salvageMin = span(state, s.minMinutes, s.maxMinutes);
  const salvageParts = span(state, s.minParts, s.maxParts);
  const patrolMin = span(state, p.minMinutes, p.maxMinutes);
  const patrolPay = span(state, p.minCredits, p.maxCredits);
  if (kind === 'courier') {
    return {
      id,
      kind,
      minutes: courierMin,
      good: goods[goodDraw] as Good,
      qty: courierQty,
      creditsAtoms: toAtoms(courierPay),
      pick,
    };
  }
  if (kind === 'salvage') {
    return {
      id,
      kind,
      minutes: salvageMin,
      creditsAtoms: 0,
      partsAtoms: toAtoms(salvageParts),
      pick,
    };
  }
  return { id, kind, minutes: patrolMin, creditsAtoms: toAtoms(patrolPay), pick };
}

/** A new player's first offers (one of each kind) and the end-of-rush event. */
export function startNewcomer(ctx: Ctx, playerId: Id): void {
  const player = ctx.state.players[playerId];
  if (!player) return;
  const kinds = shuffle(ctx.state.rng, [...KINDS]);
  player.jobs = kinds.slice(0, J.cap).map((k) => drawOffer(ctx, player, k));
  player.jobNextMs = 0;
  schedule(ctx, player.rushUntilMs, { kind: 'rush.end', playerId });
}

/** Removes a taken offer and starts the refill clock if the list was full. */
function consumeOffer(ctx: Ctx, playerId: Id, jobId: Id): void {
  const player = ctx.state.players[playerId];
  if (!player) return;
  const wasFull = player.jobs.length >= J.cap;
  player.jobs = player.jobs.filter((j) => j.id !== jobId);
  if (wasFull) {
    player.jobNextMs = ctx.state.nowMs + J.refillMinutes * MS_PER_MINUTE;
    schedule(ctx, player.jobNextMs, { kind: 'job.refill', playerId });
  }
}

/** Where a job leads and how long it takes, or why it cannot start. */
export function resolveJob(
  state: GameState,
  actorId: Id,
  offer: JobOffer,
  from: Id,
  carried: boolean,
): { route: Route; durationMs: number } | { error: OrderError } {
  const origin = state.districts[from];
  if (!origin || origin.kind === 'hub' || origin.owner !== actorId)
    return { error: 'invalid_target' };
  let route: Route | null = null;
  if (offer.kind === 'courier') {
    let bestId: Id | null = null;
    for (const d of Object.values(state.districts)) {
      if (d.kind !== 'hub') continue;
      const r = shortestRoute(state.graph, from, d.id);
      if (
        r &&
        (route === null ||
          r.lengthM < route.lengthM ||
          (r.lengthM === route.lengthM && d.id < (bestId as Id)))
      ) {
        route = r;
        bestId = d.id;
      }
    }
  } else {
    const near = [
      ...new Set(
        state.graph.edges.flatMap((e) => (e.a === from ? [e.b] : e.b === from ? [e.a] : [])),
      ),
    ].sort();
    const to = near[offer.pick % Math.max(1, near.length)];
    const edge = state.graph.edges.find(
      (e) => (e.a === from && e.b === to) || (e.b === from && e.a === to),
    );
    if (to !== undefined && edge) route = { route: [from, to], lengthM: edge.lengthM };
  }
  if (!route) return { error: 'no_route' };
  const base = offer.minutes * MS_PER_MINUTE;
  return { route, durationMs: carried ? Math.round((base * J.carrierTimePercent) / 100) : base };
}

/** Called when an order starts a job movement: the offer leaves the list. */
export function jobTaken(ctx: Ctx, playerId: Id, offer: JobOffer): void {
  consumeOffer(ctx, playerId, offer.id);
}

const sum = (g: Goods): number => GOODS.reduce((n, good) => n + g[good], 0);

/** A job movement has reached its end: pay (or fail) and send the crew and carrier home. */
export function finishJob(ctx: Ctx, m: Movement): void {
  const { state } = ctx;
  const job = m.job as JobOffer;
  const home = state.districts[m.from];
  const homeOwned = home !== undefined && home.kind !== 'hub' && home.owner === m.owner;
  const place = homeOwned ? home : nearestOwned(ctx, m.owner, m.from, m.from);
  const nodeId = place ? place.id : m.to;
  for (const id of m.crewIds) {
    const crew = state.crews[id];
    if (crew) placeCrew(ctx, crew, nodeId);
  }
  const carrier = m.carrierId ? state.carriers[m.carrierId] : undefined;
  if (carrier) carrier.loc = { at: nodeId };
  Reflect.deleteProperty(state.movements, m.id);

  const player = state.players[m.owner] as Player;
  const data: Record<string, number | string | boolean | string[]> = {
    jobId: job.id,
    job: job.kind,
    movementId: m.id,
    carrier: m.carrierKind,
    crewIds: m.crewIds,
    minutes: job.minutes,
  };
  let parts = 0;
  let failed: string | null = null;

  if (job.kind === 'courier') {
    const sent = m.sent ?? 0;
    const back = sum(m.cargo);
    deposit(ctx, m.owner, nodeId, m.cargo);
    data.sent = toUnits(sent);
    data.returned = toUnits(back);
    if (back < sent) failed = 'raided';
  } else if (job.kind === 'salvage') {
    parts = job.partsAtoms ?? 0;
    if (parts > 0) deposit(ctx, m.owner, nodeId, { parts, power: 0, data: 0, supplies: 0 });
  } else {
    const until = state.nowMs + J.patrolRevealMinutes * MS_PER_MINUTE;
    const [a, b] = m.from < m.to ? [m.from, m.to] : [m.to, m.from];
    for (const end of [m.from, m.to]) {
      const key = `${m.owner}|${end}`;
      state.reveals[key] = Math.max(state.reveals[key] ?? 0, until);
    }
    data.found = Object.values(state.movements).filter(
      (o) =>
        o.kind === 'ambush' &&
        o.owner !== m.owner &&
        o.raid !== undefined &&
        o.raid.a === a &&
        o.raid.b === b,
    ).length;
    data.edge = [a, b];
    data.revealUntilMs = until;
  }

  if (failed) {
    data.reason = failed;
    emit(ctx, 'job.failed', [m.owner], [m.from], data);
    return;
  }
  player.credits += job.creditsAtoms;
  data.credits = toUnits(job.creditsAtoms);
  data.parts = toUnits(parts);
  emit(ctx, 'job.done', [m.owner], [m.from], data);
}

export const jobSystem: System = {
  name: 'jobs',
  handlers: {
    'job.refill': (ctx, ev) => {
      const player = ctx.state.players[ev.playerId];
      if (!player) return;
      if (player.jobs.length < J.cap) {
        const kind = KINDS[nextInt(ctx.state.rng, KINDS.length)] as JobKind;
        player.jobs = [...player.jobs, drawOffer(ctx, player, kind)];
      }
      if (player.jobs.length < J.cap) {
        player.jobNextMs = ev.at + J.refillMinutes * MS_PER_MINUTE;
        schedule(ctx, player.jobNextMs, { kind: 'job.refill', playerId: player.id });
      } else {
        player.jobNextMs = 0;
      }
    },
  },
};
