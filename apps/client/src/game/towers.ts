import type { PlayerView } from '@nexum/contracts';
import { balance } from '@nexum/sim';

/** One of your own Watchtowers: where it stands and how far it sees. */
export interface Tower {
  readonly districtId: string;
  readonly level: number;
}

/** An ambush in sight that is not yours. */
export interface KnownAmbush {
  readonly id: string;
  readonly owner: string;
  readonly a: string;
  readonly b: string;
  readonly untilMs: number;
}

/** Your Watchtowers, from your own districts' buildings. */
export function myTowers(view: PlayerView): Tower[] {
  const out: Tower[] = [];
  for (const d of Object.values(view.districts)) {
    if (d.relation !== 'own') continue;
    const level = d.buildings.find((b) => b.type === 'watchtower')?.level ?? 0;
    if (level > 0) out.push({ districtId: d.id, level });
  }
  return out.sort((x, y) => x.districtId.localeCompare(y.districtId));
}

function neighbours(view: PlayerView): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of view.graph.edges) {
    (out.get(e.a) ?? out.set(e.a, []).get(e.a))?.push(e.b);
    (out.get(e.b) ?? out.set(e.b, []).get(e.b))?.push(e.a);
  }
  return out;
}

/** The nodes one tower covers: `1 + level` street hops around it, the same reach as the sim's. */
export function towerCoverage(view: PlayerView, tower: Tower): Set<string> {
  const adj = neighbours(view);
  const seen = new Set<string>([tower.districtId]);
  let frontier = [tower.districtId];
  for (let i = 0; i <= tower.level; i++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of adj.get(id) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

/** Every ambush of another player that you can see, once each, from the view's two sources. */
export function knownAmbushes(view: PlayerView): KnownAmbush[] {
  const out: KnownAmbush[] = [];
  for (const a of view.ambushes) {
    if (a.owner === view.playerId) continue;
    out.push({ id: a.id, owner: a.owner, a: a.edge[0], b: a.edge[1], untilMs: a.untilMs });
  }
  for (const m of Object.values(view.movements)) {
    if (m.kind !== 'ambush' || !m.raid || m.owner === view.playerId) continue;
    if (out.some((x) => x.id === m.id)) continue;
    out.push({
      id: m.id,
      owner: m.owner,
      a: m.raid.a,
      b: m.raid.b,
      untilMs: m.raid.untilMs,
    });
  }
  return out;
}

/** The first of your towers that covers either end of a street, or null when none does. */
export function spottingTower(view: PlayerView, a: string, b: string): Tower | null {
  for (const t of myTowers(view)) {
    const cover = towerCoverage(view, t);
    if (cover.has(a) || cover.has(b)) return t;
  }
  return null;
}

/** Known enemy ambushes on any street the route uses, soonest to end first. */
export function ambushesOnRoute(
  view: PlayerView,
  route: readonly string[],
  nowMs: number,
): KnownAmbush[] {
  const streets = new Set<string>();
  for (let i = 0; i + 1 < route.length; i++) {
    const x = route[i] as string;
    const y = route[i + 1] as string;
    streets.add(x < y ? `${x}|${y}` : `${y}|${x}`);
  }
  return knownAmbushes(view)
    .filter((k) => k.untilMs > nowMs && streets.has(k.a < k.b ? `${k.a}|${k.b}` : `${k.b}|${k.a}`))
    .sort((p, q) => p.untilMs - q.untilMs);
}

/** Why a route needs care: names an escort and a Runner as the ways to cope. */
export const AMBUSH_ROUTE_WARNING = `Known ambush on this route. Bring an escort crew, or send a Runner (${String(balance.runner.evadePercent)}% chance to slip past).`;
