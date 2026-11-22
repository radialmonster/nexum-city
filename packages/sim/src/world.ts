import { MS_PER_HOUR, balance, toAtoms } from './balance.js';
import { afterWarehouseChange, emptyGoods } from './production.js';
import { createRng, nextRange, shuffle } from './rng.js';
import { emit, type Ctx } from './ctx.js';
import { observe } from './fog.js';
import { placeCrew } from './travel.js';
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
  /** Season length in hours. Default `balance.season.lengthHours`. */
  seasonHours?: number;
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
  const seasonMs = (options.seasonHours ?? balance.season.lengthHours) * MS_PER_HOUR;

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
    counters: { crew: 0, carrier: 0, movement: 0, event: 0, seq: 1 },
    world: { cols, rows, soundY: rows },
    graph: { nodes, edges },
    districts,
    players: {},
    crews: {},
    carriers: {},
    movements: {},
    reveals: {},
    sieges: {},
    season: {
      startMs: 0,
      endMs: seasonMs,
      finaleStartMs: Math.max(0, seasonMs - balance.season.finaleHours * MS_PER_HOUR),
      finale: false,
      leaderId: null,
      belowMedian: [],
    },
    memory: {},
    // The first hourly score tick; each tick schedules the next.
    queue: [{ at: MS_PER_HOUR, seq: 1, kind: 'score.tick' }],
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
  if (next.season.finale || next.nowMs >= next.season.finaleStartMs)
    throw new Error('the season finale has begun: no new players');
  next.players[opts.id] = {
    id: opts.id,
    credits: toAtoms(opts.credits ?? balance.player.startCredits),
    stash: {},
    score: 0,
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
  observe(ctx);
  return next;
}

/**
 * A fresh plot for a player who lost their last district (ADR 0028): the
 * neutral, unbesieged district farthest from every other player's districts.
 * Their crews and carriers at `from` move there at once and it is protected.
 * Returns `null` when no neutral district is left. Task 1A will improve this.
 */
export function relocatePlayer(ctx: Ctx, playerId: Id, from: District): District | null {
  const { state } = ctx;
  const others = Object.values(state.districts).filter(
    (d) => d.owner !== 'neutral' && d.owner !== playerId,
  );
  let best: District | null = null;
  let bestScore = -1;
  for (const d of Object.values(state.districts)) {
    if (d.kind === 'hub' || d.owner !== 'neutral' || state.sieges[d.id] || d.id === from.id)
      continue;
    let nearest = 99;
    for (const o of others) {
      nearest = Math.min(nearest, Math.abs(o.pos.x - d.pos.x) + Math.abs(o.pos.y - d.pos.y));
    }
    if (nearest > bestScore || (nearest === bestScore && best !== null && d.id < best.id)) {
      best = d;
      bestScore = nearest;
    }
  }
  if (!best) return null;
  best.owner = playerId;
  best.stance = 'hold';
  best.warehouse.supplies += toAtoms(balance.player.startSupplies);
  best.protectedUntilMs = state.nowMs + balance.player.protectedHours * MS_PER_HOUR;
  const here = (loc: Crew['loc']): boolean => 'at' in loc && loc.at === from.id;
  for (const crew of Object.values(state.crews)) {
    if (crew.owner === playerId && here(crew.loc)) {
      from.garrison = from.garrison.filter((id) => id !== crew.id);
      placeCrew(ctx, crew, best.id);
    }
  }
  for (const carrier of Object.values(state.carriers)) {
    if (carrier.owner === playerId && here(carrier.loc)) carrier.loc = { at: best.id };
  }
  afterWarehouseChange(ctx, best);
  emit(ctx, 'player.joined', [playerId], [best.id], { reason: 'relocated' });
  return best;
}
