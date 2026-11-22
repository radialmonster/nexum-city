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
  construction: Construction | null;
  /** True while output is being lost to a full warehouse. */
  overflowing: boolean;
  /** Atoms lost since the overflow began. */
  wasted: number;
}

export interface Player {
  id: Id;
  /** Credits in atoms. */
  credits: number;
  /** Goods the player holds at each hub, by hub id. */
  stash: Record<Id, Goods>;
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

export type MovementKind = 'move' | 'haul' | 'scout';

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
}

export type QueuedEvent = { at: number; seq: number } & (
  | { kind: 'arrive'; movementId: Id }
  | { kind: 'build.done'; districtId: Id }
  | { kind: 'production.full'; districtId: Id }
);
export type QueuedKind = QueuedEvent['kind'];

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
  /** Pending scheduled events, sorted by (at, seq). */
  queue: QueuedEvent[];
}

// ---------------------------------------------------------------- orders

export type CargoRequest = Partial<Record<Good, number>>;

export type Order =
  | { type: 'move'; carrierId: Id | null; crewIds: Id[]; to: Id }
  | { type: 'haul'; carrierId: Id | null; crewIds: Id[]; to: Id; cargo: CargoRequest }
  | { type: 'build'; districtId: Id; building: BuildingType }
  | { type: 'scout'; crewId: Id; carrierId: Id | null; target: Id }
  | { type: 'stance'; districtId: Id; stance: Stance }
  | { type: 'recall'; movementId: Id }
  | { type: 'recruit'; districtId: Id };

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
