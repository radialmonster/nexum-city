import { MS_PER_HOUR, balance, toAtoms, toUnits } from './balance.js';
import { emit, schedule, unschedule, type Ctx } from './ctx.js';
import { towerSight } from './fog.js';
import { emptyValue, share, totalCents } from './cost.js';
import { addHeat } from './regional.js';
import { nudgeRef } from './market.js';
import { nextFloat } from './rng.js';
import { shortestRoute, travelMs } from './routing.js';
import { wearCarrier } from './wear.js';
import { applyLoss, isProtected } from './siege.js';
import type { System } from './systems.js';
import { GOODS, type Crew, type GameState, type Goods, type Id, type Movement } from './types.js';

/*
 * Raids and escorts (milestone 2). The rules and the reasoning are in
 * docs/rewrite/sim-spec.md, "Raids and escorts (M2)".
 *
 * A raid order sends crews to one end of a street (a `raid` movement). On
 * arrival the movement turns into a persistent `ambush`: the crews stay inside
 * it, so they are never garrison, never besieging and never seen standing at a
 * node. Strikes are scheduled queue events (`raid.strike`) at the moment an
 * enemy haul crosses the middle of the street, so the result never depends on
 * how the clock is sliced. When the window ends (or the ambush is full,
 * beaten or recalled) the movement becomes a `return` walking home with the
 * loot, and the normal arrival deposits it.
 */

const sumGoods = (g: Goods): number => GOODS.reduce((n, good) => n + g[good], 0);

const goodsUnits = (g: Goods): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const good of GOODS) if (g[good] > 0) out[good] = toUnits(g[good]);
  return out;
};

function crewsOf(ctx: Ctx, m: Movement): Crew[] {
  return m.crewIds.flatMap((id) => ctx.state.crews[id] ?? []);
}

function edgeLength(ctx: Ctx, x: Id, y: Id): number | null {
  const e = ctx.state.graph.edges.find((k) => (k.a === x && k.b === y) || (k.a === y && k.b === x));
  return e ? e.lengthM : null;
}

/** Hauls and settle supply carriers carry goods and can be struck; everything else cannot. */
const carriesGoods = (m: Movement): boolean => m.kind === 'haul' || m.kind === 'settle';

/**
 * New-player protection shields a player's convoys: a player is protected while any district it
 * owns still is. A protected player may not set ambushes (`protected_no_raid`).
 */
export function isPlayerProtected(state: GameState, player: Id): boolean {
  return Object.values(state.districts).some(
    (d) => d.owner === player && isProtected(d, state.nowMs),
  );
}

/**
 * When a convoy crosses the middle of the street a-b, or null if its route never uses it.
 * A recalled convoy walks its route backwards from where it turned, so it can cross the middle
 * again (only if it had got past it) and is just as exposed on the way home.
 */
export function crossingTime(ctx: Ctx, haul: Movement, a: Id, b: Id): number | null {
  if (haul.lengthM <= 0) return null;
  let walked = 0;
  for (let i = 0; i + 1 < haul.route.length; i++) {
    const x = haul.route[i] as Id;
    const y = haul.route[i + 1] as Id;
    const len = edgeLength(ctx, x, y) ?? 0;
    if ((x === a && y === b) || (x === b && y === a)) {
      const fraction = (walked + len / 2) / haul.lengthM;
      if (haul.recalledAtMs === undefined) {
        return haul.departMs + Math.round(fraction * (haul.arriveMs - haul.departMs));
      }
      const turned = haul.recallFraction ?? 0;
      if (turned <= 0 || fraction > turned) return null;
      const back = haul.arriveMs - haul.recalledAtMs;
      return haul.arriveMs - Math.round((fraction / turned) * back);
    }
    walked += len;
  }
  return null;
}

function maybeStrike(ctx: Ctx, ambush: Movement, haul: Movement): void {
  const r = ambush.raid;
  if (!r || ambush.kind !== 'ambush' || !carriesGoods(haul)) return;
  if (haul.owner === ambush.owner) return;
  if (sumGoods(haul.cargo) <= 0 || r.struck.includes(haul.id)) return;
  const at = crossingTime(ctx, haul, r.a, r.b);
  if (at === null || at < ctx.state.nowMs || at >= r.untilMs) return;
  schedule(ctx, at, { kind: 'raid.strike', movementId: ambush.id, targetId: haul.id });
}

/**
 * A convoy has just set out or turned back: every enemy ambush on its route gets a strike at the
 * crossing. A recall first drops the strikes planned for the outbound walk.
 */
export function scheduleStrikes(ctx: Ctx, haul: Movement): void {
  if (!carriesGoods(haul)) return;
  if (haul.recalledAtMs !== undefined) {
    unschedule(ctx.state, (e) => e.kind === 'raid.strike' && e.targetId === haul.id);
  }
  for (const id of Object.keys(ctx.state.movements).sort()) {
    const m = ctx.state.movements[id] as Movement;
    if (m.kind === 'ambush') maybeStrike(ctx, m, haul);
  }
}

/** The raiders have reached the street: they dig in and start waiting. */
export function beginAmbush(ctx: Ctx, m: Movement): void {
  const { state } = ctx;
  const r = m.raid;
  if (!r) return;
  r.untilMs = state.nowMs + r.windowMs;
  m.kind = 'ambush';
  m.route = [r.near];
  m.lengthM = 0;
  m.from = r.near;
  m.to = r.near;
  m.departMs = state.nowMs;
  m.arriveMs = r.untilMs;
  addHeat(state, r.a, r.b, balance.market.regional.heatPerAmbush);
  schedule(ctx, r.untilMs, { kind: 'raid.end', movementId: m.id });
  emit(ctx, 'raid.set', [m.owner], [r.a, r.b], {
    movementId: m.id,
    edge: [r.a, r.b],
    untilMs: r.untilMs,
    crewIds: m.crewIds,
  });
  // Watchtower owners whose towers see either end of the street are told (fog stays honest: only
  // the street is revealed, not the raider's crews).
  for (const pid of Object.keys(state.players).sort()) {
    if (pid === m.owner) continue;
    const seen = towerSight(state, pid);
    if (seen.has(r.a) || seen.has(r.b)) {
      emit(ctx, 'raid.spotted', [pid], [r.a, r.b], {
        movementId: m.id,
        edge: [r.a, r.b],
        untilMs: r.untilMs,
        owner: m.owner,
      });
    }
  }
  for (const id of Object.keys(state.movements).sort()) {
    const other = state.movements[id] as Movement;
    if (carriesGoods(other)) maybeStrike(ctx, m, other);
  }
}

export type AmbushEnd = 'expired' | 'recalled' | 'repelled' | 'full' | 'cleared';

/** Stops an ambush: the crews walk home with whatever they took. */
export function endAmbush(ctx: Ctx, m: Movement, reason: AmbushEnd): void {
  const { state } = ctx;
  const r = m.raid;
  if (!r || m.kind !== 'ambush') return;
  unschedule(
    state,
    (e) => (e.kind === 'raid.end' || e.kind === 'raid.strike') && e.movementId === m.id,
  );
  const home = shortestRoute(state.graph, r.near, r.home) ?? { route: [r.near], lengthM: 0 };
  m.kind = 'return';
  m.route = home.route;
  m.lengthM = home.lengthM;
  m.from = r.near;
  m.to = r.home;
  m.departMs = state.nowMs;
  m.arriveMs = state.nowMs + travelMs(home.lengthM, m.carrierKind);
  Reflect.deleteProperty(m, 'recalledAtMs');
  Reflect.deleteProperty(m, 'recallFraction');
  schedule(ctx, m.arriveMs, { kind: 'arrive', movementId: m.id });
  emit(ctx, 'raid.ended', [m.owner], [r.a, r.b], {
    movementId: m.id,
    reason,
    loot: goodsUnits(m.cargo),
    struck: r.struck.length,
  });
}

export function roll(ctx: Ctx): number {
  const k = balance.raid.noisePercent / 100;
  return 1 + (nextFloat(ctx.state.rng) * 2 - 1) * k;
}

/** What a struck convoy was, for the harness breakdown: a label plus whether it had an escort. */
function targetLabel(haul: Movement): string {
  const kind = haul.job
    ? 'job'
    : haul.kind === 'settle'
      ? 'settle'
      : haul.carrierKind === 'runner'
        ? 'runner'
        : haul.contractId
          ? 'contract'
          : 'haul';
  return `${kind}${haul.crewIds.length > 1 ? '+escort' : ''}`;
}

/**
 * Crews hurt in a raid heal: 1 strength per `balance.raid.mendHours` while they rest at a
 * district, up to the starting strength. Without it every repelled ambush is a permanent loss and
 * raiders spiral down to strength 1 per crew (see sim-spec, "Raid balance after task 77").
 */
export function scheduleMend(ctx: Ctx, crews: Crew[]): void {
  for (const c of crews) {
    if (c.strength >= balance.recruit.startStrength) continue;
    if (ctx.state.queue.some((e) => e.kind === 'crew.mend' && e.crewId === c.id)) continue;
    schedule(ctx, ctx.state.nowMs + balance.raid.mendHours * MS_PER_HOUR, {
      kind: 'crew.mend',
      crewId: c.id,
    });
  }
}

function strike(ctx: Ctx, ambush: Movement, haul: Movement): void {
  const { state } = ctx;
  const r = ambush.raid;
  if (!r) return;
  const cfg = balance.raid;
  r.struck.push(haul.id);

  // A Runner may slip away: one draw, taken only for Runners (a fixed rule, so the number of draws
  // never depends on how a fight turns out). The ambush stays in place and may catch the next one.
  if (haul.carrierKind === 'runner') {
    if (nextFloat(state.rng) < balance.runner.evadePercent / 100) {
      emit(ctx, 'raid.evaded', [ambush.owner, haul.owner], [r.a, r.b], {
        movementId: ambush.id,
        haulId: haul.id,
        chancePercent: balance.runner.evadePercent,
        target: targetLabel(haul),
      });
      return;
    }
  }
  // Being struck, hit or repelled, wears the carrier (a Runner that slips away does not).
  if (haul.carrierId) wearCarrier(ctx, state.carriers[haul.carrierId], balance.wear.perStrike);
  const raiders = crewsOf(ctx, ambush);
  const escort = crewsOf(ctx, haul);
  const raiderStrength = raiders.reduce((n, c) => n + c.strength, 0);
  let guard = balance.carriers[haul.carrierKind].toughness;
  // A settle carrier's crew is armed settlers, not a driver: every crew counts at full strength.
  // On a haul the first crew drives and counts at half.
  const driver = haul.kind === 'settle' ? 100 : cfg.driverPercent;
  escort.forEach((c, i) => {
    guard += i === 0 ? (c.strength * driver) / 100 : c.strength;
  });
  // Two draws every time, so the number of RNG calls never depends on the outcome.
  const raiderRoll = roll(ctx);
  const guardRoll = roll(ctx);
  const raidersWin = raiderStrength * raiderRoll > guard * guardRoll;
  const victim = haul.owner;
  const actors = [ambush.owner, victim];

  if (!raidersWin) {
    const lost = applyLoss(
      raiders,
      Math.max(1, Math.floor((raiderStrength * cfg.raiderLossPercent) / 100)),
    );
    scheduleMend(ctx, raiders);
    emit(ctx, 'raid.repelled', actors, [r.a, r.b], {
      movementId: ambush.id,
      haulId: haul.id,
      raiderStrength,
      guard,
      raiderLost: lost,
      target: targetLabel(haul),
    });
    endAmbush(ctx, ambush, 'repelled');
    return;
  }

  const carrierSpace =
    haul.carrierKind === 'foot'
      ? balance.carriers.foot.cargo * Math.max(1, haul.crewIds.length)
      : balance.carriers[haul.carrierKind].cargo;
  const room = Math.max(0, toAtoms(carrierSpace) - sumGoods(ambush.cargo));
  const want: Goods = { parts: 0, power: 0, data: 0, supplies: 0 };
  for (const g of GOODS) want[g] = Math.floor((haul.cargo[g] * cfg.stealPercent) / 100);
  const wantTotal = sumGoods(want);
  const stolen: Goods = { parts: 0, power: 0, data: 0, supplies: 0 };
  const destroyed: Goods = { parts: 0, power: 0, data: 0, supplies: 0 };
  const stolenValue = emptyValue();
  const destroyedValue = emptyValue();
  for (const g of GOODS) {
    stolen[g] = wantTotal <= room ? want[g] : Math.floor((want[g] * room) / wantTotal);
    const left = haul.cargo[g] - stolen[g];
    destroyed[g] = Math.floor((left * cfg.destroyPercent) / 100);
    // The cost basis follows the goods: the thief's share, the burned share, and what remains.
    stolenValue[g] = share(haul.value[g], stolen[g], haul.cargo[g]);
    destroyedValue[g] = share(haul.value[g] - stolenValue[g], destroyed[g], left);
    haul.value[g] -= stolenValue[g] + destroyedValue[g];
    haul.cargo[g] = left - destroyed[g];
    if (haul.cargo[g] <= 0) haul.value[g] = 0;
    ambush.cargo[g] += stolen[g];
    ambush.value[g] += stolenValue[g];
  }
  const escortLost = applyLoss(
    escort,
    Math.max(
      1,
      Math.floor((escort.reduce((n, c) => n + c.strength, 0) * cfg.escortLossPercent) / 100),
    ),
  );
  scheduleMend(ctx, escort);
  emit(ctx, 'raid.hit', actors, [r.a, r.b], {
    movementId: ambush.id,
    haulId: haul.id,
    stolen: goodsUnits(stolen),
    destroyed: goodsUnits(destroyed),
    lostCents: totalCents(stolenValue) + totalCents(destroyedValue),
    remaining: goodsUnits(haul.cargo),
    raiderStrength,
    guard,
    escortLost,
    target: targetLabel(haul),
  });
  addHeat(state, r.a, r.b, balance.market.regional.heatPerHit);
  const dest = state.districts[haul.to];
  if (dest && dest.kind === 'hub') {
    for (const g of GOODS) if (stolen[g] > 0) nudgeRef(state, dest.id, g, cfg.priceNudgePercent);
  }
  if (room - sumGoods(stolen) <= toAtoms(cfg.fullUnits)) endAmbush(ctx, ambush, 'full');
}

export const raidSystem: System = {
  name: 'raid',
  handlers: {
    'raid.end': (ctx, ev) => {
      const m = ctx.state.movements[ev.movementId];
      if (m && m.kind === 'ambush') endAmbush(ctx, m, 'expired');
    },
    'crew.mend': (ctx, ev) => {
      const crew = ctx.state.crews[ev.crewId];
      if (!crew || crew.strength >= balance.recruit.startStrength) return;
      // Only a crew resting at a district heals; one out on a job or ambush is checked again later.
      if ('at' in crew.loc) crew.strength += 1;
      scheduleMend(ctx, [crew]);
    },
    'raid.strike': (ctx, ev) => {
      const ambush = ctx.state.movements[ev.movementId];
      const haul = ctx.state.movements[ev.targetId];
      if (!ambush || ambush.kind !== 'ambush' || !ambush.raid) return;
      if (!haul || !carriesGoods(haul)) return;
      if (haul.owner === ambush.owner || ambush.raid.struck.includes(haul.id)) return;
      if (sumGoods(haul.cargo) <= 0) return;
      // Checked at the crossing, so protection that ends on the way stops shielding the convoy.
      if (isPlayerProtected(ctx.state, haul.owner)) return;
      strike(ctx, ambush, haul);
    },
  },
};
