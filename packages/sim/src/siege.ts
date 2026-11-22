import { ATOMS_PER_UNIT, MS_PER_HOUR, MS_PER_MINUTE, PROGRESS_SCALE, balance } from './balance.js';
import { emit, schedule, unschedule, type Ctx } from './ctx.js';
import { afterWarehouseChange, buildingLevel, emptyGoods } from './production.js';
import { nextFloat } from './rng.js';
import { shortestRoute, travelMs } from './routing.js';
import { wearOf } from './wear.js';
import type { System } from './systems.js';
import { startMovement } from './travel.js';
import {
  GOODS,
  type Crew,
  type District,
  type Goods,
  type Id,
  type JsonValue,
  type Siege,
  type SiegeRate,
} from './types.js';
import { failSettle } from './settle.js';
import { relocatePlayer } from './world.js';

const BASE_MS = balance.siege.baseHoursToFill * MS_PER_HOUR;
const DECAY_MS = balance.siege.decayHours * MS_PER_HOUR;
const ROUND_MS = balance.siege.roundMinutes * MS_PER_MINUTE;
const MILESTONE = PROGRESS_SCALE / 10;
/** Attack strength is scaled by this so it compares with the percent-scaled defence. */
const PERCENT_SQUARED = 10_000;
/** A crew whose strength falls to this or lower routs. */
const ROUT_STRENGTH = 3;

const big = (n: number): bigint => BigInt(Math.trunc(n));
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

export function isProtected(d: District, nowMs: number): boolean {
  return d.protectedUntilMs !== undefined && d.protectedUntilMs > nowMs;
}

// ------------------------------------------------------------ the bar

/** Progress at `nowMs` under the stored rate. Does not change the siege. */
export function progressAt(s: Siege, nowMs: number): number {
  const dt = nowMs - s.sinceMs;
  if (dt <= 0) return s.progress;
  if (s.rate.mode === 'up') {
    const { a, d, bonus } = s.rate;
    const gain =
      (big(dt) * big(PROGRESS_SCALE) * big(a) * big(bonus)) / (big(BASE_MS) * big(a + d) * 100n);
    return Math.min(PROGRESS_SCALE, s.progress + Number(gain));
  }
  const loss = (big(dt) * big(PROGRESS_SCALE)) / big(DECAY_MS);
  return Math.max(0, s.progress - Number(loss));
}

function fold(s: Siege, nowMs: number): void {
  s.progress = progressAt(s, nowMs);
  s.sinceMs = Math.max(s.sinceMs, nowMs);
}

/** Milliseconds from `sinceMs` until the bar reaches `target` while the rate holds. */
function timeToReach(s: Siege, target: number): number {
  if (s.rate.mode === 'up') {
    const remaining = target - s.progress;
    if (remaining <= 0) return 0;
    const { a, d, bonus } = s.rate;
    return Number(
      ceilDiv(
        big(remaining) * big(BASE_MS) * big(a + d) * 100n,
        big(PROGRESS_SCALE) * big(a) * big(bonus),
      ),
    );
  }
  const drop = s.progress - target;
  if (drop <= 0) return 0;
  return Number(ceilDiv(big(drop) * big(DECAY_MS), big(PROGRESS_SCALE)));
}

function presentCrews(ctx: Ctx, s: Siege): Crew[] {
  const out: Crew[] = [];
  for (const id of s.crewIds) {
    const crew = ctx.state.crews[id];
    if (crew && 'at' in crew.loc && crew.loc.at === s.districtId) out.push(crew);
  }
  return out;
}

const strengthOf = (crews: readonly Crew[]): number => crews.reduce((n, c) => n + c.strength, 0);

function garrisonCrews(ctx: Ctx, d: District): Crew[] {
  return d.garrison.flatMap((id) => {
    const c = ctx.state.crews[id];
    return c ? [c] : [];
  });
}

/** Defence in 1/10000ths of a strength point: (garrison + militia) x walls x stance. */
function defenceScaled(ctx: Ctx, d: District): number {
  const base = d.owner === 'neutral' ? balance.siege.neutralGuard : balance.siege.militia;
  const units = strengthOf(garrisonCrews(ctx, d)) + base;
  const walls = 100 + balance.siege.wallsPercentPerLevel * buildingLevel(d, 'walls');
  const stance = d.stance === 'pullback' ? balance.siege.pullbackPercent : 100;
  return units * walls * stance;
}

function computeRate(ctx: Ctx, s: Siege): SiegeRate {
  const d = ctx.state.districts[s.districtId] as District;
  const attack = strengthOf(presentCrews(ctx, s));
  if (attack <= 0) return { mode: 'down' };
  const leader = d.owner !== 'neutral' && d.owner === ctx.state.season.leaderId;
  return {
    mode: 'up',
    a: attack * PERCENT_SQUARED,
    d: defenceScaled(ctx, d),
    bonus: 100 + (leader ? balance.siege.leaderBonusPercent : 0),
  };
}

function scheduleCheck(ctx: Ctx, s: Siege): void {
  const { state } = ctx;
  unschedule(state, (e) => e.kind === 'siege.check' && e.districtId === s.districtId);
  let dt: number;
  if (s.rate.mode === 'up') {
    const nextTarget = Math.min(PROGRESS_SCALE, (s.milestone + 1) * MILESTONE);
    dt = timeToReach(s, nextTarget);
    if (s.roundAtMs !== null) dt = Math.min(dt, s.roundAtMs - s.sinceMs);
  } else {
    dt = timeToReach(s, 0);
  }
  schedule(ctx, Math.max(state.nowMs, s.sinceMs + dt), {
    kind: 'siege.check',
    districtId: s.districtId,
  });
}

/**
 * Re-reads who is attacking and defending a district. Call it whenever that
 * changes (a crew arrives or leaves, the stance or walls change, the leader
 * changes). The bar is folded forward exactly at this moment, so the result
 * does not depend on how the caller sliced time.
 */
export function refreshSiege(ctx: Ctx, districtId: Id): void {
  const s = ctx.state.sieges[districtId];
  if (!s) return;
  fold(s, ctx.state.nowMs);
  s.crewIds = presentCrews(ctx, s).map((c) => c.id);
  s.rate = computeRate(ctx, s);
  if (s.rate.mode === 'up') s.roundAtMs ??= ctx.state.nowMs + ROUND_MS;
  else s.roundAtMs = null;
  scheduleCheck(ctx, s);
}

/** Called after a crew has left a node: it drops out of the siege and the garrison counts change. */
export function onCrewLeft(ctx: Ctx, nodeId: Id, crewId: Id): void {
  const s = ctx.state.sieges[nodeId];
  if (!s) return;
  s.crewIds = s.crewIds.filter((id) => id !== crewId);
  refreshSiege(ctx, nodeId);
}

/** Called when a crew stands at a node (arrival, recruiting): defence may have changed. */
export function onCrewArrived(ctx: Ctx, nodeId: Id): void {
  if (ctx.state.sieges[nodeId]) refreshSiege(ctx, nodeId);
}

const involved = (s: Siege, d: District): Id[] =>
  d.owner === 'neutral' ? [s.attacker] : [s.attacker, d.owner];

// ------------------------------------------------------------ starting a siege

/** Attacking crews have reached `districtId`: they join (or start) its capture bar. */
export function joinSiege(ctx: Ctx, districtId: Id, attacker: Id, crews: readonly Crew[]): void {
  const { state } = ctx;
  const d = state.districts[districtId];
  if (!d || d.kind === 'hub' || d.owner === attacker || isProtected(d, state.nowMs)) return;
  let s = state.sieges[districtId];
  if (s && s.attacker !== attacker) {
    if (presentCrews(ctx, s).length > 0) return;
    breakSiege(ctx, s, 'replaced');
    s = undefined;
  }
  if (!s) {
    s = {
      districtId,
      attacker,
      crewIds: [],
      progress: 0,
      sinceMs: state.nowMs,
      rate: { mode: 'down' },
      milestone: 0,
      roundAtMs: null,
      startedMs: state.nowMs,
      stats: { attackerStart: 0, attackerLost: 0, defenderLost: 0, rounds: 0 },
    };
    state.sieges[districtId] = s;
    emit(ctx, 'siege.started', involved(s, d), [districtId], {
      attacker,
      defender: d.owner,
      crewIds: crews.map((c) => c.id),
    });
  }
  for (const crew of crews) {
    if (s.crewIds.includes(crew.id)) continue;
    s.crewIds.push(crew.id);
    s.stats.attackerStart += crew.strength;
  }
  refreshSiege(ctx, districtId);
}

function breakSiege(ctx: Ctx, s: Siege, reason: string): void {
  const { state } = ctx;
  const d = state.districts[s.districtId] as District;
  endSiege(ctx, s);
  emit(ctx, 'siege.broken', involved(s, d), [s.districtId], {
    attacker: s.attacker,
    defender: d.owner,
    reason,
    rounds: s.stats.rounds,
  });
}

function endSiege(ctx: Ctx, s: Siege): void {
  unschedule(ctx.state, (e) => e.kind === 'siege.check' && e.districtId === s.districtId);
  Reflect.deleteProperty(ctx.state.sieges, s.districtId);
}

// ------------------------------------------------------------ movement helpers

/** The player's own district nearest (by street length) to `from`, excluding `exclude`. */
export function nearestOwned(ctx: Ctx, owner: Id, from: Id, exclude: Id): District | null {
  let best: District | null = null;
  let bestLen = Infinity;
  for (const d of Object.values(ctx.state.districts)) {
    if (d.owner !== owner || d.id === exclude || d.kind === 'hub') continue;
    const route = shortestRoute(ctx.state.graph, from, d.id);
    if (!route) continue;
    if (route.lengthM < bestLen || (route.lengthM === bestLen && best !== null && d.id < best.id)) {
      best = d;
      bestLen = route.lengthM;
    }
  }
  return best;
}

export function walkHome(ctx: Ctx, crew: Crew, from: Id, to: Id): void {
  const route = shortestRoute(ctx.state.graph, from, to);
  if (!route) return;
  startMovement(ctx, {
    owner: crew.owner,
    kind: 'move',
    carrier: null,
    crews: [crew],
    cargo: emptyGoods(),
    route,
    durationMs: travelMs(route.lengthM, 'foot'),
  });
}

// ------------------------------------------------------------ combat

/** Takes `loss` strength points from the crews, one at a time from the strongest, never below 1. */
export function applyLoss(crews: Crew[], loss: number): number {
  let taken = 0;
  for (let i = 0; i < loss; i++) {
    let pick: Crew | null = null;
    for (const c of crews) {
      if (c.strength > 1 && (pick === null || c.strength > pick.strength)) pick = c;
    }
    if (!pick) break;
    pick.strength -= 1;
    taken += 1;
  }
  return taken;
}

function runRound(ctx: Ctx, s: Siege): void {
  const { state } = ctx;
  const d = state.districts[s.districtId] as District;
  const attackers = presentCrews(ctx, s);
  const defenders = garrisonCrews(ctx, d);
  const attack = strengthOf(attackers);
  if (attack <= 0) return;
  const defenceUnits = defenceScaled(ctx, d) / PERCENT_SQUARED;
  const share = attack + defenceUnits;
  const k = balance.siege.lossPercentPerRound / 100;
  const noise = (): number =>
    1 + (nextFloat(state.rng) * 2 - 1) * (balance.siege.noisePercent / 100);
  const attackerLoss = attack * k * 2 * (defenceUnits / share) * noise();
  const defenderLoss = strengthOf(defenders) * k * 2 * (attack / share) * noise();
  const lostA = applyLoss(attackers, Math.floor(attackerLoss + nextFloat(state.rng)));
  const lostD = applyLoss(defenders, Math.floor(defenderLoss + nextFloat(state.rng)));
  s.stats.attackerLost += lostA;
  s.stats.defenderLost += lostD;
  s.stats.rounds += 1;
  emit(ctx, 'combat.round', involved(s, d), [d.id], {
    round: s.stats.rounds,
    attackerStrength: strengthOf(attackers),
    defenderStrength: strengthOf(defenders),
    attackerLost: lostA,
    defenderLost: lostD,
  });
  for (const crew of attackers) {
    if (crew.strength > ROUT_STRENGTH) continue;
    s.crewIds = s.crewIds.filter((id) => id !== crew.id);
    const home = nearestOwned(ctx, crew.owner, d.id, d.id);
    if (home) walkHome(ctx, crew, d.id, home.id);
  }
}

// ------------------------------------------------------------ capture

/**
 * Moves 30% of the warehouse onto the attackers' carriers at the district, up
 * to their capacity, and sends them home. With no other district to go to the
 * goods stay put.
 */
function loot(ctx: Ctx, d: District, attacker: Id): Goods {
  const percent =
    d.owner === 'neutral' ? balance.siege.neutralLootPercent : balance.siege.lootPercent;
  const taken = emptyGoods();
  const home = nearestOwned(ctx, attacker, d.id, d.id);
  if (!home) return taken;
  const route = shortestRoute(ctx.state.graph, d.id, home.id);
  if (!route) return taken;
  const carriers = Object.values(ctx.state.carriers)
    .filter((c) => c.owner === attacker && 'at' in c.loc && c.loc.at === d.id)
    .sort((x, y) => (x.id < y.id ? -1 : 1));
  const want = emptyGoods();
  for (const g of GOODS) want[g] = Math.floor((d.warehouse[g] * percent) / 100);
  for (const carrier of carriers) {
    let room = balance.carriers[carrier.kind].cargo * ATOMS_PER_UNIT;
    const cargo = emptyGoods();
    for (const g of GOODS) {
      const n = Math.min(room, want[g]);
      cargo[g] = n;
      want[g] -= n;
      room -= n;
      taken[g] += n;
      d.warehouse[g] -= n;
    }
    startMovement(ctx, {
      owner: attacker,
      kind: 'haul',
      carrier,
      crews: [],
      cargo,
      route,
      durationMs: travelMs(route.lengthM, carrier.kind, wearOf(carrier)),
    });
  }
  return taken;
}

function capture(ctx: Ctx, s: Siege): void {
  const { state } = ctx;
  const d = state.districts[s.districtId] as District;
  // A settler holding the plot is its defender; losing it fails the settlement.
  const settler = d.settling;
  const defender = settler ? settler.owner : d.owner;
  if (settler) failSettle(ctx, d, 'captured');
  const attackers = presentCrews(ctx, s);
  if (d.construction) {
    unschedule(state, (e) => e.kind === 'build.done' && e.districtId === d.id);
    d.construction = null;
  }
  const damaged: Record<string, JsonValue>[] = [];
  d.buildings = d.buildings.flatMap((b) => {
    damaged.push({ building: b.type, from: b.level, to: b.level - 1 });
    return b.level > 1 ? [{ ...b, level: b.level - 1 }] : [];
  });
  const looted = loot(ctx, d, s.attacker);
  const retreating = garrisonCrews(ctx, d);
  d.garrison = [];
  d.owner = s.attacker;
  d.stance = 'hold';
  Reflect.deleteProperty(d, 'protectedUntilMs');
  for (const crew of attackers) d.garrison.push(crew.id);
  endSiege(ctx, s);

  let retreatedTo: string | null = null;
  let relocatedTo: string | null = null;
  if (defender !== 'neutral') {
    const refuge = nearestOwned(ctx, defender, d.id, d.id);
    if (refuge) {
      retreatedTo = refuge.id;
      for (const crew of retreating) walkHome(ctx, crew, d.id, refuge.id);
      for (const carrier of Object.values(state.carriers)) {
        if (carrier.owner === defender && 'at' in carrier.loc && carrier.loc.at === d.id) {
          carrier.loc = { at: refuge.id };
        }
      }
    } else {
      relocatedTo = relocatePlayer(ctx, defender, d)?.id ?? null;
    }
  }
  afterWarehouseChange(ctx, d);
  const lootedUnits: Record<string, JsonValue> = {};
  for (const g of GOODS) lootedUnits[g] = looted[g] / ATOMS_PER_UNIT;
  emit(
    ctx,
    'siege.captured',
    defender === 'neutral' ? [s.attacker] : [s.attacker, defender],
    [d.id],
    {
      attacker: s.attacker,
      defender,
      report: {
        districtId: d.id,
        startedMs: s.startedMs,
        durationMs: state.nowMs - s.startedMs,
        rounds: s.stats.rounds,
        attacker: {
          id: s.attacker,
          started: s.stats.attackerStart,
          lost: s.stats.attackerLost,
          survivors: attackers.map((c) => ({ crewId: c.id, strength: c.strength })),
        },
        defender: {
          id: defender,
          lost: s.stats.defenderLost,
          retreated: retreating.map((c) => c.id),
          retreatedTo,
          relocatedTo,
        },
        loot: lootedUnits,
        buildingsDamaged: damaged,
      },
    },
  );
}

// ------------------------------------------------------------ the system

function process(ctx: Ctx, districtId: Id): void {
  const { state } = ctx;
  const s = state.sieges[districtId];
  if (!s) return;
  fold(s, state.nowMs);
  if (s.rate.mode === 'up') {
    if (s.progress >= PROGRESS_SCALE) {
      capture(ctx, s);
      return;
    }
    while (s.milestone < 9 && s.progress >= (s.milestone + 1) * MILESTONE) {
      s.milestone += 1;
      const d = state.districts[districtId] as District;
      emit(ctx, 'siege.progress', involved(s, d), [districtId], {
        attacker: s.attacker,
        percent: s.milestone * 10,
      });
    }
    if (s.roundAtMs !== null && state.nowMs >= s.roundAtMs) {
      s.roundAtMs += ROUND_MS;
      runRound(ctx, s);
    }
  } else if (s.progress <= 0) {
    breakSiege(ctx, s, 'abandoned');
    return;
  }
  refreshSiege(ctx, districtId);
}

export const siegeSystem: System = {
  name: 'siege',
  handlers: {
    'siege.check': (ctx, ev) => {
      process(ctx, ev.districtId);
    },
  },
};

/** The bar as a fraction (0 to 1) at `nowMs`, for display. */
export function siegeFraction(s: Siege, nowMs: number): number {
  return progressAt(s, nowMs) / PROGRESS_SCALE;
}
