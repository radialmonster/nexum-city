import { balance } from '@nexum/sim';

/** What the attackers bring and the best guess at what they face. */
export interface SiegeOdds {
  /** Attack against the defence: the share of the fight the attackers hold, 0 to 1. */
  readonly edge: number;
  /** Hours to fill the capture bar from empty with these crews, or Infinity with none. */
  readonly hoursToCapture: number;
  /** True when a rival's garrison is a guess rather than a known number. */
  readonly estimated: boolean;
}

export interface SiegeOddsInput {
  /** Strength of each attacking crew. */
  readonly attackers: readonly number[];
  /** Strength of each defending crew, when known (your own districts only). */
  readonly defenders?: readonly number[];
  /** Crews seen at a rival district: valued at their starting strength when strengths are hidden. */
  readonly defenderCount?: number;
  readonly wallsLevel?: number;
  readonly pullback?: boolean;
  /** The district's owner leads the season: the attack gets a bonus. */
  readonly leader?: boolean;
}

const PERCENT_SQUARED = 10_000;

/**
 * The sim's own siege rate: attack x 10000 against (garrison + militia) x walls x stance, with the
 * base fill time and the leader bonus. A rival's garrison is hidden by fog, so unless exact
 * strengths are given it is estimated from the crews seen, at their starting strength, with no
 * walls. The result says so through `estimated`.
 */
export function siegeOdds(input: SiegeOddsInput): SiegeOdds {
  const s = balance.siege;
  const a = input.attackers.reduce((n, v) => n + v, 0) * PERCENT_SQUARED;
  const estimated = input.defenders === undefined;
  const garrison = input.defenders
    ? input.defenders.reduce((n, v) => n + v, 0)
    : (input.defenderCount ?? 0) * balance.recruit.startStrength;
  const walls = 100 + s.wallsPercentPerLevel * (input.wallsLevel ?? 0);
  const stance = input.pullback === true ? s.pullbackPercent : 100;
  const d = (garrison + s.militia) * walls * stance;
  const edge = a + d === 0 ? 0 : a / (a + d);
  const bonus = 100 + (input.leader === true ? s.leaderBonusPercent : 0);
  const hoursToCapture = a > 0 ? (s.baseHoursToFill * (a + d) * 100) / (a * bonus) : Infinity;
  return { edge, hoursToCapture, estimated };
}
