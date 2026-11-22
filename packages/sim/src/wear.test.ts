import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, MS_PER_MINUTE, balance, maxLevelOf, toAtoms } from './balance.js';
import { BOTS } from './bots.js';
import { clone, crewsOf, scenario, vanOf } from './fixtures.js';
import { sightOf, towerReach, towerSight, viewFor } from './fog.js';
import { checkInvariants } from './invariants.js';
import { validateOrder } from './orders.js';
import { step } from './step.js';
import { runnerPrice, slowPercentAt, wearOf, wornMs } from './wear.js';
import type { GameState, Id, Order } from './types.js';

const w = balance.wear;

function withBuilding(s: GameState, at: Id, type: 'watchtower' | 'garage', level = 1): GameState {
  const d = s.districts[at];
  if (d) d.buildings.push({ type, level });
  return s;
}

/** p1's van, worn to `wear`, parked at d2_1. */
function wornVan(wear: number, garage = 0): { s: GameState; van: Id } {
  const s = scenario();
  if (garage > 0) withBuilding(s, 'd2_1', 'garage', garage);
  const van = vanOf(s, 'p1');
  const c = s.carriers[van];
  if (c) c.wear = wear;
  return { s, van };
}

const idle = (s: GameState, ms: number): ReturnType<typeof step> => {
  // The repair clock starts when wear is first added, so queue the first check by hand.
  const first = {
    at: s.nowMs + MS_PER_MINUTE,
    seq: 9_999,
    kind: 'carrier.repair' as const,
    carrierId: vanOf(s, 'p1'),
  };
  s.queue = [first, ...s.queue];
  return step(s, [], s.nowMs + ms);
};

describe('wear and slowdown', () => {
  it('is free below the threshold and slows linearly to the cap', () => {
    expect(slowPercentAt(0)).toBe(0);
    expect(slowPercentAt(w.slowFrom)).toBe(0);
    expect(slowPercentAt(w.max)).toBe(w.slowPercentAtMax);
    expect(slowPercentAt(70)).toBe(
      Math.floor(((70 - w.slowFrom) * w.slowPercentAtMax) / (w.max - w.slowFrom)),
    );
    expect(wornMs(1000, w.slowFrom)).toBe(1000);
    expect(wornMs(1000, w.max)).toBe(Math.ceil((1000 * 100) / (100 - w.slowPercentAtMax)));
    expect(wearOf({})).toBe(0);
  });

  it('every finished haul wears the carrier by perTrip and the world stays valid', () => {
    const s = scenario();
    const d = s.districts['d2_1'];
    if (d) d.warehouse.parts = toAtoms(50);
    const van = vanOf(s, 'p1');
    const haul: Order = {
      type: 'haul',
      carrierId: van,
      crewIds: [crewsOf(s, 'p1')[0] as Id],
      to: 'hubW',
      cargo: { parts: 10 },
    };
    let r = step(s, [{ actorId: 'p1', order: haul }], s.nowMs + 1);
    for (let i = 0; i < 200 && Object.keys(r.state.movements).length > 0; i++) {
      r = step(r.state, [], r.state.nowMs + MS_PER_HOUR / 4);
    }
    expect(wearOf(r.state.carriers[van] ?? {})).toBe(w.perTrip);
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('a worn carrier takes longer on the same road', () => {
    const fresh = wornVan(0);
    const worn = wornVan(w.max);
    const go = (x: { s: GameState; van: Id }): number => {
      const r = step(
        x.s,
        [
          {
            actorId: 'p1',
            order: {
              type: 'move',
              carrierId: x.van,
              crewIds: [crewsOf(x.s, 'p1')[0] as Id],
              to: 'd3_1',
            },
          },
        ],
        x.s.nowMs + 1,
      );
      return Object.values(r.state.movements)[0]?.arriveMs ?? 0;
    };
    expect(go(worn)).toBeGreaterThan(go(fresh));
  });

  it('wear above the cap or off the integers breaks an invariant', () => {
    const { s, van } = wornVan(w.max + 1);
    expect(checkInvariants(s).length).toBeGreaterThan(0);
    const c = s.carriers[van];
    if (c) c.wear = 3.5;
    expect(checkInvariants(s).length).toBeGreaterThan(0);
  });
});

describe('repair and the Garage', () => {
  it('heals a parked carrier one point per repair interval and tells the owner at the threshold', () => {
    const { s } = wornVan(w.slowFrom + 1);
    const r = idle(s, w.repairMinutes * MS_PER_MINUTE * 2);
    expect(wearOf(r.state.carriers[vanOf(s, 'p1')] ?? {})).toBeLessThan(w.slowFrom + 1);
    expect(r.events.some((e) => e.kind === 'carrier.repaired')).toBe(true);
  });

  it('a Garage heals faster than none, and level 2 faster than level 1', () => {
    const healed = (g: number): number => {
      const { s, van } = wornVan(60, g);
      const r = idle(s, 6 * MS_PER_HOUR);
      return 60 - wearOf(r.state.carriers[van] ?? {});
    };
    expect(healed(1)).toBeGreaterThan(healed(0));
    expect(healed(2)).toBeGreaterThan(healed(1));
  });

  it('carrier.worn fires once when wear first crosses the threshold', () => {
    const s = scenario();
    const van = vanOf(s, 'p1');
    const c = s.carriers[van];
    if (c) c.wear = w.slowFrom - 1;
    const d = s.districts['d2_1'];
    if (d) d.warehouse.parts = toAtoms(50);
    let r = step(
      s,
      [
        {
          actorId: 'p1',
          order: {
            type: 'haul',
            carrierId: van,
            crewIds: [crewsOf(s, 'p1')[0] as Id],
            to: 'hubW',
            cargo: { parts: 10 },
          },
        },
      ],
      s.nowMs + 1,
    );
    const seen: string[] = [];
    for (let i = 0; i < 200 && Object.keys(r.state.movements).length > 0; i++) {
      r = step(r.state, [], r.state.nowMs + MS_PER_HOUR / 4);
      seen.push(...r.events.map((e) => e.kind));
    }
    expect(seen.filter((k) => k === 'carrier.worn')).toHaveLength(1);
  });

  it('a Garage cheapens Runners per level and only where it stands', () => {
    const s = scenario();
    withBuilding(s, 'd2_1', 'garage', 1);
    const plain = s.districts['d3_1'];
    const garaged = s.districts['d2_1'];
    if (!plain || !garaged) throw new Error('fixture');
    expect(runnerPrice(plain)).toBe(balance.runner.credits);
    expect(runnerPrice(garaged)).toBe(
      Math.floor((balance.runner.credits * (100 - w.garageRunnerDiscountPercent)) / 100),
    );
    const p = s.players['p1'];
    if (p) p.credits = toAtoms(balance.runner.credits);
    const order: Order = { type: 'carrier.buy', districtId: 'd2_1', kind: 'runner' };
    const r = step(s, [{ actorId: 'p1', order }], s.nowMs + 1);
    expect(r.events.find((e) => e.kind === 'carrier.bought')?.data).toMatchObject({
      credits: runnerPrice(garaged),
    });
  });

  it('Watchtower and Garage stop at their own max level', () => {
    expect(maxLevelOf('watchtower')).toBe(2);
    expect(maxLevelOf('garage')).toBe(2);
    const s = scenario();
    withBuilding(s, 'd2_1', 'watchtower', 2);
    const d = s.districts['d2_1'];
    if (d) d.warehouse.parts = toAtoms(500);
    const v = validateOrder(s, {
      actorId: 'p1',
      order: { type: 'build', districtId: 'd2_1', building: 'watchtower' },
    });
    expect(v.ok).toBe(false);
  });
});

describe('Watchtower sight and warnings', () => {
  it('extends sight by one hop per level without touching a tower-less rival', () => {
    const s = scenario();
    const base = sightOf(s, 'p1').size;
    withBuilding(s, 'd2_1', 'watchtower', 1);
    expect(sightOf(s, 'p1').size).toBeGreaterThan(base);
    expect(sightOf(s, 'p2').size).toBe(sightOf(scenario(), 'p2').size);
    const l1 = towerSight(s, 'p1').size;
    withBuilding(s, 'd3_1', 'watchtower', 2);
    expect(towerSight(s, 'p1').size).toBeGreaterThanOrEqual(l1);
    expect(towerReach(s, (d) => d.id === 'd2_1').has('d2_1')).toBe(true);
  });

  it('shows the tower level on the district view', () => {
    const s = scenario();
    withBuilding(s, 'd1_1', 'watchtower', 2);
    const view = viewFor(s, 'p1');
    const d = view.districts['d1_1'];
    expect(d && 'watchtower' in d ? d.watchtower : -1).toBe(2);
  });

  it('turtle bots ignore ambush-free states without crashing and raiders skip tower-watched streets', () => {
    const s = scenario();
    withBuilding(s, 'd2_1', 'watchtower', 1);
    expect(() => BOTS.turtle(clone(s), 'p1')).not.toThrow();
    expect(() => BOTS.raider(clone(s), 'p2')).not.toThrow();
  });
});

describe('raid.spotted', () => {
  /** p1 ambushes the first street of p2's haul; p2 may own a Watchtower. */
  function ambushWith(tower: boolean): string[] {
    const s = scenario();
    const home = s.districts['d0_0'];
    if (home) home.warehouse.parts = toAtoms(100);
    if (tower) withBuilding(s, 'd0_0', 'watchtower', 1);
    const probe = step(
      s,
      [
        {
          actorId: 'p2',
          order: {
            type: 'haul',
            carrierId: vanOf(s, 'p2'),
            crewIds: [crewsOf(s, 'p2')[0] as Id],
            to: 'hubW',
            cargo: { parts: 40 },
          },
        },
      ],
      s.nowMs + 1,
    ).state;
    const m = Object.values(probe.movements).find((x) => x.kind === 'haul');
    const raid: Order = {
      type: 'raid',
      carrierId: vanOf(s, 'p1'),
      crewIds: crewsOf(s, 'p1').slice(0, 2),
      a: m?.route[0] as Id,
      b: m?.route[1] as Id,
      hours: 8,
    };
    let r = step(s, [{ actorId: 'p1', order: raid }], s.nowMs + 1);
    const kinds: string[] = [];
    for (let i = 0; i < 48; i++) {
      r = step(r.state, [], r.state.nowMs + MS_PER_HOUR / 4);
      for (const e of r.events)
        if (e.kind === 'raid.spotted' && e.actors.includes('p2')) kinds.push(e.kind);
    }
    return kinds;
  }

  it('warns a tower owner whose sight covers the ambush, and nobody else', () => {
    expect(ambushWith(true).length).toBeGreaterThan(0);
    expect(ambushWith(false)).toEqual([]);
  });
});
