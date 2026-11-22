import type { DistrictView } from '@nexum/contracts';

type OwnDistrict = Extract<DistrictView, { relation: 'own' }>;
import { describe, expect, it } from 'vitest';
import { ambushesOnRoute, knownAmbushes, myTowers, spottingTower, towerCoverage } from './towers';
import { makeView } from './testing';

function withTower(level: number) {
  const base = makeView();
  const a = base.districts['a'] as OwnDistrict;
  return makeView({
    districts: { ...base.districts, a: { ...a, buildings: [{ type: 'watchtower', level }] } },
    ambushes: [{ id: 'x1', owner: 'rival', edge: ['a', 'b'], untilMs: 2_000_000 }],
  });
}

describe('towers', () => {
  it('lists only your own towered districts', () => {
    expect(myTowers(makeView())).toEqual([]);
    expect(myTowers(withTower(1))).toEqual([{ districtId: 'a', level: 1 }]);
  });

  it('covers 1 + level hops', () => {
    const v = withTower(1);
    expect([...towerCoverage(v, { districtId: 'a', level: 1 })].sort()).toEqual(['a', 'b']);
  });

  it('finds the tower that sees a street and the known ambushes on a route', () => {
    const v = withTower(1);
    expect(spottingTower(v, 'a', 'b')?.districtId).toBe('a');
    expect(knownAmbushes(v)).toHaveLength(1);
    expect(ambushesOnRoute(v, ['a', 'b'], 1_000_000)).toHaveLength(1);
    expect(ambushesOnRoute(v, ['a', 'b'], 3_000_000)).toHaveLength(0);
    expect(ambushesOnRoute(v, ['a'], 1_000_000)).toHaveLength(0);
  });

  it('ignores your own ambushes', () => {
    const v = makeView({ ambushes: [{ id: 'm', owner: 'me', edge: ['a', 'b'], untilMs: 9e9 }] });
    expect(knownAmbushes(v)).toEqual([]);
  });
});
