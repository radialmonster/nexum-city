import { toUnits } from './balance.js';
import { BOTS, type BotKind } from './bots.js';
import { hashState } from './hash.js';
import { checkInvariants } from './invariants.js';
import { validateOrder } from './orders.js';
import { stripNewcomerPerks } from './rush.js';
import { standings, type Standing } from './score.js';
import { step } from './step.js';
import { GOODS, type GameState, type Id, type Input, type SimEvent } from './types.js';
import { addPlayer, createWorld } from './world.js';

export interface SeasonOptions {
  seed?: number;
  days?: number;
  /** One bot per player, in order. */
  bots?: BotKind[];
  /** How often the bots decide, in game minutes. */
  decideEveryMinutes?: number;
  /** Called with the state after every beat (read-only; used by the market measurement). */
  observe?: (state: GameState) => void;
  /** Play the game as it was before the newcomer rush, starter contract and street jobs. */
  noNewcomerPerks?: boolean;
}

export interface SeasonResult {
  /** The recorded bot orders, in time order. Replay them to rebuild the season. */
  inputs: Input[];
  start: GameState;
  final: GameState;
  hash: string;
  events: number;
  captures: number;
  /** Captures where the defender was another player (not a neutral plot). */
  pvpCaptures: number;
  settled: number;
  settleFailed: number;
  /** Orders the bots proposed, and how many validateOrder refused (should stay under 10 percent). */
  botOrders: number;
  botRejected: number;
  fills: number;
  filledUnits: number;
  rejected: number;
  /** Raids (milestone 2): ambushes set, convoys hit, ambushes beaten, units stolen and destroyed. */
  raids: number;
  raidHits: number;
  raidsRepelled: number;
  /** Strikes a Runner slipped away from, and Runners bought. */
  raidsEvaded: number;
  /** Diagnostic: strikes by target label (job, contract, haul, settle, runner; +escort). */
  raidTargets: Record<string, { hit: number; repelled: number; evaded: number }>;
  /** Strikes by the player whose haul was struck (the second actor), to compare bot types. */
  raidsAgainst: Record<string, { hit: number; repelled: number; evaded: number }>;
  /** Diagnostic: summed raider strength and guard over decided fights. */
  raidFights: { raiderStrength: number; guard: number; n: number };
  /** Diagnostic: per raider player, ambushes set, hits, repels and strength lost. */
  raidsBy: Record<string, { set: number; hit: number; repelled: number; lost: number }>;
  runnersBought: number;
  /** Diagnostic (task 75): per player, ambush warnings from Watchtowers, carriers worn past the slow line, and carriers healed back. */
  wearBy: Record<Id, { spotted: number; worn: number; repaired: number }>;
  stolenUnits: number;
  destroyedUnits: number;
  districts: number;
  /** Each player's credits (whole units) 48 game hours in, for the early-income check. */
  creditsAt48h: Record<Id, number>;
  /** Contracts per taker: taken, finished and failed. */
  contractsBy: Record<Id, { taken: number; done: number; failed: number }>;
  contractsPosted: { civic: number; player: number };
  contractsExpired: number;
  /** Street jobs per player: taken, finished, failed (raided), and the pay they brought in. */
  jobsBy: Record<
    Id,
    { taken: number; done: number; failed: number; credits: number; parts: number }
  >;
  /** Street job payouts in whole units: the explicit civic source of credits and parts. */
  jobPaid: { credits: number; parts: number };
  players: { id: Id; bot: BotKind }[];
  standings: Standing[];
  /** Broken invariants found at any decision time (empty is good). */
  problems: string[];
}

/** The early-income checkpoint: 48 game hours. */
const EARLY_MS = 48 * 3_600_000;

const DEFAULT_BOTS: BotKind[] = ['raider', 'turtle', 'turtle', 'merchant', 'merchant', 'hunter'];

/** A fresh world with the bots joined at game time 0. */
export function seasonStart(options: SeasonOptions = {}): {
  state: GameState;
  players: { id: Id; bot: BotKind }[];
} {
  const days = options.days ?? 7;
  let state = createWorld(options.seed ?? 1, { seasonHours: days * 24 });
  const players = (options.bots ?? DEFAULT_BOTS).map((bot, i) => ({ id: `b${i + 1}`, bot }));
  for (const p of players) state = addPlayer(state, { id: p.id });
  if (options.noNewcomerPerks) stripNewcomerPerks(state, { jobs: true });
  return { state, players };
}

/**
 * Plays a season with scripted bots. The bots decide on a fixed beat; everything between two
 * beats is one `step`, so this run is the coarse reference. `replay` below proves any other
 * slicing of time gives the same hash.
 */
export function runSeason(options: SeasonOptions = {}): SeasonResult {
  const beatMs = (options.decideEveryMinutes ?? 60) * 60_000;
  const { state: start, players } = seasonStart(options);
  const endMs = start.season.endMs;
  let state = start;
  const inputs: Input[] = [];
  let captures = 0;
  let pvpCaptures = 0;
  let settled = 0;
  let settleFailed = 0;
  let botOrders = 0;
  let botRejected = 0;
  let fills = 0;
  let filledUnits = 0;
  let rejected = 0;
  let events = 0;
  let raids = 0;
  let raidHits = 0;
  let raidsRepelled = 0;
  let raidsEvaded = 0;
  const raidTargets: SeasonResult['raidTargets'] = {};
  const raidsAgainst: SeasonResult['raidsAgainst'] = {};
  const raidFights = { raiderStrength: 0, guard: 0, n: 0 };
  const raidsBy: SeasonResult['raidsBy'] = {};
  const raidOf = (id: unknown): SeasonResult['raidsBy'][string] =>
    (raidsBy[String(id)] ??= { set: 0, hit: 0, repelled: 0, lost: 0 });
  const tally = (e: SimEvent, field: 'hit' | 'repelled' | 'evaded'): void => {
    const t = (raidTargets[String(e.data['target'])] ??= { hit: 0, repelled: 0, evaded: 0 });
    t[field] += 1;
    const v = (raidsAgainst[String(e.actors[1])] ??= { hit: 0, repelled: 0, evaded: 0 });
    v[field] += 1;
    if (field !== 'evaded') {
      raidFights.raiderStrength += Number(e.data['raiderStrength']);
      raidFights.guard += Number(e.data['guard']);
      raidFights.n += 1;
    }
  };
  let runnersBought = 0;
  let stolenUnits = 0;
  let destroyedUnits = 0;
  let lootReturned = 0;
  // Per haul: units stolen and destroyed on the way, to prove nothing is created or lost silently.
  const taken = new Map<string, number>();
  const problems: string[] = [];
  const creditsAt48h: Record<Id, number> = {};
  const contractsBy: SeasonResult['contractsBy'] = {};
  const contractsPosted = { civic: 0, player: 0 };
  let contractsExpired = 0;
  const jobsBy: SeasonResult['jobsBy'] = {};
  const jobPaid = { credits: 0, parts: 0 };
  const jobOf = (id: unknown): SeasonResult['jobsBy'][string] =>
    (jobsBy[String(id)] ??= { taken: 0, done: 0, failed: 0, credits: 0, parts: 0 });
  // Per contract: the escrowed reward, to prove each one pays out or refunds exactly that.
  const rewards = new Map<string, number>();
  // Per tagged haul: units the contract accepted plus excess, to match what arrived.
  const delivered = new Map<string, number>();
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;
  const by = (id: unknown): { taken: number; done: number; failed: number } =>
    (contractsBy[String(id)] ??= { taken: 0, done: 0, failed: 0 });
  const sumUnits = (v: unknown): number =>
    v && typeof v === 'object'
      ? Object.values(v as Record<string, unknown>).reduce<number>(
          (n, x) => n + (typeof x === 'number' ? x : 0),
          0,
        )
      : 0;

  const wearBy: SeasonResult['wearBy'] = {};
  const wearOf = (id: unknown): SeasonResult['wearBy'][string] =>
    (wearBy[String(id)] ??= { spotted: 0, worn: 0, repaired: 0 });
  const count = (list: SimEvent[]): void => {
    events += list.length;
    for (const e of list) {
      if (e.kind === 'siege.captured') {
        captures += 1;
        const defender = e.data['defender'];
        if (typeof defender === 'string' && defender !== 'neutral') pvpCaptures += 1;
      } else if (e.kind === 'settle.done') settled += 1;
      else if (e.kind === 'settle.failed') settleFailed += 1;
      else if (e.kind === 'trade.filled') {
        fills += 1;
        const qty = e.data['qty'];
        if (typeof qty === 'number') filledUnits += qty;
      } else if (e.kind === 'order.rejected') rejected += 1;
      else if (e.kind === 'raid.set') {
        raids += 1;
        raidOf(e.actors[0]).set += 1;
      } else if (e.kind === 'raid.repelled') {
        raidsRepelled += 1;
        tally(e, 'repelled');
        raidOf(e.actors[0]).repelled += 1;
        raidOf(e.actors[0]).lost += Number(e.data['raiderLost']);
      } else if (e.kind === 'raid.evaded') {
        raidsEvaded += 1;
        tally(e, 'evaded');
      } else if (e.kind === 'carrier.bought') runnersBought += 1;
      else if (e.kind === 'raid.spotted') wearOf(e.actors[0]).spotted += 1;
      else if (e.kind === 'carrier.worn') wearOf(e.actors[0]).worn += 1;
      else if (e.kind === 'carrier.repaired') wearOf(e.actors[0]).repaired += 1;
      else if (e.kind === 'raid.ended') lootReturned += sumUnits(e.data['loot']);
      else if (e.kind === 'raid.hit') {
        raidHits += 1;
        tally(e, 'hit');
        raidOf(e.actors[0]).hit += 1;
        const stolen = sumUnits(e.data['stolen']);
        const destroyed = sumUnits(e.data['destroyed']);
        stolenUnits += stolen;
        destroyedUnits += destroyed;
        const haul = String(e.data['haulId']);
        taken.set(haul, (taken.get(haul) ?? 0) + stolen + destroyed);
      } else if (e.kind === 'job.done' || e.kind === 'job.failed') {
        const j = jobOf(e.actors[0]);
        if (e.kind === 'job.done') {
          j.done += 1;
          j.credits += Number(e.data['credits']);
          j.parts += Number(e.data['parts']);
          jobPaid.credits += Number(e.data['credits']);
          jobPaid.parts += Number(e.data['parts']);
        } else j.failed += 1;
        if (e.data['job'] === 'courier') {
          // A courier run carries nothing new: what left is back, or was taken by a raid.
          const sent = Number(e.data['sent']);
          const back = Number(e.data['returned']);
          const lost = taken.get(String(e.data['movementId'])) ?? 0;
          if (Math.abs(sent - back - lost) > 1e-6) {
            problems.push(
              `courier ${String(e.data['movementId'])}: sent ${sent} but ${back} came back and ${lost} were taken`,
            );
          }
          taken.delete(String(e.data['movementId']));
        }
      } else if (e.kind === 'contract.posted') {
        rewards.set(String(e.data['contractId']), Number(e.data['reward']));
        if (e.data['civic']) contractsPosted.civic += 1;
        else contractsPosted.player += 1;
      } else if (e.kind === 'contract.taken') by(e.data['taker']).taken += 1;
      else if (e.kind === 'contract.progress' || e.kind === 'contract.done') {
        const mv = String(e.data['movementId']);
        delivered.set(
          mv,
          (delivered.get(mv) ?? 0) + Number(e.data['accepted']) + Number(e.data['excess']),
        );
        if (e.kind === 'contract.done') {
          const id = String(e.data['contractId']);
          by(e.data['taker']).done += 1;
          if (!near(Number(e.data['paid']), rewards.get(id) ?? NaN)) {
            problems.push(
              `contract ${id}: paid ${String(e.data['paid'])} of ${String(rewards.get(id))}`,
            );
          }
          rewards.delete(id);
        }
      } else if (e.kind === 'contract.failed') {
        by(e.data['taker']).failed += 1;
        const id = String(e.data['contractId']);
        if (!e.data['civic']) {
          const sum = Number(e.data['paid']) + Number(e.data['refunded']);
          if (!near(sum, rewards.get(id) ?? NaN)) {
            problems.push(`contract ${id}: paid+refunded ${sum} of ${String(rewards.get(id))}`);
          }
        }
        rewards.delete(id);
      } else if (e.kind === 'contract.expired') {
        contractsExpired += 1;
        const id = String(e.data['contractId']);
        if (!e.data['civic'] && !near(Number(e.data['refunded']), rewards.get(id) ?? NaN)) {
          problems.push(
            `contract ${id}: refunded ${String(e.data['refunded'])} of ${String(rewards.get(id))}`,
          );
        }
        rewards.delete(id);
      } else if (
        e.kind === 'arrived' &&
        (e.data['movement'] === 'haul' || e.data['movement'] === 'settle')
      ) {
        const sent = Number(e.data['sent']);
        const left = Number(e.data['cargo']);
        const lost = taken.get(String(e.data['movementId'])) ?? 0;
        if (Math.abs(sent - left - lost) > 1e-6) {
          problems.push(
            `haul ${String(e.data['movementId'])}: sent ${sent} but ${left} arrived and ${lost} were taken`,
          );
        }
        taken.delete(String(e.data['movementId']));
        if (e.data['contractId'] && e.data['recalled'] !== true) {
          const got = delivered.get(String(e.data['movementId'])) ?? 0;
          // A contract that already ended (late, cancelled) leaves the cargo to be deposited.
          const gone = got === 0 && !rewards.has(String(e.data['contractId']));
          if (!gone && !near(got, left)) {
            problems.push(
              `haul ${String(e.data['movementId'])}: ${left} arrived but the contract took ${got}`,
            );
          }
        }
        delivered.delete(String(e.data['movementId']));
      }
    }
  };

  while (state.nowMs < endMs) {
    const at = state.nowMs;
    const batch: Input[] = [];
    for (const p of players) {
      for (const order of BOTS[p.bot](state, p.id)) {
        const input: Input = { actorId: p.id, order, atMs: at };
        botOrders += 1;
        if (validateOrder(state, input).ok) {
          batch.push(input);
          if (order.type === 'job.take') jobOf(p.id).taken += 1;
        } else botRejected += 1;
      }
    }
    inputs.push(...batch);
    const result = step(state, batch, Math.min(at + beatMs, endMs));
    state = result.state;
    count(result.events);
    options.observe?.(state);
    if (at < EARLY_MS && state.nowMs >= EARLY_MS) {
      for (const p of players) creditsAt48h[p.id] = toUnits(state.players[p.id]?.credits ?? 0);
    }
    for (const problem of checkInvariants(state)) problems.push(`t=${state.nowMs}: ${problem}`);
  }
  // Loot conservation: everything stolen is either reported home or still with a waiting ambush.
  const waiting = Object.values(state.movements)
    .filter((m) => m.kind === 'ambush')
    .reduce(
      (n, m) => n + sumUnits(Object.fromEntries(GOODS.map((g) => [g, toUnits(m.cargo[g])]))),
      0,
    );
  if (Math.abs(stolenUnits - lootReturned - waiting) > 1e-6) {
    problems.push(
      `loot: stolen ${stolenUnits} but ${lootReturned} reported home and ${waiting} waiting`,
    );
  }
  return {
    inputs,
    start,
    final: state,
    hash: hashState(state),
    events,
    captures,
    pvpCaptures,
    settled,
    settleFailed,
    botOrders,
    botRejected,
    fills,
    filledUnits,
    rejected,
    raids,
    raidHits,
    raidsRepelled,
    raidsEvaded,
    raidTargets,
    raidsAgainst,
    raidFights,
    raidsBy,
    runnersBought,
    wearBy,
    stolenUnits,
    destroyedUnits,
    districts: Object.keys(state.districts).length,
    creditsAt48h,
    contractsBy,
    contractsPosted,
    contractsExpired,
    jobsBy,
    jobPaid,
    players,
    standings: standings(state),
    problems,
  };
}

/**
 * Replays recorded inputs from the start state in slices of `sliceMs` (or one jump when
 * `sliceMs` is 0) up to `toMs` (default: the season's end) and returns the hash. Used to prove
 * step is exact over any split of time.
 */
export function replay(
  start: GameState,
  inputs: readonly Input[],
  sliceMs: number,
  toMs: number = start.season.endMs,
): string {
  const endMs = toMs;
  if (sliceMs <= 0) return hashState(step(start, inputs, endMs).state);
  let state = start;
  let next = 0;
  while (state.nowMs < endMs) {
    const to = Math.min(state.nowMs + sliceMs, endMs);
    // Inputs are sorted by time; hand over the ones that fall in this slice.
    const slice: Input[] = [];
    while (next < inputs.length && (inputs[next]?.atMs ?? 0) <= to) {
      slice.push(inputs[next] as Input);
      next += 1;
    }
    state = step(state, slice, to).state;
  }
  return hashState(state);
}
