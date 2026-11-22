import { describe, expect, it } from 'vitest';
import { buildRaidReport, hasRaidReport } from './raidReport';
import { feedItem, makeView } from './testing';

const view = makeView();

describe('buildRaidReport', () => {
  it('only opens for hit and repelled events', () => {
    expect(hasRaidReport('raid.hit')).toBe(true);
    expect(hasRaidReport('raid.repelled')).toBe(true);
    expect(hasRaidReport('raid.set')).toBe(false);
    expect(buildRaidReport([feedItem(1, 'raid.set')], view, 1)).toBeNull();
    expect(buildRaidReport([], view, 1)).toBeNull();
  });

  it('reads a hit from the victim side', () => {
    const feed = [
      feedItem(1, 'raid.hit', {
        districts: ['a', 'b'],
        actors: ['rival', 'me'],
        data: {
          stolen: { parts: 12, power: 0 },
          remaining: { parts: 18 },
          raiderStrength: 5,
          guard: 2,
          escortLost: 1,
        },
      }),
    ];
    const r = buildRaidReport(feed, view, 1);
    expect(r).toMatchObject({
      outcome: 'hit',
      role: 'victim',
      raiderStrength: 5,
      guard: 2,
      stolen: { parts: 12 },
      escortLost: 1,
    });
    expect(r?.street).toBe('Alpha Docks - Beta Stacks');
  });

  it('reads a repelled raid from the raider side', () => {
    const feed = [
      feedItem(2, 'raid.repelled', {
        districts: ['a', 'b'],
        actors: ['me', 'rival'],
        data: { raiderStrength: 3, guard: 6, raiderLost: 2 },
      }),
    ];
    expect(buildRaidReport(feed, view, 2)).toMatchObject({
      outcome: 'repelled',
      role: 'raider',
      raiderLost: 2,
    });
  });
});
