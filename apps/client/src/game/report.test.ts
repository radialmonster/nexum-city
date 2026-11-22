import { describe, expect, it } from 'vitest';
import type { FeedItem } from '@nexum/contracts';
import { buildReport, hasReport } from './report';
import { buildDossier } from './rivalDossier';
import { makeView } from './testing';

let n = 0;
const ev = (
  kind: FeedItem['event']['kind'],
  at: number,
  data: FeedItem['event']['data'],
  actors = ['me', 'rival'],
  districts = ['a'],
): FeedItem => ({
  seq: ++n,
  event: { id: `e${String(n)}`, at, kind, actors, districts, data },
});
const round = (at: number, r: number, a: number, d: number) =>
  ev('combat.round', at, {
    round: r,
    attackerStrength: a,
    defenderStrength: d,
    attackerLost: 4,
    defenderLost: 2,
  });

describe('buildReport', () => {
  const feed: FeedItem[] = [
    ev('siege.started', 100, { attacker: 'rival', defender: 'me', crewIds: [] }),
    round(200, 1, 90, 70),
    round(300, 2, 80, 60),
    ev('siege.captured', 400, {
      attacker: 'rival',
      defender: 'me',
      report: {
        startedMs: 100,
        rounds: 2,
        attacker: {
          id: 'rival',
          started: 100,
          lost: 20,
          survivors: [{ crewId: 'x', strength: 5 }],
        },
        defender: { id: 'me', lost: 12 },
        loot: { parts: 30.4, power: 0 },
        buildingsDamaged: [{ building: 'depot', from: 2, to: 1 }],
      },
    }),
    ev('siege.started', 900, { attacker: 'me', defender: 'rival' }),
    round(950, 1, 50, 40),
  ];
  const view = makeView();

  it('builds a captured report from the closing event', () => {
    const r = buildReport(feed, view, 4);
    expect(r).toMatchObject({
      outcome: 'captured',
      attacker: 'rival',
      defender: 'me',
      attackerStart: 100,
      attackerLost: 20,
      defenderLost: 12,
      survivors: 1,
      loot: { parts: 30 },
      buildingsDamaged: 1,
      startedMs: 100,
      endedMs: 400,
    });
    expect(r?.rounds.map((x) => x.attackerStrength)).toEqual([90, 80]);
  });

  it('a clicked combat round finds its own siege and its end', () => {
    expect(buildReport(feed, view, 2)?.outcome).toBe('captured');
    const live = buildReport(feed, view, 6);
    expect(live?.outcome).toBe('ongoing');
    expect(live?.rounds).toHaveLength(1);
    expect(live?.attacker).toBe('me');
  });

  it('refuses other events', () => {
    expect(buildReport(feed, view, 1)).toBeNull();
    expect(hasReport('arrived')).toBe(false);
    expect(hasReport('siege.broken')).toBe(true);
  });

  it('sums losses from rounds when a siege was only broken', () => {
    const f = [
      ev('siege.started', 1, { attacker: 'me', defender: 'rival' }),
      round(2, 1, 9, 9),
      ev('siege.broken', 3, { attacker: 'me', defender: 'rival', reason: 'routed' }),
    ];
    const r = buildReport(f, view, f[2]?.seq ?? 0);
    expect(r).toMatchObject({ outcome: 'broken', attackerLost: 4, defenderLost: 2 });
    expect(r?.summary).toContain('routed');
  });
});

describe('buildDossier', () => {
  it('lists their plots, standing and shared history, newest first', () => {
    const feed: FeedItem[] = [
      ev('trade.filled', 10, { good: 'parts' }),
      ev('siege.captured', 20, { attacker: 'rival', defender: 'me' }),
      ev('arrived', 30, {}, ['me']),
    ];
    const d = buildDossier(makeView(), feed, 'rival');
    expect(d).toMatchObject({ rank: 1, score: 10, stance: 'hostile' });
    expect(d.districts.map((x) => x.id)).toEqual(['b']);
    expect(d.interactions.map((i) => i.text)).toEqual([
      'They captured Alpha Docks.',
      'You traded with them in Alpha Docks.',
    ]);
  });

  it('knows nothing about a stranger', () => {
    const d = buildDossier(makeView(), [], 'ghost');
    expect(d).toMatchObject({ rank: null, stance: 'unknown', districts: [] });
  });
});
