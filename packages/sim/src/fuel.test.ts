import { describe, expect, it } from 'vitest';
import { ATOMS_PER_UNIT, MS_PER_HOUR, balance, toAtoms } from './balance.js';
import { clone, crewsOf, scenario, vanOf } from './fixtures.js';
import { fuelFor, fuelUnitsFor } from './fuel.js';
import { checkInvariants } from './invariants.js';
import { validateOrder } from './orders.js';
import { step } from './step.js';
import type { GameState, Input, OrderError } from './types.js';

const s0 = scenario();
const [c1] = crewsOf(s0, 'p1') as [string];
const van = vanOf(s0, 'p1');
const haul: Input = {
  actorId: 'p1',
  order: { type: 'haul', carrierId: van, crewIds: [c1], to: 'd3_1', cargo: { parts: 30 } },
};
const err = (s: GameState, i: Input = haul): OrderError | null => {
  const v = validateOrder(s, i);
  return v.ok ? null : v.error;
};
const power = (s: GameState): number =>
  Object.values(s.districts)
    .filter((d) => d.owner === 'p1')
    .reduce((n, d) => n + d.warehouse.power, 0);

describe('fuelFor', () => {
  it('is zero on foot and grows with distance for carriers', () => {
    expect(fuelFor('foot', 10_000)).toBe(0);
    expect(fuelFor('van', 0)).toBe(0);
    expect(fuelFor('van', 2_000)).toBeGreaterThan(0);
    expect(fuelFor('van', 4_000)).toBeGreaterThanOrEqual(2 * fuelFor('van', 2_000) - 1);
    expect(fuelFor('hauler', 5_000)).toBeGreaterThan(fuelFor('van', 5_000));
    expect(Number.isInteger(fuelFor('van', 1_234))).toBe(true);
  });
  it('shows whole-and-hundredths units that never undercount the atoms', () => {
    const atoms = fuelFor('van', 12_000);
    expect(fuelUnitsFor('van', 12_000) * ATOMS_PER_UNIT).toBeGreaterThanOrEqual(atoms);
  });
});

describe('fuel on an order', () => {
  it('accepts a van haul that has power and burns it when ordered', () => {
    expect(err(s0)).toBeNull();
    const r = step(s0, [haul], s0.nowMs + 1);
    expect(Object.keys(r.state.movements).length).toBe(1);
    expect(power(r.state)).toBeLessThan(power(s0));
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('refuses a van haul with no power anywhere, with the typed error no_fuel', () => {
    const s = clone(s0);
    for (const d of Object.values(s.districts)) d.warehouse.power = 0;
    expect(err(s)).toBe('no_fuel');
    const r = step(s, [haul], s.nowMs + 1);
    expect(Object.keys(r.state.movements)).toEqual([]);
  });

  it('never refuses a crew on foot, which burns none', () => {
    const s = clone(s0);
    for (const d of Object.values(s.districts)) d.warehouse.power = 0;
    const move: Input = {
      actorId: 'p1',
      order: { type: 'move', carrierId: null, crewIds: [c1], to: 'd3_1' },
    };
    expect(err(s, move)).toBeNull();
  });

  it('draws the rest from the owner’s other warehouses when the start store is short', () => {
    const s = clone(s0);
    const first = s.districts['d2_1'];
    const second = s.districts['d3_1'];
    if (!first || !second) throw new Error('scenario districts missing');
    first.warehouse.power = 0;
    first.warehouseValue.power = 0;
    for (const d of Object.values(s.districts)) if (d.id !== 'd3_1') d.warehouse.power = 0;
    second.warehouse.power = toAtoms(20);
    expect(err(s)).toBeNull();
    const before = power(s);
    const r = step(s, [haul], s.nowMs + 1);
    expect(Object.keys(r.state.movements).length).toBe(1);
    expect(r.state.districts['d3_1']?.warehouse.power).toBeLessThan(second.warehouse.power);
    expect(before - power(r.state)).toBeGreaterThan(0);
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('adds the fuel’s cost to the cargo’s cost basis on arrival', () => {
    const arrived = (milli: number): number => {
      const old = balance.fuel.milliPerKm.van;
      balance.fuel.milliPerKm.van = milli;
      try {
        const s = clone(s0);
        for (const d of Object.values(s.districts)) d.warehouseValue.power = 0;
        const first = s.districts['d2_1'];
        if (first) first.warehouseValue.power = first.warehouse.power * 100;
        const r = step(s, [haul], s.nowMs + 1);
        const end = step(r.state, [], r.state.nowMs + 6 * MS_PER_HOUR).state;
        return end.districts['d3_1']?.warehouseValue.parts ?? 0;
      } finally {
        balance.fuel.milliPerKm.van = old;
      }
    };
    expect(arrived(balance.fuel.milliPerKm.van)).toBeGreaterThan(arrived(0));
  });
});
