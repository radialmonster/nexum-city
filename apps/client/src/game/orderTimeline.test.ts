import { describe, expect, it } from 'vitest';
import { timelineEntries, timelineRows, TIMELINE_SPAN_MS } from './orderTimeline';
import { makeView } from './testing';

const goods = { parts: 0, power: 0, data: 0, supplies: 0 };
const now = 1_000_000;

describe('timelineEntries', () => {
  it('lists my movement with an ETA and a recall id, and skips rivals', () => {
    const base = {
      carrierId: null,
      carrierKind: 'foot' as const,
      crewIds: ['c1'],
      cargo: goods,
      route: ['a', 'b'],
      lengthM: 500,
      from: 'a',
      to: 'b',
    };
    const view = makeView({
      movements: {
        m1: {
          ...base,
          id: 'm1',
          owner: 'me',
          kind: 'haul',
          departMs: now - 600_000,
          arriveMs: now + 600_000,
        },
        m2: {
          ...base,
          id: 'm2',
          owner: 'rival',
          kind: 'move',
          departMs: now,
          arriveMs: now + 1000,
        },
      },
    });
    const e = timelineEntries(view, [], now);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ kind: 'haul', recallId: 'm1', progress: 0.5 });
    expect(e[0]?.text).toContain('ETA 10m');
  });

  it('a recalled movement shows a return and cannot be recalled again', () => {
    const view = makeView({
      movements: {
        m1: {
          id: 'm1',
          owner: 'me',
          kind: 'move',
          carrierId: null,
          carrierKind: 'foot',
          crewIds: ['c1'],
          cargo: goods,
          route: ['a', 'b'],
          lengthM: 1,
          from: 'a',
          to: 'b',
          departMs: now - 1,
          arriveMs: now + 60_000,
          recalledAtMs: now - 1,
        },
      },
    });
    const [e] = timelineEntries(view, [], now);
    expect(e?.recallId).toBeNull();
    expect(e?.text).toMatch(/^RETURN to Alpha Docks/);
  });

  it('estimates a siege finish from pace since the start event', () => {
    const view = makeView();
    const b = view.districts['b'];
    if (b?.relation !== 'visible') throw new Error('fixture');
    b.siege = { attacker: 'me', progress: 0.25 };
    const feed = [
      {
        seq: 1,
        event: {
          id: 'e1',
          at: now - 3_600_000,
          kind: 'siege.started' as const,
          actors: ['me'],
          districts: ['b'],
          data: {},
        },
      },
    ];
    const [e] = timelineEntries(view, feed, now);
    expect(e).toMatchObject({ kind: 'siege', progress: 0.25 });
    expect(e?.endMs).toBe(now + 3 * 3_600_000);
  });

  it('lists builds, scout reveal windows and crews getting ready', () => {
    const view = makeView({ reveals: { b: now + 1_800_000, z: now - 5 } });
    const a = view.districts['a'];
    if (a?.relation !== 'own') throw new Error('fixture');
    a.construction = { building: 'depot', level: 1, completesAtMs: now + 600_000 };
    view.crews['c2'] = {
      id: 'c2',
      owner: 'me',
      strength: 10,
      loc: { at: 'a' },
      readyAtMs: now + 120_000,
    };
    const kinds = timelineEntries(view, [], now)
      .map((x) => x.kind)
      .sort();
    expect(kinds).toEqual(['build', 'recruit', 'reveal']);
  });
});

describe('timelineRows', () => {
  it('maps onto the span, clips and drops out-of-range rows', () => {
    const mk = (id: string, startMs: number, endMs: number) => ({
      id,
      kind: 'move' as const,
      label: id,
      glyph: '>',
      faction: 'self' as const,
      startMs,
      endMs,
      progress: 0,
      text: '',
      state: 'running' as const,
      recallId: null,
      districtId: null,
    });
    const rows = timelineRows(
      [
        mk('half', now - 1000, now + TIMELINE_SPAN_MS / 2),
        mk('far', now + TIMELINE_SPAN_MS * 2, now + TIMELINE_SPAN_MS * 3),
        mk('past', now - 10, now - 5),
        mk('long', now, now + TIMELINE_SPAN_MS * 3),
      ],
      now,
    );
    expect(rows.map((r) => r.id)).toEqual(['half', 'long']);
    expect(rows[0]).toMatchObject({ start: 0, end: 0.5 });
    expect(rows[1]?.end).toBe(1);
  });
});

describe('settling in the timeline', () => {
  it('shows my settlement with its time left, and ignores a rival one', () => {
    const base = makeView();
    const b = base.districts['b'];
    if (b?.relation !== 'visible') throw new Error('fixture');
    const mine = makeView({
      districts: {
        ...base.districts,
        b: {
          ...b,
          owner: 'neutral',
          open: true,
          settling: { owner: 'me', completesAtMs: now + 3_600_000 },
        },
      },
    });
    const e = timelineEntries(mine, [], now).find((x) => x.kind === 'settle');
    expect(e).toMatchObject({ districtId: 'b', state: 'running' });
    expect(e?.text).toContain('SETTLING');
    const theirs = makeView({
      districts: {
        ...base.districts,
        b: {
          ...b,
          owner: 'neutral',
          open: true,
          settling: { owner: 'rival', completesAtMs: now + 1 },
        },
      },
    });
    expect(timelineEntries(theirs, [], now).some((x) => x.kind === 'settle')).toBe(false);
  });
});
