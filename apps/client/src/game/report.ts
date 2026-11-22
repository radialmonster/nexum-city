import type { FeedItem, PlayerView } from '@nexum/contracts';

export const REPORT_KINDS = ['siege.captured', 'siege.broken', 'combat.round'] as const;

/** True for the feed events that open a battle report when clicked. */
export const hasReport = (kind: string): boolean =>
  (REPORT_KINDS as readonly string[]).includes(kind);

export interface RoundPoint {
  readonly round: number;
  readonly at: number;
  readonly attackerStrength: number;
  readonly defenderStrength: number;
  readonly attackerLost: number;
  readonly defenderLost: number;
}

export interface BattleReport {
  readonly districtId: string;
  readonly districtName: string;
  readonly outcome: 'captured' | 'broken' | 'ongoing';
  readonly attacker: string;
  readonly defender: string;
  readonly startedMs: number | null;
  readonly endedMs: number | null;
  /** The strength timeline, one point per fought round. */
  readonly rounds: readonly RoundPoint[];
  readonly attackerStart: number | null;
  readonly attackerLost: number;
  readonly defenderLost: number;
  readonly survivors: number | null;
  readonly loot: Readonly<Record<string, number>>;
  readonly buildingsDamaged: number;
  /** Plain sentence for the outcome. */
  readonly summary: string;
}

type Data = Readonly<Record<string, unknown>>;
const num = (d: Data, k: string): number | undefined => {
  const v = d[k];
  return typeof v === 'number' ? v : undefined;
};
const str = (d: Data, k: string): string | undefined => {
  const v = d[k];
  return typeof v === 'string' ? v : undefined;
};
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Builds the report for the siege that the event at `seq` belongs to, from the feed alone: the
 * `siege.started` before it, every `combat.round` in between, and the closing event if any.
 */
export function buildReport(
  feed: readonly FeedItem[],
  view: PlayerView,
  seq: number,
): BattleReport | null {
  const hit = feed.find((f) => f.seq === seq);
  if (!hit || !hasReport(hit.event.kind)) return null;
  const districtId = hit.event.districts[0];
  if (districtId === undefined) return null;
  const here = feed.filter((f) => f.event.districts[0] === districtId);

  // The closing event of this siege: the clicked one, else the first end after it.
  const isEnd = (f: FeedItem) =>
    f.event.kind === 'siege.captured' || f.event.kind === 'siege.broken';
  const close = isEnd(hit) ? hit : here.find((f) => f.seq > hit.seq && isEnd(f));
  const endSeq = close?.seq ?? Infinity;
  const startItem = [...here]
    .reverse()
    .find((f) => f.event.kind === 'siege.started' && f.seq <= hit.seq && f.seq < endSeq);
  const startSeq = startItem?.seq ?? -Infinity;
  // A siege that has already ended is bounded by the previous end too.
  const prevEnd = [...here].reverse().find((f) => isEnd(f) && f.seq < (startItem?.seq ?? hit.seq));
  const from = Math.max(startSeq, prevEnd?.seq ?? -Infinity);

  const rounds: RoundPoint[] = here
    .filter((f) => f.event.kind === 'combat.round' && f.seq > from && f.seq < endSeq)
    .map((f) => ({
      round: num(f.event.data, 'round') ?? 0,
      at: f.event.at,
      attackerStrength: num(f.event.data, 'attackerStrength') ?? 0,
      defenderStrength: num(f.event.data, 'defenderStrength') ?? 0,
      attackerLost: num(f.event.data, 'attackerLost') ?? 0,
      defenderLost: num(f.event.data, 'defenderLost') ?? 0,
    }));

  const data = (close ?? startItem ?? hit).event.data;
  const attacker =
    str(data, 'attacker') ?? str(startItem?.event.data ?? {}, 'attacker') ?? 'someone';
  const defender =
    str(data, 'defender') ?? str(startItem?.event.data ?? {}, 'defender') ?? 'neutral';
  const sum = (k: 'attackerLost' | 'defenderLost') => rounds.reduce((n, r) => n + r[k], 0);

  const rep = obj(close?.event.kind === 'siege.captured' ? close.event.data['report'] : null);
  const repAttacker = obj(rep?.['attacker']);
  const repDefender = obj(rep?.['defender']);
  const lootRaw = obj(rep?.['loot']) ?? {};
  const loot: Record<string, number> = {};
  for (const [g, v] of Object.entries(lootRaw))
    if (typeof v === 'number' && v > 0) loot[g] = Math.round(v);
  const survivors = Array.isArray(repAttacker?.['survivors'])
    ? repAttacker['survivors'].length
    : null;

  const outcome = close
    ? close.event.kind === 'siege.captured'
      ? 'captured'
      : 'broken'
    : 'ongoing';
  const districtName = view.districts[districtId]?.name ?? districtId;
  const name = (id: string): string => (id === view.playerId ? 'You' : id);
  const summary =
    outcome === 'captured'
      ? `${name(attacker)} took ${districtName} from ${defender === 'neutral' ? 'nobody' : name(defender)}.`
      : outcome === 'broken'
        ? `The siege of ${districtName} by ${name(attacker)} ended without a capture${str(data, 'reason') ? ` (${String(str(data, 'reason'))})` : ''}.`
        : `${name(attacker)} is still besieging ${districtName}.`;

  return {
    districtId,
    districtName,
    outcome,
    attacker,
    defender,
    startedMs: num(rep ?? {}, 'startedMs') ?? startItem?.event.at ?? null,
    endedMs: close?.event.at ?? null,
    rounds,
    attackerStart: num(repAttacker ?? {}, 'started') ?? null,
    attackerLost: num(repAttacker ?? {}, 'lost') ?? sum('attackerLost'),
    defenderLost: num(repDefender ?? {}, 'lost') ?? sum('defenderLost'),
    survivors,
    loot,
    buildingsDamaged: Array.isArray(rep?.['buildingsDamaged']) ? rep['buildingsDamaged'].length : 0,
    summary,
  };
}
