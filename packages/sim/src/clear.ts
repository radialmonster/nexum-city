import { balance, toUnits } from './balance.js';
import { emit, schedule, type Ctx } from './ctx.js';
import { sightOf } from './fog.js';
import { applyLoss } from './siege.js';
import { endAmbush, roll, scheduleMend } from './raid.js';
import { shortestRoute, travelMs } from './routing.js';
import {
  GOODS,
  type Carrier,
  type Crew,
  type Edge,
  type GameState,
  type Id,
  type JsonValue,
  type Movement,
} from './types.js';

/*
 * "Break it up" (`ambush.clear`): a player sends crews to attack an enemy ambush they can see.
 * Rules and reasoning: docs/rewrite/sim-spec.md, "Break it up (clear ambush)".
 *
 * The crews walk to the nearer end of the ambushed street as a `clear` movement. On arrival the
 * ambush is looked up again: still there means one fight with the raid strike maths (strength
 * sums, a +-noise roll each side, no new combat rules); gone means a walk home. Either way the
 * `clear` movement turns into a `return` and the normal arrival puts the crews back.
 */

/** The ambush `ambushId` if `player` may attack it: an enemy ambush on a street in their sight. */
export function visibleAmbush(state: GameState, player: Id, ambushId: Id): Movement | null {
  const m = state.movements[ambushId];
  if (!m || m.kind !== 'ambush' || !m.raid || m.owner === player) return null;
  const sight = sightOf(state, player);
  return sight.has(m.raid.a) || sight.has(m.raid.b) ? m : null;
}

/** What `pickClearCrews` needs: satisfied by both the full state and a `PlayerView`. */
export interface ClearWorld {
  nowMs: number;
  crews: Record<Id, Crew>;
  carriers: Record<Id, Carrier>;
  graph: { nodes: GameState['graph']['nodes']; edges: Edge[] };
  /** The full state's sieges: a district under siege keeps its crews at home. */
  sieges?: Record<Id, unknown>;
  /** A view's districts: an own district whose `siege` is set is under siege. */
  districts?: Record<Id, object>;
  /** The full state's movements: an enemy siege or raid on the way to a district counts as a threat. */
  movements?: Record<Id, { owner: Id; kind: string; to: Id }>;
}

/** Why no default force could be picked. */
export interface ClearNone {
  error: 'no_crew';
  /** `busy`: no free crew anywhere. `under_siege`: the only free crews guard a district under attack. */
  reason: 'busy' | 'under_siege';
}

/** A district whose crews must stay put: besieged, or an enemy siege is walking toward it. */
function threatened(world: ClearWorld, player: Id, node: Id): boolean {
  if (world.sieges?.[node] !== undefined) return true;
  if ((world.districts?.[node] as { siege?: unknown } | undefined)?.siege) return true;
  return Object.values(world.movements ?? {}).some(
    (m) => m.owner !== player && m.kind === 'siege' && m.to === node,
  );
}

export interface ClearPick {
  crewIds: Id[];
  carrierId: Id | null;
  /** Where they set out from. */
  from: Id;
  /** Their combined strength. */
  strength: number;
}

/**
 * The default force for an ambush on the street `a`-`b`: the strongest free crews at the node
 * with the shortest walk to either end (ties: the smaller node id), in an idle van or hauler
 * there when one exists (two seats), else a lone crew on foot. Null when nobody is free.
 */
export function pickClearCrews(
  world: ClearWorld,
  player: Id,
  edge: { a: Id; b: Id },
  /** Crews and carriers already spoken for (a bot's other orders this turn). */
  exclude: ReadonlySet<Id> = new Set(),
): ClearPick | null {
  const r = pickClearCrewsOrWhy(world, player, edge, exclude);
  return 'error' in r ? null : r;
}

/** Like `pickClearCrews`, but says why when there is no force (`no_crew` with a reason). Never takes crews from a district under siege. */
export function pickClearCrewsOrWhy(
  world: ClearWorld,
  player: Id,
  edge: { a: Id; b: Id },
  exclude: ReadonlySet<Id> = new Set(),
): ClearPick | ClearNone {
  const idle = Object.values(world.crews).filter(
    (c) => c.owner === player && 'at' in c.loc && c.readyAtMs <= world.nowMs && !exclude.has(c.id),
  );
  const free = idle
    .filter((c) => !threatened(world, player, (c.loc as { at: Id }).at))
    .sort((x, y) => y.strength - x.strength || (x.id < y.id ? -1 : 1));
  const nodes = [...new Set(free.map((c) => (c.loc as { at: Id }).at))].sort();
  let best: { node: Id; len: number } | null = null;
  for (const node of nodes) {
    const lens = [edge.a, edge.b].flatMap((end) => shortestRoute(world.graph, node, end) ?? []);
    if (lens.length === 0) continue;
    const len = Math.min(...lens.map((r) => r.lengthM));
    if (best === null || len < best.len) best = { node, len };
  }
  if (!best) {
    return {
      error: 'no_crew',
      reason: idle.length > 0 && free.length === 0 ? 'under_siege' : 'busy',
    };
  }
  const here = free.filter((c) => (c.loc as { at: Id }).at === best.node);
  const ride = Object.values(world.carriers)
    .filter(
      (v) =>
        v.owner === player &&
        !exclude.has(v.id) &&
        'at' in v.loc &&
        v.loc.at === best.node &&
        !balance.carriers[v.kind].locked &&
        balance.carriers[v.kind].seats >= 2,
    )
    .sort((x, y) => (x.id < y.id ? -1 : 1))[0];
  const seats = ride ? balance.carriers[ride.kind].seats : balance.carriers.foot.seats;
  const crews = here.slice(0, seats);
  return {
    crewIds: crews.map((c) => c.id),
    carrierId: ride ? ride.id : null,
    from: best.node,
    strength: crews.reduce((n, c) => n + c.strength, 0),
  };
}

/** A plain-language read on a fight, from what the player may legitimately know. */
export interface ClearEstimate {
  label: 'likely' | 'even' | 'risky';
  /** Your crews' combined strength. */
  yours: number;
  /** The visible range for the ambushers' strength. */
  theirs: [number, number];
  /** For example "your strength 9 vs about 12, risky". */
  text: string;
}

/**
 * How a fight would go: `yours` against the fogged range on a spotted ambush. Likely when you
 * beat even the top of the range, risky when you are under its middle, even in between. Uses
 * only the view's range, never the real sum, so it cannot leak what fog hides.
 */
export function estimateClear(
  yours: number,
  ambush: { strength: [number, number] },
): ClearEstimate {
  const [low, high] = ambush.strength;
  const mid = (low + high) / 2;
  const label = yours >= high ? 'likely' : yours < mid ? 'risky' : 'even';
  const about = Math.round(mid);
  return {
    label,
    yours,
    theirs: [low, high],
    text: `your strength ${yours} vs about ${about}, ${label}`,
  };
}

const sumStrength = (crews: Crew[]): number => crews.reduce((n, c) => n + c.strength, 0);

function sendHome(ctx: Ctx, m: Movement): void {
  const c = m.clear;
  if (!c) return;
  const home = shortestRoute(ctx.state.graph, c.near, c.home) ?? { route: [c.near], lengthM: 0 };
  m.kind = 'return';
  m.route = home.route;
  m.lengthM = home.lengthM;
  m.from = c.near;
  m.to = c.home;
  m.departMs = ctx.state.nowMs;
  m.arriveMs = ctx.state.nowMs + travelMs(home.lengthM, m.carrierKind);
  Reflect.deleteProperty(m, 'recalledAtMs');
  Reflect.deleteProperty(m, 'recallFraction');
  Reflect.deleteProperty(m, 'clear');
  schedule(ctx, m.arriveMs, { kind: 'arrive', movementId: m.id });
}

/** The clearing crews have reached the street: fight the ambush if it is still there. */
export function resolveClear(ctx: Ctx, m: Movement): void {
  const { state } = ctx;
  const c = m.clear;
  if (!c) return;
  const ambush = state.movements[c.ambushId];
  const edge = [c.a, c.b];
  const crews = m.crewIds.flatMap((id) => state.crews[id] ?? []);
  if (!ambush || ambush.kind !== 'ambush' || !ambush.raid || ambush.owner === m.owner) {
    emit(ctx, 'ambush.gone', [m.owner], edge, { movementId: m.id, ambushId: c.ambushId });
    sendHome(ctx, m);
    return;
  }
  const raiders = ambush.crewIds.flatMap((id) => state.crews[id] ?? []);
  const attack = sumStrength(crews);
  const defence = sumStrength(raiders);
  // Two draws every time, so the number of RNG calls never depends on the outcome.
  const attackRoll = roll(ctx);
  const defenceRoll = roll(ctx);
  const won = attack * attackRoll > defence * defenceRoll;
  const actors = [m.owner, ambush.owner];
  const base: Record<string, JsonValue> = {
    movementId: ambush.id,
    clearId: m.id,
    attackerStrength: attack,
    defenderStrength: defence,
  };
  if (won) {
    const lost = applyLoss(
      raiders,
      Math.max(1, Math.floor((defence * balance.raid.raiderLossPercent) / 100)),
    );
    scheduleMend(ctx, raiders);
    const loot: Record<string, number> = {};
    for (const g of GOODS) if (ambush.cargo[g] > 0) loot[g] = toUnits(ambush.cargo[g]);
    emit(ctx, 'ambush.cleared', actors, edge, { ...base, defenderLost: lost, loot });
    endAmbush(ctx, ambush, 'cleared');
  } else {
    const lost = applyLoss(
      crews,
      Math.max(1, Math.floor((attack * balance.raid.raiderLossPercent) / 100)),
    );
    scheduleMend(ctx, crews);
    emit(ctx, 'ambush.held', actors, edge, { ...base, attackerLost: lost });
  }
  sendHome(ctx, m);
}
