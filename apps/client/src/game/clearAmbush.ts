import type { PlayerView } from '@nexum/contracts';
import { estimateClear, pickClearCrews, type ClearEstimate } from '@nexum/sim';
import type { PlayerView as SimView } from '@nexum/sim';
import { wearInfo, wornRoute } from './wear';

/** An enemy ambush you can see right now, from the view's `ambushes`. */
export type SeenAmbush = PlayerView['ambushes'][number];

/** What "Break it up" would do: who goes, how long the walk is and how the fight looks. */
export interface ClearPlan {
  readonly ambush: SeenAmbush;
  /** Time until the ambush ends on its own. */
  readonly remainingMs: number;
  /** Null when no crew is free. */
  readonly pick: { crewIds: string[]; carrierId: string | null; from: string } | null;
  /** Travel time from the crews' plot to the nearer end of the street. */
  readonly etaMs: number | null;
  /** True when the crews would arrive after the ambush has ended on its own. */
  readonly tooLate: boolean;
  readonly estimate: ClearEstimate | null;
}

/** The ambushes of rivals you can see that end at a district. */
export function ambushesAt(view: PlayerView, districtId: string, nowMs: number): SeenAmbush[] {
  return view.ambushes
    .filter((a) => a.owner !== view.playerId && a.untilMs > nowMs && a.edge.includes(districtId))
    .sort((x, y) => x.untilMs - y.untilMs);
}

/** A visible ambush by id, or undefined when it ended or you no longer see it. */
export function findAmbush(view: PlayerView, id: string, nowMs: number): SeenAmbush | undefined {
  return view.ambushes.find((a) => a.id === id && a.owner !== view.playerId && a.untilMs > nowMs);
}

/** True when one of your crews is already on its way to break this ambush up. */
export function clearUnderway(view: PlayerView, ambushId: string): boolean {
  return Object.values(view.movements).some(
    (m) => m.owner === view.playerId && m.kind === 'clear' && m.clear?.ambushId === ambushId,
  );
}

/** The default force, its walk and the plain estimate, all from the sim's own helpers. */
export function planClear(view: PlayerView, ambush: SeenAmbush, nowMs: number): ClearPlan {
  const remainingMs = Math.max(0, ambush.untilMs - nowMs);
  // The wire view and the sim view differ only in optional-property typing.
  const found = pickClearCrews(view as unknown as SimView, view.playerId, {
    a: ambush.edge[0],
    b: ambush.edge[1],
  });
  if (!found) {
    return { ambush, remainingMs, pick: null, etaMs: null, tooLate: false, estimate: null };
  }
  const carrier = found.carrierId ? view.carriers[found.carrierId] : undefined;
  const kind = carrier?.kind ?? 'foot';
  const wear = wearInfo({ wear: carrier?.wear ?? 0 }).wear;
  let etaMs: number | null = null;
  for (const end of ambush.edge) {
    const leg = wornRoute(view, found.from, end, kind, wear);
    if (leg && (etaMs === null || leg.durationMs < etaMs)) etaMs = leg.durationMs;
  }
  return {
    ambush,
    remainingMs,
    pick: { crewIds: found.crewIds, carrierId: found.carrierId, from: found.from },
    etaMs,
    tooLate: etaMs !== null && etaMs >= remainingMs,
    estimate: estimateClear(found.strength, ambush),
  };
}
