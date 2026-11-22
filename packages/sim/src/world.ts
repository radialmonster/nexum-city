import { MS_PER_HOUR, balance, toAtoms } from './balance.js';
import { afterWarehouseChange, emptyGoods } from './production.js';
import { createRng, nextRange, shuffle } from './rng.js';
import type { Ctx } from './ctx.js';
import type {
  Carrier,
  Crew,
  District,
  DistrictKind,
  Edge,
  GameState,
  GraphNode,
  Id,
} from './types.js';

export interface WorldOptions {
  /** Plots per row. Default 6. */
  cols?: number;
  /** Rows of plots. Default 4. */
  rows?: number;
  /** Shortest and longest street between neighbouring districts, in metres. */
  edgeMinM?: number;
  edgeMaxM?: number;
}

export function districtId(x: number, y: number): Id {
  return `d${x}_${y}`;
}

function newDistrict(
  id: Id,
  name: string,
  kind: DistrictKind,
  x: number,
  y: number,
  slots: number,
): District {
  return {
    id,
    name,
    kind,
    pos: { x, y },
    owner: 'neutral',
    garrison: [],
    stance: 'hold',
    buildings: [],
    slots,
    warehouse: emptyGoods(),
    frontier: 'built',
    construction: null,
    overflowing: false,
    wasted: 0,
  };
}

/**
 * Builds a starting city: a grid of districts joined by streets, two hubs on
 * the west and east edges, and the Sound along the south edge. The south row is
 * Docks; the other kinds are shuffled with the seeded RNG. Everything is neutral.
 */
export function createWorld(seed: number, options: WorldOptions = {}): GameState {
  const cols = options.cols ?? balance.world.cols;
  const rows = options.rows ?? balance.world.rows;
  const edgeMin = options.edgeMinM ?? balance.world.edgeMinM;
  const edgeMax = options.edgeMaxM ?? balance.world.edgeMaxM;
  const rng = createRng(seed);

  const mix: DistrictKind[] = [];
  for (const [kind, n] of Object.entries(balance.world.kindMix)) {
    for (let i = 0; i < n; i++) mix.push(kind as DistrictKind);
  }
  shuffle(rng, mix);
  let mixIndex = 0;

  const districts: Record<Id, District> = {};
  const nodes: Record<Id, GraphNode> = {};
  const addNode = (d: District): void => {
    districts[d.id] = d;
    nodes[d.id] = { id: d.id, type: 'district', pos: d.pos };
  };

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // Once the shuffled mix runs out (bigger grids), cycle through it.
      const kind: DistrictKind =
        y === rows - 1 ? 'docks' : (mix[mixIndex++ % mix.length] ?? 'residential');
      addNode(
        newDistrict(
          districtId(x, y),
          `Sector ${x + 1}-${y + 1}`,
          kind,
          x,
          y,
          balance.buildings.slots,
        ),
      );
    }
  }

  const hubY = Math.floor((rows - 1) / 2);
  addNode(newDistrict('hubW', 'West Hub', 'hub', -1, hubY, 0));
  addNode(newDistrict('hubE', 'East Hub', 'hub', cols, Math.min(rows - 1, hubY + 1), 0));

  const edges: Edge[] = [];
  const street = (a: Id, b: Id): void => {
    edges.push({ a, b, lengthM: nextRange(rng, edgeMin, edgeMax) });
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (x + 1 < cols) street(districtId(x, y), districtId(x + 1, y));
      if (y + 1 < rows) street(districtId(x, y), districtId(x, y + 1));
    }
  }
  const eastY = Math.min(rows - 1, hubY + 1);
  street('hubW', districtId(0, hubY));
  if (hubY + 1 < rows) street('hubW', districtId(0, hubY + 1));
  street('hubE', districtId(cols - 1, eastY));
  if (eastY - 1 >= 0) street('hubE', districtId(cols - 1, eastY - 1));

  return {
    version: 1,
    seed,
    nowMs: 0,
    rng,
    counters: { crew: 0, carrier: 0, movement: 0, event: 0, seq: 0 },
    world: { cols, rows, soundY: rows },
    graph: { nodes, edges },
    districts,
    players: {},
    crews: {},
    carriers: {},
    movements: {},
    reveals: {},
    queue: [],
  };
}

export interface AddPlayerOptions {
  id: Id;
  /** The district the player starts in; it becomes theirs. */
  districtId: Id;
  credits?: number;
  supplies?: number;
  crews?: number;
  vans?: number;
  /** Hours of protection from the current time. */
  protectedHours?: number;
}

/**
 * Bootstraps a player with a district, crews, vans, credits and supplies.
 * Returns a new state. This is a minimal setup helper; new-player placement
 * on the frontier (task 1A) will build on it.
 */
export function addPlayer(state: GameState, opts: AddPlayerOptions): GameState {
  const next = JSON.parse(JSON.stringify(state)) as GameState;
  const d = next.districts[opts.districtId];
  if (!d) throw new Error(`unknown district ${opts.districtId}`);
  if (d.kind === 'hub') throw new Error('hubs are never owned');
  if (next.players[opts.id]) throw new Error(`player ${opts.id} already exists`);
  next.players[opts.id] = {
    id: opts.id,
    credits: toAtoms(opts.credits ?? balance.player.startCredits),
    stash: {},
  };
  d.owner = opts.id;
  d.warehouse.supplies += toAtoms(opts.supplies ?? balance.player.startSupplies);
  const hours = opts.protectedHours ?? balance.player.protectedHours;
  if (hours > 0) d.protectedUntilMs = next.nowMs + hours * MS_PER_HOUR;
  for (let i = 0; i < (opts.crews ?? balance.player.startCrews); i++) {
    next.counters.crew += 1;
    const crew: Crew = {
      id: `c${next.counters.crew}`,
      owner: opts.id,
      strength: balance.recruit.startStrength,
      loc: { at: d.id },
      readyAtMs: next.nowMs,
    };
    next.crews[crew.id] = crew;
    d.garrison.push(crew.id);
  }
  for (let i = 0; i < (opts.vans ?? balance.player.startVans); i++) {
    next.counters.carrier += 1;
    const van: Carrier = {
      id: `v${next.counters.carrier}`,
      owner: opts.id,
      kind: 'van',
      loc: { at: d.id },
    };
    next.carriers[van.id] = van;
  }
  // Production and warehouse state depend on ownership; schedule the first overflow check.
  const ctx: Ctx = { state: next, events: [] };
  afterWarehouseChange(ctx, d);
  return next;
}
