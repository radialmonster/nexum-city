import { BOTS, type BotKind } from './bots.js';
import { hashState } from './hash.js';
import { checkInvariants } from './invariants.js';
import { validateOrder } from './orders.js';
import { standings, type Standing } from './score.js';
import { step } from './step.js';
import type { GameState, Id, Input, SimEvent } from './types.js';
import { addPlayer, createWorld } from './world.js';

export interface SeasonOptions {
  seed?: number;
  days?: number;
  /** One bot per player, in order. */
  bots?: BotKind[];
  /** How often the bots decide, in game minutes. */
  decideEveryMinutes?: number;
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
  districts: number;
  players: { id: Id; bot: BotKind }[];
  standings: Standing[];
  /** Broken invariants found at any decision time (empty is good). */
  problems: string[];
}

const DEFAULT_BOTS: BotKind[] = ['raider', 'raider', 'turtle', 'turtle', 'merchant', 'merchant'];

/** A fresh world with the bots joined at game time 0. */
export function seasonStart(options: SeasonOptions = {}): {
  state: GameState;
  players: { id: Id; bot: BotKind }[];
} {
  const days = options.days ?? 7;
  let state = createWorld(options.seed ?? 1, { seasonHours: days * 24 });
  const players = (options.bots ?? DEFAULT_BOTS).map((bot, i) => ({ id: `b${i + 1}`, bot }));
  for (const p of players) state = addPlayer(state, { id: p.id });
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
  const problems: string[] = [];

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
    }
  };

  while (state.nowMs < endMs) {
    const at = state.nowMs;
    const batch: Input[] = [];
    for (const p of players) {
      for (const order of BOTS[p.bot](state, p.id)) {
        const input: Input = { actorId: p.id, order, atMs: at };
        botOrders += 1;
        if (validateOrder(state, input).ok) batch.push(input);
        else botRejected += 1;
      }
    }
    inputs.push(...batch);
    const result = step(state, batch, Math.min(at + beatMs, endMs));
    state = result.state;
    count(result.events);
    for (const problem of checkInvariants(state)) problems.push(`t=${state.nowMs}: ${problem}`);
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
    districts: Object.keys(state.districts).length,
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
