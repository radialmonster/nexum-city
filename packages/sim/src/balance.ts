import type { BuildingType, CarrierKind, Good, Goods } from './types.js';

/**
 * Every tunable number in the simulation lives here (docs/rewrite/sim-spec.md).
 * Quantities in this file are whole units unless the name says otherwise; the
 * state stores them as integer "atoms" (see `ATOMS_PER_UNIT`).
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;

/**
 * Stock and credits are stored as integers of 1 / ATOMS_PER_UNIT of a unit.
 * 1 unit/hour is exactly 100 atoms/ms, so a rate integrated over any split of
 * a time span gives the same total. That is what makes 2 s ticks and one big
 * jump agree bit for bit.
 */
export const ATOMS_PER_UNIT = 360_000_000;

export interface CarrierSpec {
  /** Metres per minute. */
  readonly speed: number;
  /** Units of cargo. */
  readonly cargo: number;
  readonly toughness: number;
  readonly seats: number;
  /** Locked carriers cannot be used yet (milestone 2). */
  readonly locked: boolean;
}

export interface BuildingSpec {
  /** Goods cost of level 1; level n costs n times this. */
  readonly cost: Readonly<Partial<Record<Good, number>>>;
  /** Hours to build level 1; level n takes n times this. */
  readonly hours: number;
}

export const balance = {
  carriers: {
    foot: { speed: 40, cargo: 5, toughness: 0, seats: 1, locked: false },
    van: { speed: 100, cargo: 40, toughness: 10, seats: 2, locked: false },
    hauler: { speed: 60, cargo: 150, toughness: 25, seats: 2, locked: false },
    runner: { speed: 180, cargo: 15, toughness: 3, seats: 1, locked: true },
  } satisfies Record<CarrierKind, CarrierSpec>,

  production: {
    /** Units per hour of the district's main good. */
    baseUnitsPerHour: 10,
    /** Percent added per Workshop level. */
    workshopBonusPercent: 25,
  },

  warehouse: {
    baseCapacity: 120,
    depotBonusPerLevel: 120,
  },

  buildings: {
    maxLevel: 3,
    slots: 3,
    specs: {
      workshop: { cost: { parts: 30, power: 10 }, hours: 2 },
      depot: { cost: { parts: 40, data: 10 }, hours: 3 },
      walls: { cost: { parts: 50, power: 10 }, hours: 4 },
    } satisfies Record<BuildingType, BuildingSpec>,
  },

  recruit: {
    credits: 150,
    supplies: 20,
    readyMinutes: 30,
    startStrength: 10,
  },

  scout: {
    revealHours: 4,
  },

  world: {
    cols: 6,
    rows: 4,
    /** Street length between neighbouring districts, in metres (15-23 min by Van). */
    edgeMinM: 1500,
    edgeMaxM: 2300,
    /** Kinds shuffled across the non-dock plots (the south row is Docks). */
    kindMix: {
      grid: 4,
      archive: 4,
      farms: 3,
      stacks: 2,
      residential: 5,
    },
  },

  player: {
    startCredits: 500,
    startSupplies: 40,
    startCrews: 2,
    startVans: 1,
    protectedHours: 48,
  },
} as const;

export const EMPTY_GOODS: Readonly<Goods> = Object.freeze({
  parts: 0,
  power: 0,
  data: 0,
  supplies: 0,
});

export function toAtoms(units: number): number {
  return Math.round(units * ATOMS_PER_UNIT);
}

export function toUnits(atoms: number): number {
  return atoms / ATOMS_PER_UNIT;
}
