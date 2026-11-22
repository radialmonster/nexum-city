import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, MS_PER_MINUTE, balance, toAtoms, toUnits } from './balance.js';
import { buildCost, buildDurationMs } from './construction.js';
import { clone, crewsOf, scenario, vanOf } from './fixtures.js';
import { hashState } from './hash.js';
import { checkInvariants } from './invariants.js';
import { productionPerHour, totalGoods, warehouseCapacity } from './production.js';
import { eta } from './routing.js';
import { step } from './step.js';
import type { GameState, Input, SimEvent } from './types.js';

const s0 = scenario();
const [c1, c2] = crewsOf(s0, 'p1') as [string, string];
const van = vanOf(s0, 'p1');
const input = (order: Input['order'], atMs?: number): Input =>
  atMs === undefined ? { actorId: 'p1', order } : { actorId: 'p1', order, atMs };
const get = (s: GameState, id: string) => {
  const d = s.districts[id];
  if (!d) throw new Error(`no district ${id}`);
  return d;
};

describe('step', () => {
  it('is pure: the input state is never mutated', () => {
    const before = hashState(s0);
    step(s0, [input({ type: 'recruit', districtId: 'd2_1' })], MS_PER_HOUR);
    expect(hashState(s0)).toBe(before);
  });
  it('refuses to go backwards or to fractional times', () => {
    expect(() => step(s0, [], -1)).toThrow(RangeError);
    expect(() => step(s0, [], 1.5)).toThrow(RangeError);
  });
  it('ignores inputs scheduled after the target time', () => {
    const { state } = step(s0, [input({ type: 'recruit', districtId: 'd2_1' }, 5000)], 1000);
    expect(Object.keys(state.crews)).toHaveLength(Object.keys(s0.crews).length);
  });
});

describe('production and warehouses', () => {
  it('produces the main good at the base rate', () => {
    const { state } = step(s0, [], 2 * MS_PER_HOUR);
    const before = get(s0, 'd3_1').warehouse.power;
    expect(toUnits(get(state, 'd3_1').warehouse.power - before)).toBe(
      2 * balance.production.baseUnitsPerHour,
    );
    expect(state.nowMs).toBe(2 * MS_PER_HOUR);
  });
  it('credits from Residential go to the player, not the warehouse', () => {
    const s = clone(s0);
    get(s, 'd3_1').kind = 'residential';
    const { state } = step(s, [], MS_PER_HOUR);
    const p0 = s.players['p1']?.credits ?? 0;
    expect(toUnits((state.players['p1']?.credits ?? 0) - p0)).toBe(
      balance.production.baseUnitsPerHour,
    );
  });
  it('applies Workshop and Depot bonuses', () => {
    const d = clone(get(s0, 'd3_1'));
    expect(productionPerHour(d)).toBe(10);
    d.buildings.push({ type: 'workshop', level: 2 });
    expect(productionPerHour(d)).toBe(15);
    expect(warehouseCapacity(d)).toBe(toAtoms(120));
    d.buildings.push({ type: 'depot', level: 1 });
    expect(warehouseCapacity(d)).toBe(toAtoms(240));
  });
  it('emits production.wasted when overflow starts and ends, never exceeding capacity', () => {
    const { state, events } = step(
      s0,
      [input({ type: 'recruit', districtId: 'd2_1' }, 4 * MS_PER_HOUR)],
      5 * MS_PER_HOUR,
    );
    const wasted = events.filter(
      (e) => e.kind === 'production.wasted' && e.districts[0] === 'd2_1',
    );
    expect(wasted).toHaveLength(2);
    expect(wasted[0]?.at).toBe(2 * MS_PER_HOUR);
    expect(wasted[0]?.data['ongoing']).toBe(true);
    expect(wasted[1]?.at).toBe(4 * MS_PER_HOUR);
    expect(wasted[1]?.data['amount']).toBe(20);
    expect(totalGoods(get(state, 'd2_1').warehouse)).toBeLessThanOrEqual(
      warehouseCapacity(get(state, 'd2_1')),
    );
  });
});

describe('travel', () => {
  it('moves a crew on foot and arrives exactly at the ETA', () => {
    const d = eta(s0.graph, 'd2_1', 'd3_1', 'foot');
    expect(d).not.toBeNull();
    const dur = d?.durationMs ?? 0;
    const go = input({ type: 'move', carrierId: null, crewIds: [c1], to: 'd3_1' });
    const mid = step(s0, [go], dur - 1);
    expect(mid.state.crews[c1]?.loc).toHaveProperty('movement');
    expect(checkInvariants(mid.state)).toEqual([]);
    const end = step(mid.state, [], dur);
    expect(end.state.crews[c1]?.loc).toEqual({ at: 'd3_1' });
    expect(get(end.state, 'd3_1').garrison).toContain(c1);
    expect(get(end.state, 'd2_1').garrison).not.toContain(c1);
    const arrived = end.events.find((e) => e.kind === 'arrived');
    expect(arrived?.at).toBe(dur);
  });
  it('a van is faster than walking', () => {
    const foot = eta(s0.graph, 'd2_1', 'd3_1', 'foot')?.durationMs ?? 0;
    const byVan = eta(s0.graph, 'd2_1', 'd3_1', 'van')?.durationMs ?? 0;
    expect(byVan).toBeLessThan(foot);
    expect(byVan).toBeGreaterThanOrEqual(15 * MS_PER_MINUTE);
  });
  it('hauls cargo, deducting at departure and depositing on arrival', () => {
    const haul = input({
      type: 'haul',
      carrierId: van,
      crewIds: [c1],
      to: 'd3_1',
      cargo: { parts: 30 },
    });
    const dur = eta(s0.graph, 'd2_1', 'd3_1', 'van')?.durationMs ?? 0;
    const mid = step(s0, [haul], 1000);
    expect(toUnits(get(mid.state, 'd2_1').warehouse.parts)).toBeLessThan(40);
    const end = step(mid.state, [], dur);
    expect(toUnits(get(end.state, 'd3_1').warehouse.parts)).toBe(30);
    expect(end.state.carriers[van]?.loc).toEqual({ at: 'd3_1' });
    expect(Object.keys(end.state.movements)).toHaveLength(0);
  });
  it('recall turns a movement around and returns the cargo home', () => {
    const haul = input({
      type: 'haul',
      carrierId: van,
      crewIds: [c1],
      to: 'd3_1',
      cargo: { parts: 30 },
    });
    const first = step(s0, [haul], 1000);
    const mid = step(first.state, [], 5 * MS_PER_MINUTE);
    const mId = Object.keys(mid.state.movements)[0] ?? '';
    const recalled = step(
      mid.state,
      [input({ type: 'recall', movementId: mId })],
      6 * MS_PER_MINUTE,
    );
    expect(checkInvariants(recalled.state)).toEqual([]);
    const home = step(recalled.state, [], 2 * MS_PER_HOUR);
    expect(home.state.crews[c1]?.loc).toEqual({ at: 'd2_1' });
    expect(toUnits(get(home.state, 'd2_1').warehouse.parts)).toBeGreaterThanOrEqual(40);
    expect(Object.keys(home.state.movements)).toHaveLength(0);
  });
  it('scouting reveals the target for a while', () => {
    const target = 'd3_0';
    const go = input({ type: 'scout', crewId: c1, carrierId: null, target });
    const dur = eta(s0.graph, 'd2_1', target, 'foot')?.durationMs ?? 0;
    const { state } = step(s0, [go], dur + 1000);
    expect(state.reveals[`p1|${target}`]).toBeGreaterThan(state.nowMs);
  });
});

describe('construction', () => {
  it('builds a Workshop, taking goods now and finishing later', () => {
    const cost = buildCost('workshop', 1);
    const build = input({ type: 'build', districtId: 'd2_1', building: 'workshop' });
    const mid = step(s0, [build], 1000);
    expect(get(mid.state, 'd2_1').construction).not.toBeNull();
    expect(get(mid.state, 'd2_1').warehouse.parts).toBeLessThanOrEqual(
      get(s0, 'd2_1').warehouse.parts - cost.parts + toAtoms(0.01),
    );
    const end = step(mid.state, [], 1000 + buildDurationMs('workshop', 1));
    expect(get(end.state, 'd2_1').construction).toBeNull();
    expect(get(end.state, 'd2_1').buildings).toEqual([{ type: 'workshop', level: 1 }]);
    expect(end.events.some((e) => e.kind === 'build.done')).toBe(true);
    expect(productionPerHour(get(end.state, 'd2_1'))).toBe(12.5);
  });
});

describe('scenario: recruit, move, haul, build, production rises', () => {
  it('plays out end to end', () => {
    // Hour 0: recruit, send a crew with a van hauling Workshop materials next door.
    const cost = buildCost('workshop', 1);
    const t0 = step(
      s0,
      [
        input({ type: 'recruit', districtId: 'd2_1' }),
        input({
          type: 'haul',
          carrierId: van,
          crewIds: [c1],
          to: 'd3_1',
          cargo: { parts: toUnits(cost.parts), power: toUnits(cost.power) },
        }),
        input({ type: 'move', carrierId: null, crewIds: [c2], to: 'd3_1' }),
      ],
      MS_PER_HOUR,
    );
    expect(Object.keys(t0.state.crews)).toHaveLength(Object.keys(s0.crews).length + 1);
    expect(checkInvariants(t0.state)).toEqual([]);

    // Hour 2: everything has arrived; start the Workshop in d3_1.
    const t1 = step(t0.state, [], 2 * MS_PER_HOUR);
    expect(t1.state.crews[c2]?.loc).toEqual({ at: 'd3_1' });
    expect(t1.state.carriers[van]?.loc).toEqual({ at: 'd3_1' });
    const rateBefore = productionPerHour(get(t1.state, 'd3_1'));
    const t2 = step(
      t1.state,
      [input({ type: 'build', districtId: 'd3_1', building: 'workshop' })],
      2 * MS_PER_HOUR + 1000,
    );
    const t3 = step(t2.state, [], 6 * MS_PER_HOUR);
    expect(get(t3.state, 'd3_1').buildings).toEqual([{ type: 'workshop', level: 1 }]);
    expect(productionPerHour(get(t3.state, 'd3_1'))).toBeGreaterThan(rateBefore);

    // After the build, power accrues faster than before.
    const t4 = step(t3.state, [], 7 * MS_PER_HOUR);
    const gain = toUnits(
      get(t4.state, 'd3_1').warehouse.power - get(t3.state, 'd3_1').warehouse.power,
    );
    expect(gain).toBe(12.5);
    expect(checkInvariants(t4.state)).toEqual([]);
  });
});

describe('determinism', () => {
  const T = 6 * MS_PER_HOUR;
  const TICK = 2000;
  const orders: Input[] = [
    input({ type: 'recruit', districtId: 'd2_1' }, 10 * TICK),
    input(
      { type: 'haul', carrierId: van, crewIds: [c1], to: 'd3_1', cargo: { parts: 30, power: 10 } },
      20 * TICK,
    ),
    input({ type: 'move', carrierId: null, crewIds: [c2], to: 'd3_1' }, 30 * TICK),
    input({ type: 'build', districtId: 'd2_1', building: 'depot' }, 900 * TICK),
    input({ type: 'build', districtId: 'd3_1', building: 'workshop' }, 2000 * TICK),
    input({ type: 'stance', districtId: 'd3_1', stance: 'pullback' }, 2100 * TICK),
  ];

  it('gives the same hash and events for 2 s ticks and one 6 h jump', () => {
    let ticked = s0;
    const tickEvents: SimEvent[] = [];
    for (let t = TICK; t <= T; t += TICK) {
      const due = orders.filter((o) => (o.atMs ?? 0) > t - TICK && (o.atMs ?? 0) <= t);
      const r = step(ticked, due, t);
      ticked = r.state;
      tickEvents.push(...r.events);
    }
    const jump = step(s0, orders, T);
    expect(hashState(ticked)).toBe(hashState(jump.state));
    expect(tickEvents).toEqual(jump.events);
    expect(checkInvariants(jump.state)).toEqual([]);
    expect(jump.events.some((e) => e.kind === 'build.done')).toBe(true);
  });
  it('is repeatable: the same run twice gives the same hash', () => {
    expect(hashState(step(s0, orders, T).state)).toBe(hashState(step(s0, orders, T).state));
  });
  it('arbitrary chunk sizes agree too', () => {
    let s = s0;
    for (const t of [777, 123_457, 3_600_001, 9_999_999, T]) {
      s = step(
        s,
        orders.filter((o) => (o.atMs ?? 0) <= t && (o.atMs ?? 0) > s.nowMs),
        t,
      ).state;
    }
    expect(hashState(s)).toBe(hashState(step(s0, orders, T).state));
  });
});

describe('invariants', () => {
  it('hold across a long busy run, checked every simulated 10 minutes', () => {
    let s = s0;
    const orders: Input[] = [
      input({ type: 'haul', carrierId: van, crewIds: [c1], to: 'd3_1', cargo: { parts: 40 } }),
      input({ type: 'move', carrierId: null, crewIds: [c2], to: 'd3_1' }),
      input({ type: 'recruit', districtId: 'd2_1' }),
    ];
    s = step(s, orders, 1).state;
    for (let t = 10 * MS_PER_MINUTE; t <= 12 * MS_PER_HOUR; t += 10 * MS_PER_MINUTE) {
      const fresh: Input[] = [];
      if (t === 2 * MS_PER_HOUR) {
        fresh.push(input({ type: 'move', carrierId: van, crewIds: [c2], to: 'd2_1' }));
      }
      s = step(s, fresh, t).state;
      expect(checkInvariants(s)).toEqual([]);
    }
  });
});
