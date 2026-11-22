import { ATOMS_PER_UNIT, MS_PER_HOUR, balance } from './balance.js';
import { emit, schedule, type Ctx } from './ctx.js';
import { refreshSiege } from './siege.js';
import type { System } from './systems.js';
import type { GameState, Id, JsonValue } from './types.js';

export interface Standing {
  rank: number;
  playerId: Id;
  /** Season score in district-hours (1 point = one district held for an hour). */
  score: number;
  /** The exact integer behind `score`, in district-milliseconds. */
  scoreMs: number;
  districts: number;
  /** Part of `score` earned from trade, in district-hours. */
  tradeScore: number;
  /** The exact integer behind `tradeScore`. */
  tradeMs: number;
  /** Part of `score` earned from completed contracts, in district-hours. */
  contractScore: number;
  /** The exact integer behind `contractScore`. */
  contractMs: number;
}

/**
 * Integrates district-hours exactly: every owned district earns its owner one
 * millisecond of score per millisecond held. The sum is an integer, so any
 * split of the same span gives the same total. Scoring stops at the season end.
 */
export function settleScore(ctx: Ctx, fromMs: number, toMs: number): void {
  const { state } = ctx;
  const dt = Math.min(toMs, state.season.endMs) - Math.min(fromMs, state.season.endMs);
  if (dt <= 0) return;
  for (const d of Object.values(state.districts)) {
    const owner = d.owner === 'neutral' ? undefined : state.players[d.owner];
    if (owner) owner.score += dt;
  }
}

/**
 * Credits a player's trade score for a fill worth `cents` centi-credits. 1 point (one district
 * hour) per `creditsPerPoint` credits, floored to whole milliseconds, capped per season day.
 * Pure integer maths, so the total never depends on how time was sliced.
 */
export function addTradeScore(ctx: Ctx, playerId: Id, cents: number): void {
  const { state } = ctx;
  const p = state.players[playerId];
  if (!p || state.nowMs >= state.season.endMs) return;
  const T = balance.tradeScore;
  const day = Math.floor((state.nowMs - state.season.startMs) / (24 * MS_PER_HOUR));
  if (p.tradeDay !== day) {
    p.tradeDay = day;
    p.tradeDayMs = 0;
  }
  const earned = Math.floor((cents * MS_PER_HOUR) / (100 * T.creditsPerPoint));
  const gain = Math.min(earned, T.dailyCapPoints * MS_PER_HOUR - p.tradeDayMs);
  if (gain <= 0) return;
  p.tradeDayMs += gain;
  p.tradeMs += gain;
  p.score += gain;
}

/**
 * Credits a player's contract score for a completed contract that paid `rewardAtoms`: 1 point per
 * `creditsPerPoint` credits, capped per season day. Returns the milliseconds gained.
 */
export function addContractScore(ctx: Ctx, playerId: Id, rewardAtoms: number): number {
  const { state } = ctx;
  const p = state.players[playerId];
  if (!p || state.nowMs >= state.season.endMs) return 0;
  const T = balance.contractScore;
  const day = Math.floor((state.nowMs - state.season.startMs) / (24 * MS_PER_HOUR));
  if (p.contractDay !== day) {
    p.contractDay = day;
    p.contractDayMs = 0;
  }
  const earned = Number(
    (BigInt(Math.trunc(rewardAtoms)) * BigInt(MS_PER_HOUR)) /
      (BigInt(ATOMS_PER_UNIT) * BigInt(T.creditsPerPoint)),
  );
  const gain = Math.min(earned, T.dailyCapPoints * MS_PER_HOUR - p.contractDayMs);
  if (gain <= 0) return 0;
  p.contractDayMs += gain;
  p.contractMs += gain;
  p.score += gain;
  return gain;
}

/** Players ranked by score (ties broken by id), with their district counts. */
export function standings(state: GameState): Standing[] {
  const held = new Map<Id, number>();
  for (const d of Object.values(state.districts)) {
    if (d.owner !== 'neutral') held.set(d.owner, (held.get(d.owner) ?? 0) + 1);
  }
  const rows = Object.values(state.players)
    .map((p) => ({
      playerId: p.id,
      scoreMs: p.score,
      tradeMs: p.tradeMs,
      contractMs: p.contractMs,
      districts: held.get(p.id) ?? 0,
    }))
    .sort((a, b) => b.scoreMs - a.scoreMs || (a.playerId < b.playerId ? -1 : 1));
  return rows.map((r, i) => ({
    rank: i + 1,
    playerId: r.playerId,
    score: r.scoreMs / MS_PER_HOUR,
    scoreMs: r.scoreMs,
    districts: r.districts,
    tradeScore: r.tradeMs / MS_PER_HOUR,
    tradeMs: r.tradeMs,
    contractScore: r.contractMs / MS_PER_HOUR,
    contractMs: r.contractMs,
  }));
}

/** Players strictly below the median score, and the sole leader (null when tied or empty). */
function classify(state: GameState): { leaderId: Id | null; belowMedian: Id[] } {
  const rows = standings(state);
  const top = rows[0];
  const second = rows[1];
  const leaderId = top && (!second || top.scoreMs > second.scoreMs) ? top.playerId : null;
  if (rows.length < 2) return { leaderId, belowMedian: [] };
  const asc = rows.map((r) => r.scoreMs).sort((a, b) => a - b);
  const mid = asc.length >> 1;
  // Twice the median keeps the arithmetic in integers for even counts.
  const twiceMedian =
    asc.length % 2 === 1
      ? 2 * (asc[mid] as number)
      : (asc[mid - 1] as number) + (asc[mid] as number);
  const belowMedian = rows.filter((r) => 2 * r.scoreMs < twiceMedian).map((r) => r.playerId);
  return { leaderId, belowMedian: belowMedian.sort() };
}

/** True once the last 48 hours of the season have begun. */
export function inFinale(state: GameState): boolean {
  return state.nowMs >= state.season.finaleStartMs;
}

export const scoreSystem: System = {
  name: 'score',
  settle: settleScore,
  handlers: {
    'score.tick': (ctx, ev) => {
      const { state } = ctx;
      const season = state.season;
      const { leaderId, belowMedian } = classify(state);
      const leaderChanged = leaderId !== season.leaderId;
      season.leaderId = leaderId;
      season.belowMedian = belowMedian;
      season.finale = inFinale(state);
      const table: JsonValue[] = standings(state).map((r) => ({
        rank: r.rank,
        playerId: r.playerId,
        score: r.score,
        districts: r.districts,
      }));
      emit(ctx, 'score.tick', [], [], {
        hour: Math.round((ev.at - season.startMs) / MS_PER_HOUR),
        leaderId,
        belowMedian,
        finale: season.finale,
        standings: table,
      });
      // The leader bonus changes capture rates against the old and new leader.
      if (leaderChanged) for (const id of Object.keys(state.sieges)) refreshSiege(ctx, id);
      if (ev.at + MS_PER_HOUR <= season.endMs) {
        schedule(ctx, ev.at + MS_PER_HOUR, { kind: 'score.tick' });
      }
    },
  },
};
