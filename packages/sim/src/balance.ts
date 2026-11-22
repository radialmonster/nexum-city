import type { BuildingType, CarrierKind, Good, Goods } from './types.js';

/**
 * Every tunable number in the simulation lives here (docs/rewrite/sim-spec.md).
 * Quantities in this file are whole units unless the name says otherwise; the
 * state stores them as integer "atoms" (see `ATOMS_PER_UNIT`).
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;

/** A siege bar runs from 0 to this value (1.0 = captured). */
export const PROGRESS_SCALE = 1_000_000;

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
  /** Highest level, when it is lower than `buildings.maxLevel`. */
  readonly maxLevel?: number;
}

export const balance = {
  carriers: {
    foot: { speed: 40, cargo: 5, toughness: 0, seats: 1, locked: false },
    van: { speed: 100, cargo: 40, toughness: 12, seats: 2, locked: false },
    hauler: { speed: 60, cargo: 150, toughness: 25, seats: 2, locked: false },
    runner: { speed: 160, cargo: 16, toughness: 3, seats: 1, locked: false },
  } satisfies Record<CarrierKind, CarrierSpec>,

  /**
   * The Runner (milestone 2, docs/rewrite/sim-spec.md, "Runner carrier"): bought, not given. Vans
   * come with the plot; a Runner is a purchase made with credits.
   */
  runner: {
    credits: 300,
    /** Runners one player may own at once. */
    maxOwned: 2,
    /** The chance, in percent, that a raid strike on a Runner's convoy finds nothing to catch. */
    evadePercent: 35,
  },

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
      // Watchtower: sight 1 + level hops, and the owner is told of ambushes in view (sim-spec, "Watchtower and Garage").
      watchtower: { cost: { parts: 40 }, hours: 3, maxLevel: 2 },
      // Garage: faster carrier repair and a Runner discount at its district.
      garage: { cost: { parts: 50 }, hours: 3, maxLevel: 2 },
    } satisfies Record<BuildingType, BuildingSpec>,
  },

  /** Carrier wear: a gentle upkeep loop that the Garage speeds up (sim-spec, "Watchtower and Garage"). */
  wear: {
    /** Wear added when a carrier finishes a haul or settle trip. */
    perTrip: 2,
    /** Extra wear when a carrier is struck in an ambush (a hit or a repel, not a Runner evade). */
    perStrike: 6,
    max: 100,
    /** Below this wear a carrier runs at full speed. */
    slowFrom: 40,
    /** Percent slower at max wear; the slowdown rises in a straight line from `slowFrom`. */
    slowPercentAtMax: 20,
    /** Minutes to repair one wear point while the carrier is parked at any district. */
    repairMinutes: 90,
    /** Same, with a Garage of level 1 and 2 at that district. */
    garageRepairMinutes: [25, 12],
    /** Percent off the Runner price per Garage level at the district where it is bought. */
    garageRunnerDiscountPercent: 15,
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

  siege: {
    /** Hours for an unopposed-ratio-1 bar (A much greater than D) to fill: base rate is 1/6 per hour. */
    baseHoursToFill: 4,
    /** Defence added to every owned district. */
    militia: 10,
    /** Defence of an unowned plot (task 54: raised from 10 so raiders cannot farm empty land). */
    neutralGuard: 20,
    wallsPercentPerLevel: 30,
    pullbackPercent: 50,
    /** The bar falls by 1/12 per hour with no attackers present. */
    decayHours: 12,
    roundMinutes: 30,
    /** Expected loss per round, as a percent of the other side's strength. */
    lossPercentPerRound: 1.5,
    noisePercent: 20,
    lootPercent: 30,
    /** Loot share when the district was unowned. */
    neutralLootPercent: 10,
    /** Capture rate bonus against the score leader, in percent. */
    leaderBonusPercent: 10,
  },

  season: {
    /** Milestone 1 test season; a normal season is 28 days. */
    lengthHours: 168,
    finaleHours: 48,
    /** Percent of the usual recruit time for players below the median score. */
    belowMedianRecruitPercent: 75,
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

  frontier: {
    /** The city keeps at least this many open plots (or `players / playersPerPlot`, whichever is more). */
    minOpen: 4,
    playersPerPlot: 3,
    /** A new plot is surveyed for this long before it opens. */
    surveyHours: 4,
    /**
     * While any player is in their newcomer rush, a new plot is surveyed this fast instead, so the
     * plot a joiner just left behind is open again before their rush hour is over.
     */
    rushSurveyMinutes: 5,
  },

  /** Settling an open frontier plot without a fight (task 54). */
  settle: {
    /** Supplies the crew carries; spent on arrival, refunded if the trip fails or is recalled. */
    supplies: 60,
    /** Hours between arrival and the plot becoming the settler's district. */
    hours: 10,
  },

  /** Raids and escorts (milestone 2, docs/rewrite/sim-spec.md). */
  raid: {
    /** The longest an ambush may last, in hours. */
    maxHours: 8,
    /** Ambushes (waiting or on their way) one player may run at once. */
    maxActive: 2,
    /** Percent of a convoy's cargo, per good, that winning raiders try to take. */
    stealPercent: 40,
    /** Percent of what is left after the theft that is destroyed in the fight. */
    destroyPercent: 15,
    /** Percent of the raiders' strength lost when they are beaten. */
    raiderLossPercent: 30,
    /** A crew hurt in a raid regains 1 strength every this many hours while it rests at a district, up to its starting strength. */
    mendHours: 1.5,
    /** Percent of the escort's strength lost when the raiders win. */
    escortLossPercent: 10,
    /** Each side's strength is rolled between 100 minus and 100 plus this percent. */
    noisePercent: 20,
    /** The convoy's first crew drives, and counts for this percent as a guard. */
    driverPercent: 50,
    /** A winning ambush with this many units of room left or fewer stands down, full. */
    fullUnits: 1,
    /** A successful raid nudges the hub's reference price for the stolen good up by this percent. */
    priceNudgePercent: 4,
  },

  /** Trade earns score (task 54): only fills against the civic traders or other players count. */
  tradeScore: {
    /** Credits of trade per score point (1 point = 1 district-hour). */
    creditsPerPoint: 100,
    /** The most points a player can earn from trade in one season day. */
    dailyCapPoints: 24,
  },

  /** The contracts board (milestone 2, docs/rewrite/sim-spec.md). */
  contracts: {
    /** Live contracts (open or taken) one hub's board holds. */
    boardCap: 4,
    /** Of those, at most this many are civic, so a slot is always free for players. */
    civicCap: 3,
    /** The city considers posting one contract per hub this often. */
    civicEveryHours: 3,
    /** An offer nobody takes lapses after this many hours. */
    offerHours: 24,
    /** The delivery window, in hours from taking. */
    minHours: 6,
    maxHours: 18,
    /** Civic contract sizes in units, in steps. A van carries 40. */
    civicMinQty: 10,
    civicMaxQty: 40,
    qtyStep: 5,
    /** Player contract size limits, in units. */
    minQty: 5,
    maxQty: 150,
    /** Civic reward is the goods' reference value plus this percent. */
    civicPremiumPercent: 30,
    /** A player's reward must be within this band of the goods' reference value, in percent. */
    minRewardPercent: 50,
    maxRewardPercent: 300,
    /** The taker's deposit, in percent of the reward; refunded on success, lost when late. */
    depositPercent: 10,
    /** Contracts one player may hold taken at once, and may have posted and open at once. */
    maxTaken: 2,
    maxPosted: 2,
    /** A posting is news (a public event) from this reward, in credits; civic ones are rarely notable. */
    notableCredits: 1000,
  },

  /** Completed contracts earn score too, but only a little: a bonus on top of the pay. */
  contractScore: {
    /** Credits of reward per score point (1 point = 1 district-hour). */
    creditsPerPoint: 50,
    /** The most points a player can earn from contracts in one season day. */
    dailyCapPoints: 12,
  },

  market: {
    /** Prices are integers in 1/100 credit. */
    priceScale: 100,
    maxPrice: 100_000,
    maxQty: 1000,
    maxOrdersPerPlayer: 20,
    /** The civic bid and ask sit this many percent below and above the reference. */
    civicSpreadPercent: 8,
    /** Units each civic side will trade per hub and good; refilled hourly up to the cap. */
    civicDepthCap: 60,
    civicRefillPerHour: 20,
    /** After a fill the reference moves 1/this of the way to the fill price. */
    refDriftDivisor: 8,
    /** Each hour the reference moves this percent of the way back to its base. */
    reversionPercent: 5,
    /** The reference never leaves this band around its base, in percent. */
    refMinPercent: 50,
    refMaxPercent: 200,
    /** Starting civic reference prices in centi-credits per unit. */
    baseRefCents: { parts: 1800, power: 1400, data: 2400, supplies: 1000 },
  },

  /**
   * Newcomer rush (docs/rewrite/sim-spec.md, "Newcomer rush and street jobs"): for the first
   * `hours` after joining, builds and settles run `factor` times faster.
   */
  rush: {
    hours: 24,
    factor: 10,
    /** The starter civic contract reserved for a newcomer. */
    starter: { good: 'supplies', qty: 5, premiumPercent: 100, graceMinutes: 20 },
    /** Goods a new home district starts with, exactly one level-1 Workshop (so the first build is not a 30 minute haul away) and 30 supplies, which with the 30 bought at the hub make the 60 a first settle needs. */
    kit: { parts: 30, power: 10, supplies: 30 },
  },

  /** Street jobs: a personal list of quick errands, one new offer every `refillMinutes`. */
  jobs: {
    cap: 3,
    refillMinutes: 30,
    /** A carrier makes the errand this much of the base time (percent). */
    carrierTimePercent: 67,
    /** How long a patrol keeps the streets it walked revealed. */
    patrolRevealMinutes: 60,
    courier: { minMinutes: 4, maxMinutes: 8, minQty: 4, maxQty: 10, minCredits: 6, maxCredits: 12 },
    salvage: { minMinutes: 3, maxMinutes: 6, minParts: 1, maxParts: 2 },
    patrol: { minMinutes: 5, maxMinutes: 10, minCredits: 4, maxCredits: 8 },
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

/** Highest level a building type can reach (Watchtower and Garage stop below the global cap). */
export function maxLevelOf(type: BuildingType): number {
  const spec: BuildingSpec = balance.buildings.specs[type];
  return spec.maxLevel ?? balance.buildings.maxLevel;
}
