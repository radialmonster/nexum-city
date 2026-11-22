import type { PlayerView } from '@nexum/contracts';
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
  /** An unowned plot: it holds the neutral guard (never worn down) instead of the militia. */
  readonly neutral?: boolean;
}

const PERCENT_SQUARED = 10_000;

/**
 * The sim's own siege rate (its `siegeDefence`, which needs full state, so the same sum is done
 * here from the view): attack x 10000 against (garrison + militia, or the neutral guard on an
 * unowned plot) x walls x stance, with the
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
  const base = input.neutral === true ? s.neutralGuard : s.militia;
  const d = (garrison + base) * walls * stance;
  const edge = a + d === 0 ? 0 : a / (a + d);
  const bonus = 100 + (input.leader === true ? s.leaderBonusPercent : 0);
  const hoursToCapture = a > 0 ? (s.baseHoursToFill * (a + d) * 100) / (a * bonus) : Infinity;
  return { edge, hoursToCapture, estimated };
}

/**
 * Hours left on a siege you are running, from the same odds the order card shows: the full-bar time
 * for the crews at the plot, scaled by how much of the bar is still empty. Null when it cannot be
 * worked out (no crews of yours there), so the caller can fall back to the observed pace.
 */
export function attackHoursLeft(
  view: PlayerView,
  districtId: string,
  progress: number,
): number | null {
  const d = view.districts[districtId];
  if (!d || d.relation === 'remembered') return null;
  const attackers = Object.values(view.crews)
    .filter((c) => c.owner === view.playerId && 'at' in c.loc && c.loc.at === districtId)
    .map((c) => c.strength);
  if (attackers.length === 0) return null;
  const defenderCount =
    d.relation === 'visible' || d.relation === 'hub'
      ? Object.values(d.presence).reduce((n, v) => n + v, 0)
      : 0;
  const owner = 'owner' in d ? d.owner : '';
  const leader = view.standings.find((s) => s.rank === 1)?.playerId === owner;
  const neutral = owner === 'neutral' || owner === '';
  const { hoursToCapture } = siegeOdds({ attackers, defenderCount, leader, neutral });
  if (!Number.isFinite(hoursToCapture)) return null;
  return hoursToCapture * (1 - Math.min(1, Math.max(0, progress)));
}
