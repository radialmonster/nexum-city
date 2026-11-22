import type { FeedItem, PlayerView } from '@nexum/contracts';
import { balance, buildDurationMs } from '@nexum/sim';
import type { Faction } from '../ui/util';
import { isOwn, streetEnds } from './derive';

/** The time axis of the bottom band runs from now to this far ahead. */
export const TIMELINE_SPAN_MS = 4 * 3_600_000;

export type TimelineKind =
  | 'move'
  | 'haul'
  | 'scout'
  | 'siege'
  | 'reinforce'
  | 'settle'
  | 'raid'
  | 'ambush'
  | 'return'
  | 'build'
  | 'recruit'
  | 'reveal'
  | 'defence';

export interface TimelineEntry {
  readonly id: string;
  readonly kind: TimelineKind;
  /** The asset that is busy: a district, a crew group or a carrier. */
  readonly label: string;
  readonly glyph: string;
  readonly faction: Faction;
  /** Bar start and end in ms of game time; the start may lie before now. */
  readonly startMs: number;
  readonly endMs: number;
  /** 0 to 1 of the bar already done. */
  readonly progress: number;
  readonly text: string;
  readonly state: 'running' | 'pending' | 'hot';
  /** Set when this row can be recalled (a movement not yet turned around). */
  readonly recallId: string | null;
  /** The district to fly to when the row is clicked. */
  readonly districtId: string | null;
}

export interface TimelineRow extends TimelineEntry {
  /** Bar position on the track, 0 to 1 of the span. */
  readonly start: number;
  readonly end: number;
}

const GLYPH: Record<TimelineKind, string> = {
  move: '>',
  haul: '#',
  scout: '?',
  siege: 'x',
  reinforce: '+',
  settle: '+',
  raid: 'x',
  ambush: 'x',
  return: '<',
  build: '+',
  recruit: '+',
  reveal: 'o',
  defence: '!',
};

const frac = (a: number, b: number): number => (b <= a ? 1 : Math.min(1, Math.max(0, a / b)));

/** "5m", "1h 20m". */
export function shortDuration(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${String(m)}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${String(h)}h` : `${String(h)}h ${String(r)}m`;
}

/**
 * The orders in progress as plain entries, soonest to finish first. A pure function of the
 * player view and the feed (the feed gives when a siege began, so its finish can be estimated).
 */
export function timelineEntries(
  view: PlayerView,
  feed: readonly FeedItem[],
  nowMs: number,
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const me = view.playerId;
  const name = (id: string): string => view.districts[id]?.name ?? id;

  for (const m of Object.values(view.movements)) {
    if (m.owner !== me) continue;
    const returning = m.recalledAtMs !== undefined;
    const target = returning ? m.from : m.to;
    const crew = m.crewIds.length;
    const verb: Record<string, string> = {
      move: 'MOVE',
      haul: 'HAUL',
      scout: 'SCOUT',
      siege: 'ATTACK',
      reinforce: 'REINFORCE',
      settle: 'SETTLE',
      raid: 'RAID',
      ambush: 'AMBUSH',
      return: 'RETURN',
    };
    out.push({
      id: m.id,
      kind: m.kind,
      label: `${m.carrierKind} / ${String(crew)} crew`,
      glyph: GLYPH[m.kind],
      faction:
        m.kind === 'siege' || m.kind === 'raid' || m.kind === 'ambush'
          ? 'raider'
          : m.kind === 'scout'
            ? 'hunter'
            : 'self',
      startMs: m.departMs,
      endMs: m.arriveMs,
      progress: frac(nowMs - m.departMs, m.arriveMs - m.departMs),
      text:
        m.kind === 'ambush' && m.raid
          ? `AMBUSH ${streetEnds(name(m.raid.a), name(m.raid.b))}, ends in ${shortDuration(m.arriveMs - nowMs)}`
          : m.kind === 'raid' && m.raid
            ? `RAID ${streetEnds(name(m.raid.a), name(m.raid.b))}, ETA ${shortDuration(m.arriveMs - nowMs)}`
            : `${returning ? 'RETURN' : (verb[m.kind] ?? 'MOVE')} to ${name(target)}  ETA ${shortDuration(m.arriveMs - nowMs)}`,
      state: m.kind === 'siege' && !returning ? 'hot' : 'running',
      recallId: returning ? null : m.id,
      districtId: target,
    });
  }

  for (const d of Object.values(view.districts)) {
    if (isOwn(d) && d.construction) {
      const total = buildDurationMs(d.construction.building, d.construction.level);
      const start = d.construction.completesAtMs - total;
      out.push({
        id: `build:${d.id}`,
        kind: 'build',
        label: d.name,
        glyph: GLYPH.build,
        faction: 'merchant',
        startMs: start,
        endMs: d.construction.completesAtMs,
        progress: frac(nowMs - start, total),
        text: `BUILD ${d.construction.building} L${String(d.construction.level)}  ${shortDuration(d.construction.completesAtMs - nowMs)}`,
        state: 'running',
        recallId: null,
        districtId: d.id,
      });
    }
    if (d.relation !== 'own' && d.relation !== 'remembered' && d.settling?.owner === me) {
      const total = balance.settle.hours * 3_600_000;
      const start = d.settling.completesAtMs - total;
      out.push({
        id: `settle:${d.id}`,
        kind: 'settle',
        label: d.name,
        glyph: GLYPH.settle,
        faction: 'self',
        startMs: start,
        endMs: d.settling.completesAtMs,
        progress: frac(nowMs - start, total),
        text: `SETTLING  ${shortDuration(d.settling.completesAtMs - nowMs)} left`,
        state: 'running',
        recallId: null,
        districtId: d.id,
      });
    }
    if (d.relation !== 'own' && d.relation !== 'remembered' && d.siege?.attacker === me) {
      out.push(siegeEntry(view, feed, nowMs, d.id, d.siege.progress, 'ATTACK', 'raider'));
    }
    if (isOwn(d) && d.siege) {
      out.push(siegeEntry(view, feed, nowMs, d.id, d.siege.progress, 'DEFEND', 'rival'));
    }
  }

  for (const [id, until] of Object.entries(view.reveals)) {
    if (until <= nowMs) continue;
    out.push({
      id: `reveal:${id}`,
      kind: 'reveal',
      label: name(id),
      glyph: GLYPH.reveal,
      faction: 'hunter',
      startMs: nowMs,
      endMs: until,
      progress: 0,
      text: `SCOUTED  visible ${shortDuration(until - nowMs)}`,
      state: 'pending',
      recallId: null,
      districtId: id,
    });
  }

  for (const c of Object.values(view.crews)) {
    if (c.owner !== me || c.readyAtMs <= nowMs) continue;
    const place = 'at' in c.loc ? c.loc.at : null;
    out.push({
      id: `ready:${c.id}`,
      kind: 'recruit',
      label: place ? name(place) : 'crew',
      glyph: GLYPH.recruit,
      faction: 'newcomer',
      startMs: nowMs,
      endMs: c.readyAtMs,
      progress: 0,
      text: `CREW READY  ${shortDuration(c.readyAtMs - nowMs)}`,
      state: 'pending',
      recallId: null,
      districtId: place,
    });
  }

  return out.sort((a, b) => a.endMs - b.endMs || a.id.localeCompare(b.id));
}

function siegeEntry(
  view: PlayerView,
  feed: readonly FeedItem[],
  nowMs: number,
  districtId: string,
  progress: number,
  verb: 'ATTACK' | 'DEFEND',
  faction: Faction,
): TimelineEntry {
  const started = feed.find(
    (f) => f.event.kind === 'siege.started' && f.event.districts[0] === districtId,
  )?.event.at;
  const p = Math.min(1, Math.max(0, progress));
  const elapsed = started === undefined ? 0 : nowMs - started;
  // No rate in the view: pace is progress over the time since the siege began.
  const estimated = p > 0 && elapsed > 0 ? nowMs + (elapsed / p) * (1 - p) : null;
  const end = estimated ?? nowMs + 3_600_000;
  const name = view.districts[districtId]?.name ?? districtId;
  return {
    id: `siege:${districtId}`,
    kind: verb === 'ATTACK' ? 'siege' : 'defence',
    label: name,
    glyph: GLYPH[verb === 'ATTACK' ? 'siege' : 'defence'],
    faction,
    startMs: started ?? nowMs,
    endMs: end,
    progress: p,
    text: `${verb} ${String(Math.round(p * 100))}%${estimated === null ? '' : `  ends ~${shortDuration(end - nowMs)}`}`,
    state: 'hot',
    recallId: null,
    districtId,
  };
}

/** Places entries on the 0 to 1 track. Anything finished or entirely past the span is dropped. */
export function timelineRows(
  entries: readonly TimelineEntry[],
  nowMs: number,
  spanMs: number = TIMELINE_SPAN_MS,
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const e of entries) {
    if (e.endMs <= nowMs) continue;
    const start = Math.max(0, (e.startMs - nowMs) / spanMs);
    if (start >= 1) continue;
    const end = Math.min(1, (e.endMs - nowMs) / spanMs);
    rows.push({ ...e, start, end: Math.max(end, start + 0.01) });
  }
  return rows;
}
