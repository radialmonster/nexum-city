import type { FeedItem, PlayerView } from '@nexum/contracts';
import { streetEnds } from './derive';

/** The raid events that open a short report when their feed card is clicked. */
export const RAID_REPORT_KINDS = ['raid.hit', 'raid.repelled'] as const;

export const hasRaidReport = (kind: string): boolean =>
  (RAID_REPORT_KINDS as readonly string[]).includes(kind);

export interface RaidReport {
  readonly outcome: 'hit' | 'repelled';
  readonly districtId: string | null;
  readonly street: string;
  readonly raider: string;
  readonly victim: string;
  /** Which side the viewer was on. */
  readonly role: 'raider' | 'victim' | 'witness';
  readonly raiderStrength: number;
  readonly guard: number;
  readonly stolen: Readonly<Record<string, number>>;
  readonly destroyed: Readonly<Record<string, number>>;
  readonly remaining: Readonly<Record<string, number>>;
  /** Escort crews the haul lost (hit) or raiders lost (repelled). */
  readonly escortLost: number;
  readonly raiderLost: number;
  readonly at: number;
  /** Plain sentence for the outcome, from the viewer's side. */
  readonly summary: string;
}

type Data = Readonly<Record<string, unknown>>;
const num = (d: Data, k: string): number => {
  const v = d[k];
  return typeof v === 'number' ? v : 0;
};
const goods = (d: Data, k: string): Record<string, number> => {
  const v = d[k];
  const out: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [g, n] of Object.entries(v)) if (typeof n === 'number' && n > 0) out[g] = n;
  }
  return out;
};

/** Builds the short report for the raid hit or repelled event at `seq`. */
export function buildRaidReport(
  feed: readonly FeedItem[],
  view: PlayerView,
  seq: number,
): RaidReport | null {
  const item = feed.find((f) => f.seq === seq);
  if (!item || !hasRaidReport(item.event.kind)) return null;
  const e = item.event;
  const d = e.data;
  const me = view.playerId;
  const raiderId = e.actors[0] ?? '';
  const victimId = e.actors[1] ?? '';
  const nameOf = (id: string | undefined): string => view.districts[id ?? '']?.name ?? id ?? '?';
  const street = streetEnds(nameOf(e.districts[0]), nameOf(e.districts[1]));
  const role = raiderId === me ? 'raider' : victimId === me ? 'victim' : 'witness';
  const outcome = e.kind === 'raid.hit' ? 'hit' : 'repelled';
  const stolen = goods(d, 'stolen');
  const raiderStrength = num(d, 'raiderStrength');
  const guard = num(d, 'guard');
  let summary: string;
  if (outcome === 'hit') {
    summary =
      role === 'victim'
        ? 'Raiders caught your haul and took part of its cargo.'
        : role === 'raider'
          ? 'Your ambush caught a haul and took part of its cargo.'
          : 'A haul was raided.';
  } else {
    summary =
      role === 'victim'
        ? 'Your escort was strong enough to beat the raiders off. The cargo is safe.'
        : role === 'raider'
          ? 'The haul was escorted and your raiders were beaten off. Nothing was taken.'
          : 'An escort beat off raiders.';
  }
  return {
    outcome,
    districtId: e.districts[0] ?? null,
    street,
    raider: raiderId,
    victim: victimId,
    role,
    raiderStrength,
    guard,
    stolen,
    destroyed: goods(d, 'destroyed'),
    remaining: goods(d, 'remaining'),
    escortLost: num(d, 'escortLost'),
    raiderLost: num(d, 'raiderLost'),
    at: e.at,
    summary,
  };
}
