/** Serializable simulation state, orders and events. Everything here is JSON-safe. */

export type Id = string;
export type Owner = Id | 'neutral';

export const GOODS = ['parts', 'power', 'data', 'supplies'] as const;
export type Good = (typeof GOODS)[number];
/** Goods counts in atoms (see `ATOMS_PER_UNIT`). */
export type Goods = Record<Good, number>;

export const DISTRICT_KINDS = [
  'docks',
  'grid',
  'archive',
  'farms',
  'stacks',
  'residential',
  'hub',
] as const;
export type DistrictKind = (typeof DISTRICT_KINDS)[number];

export const BUILDING_TYPES = ['workshop', 'depot', 'walls'] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export const CARRIER_KINDS = ['foot', 'van', 'hauler', 'runner'] as const;
export type CarrierKind = (typeof CARRIER_KINDS)[number];

export type Stance = 'hold' | 'pullback';
export type FrontierState = 'open' | 'surveying' | 'built';

export type RngState = [number, number, number, number];

export interface Pos {
  x: number;
  y: number;
}

export interface GraphNode {
  id: Id;
  type: 'district' | 'junction';
  pos: Pos;
}

export interface Edge {
  a: Id;
  b: Id;
  /** Street length in metres. */
  lengthM: number;
}

export interface Graph {
  nodes: Record<Id, GraphNode>;
  edges: Edge[];
}

export interface Building {
  type: BuildingType;
  level: number;
}

export interface Construction {
  building: BuildingType;
  /** The level this job will bring the building to. */
  level: number;
  completesAtMs: number;
}

export interface District {
  id: Id;
  name: string;
  kind: DistrictKind;
  pos: Pos;
  owner: Owner;
  /** Crews of the owner currently stationed here. */
  garrison: Id[];
  stance: Stance;
  buildings: Building[];
  slots: number;
  /** Goods in atoms. Capacity is derived: `warehouseCapacity`. */
  warehouse: Goods;
  protectedUntilMs?: number;
  frontier: FrontierState;
  /** Set while a settler holds this open plot and the settle timer runs (task 54). */
  settling?: Settling;
  construction: Construction | null;
  /** True while output is being lost to a full warehouse. */
  overflowing: boolean;
  /** Atoms lost since the overflow began. */
  wasted: number;
}

/** A settler's claim on an open plot: when `completesAtMs` passes unbroken, the plot becomes theirs. */
export interface Settling {
  owner: Id;
  crewIds: Id[];
  startedMs: number;
  completesAtMs: number;
}

export interface Player {
  id: Id;
  /** Credits in atoms. */
  credits: number;
  /** Goods the player holds at each hub, by hub id. */
  stash: Record<Id, Goods>;
  /** Season score in district-milliseconds: 1 point = `MS_PER_HOUR` of one owned district. */
  score: number;
  /** Part of `score` that came from trade, in district-milliseconds. */
  tradeMs: number;
  /** Season day (0-based) the daily trade counter below belongs to. */
  tradeDay: number;
  /** Trade score earned on `tradeDay`, in district-milliseconds (capped per day). */
  tradeDayMs: number;
}

export type UnitLocation = { at: Id } | { movement: Id };

export interface Crew {
  id: Id;
  owner: Id;
  strength: number;
  loc: UnitLocation;
  /** The crew cannot act before this time (recruiting). */
  readyAtMs: number;
}

export interface Carrier {
  id: Id;
  owner: Id;
  kind: Exclude<CarrierKind, 'foot'>;
  loc: UnitLocation;
}

export type MovementKind =
  | 'move'
  | 'haul'
  | 'scout'
  | 'siege'
  | 'reinforce'
  | 'settle'
  /** Crews walking to a street edge to lie in wait (raids, M2). */
  | 'raid'
  /** Crews lying in wait on a street edge. Persistent; the crews are inside it. */
  | 'ambush'
  /** Raiders walking home with the loot. */
  | 'return';

/** The bookkeeping of a raid, carried by its `raid`, `ambush` and `return` movements. */
export interface RaidInfo {
  /** The two ends of the ambushed street (sorted by id). */
  a: Id;
  b: Id;
  /** The end the raiders walk to and wait beside. */
  near: Id;
  /** Where the crews came from and walk back to. */
  home: Id;
  /** How long the ambush lasts once the crews arrive. */
  windowMs: number;
  /** When the ambush ends (0 until the crews have arrived). */
  untilMs: number;
  /** Convoys already hit by this ambush; each is hit at most once. */
  struck: Id[];
}

/** A group of units travelling together along a route. */
export interface Movement {
  id: Id;
  owner: Id;
  kind: MovementKind;
  /** `null` means on foot. */
  carrierId: Id | null;
  carrierKind: CarrierKind;
  crewIds: Id[];
  cargo: Goods;
  route: Id[];
  lengthM: number;
  from: Id;
  /** Where the movement is heading; becomes `from` after a recall. */
  to: Id;
  departMs: number;
  arriveMs: number;
  recalledAtMs?: number;
  /** Fraction of the route covered when it was recalled. */
  recallFraction?: number;
  /** Raids only: the ambush this movement belongs to. */
  raid?: RaidInfo;
  /** Hauls only: the cargo it set out with, in atoms (for conservation checks and reports). */
  sent?: number;
}

export type QueuedEvent = { at: number; seq: number } & (
  | { kind: 'arrive'; movementId: Id }
  | { kind: 'build.done'; districtId: Id }
  | { kind: 'production.full'; districtId: Id }
  | { kind: 'siege.check'; districtId: Id }
  | { kind: 'score.tick' }
  | { kind: 'market.tick' }
  | { kind: 'frontier.survey'; districtId: Id }
  | { kind: 'settle.done'; districtId: Id }
  | { kind: 'raid.end'; movementId: Id }
  | { kind: 'raid.strike'; movementId: Id; targetId: Id }
);
export type QueuedKind = QueuedEvent['kind'];

/** How a siege bar moves between events. Inputs are small integers; see `siege.ts`. */
export type SiegeRate =
  | {
      mode: 'up';
      /** Attacking strength, scaled by 10000 so it compares directly with `d`. */
      a: number;
      /** Defence: (garrison + militia) x walls percent x stance percent. */
      d: number;
      /** Capture-rate percent (100, or 110 against the leader). */
      bonus: number;
    }
  | { mode: 'down' };

/** The single capture bar of a district. Progress is lazy: it is exact at `sinceMs` and the rate holds after. */
export interface Siege {
  districtId: Id;
  attacker: Id;
  /** Attacking crews present at the district. */
  crewIds: Id[];
  /** Bar progress in `PROGRESS_SCALE` units, valid at `sinceMs`. */
  progress: number;
  sinceMs: number;
  rate: SiegeRate;
  /** Highest 10% step already reported (0 to 9). */
  milestone: number;
  /** Next attrition round, or `null` while no attackers are present. */
  roundAtMs: number | null;
  startedMs: number;
  stats: { attackerStart: number; attackerLost: number; defenderLost: number; rounds: number };
}

export type Side = 'buy' | 'sell';

/** A resting player order. Price is in centi-credits per unit; quantity in whole units. */
export interface MarketOrder {
  id: Id;
  owner: Id;
  hub: Id;
  good: Good;
  side: Side;
  price: number;
  /** Units still open. The escrow for them is held by the order. */
  qty: number;
  /** Placement number; breaks price ties (earlier first). */
  seq: number;
}

/** One order book: one hub, one good. The civic traders are virtual and described by `refCents`. */
export interface Book {
  /** Bids, best (highest price) first, then oldest first. */
  bids: MarketOrder[];
  /** Asks, best (lowest price) first, then oldest first. */
  asks: MarketOrder[];
  /** Civic reference price in centi-credits; the civic bid and ask sit either side of it. */
  refCents: number;
  /** Units the civic traders will still buy / sell. Refilled hourly. */
  bidDepth: number;
  askDepth: number;
  /** Price of the latest fill, or `null`. */
  lastCents: number | null;
}

export interface Season {
  startMs: number;
  endMs: number;
  /** The last 48 hours begin here. */
  finaleStartMs: number;
  /** True once the finale has begun (updated hourly). New players cannot join. */
  finale: boolean;
  /** Strict score leader as of the last hourly tick, else `null`. */
  leaderId: Id | null;
  /** Players below the median score as of the last hourly tick. */
  belowMedian: Id[];
}

export interface WorldMeta {
  cols: number;
  rows: number;
  /** Rows at `y >= soundY` are water (the Sound bounds the south). */
  soundY: number;
}

export interface Counters {
  crew: number;
  carrier: number;
  movement: number;
  event: number;
  seq: number;
  /** Last market order number issued. */
  order: number;
}

export interface GameState {
  version: 1;
  seed: number;
  /** Game time in integer milliseconds. */
  nowMs: number;
  rng: RngState;
  counters: Counters;
  world: WorldMeta;
  graph: Graph;
  districts: Record<Id, District>;
  players: Record<Id, Player>;
  crews: Record<Id, Crew>;
  carriers: Record<Id, Carrier>;
  movements: Record<Id, Movement>;
  /** `${playerId}|${districtId}` to the time the scout reveal ends. */
  reveals: Record<string, number>;
  /** Capture bars by district id. */
  sieges: Record<Id, Siege>;
  season: Season;
  /** Order books by hub id, then good. */
  markets: Record<Id, Record<Good, Book>>;
  /** What each player last saw of each district's owner (fog memory). */
  memory: Record<Id, Record<Id, Owner>>;
  /** Pending scheduled events, sorted by (at, seq). */
  queue: QueuedEvent[];
}

// ---------------------------------------------------------------- orders

export type CargoRequest = Partial<Record<Good, number>>;

export type Order =
  | { type: 'move'; carrierId: Id | null; crewIds: Id[]; to: Id }
  | { type: 'haul'; carrierId: Id | null; crewIds: Id[]; to: Id; cargo: CargoRequest }
  | { type: 'build'; districtId: Id; building: BuildingType }
  | { type: 'siege'; carrierId: Id | null; crewIds: Id[]; target: Id }
  | { type: 'reinforce'; carrierId: Id | null; crewIds: Id[]; to: Id }
  | { type: 'settle'; carrierId: Id | null; crewIds: Id[]; target: Id }
  | { type: 'raid'; carrierId: Id | null; crewIds: Id[]; a: Id; b: Id; hours: number }
  | { type: 'scout'; crewId: Id; carrierId: Id | null; target: Id }
  | { type: 'stance'; districtId: Id; stance: Stance }
  | { type: 'recall'; movementId: Id }
  | { type: 'recruit'; districtId: Id }
  | { type: 'market.place'; hub: Id; side: Side; good: Good; price: number; qty: number }
  | { type: 'market.cancel'; orderId: Id };

export type OrderType = Order['type'];

export interface Input {
  actorId: Id;
  order: Order;
  /**
   * Game time to apply the order. Defaults to the state's current time; times
   * in the past are clamped to it. Inputs later than `toMs` are ignored by
   * that `step` call.
   */
  atMs?: number;
}

export const ORDER_ERRORS = [
  'unknown_actor',
  'unknown_crew',
  'unknown_carrier',
  'unknown_district',
  'unknown_movement',
  'not_owner',
  'crew_not_ready',
  'crew_busy',
  'carrier_busy',
  'carrier_locked',
  'not_colocated',
  'no_crew',
  'too_many_crews',
  'duplicate_unit',
  'invalid_target',
  'no_route',
  'empty_cargo',
  'bad_quantity',
  'over_capacity',
  'insufficient_goods',
  'insufficient_credits',
  'slot_unavailable',
  'max_level',
  'already_building',
  'already_recalled',
  'protected',
  'unknown_good',
  'bad_price',
  'unknown_order',
  'too_many_orders',
  'not_open_plot',
  'already_settling',
  'bad_edge',
  'bad_window',
  'too_many_raids',
] as const;
export type OrderError = (typeof ORDER_ERRORS)[number];

export type Validation = { ok: true } | { ok: false; error: OrderError };

// ---------------------------------------------------------------- events

export type SimEventKind =
  | 'arrived'
  | 'siege.started'
  | 'siege.progress'
  | 'siege.captured'
  | 'siege.broken'
  | 'combat.round'
  | 'production.wasted'
  | 'build.done'
  | 'trade.filled'
  | 'player.joined'
  | 'frontier.opened'
  | 'settle.started'
  | 'settle.done'
  | 'settle.failed'
  | 'raid.set'
  | 'raid.hit'
  | 'raid.repelled'
  | 'raid.ended'
  | 'protection.ended'
  | 'score.tick'
  | 'order.rejected';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface SimEvent {
  id: Id;
  at: number;
  kind: SimEventKind;
  actors: Id[];
  districts: Id[];
  data: Record<string, JsonValue>;
}

export interface StepResult {
  state: GameState;
  events: SimEvent[];
}
