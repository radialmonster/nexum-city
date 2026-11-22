import type { DistrictView, PlayerView } from '@nexum/contracts';
import {
  balance,
  runnerPrice,
  shortestRoute,
  slowPercentAt,
  travelMs,
  wearOf,
  type BuildingType,
  type CarrierKind,
} from '@nexum/sim';

/** Highest level a building type can reach: Watchtower and Garage stop below the global cap. */
export function maxLevelFor(type: BuildingType): number {
  const spec = balance.buildings.specs[type] as { maxLevel?: number };
  return spec.maxLevel ?? balance.buildings.maxLevel;
}

type OwnDistrict = Extract<DistrictView, { relation: 'own' }>;

/** What a Runner costs when bought at this district, in credits (a Garage makes it cheaper). */
export function runnerCreditsAt(d: Pick<OwnDistrict, 'kind' | 'buildings'> | undefined): number {
  if (!d) return balance.runner.credits;
  return runnerPrice({ kind: d.kind, buildings: d.buildings } as Parameters<typeof runnerPrice>[0]);
}

/** A carrier's wear (0 to 100) and how much slower it makes its trips. */
export function wearInfo(carrier: { wear?: number | undefined }): {
  wear: number;
  slowPercent: number;
} {
  const wear = wearOf(carrier.wear === undefined ? {} : { wear: carrier.wear });
  return { wear, slowPercent: slowPercentAt(wear) };
}

/** "+12% slower" for a worn carrier, or null when wear costs nothing yet. */
export function slowText(slowPercent: number): string | null {
  return slowPercent > 0 ? `+${String(slowPercent)}% slower` : null;
}

/** The shortest route and its trip time for a carrier of this kind and wear, or null. */
export function wornRoute(
  view: PlayerView,
  from: string,
  to: string,
  kind: CarrierKind,
  wear: number,
): { route: readonly string[]; durationMs: number; lengthM: number } | null {
  const r = shortestRoute(view.graph, from, to);
  if (!r) return null;
  return { route: r.route, lengthM: r.lengthM, durationMs: travelMs(r.lengthM, kind, wear) };
}

/** The most worn idle carrier of this kind at `from` is the one the card plans with. */
export function wearOfBest(view: PlayerView, from: string, kind: CarrierKind): number {
  let best: number | null = null;
  for (const c of Object.values(view.carriers)) {
    if (c.owner !== view.playerId || c.kind !== kind) continue;
    if (!('at' in c.loc) || c.loc.at !== from) continue;
    const w = wearOf(c.wear === undefined ? {} : { wear: c.wear });
    if (best === null || w < best) best = w;
  }
  return best ?? 0;
}
