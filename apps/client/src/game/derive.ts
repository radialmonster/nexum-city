import type { DistrictView, PlayerView } from '@nexum/contracts';
import { balance, toUnits, type CarrierKind } from '@nexum/sim';

export type OwnDistrict = Extract<DistrictView, { relation: 'own' }>;
export interface Goods {
  parts: number;
  power: number;
  data: number;
  supplies: number;
}
export const GOOD_KEYS = ['parts', 'power', 'data', 'supplies'] as const;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const isOwn = (d: DistrictView | undefined): d is OwnDistrict => d?.relation === 'own';

export function ownDistricts(view: PlayerView): OwnDistrict[] {
  return Object.values(view.districts).filter(isOwn);
}

/** Goods sitting in all your district warehouses, in whole units. */
export function warehouseTotals(view: PlayerView): Goods {
  const t: Goods = { parts: 0, power: 0, data: 0, supplies: 0 };
  for (const d of ownDistricts(view)) for (const g of GOOD_KEYS) t[g] += toUnits(d.warehouse[g]);
  return t;
}

/** Units one warehouse holds: the base plus a bonus for each depot level. */
export function warehouseCapacity(d: OwnDistrict): number {
  const depot = d.buildings.find((b) => b.type === 'depot')?.level ?? 0;
  return balance.warehouse.baseCapacity + depot * balance.warehouse.depotBonusPerLevel;
}

/** How full a warehouse is, 0 to 1 and beyond when it overflows. */
export function storageFill(d: OwnDistrict): number {
  const held = GOOD_KEYS.reduce((n, g) => n + toUnits(d.warehouse[g]), 0);
  return held / warehouseCapacity(d);
}

/** The warehouse is this full (0 to 1) before the "nearly full" hint shows. */
export const NEARLY_FULL = 0.9;

/** Units per hour of the district's main good, with the workshop bonus. */
export function productionPerHour(d: OwnDistrict): number {
  if (d.kind === 'hub' || d.kind === 'residential' || d.frontier !== 'built') return 0;
  const ws = d.buildings.find((b) => b.type === 'workshop')?.level ?? 0;
  const p = balance.production;
  return (p.baseUnitsPerHour * (100 + p.workshopBonusPercent * ws)) / 100;
}

/** The good a district kind makes. */
export const KIND_GOOD: Readonly<Record<string, keyof Goods | undefined>> = {
  docks: 'supplies',
  grid: 'power',
  archive: 'data',
  farms: 'supplies',
  stacks: 'parts',
};

export interface Race {
  readonly rank: number;
  readonly total: number;
  readonly points: number;
  /** Points behind the player one rank up, or null when leading. */
  readonly behind: number | null;
  readonly aheadOf: number | null;
  readonly shares: readonly { id: string; share: number; me: boolean }[];
}

/** Where you stand in the season race, from the view's standings. */
export function raceOf(view: PlayerView): Race {
  const rows = [...view.standings].sort((a, b) => a.rank - b.rank);
  const me = rows.find((r) => r.playerId === view.playerId);
  const sum = rows.reduce((n, r) => n + Math.max(0, r.score), 0);
  const up = me ? rows.find((r) => r.rank === me.rank - 1) : undefined;
  const down = me ? rows.find((r) => r.rank === me.rank + 1) : undefined;
  return {
    rank: me?.rank ?? rows.length + 1,
    total: Math.max(rows.length, 1),
    points: me?.score ?? view.self.score,
    behind: me && up ? Math.max(0, up.score - me.score) : null,
    aheadOf: me && down ? Math.max(0, me.score - down.score) : null,
    shares: rows.map((r) => ({
      id: r.playerId,
      share: sum > 0 ? Math.max(0, r.score) / sum : 1 / Math.max(rows.length, 1),
      me: r.playerId === view.playerId,
    })),
  };
}

export interface SeasonClock {
  readonly day: number;
  readonly days: number;
  readonly hhmm: string;
}

export function seasonClock(view: PlayerView, nowMs: number): SeasonClock {
  const { startMs, endMs } = view.season;
  const days = Math.max(1, Math.ceil((endMs - startMs) / DAY_MS));
  const day = Math.min(days, Math.max(1, Math.floor((nowMs - startMs) / DAY_MS) + 1));
  const into = Math.max(0, nowMs - startMs) % DAY_MS;
  const h = Math.floor(into / HOUR_MS);
  const m = Math.floor((into % HOUR_MS) / 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return { day, days, hhmm: `${p(h)}:${p(m)}` };
}

export type SeasonPhase = 'running' | 'finale' | 'over';

export interface FinaleClock {
  readonly phase: SeasonPhase;
  /** Time until the season ends; 0 once it is over. */
  readonly msLeft: number;
  /** `HH:MM:SS` (hours can pass 24 during the finale). */
  readonly text: string;
}

/** Where the season is: running, in the finale (with a countdown), or over. */
export function finaleClock(view: PlayerView, nowMs: number): FinaleClock {
  const { endMs, finaleStartMs } = view.season;
  const msLeft = Math.max(0, endMs - nowMs);
  const phase: SeasonPhase =
    nowMs >= endMs ? 'over' : nowMs >= finaleStartMs ? 'finale' : 'running';
  const s = Math.floor(msLeft / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    phase,
    msLeft,
    text: `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`,
  };
}

export function crewsAt(view: PlayerView, nodeId: string) {
  return Object.values(view.crews).filter(
    (c) => c.owner === view.playerId && 'at' in c.loc && c.loc.at === nodeId,
  );
}

const idNumber = (id: string): number => Number(/d+/.exec(id)?.[0] ?? Number.MAX_SAFE_INTEGER);

/** Your crew's player-facing label: "Crew 2", numbered by id order among your own crews. */
export function crewLabel(view: PlayerView, id: string): string {
  const mine = Object.values(view.crews)
    .filter((c) => c.owner === view.playerId)
    .map((c) => c.id)
    .sort((a, b) => idNumber(a) - idNumber(b) || a.localeCompare(b));
  const i = mine.indexOf(id);
  return i < 0 ? 'Crew' : `Crew ${String(i + 1)}`;
}

/** Your carrier's label: "Van 1", numbered by id order among your carriers of that kind. */
export function carrierLabel(view: PlayerView, id: string): string {
  const c = view.carriers[id];
  if (!c) return 'Carrier';
  const same = Object.values(view.carriers)
    .filter((x) => x.owner === view.playerId && x.kind === c.kind)
    .map((x) => x.id)
    .sort((a, b) => idNumber(a) - idNumber(b) || a.localeCompare(b));
  return `${c.kind.charAt(0).toUpperCase()}${c.kind.slice(1)} ${String(same.indexOf(id) + 1)}`;
}

export function carriersAt(view: PlayerView, nodeId: string) {
  return Object.values(view.carriers).filter(
    (c) => c.owner === view.playerId && 'at' in c.loc && c.loc.at === nodeId,
  );
}

/** Nodes where you hold at least one crew that can take an order now. */
export function readyNodes(view: PlayerView, nowMs: number): string[] {
  const out = new Set<string>();
  for (const c of Object.values(view.crews)) {
    if (c.owner === view.playerId && 'at' in c.loc && c.readyAtMs <= nowMs) out.add(c.loc.at);
  }
  return [...out];
}

export const seatsFor = (kind: CarrierKind | 'foot'): number => balance.carriers[kind].seats;

/** The nearest few districts to `id`, by straight line on the map. */
export function nearby(view: PlayerView, id: string, count = 4): DistrictView[] {
  const here = view.districts[id];
  if (!here) return [];
  return Object.values(view.districts)
    .filter((d) => d.id !== id)
    .map((d) => ({ d, dist: Math.hypot(d.pos.x - here.pos.x, d.pos.y - here.pos.y) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count)
    .map((x) => x.d);
}

/** Wire stance values are lower case; the kit's switch camel-cases the second one. */
export const toKitStance = (s: 'hold' | 'pullback'): 'hold' | 'pullBack' =>
  s === 'pullback' ? 'pullBack' : 'hold';
export const fromKitStance = (s: 'hold' | 'pullBack'): 'hold' | 'pullback' =>
  s === 'pullBack' ? 'pullback' : 'hold';

/** How long your newcomer rush still runs (0 when it is over). */
export const rushLeftMs = (view: PlayerView, nowMs: number): number =>
  Math.max(0, view.self.rushUntilMs - nowMs);

/**
 * A build or settle time as it runs for you now: the newcomer rush makes both
 * `balance.rush.factor` times faster (the sim's `rushDuration`). Travel never changes.
 */
export function rushed(view: PlayerView, nowMs: number, ms: number): number {
  return rushLeftMs(view, nowMs) > 0 ? Math.max(1, Math.ceil(ms / balance.rush.factor)) : ms;
}

/** A span as "5h 12m" or "42m", rounded up to whole minutes. */
export function longSpan(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  if (m < 60) return `${String(m)}m`;
  return `${String(Math.floor(m / 60))}h ${String(m % 60)}m`;
}

export function formatEta(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m >= 60
    ? `${String(Math.floor(m / 60))}h ${String(m % 60).padStart(2, '0')}m`
    : `${String(m)}m`;
}

/** Hours as "3h 20m"; infinite shows a dash. */
export function formatHours(h: number): string {
  return Number.isFinite(h) ? formatEta(h * HOUR_MS) : '-';
}

/** Short wire id shown to players, e.g. a rival's name. */
export const shortName = (id: string): string => (id.length > 14 ? `${id.slice(0, 12)}..` : id);

/** Crew names by player id, as sent by `/me` and `/standings`. */
export type CrewNames = Readonly<Record<string, string>>;

/** A crew's display name: the server's name for it, else a shortened id. */
export const crewName = (names: CrewNames, id: string): string => names[id] ?? shortName(id);

/** "You" for the player, a crew name for everyone else. */
export const whoIs = (names: CrewNames, me: string, id: string): string =>
  id === me ? 'You' : crewName(names, id);

export interface EmpireSummary {
  readonly districts: number;
  readonly crews: number;
  readonly carriers: number;
  /** Units per hour by good, from your built districts. */
  readonly perHour: Goods;
  readonly totalPerHour: number;
  readonly besieged: number;
}

/** What you hold at a glance: districts, crews, carriers and goods made per hour. */
export function empireSummary(view: PlayerView): EmpireSummary {
  const own = ownDistricts(view);
  const perHour: Goods = { parts: 0, power: 0, data: 0, supplies: 0 };
  for (const d of own) {
    const good = KIND_GOOD[d.kind];
    if (good) perHour[good] += productionPerHour(d);
  }
  const mine = <T extends { owner: string }>(xs: Record<string, T>): number =>
    Object.values(xs).filter((x) => x.owner === view.playerId).length;
  return {
    districts: own.length,
    crews: mine(view.crews),
    carriers: mine(view.carriers),
    perHour,
    totalPerHour: GOOD_KEYS.reduce((n, g) => n + perHour[g], 0),
    besieged: own.filter((d) => d.siege !== null).length,
  };
}

/**
 * Two district names as one short phrase for a street: "Sector 1-1 and 2-1" when both names
 * share their first word, else "A and B".
 */
export function streetEnds(a: string, b: string): string {
  const [wa, ...ra] = a.split(' ');
  const [wb, ...rb] = b.split(' ');
  return ra.length > 0 && rb.length > 0 && wa === wb ? `${a} and ${rb.join(' ')}` : `${a} and ${b}`;
}
