import { ATOMS_PER_UNIT, balance } from './balance.js';
import { take } from './cost.js';
import { GOODS, type CarrierKind, type Good, type Goods } from './types.js';

/**
 * Fuel (economy plan, stage 4; docs/rewrite/sim-spec.md "Fuel"). A carrier burns power for the
 * street distance of the trip, charged when the trip is ordered. Crews on foot burn none.
 */

/** Power atoms a carrier burns over `distM` metres of street (rounded up; 0 on foot). */
export function fuelFor(kind: CarrierKind, distM: number): number {
  const milli = balance.fuel.milliPerKm[kind];
  if (milli <= 0 || distM <= 0) return 0;
  // units = km x milli/1000 = distM x milli / 1e6, so atoms = distM x milli x ATOMS_PER_UNIT / 1e6.
  return Math.ceil((distM * milli * ATOMS_PER_UNIT) / 1_000_000);
}

/** The same in whole-and-hundredths units of power, for showing to players. */
export function fuelUnitsFor(kind: CarrierKind, distM: number): number {
  return Math.ceil((fuelFor(kind, distM) * 100) / ATOMS_PER_UNIT) / 100;
}

/** Takes `atoms` of power out of a store; returns the cost basis that went with it (centi-credits x atoms). */
export function burnFuel(store: Goods, value: Goods, atoms: number): number {
  const cost = take(store, value, { parts: 0, power: atoms, data: 0, supplies: 0 });
  return cost.power;
}

/** Adds the fuel's cost to the cargo's cost basis, on the good the trip carries most of. */
export function addFuelCost(carried: Goods, cargo: Goods, cost: number): void {
  let best: Good | null = null;
  for (const g of GOODS) if (cargo[g] > 0 && (best === null || cargo[g] > cargo[best])) best = g;
  if (best !== null) carried[best] += cost;
}
