import { MS_PER_HOUR, balance, toAtoms } from './balance.js';
import { afterWarehouseChange } from './production.js';
import { createRng, nextRange, shuffle } from './rng.js';
import { emit, type Ctx } from './ctx.js';
import {
  chooseStartPlot,
  districtId,
  ensureFrontier,
  newDistrict,
  sectorName,
} from './frontier.js';
import { newHubBooks } from './market.js';
import { postStarterContract } from './contracts.js';
import { observe } from './fog.js';
import { startNewcomer } from './jobs.js';
import { rushEndsAt } from './rush.js';
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
  SimEvent,
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
  /** Game time the world starts at (ms). The season and the first ticks are measured from here. Default 0. */
  startMs?: number;
}

export { districtId };

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
  const startMs = options.startMs ?? 0;

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
      addNode(newDistrict(districtId(x, y), sectorName(x, y), kind, x, y, balance.buildings.slots));
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

  const state: GameState = {
    version: 1,
    seed,
    nowMs: startMs,
    rng,
    counters: { crew: 0, carrier: 0, movement: 0, event: 0, seq: 3, order: 0, contract: 0, job: 0 },
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
      startMs,
      endMs: startMs + seasonMs,
      finaleStartMs: startMs + Math.max(0, seasonMs - balance.season.finaleHours * MS_PER_HOUR),
      finale: false,
      leaderId: null,
      belowMedian: [],
    },
    markets: { hubW: newHubBooks(), hubE: newHubBooks() },
    contracts: {},
    memory: {},
    // The first hourly score and market ticks; each tick schedules the next.
    queue: [
      { at: startMs + MS_PER_HOUR, seq: 1, kind: 'score.tick' },
      { at: startMs + MS_PER_HOUR, seq: 2, kind: 'market.tick' },
      {
        at: startMs + balance.contracts.civicEveryHours * MS_PER_HOUR,
        seq: 3,
        kind: 'contract.civic',
      },
    ],
  };
  // The first open plots along the edge. Their events are not part of the game's history.
  ensureFrontier({ state, events: [] }, true);
  state.counters.event = 0;
  return state;
}

export interface AddPlayerOptions {
  id: Id;
  /**
   * The district the player starts in; it becomes theirs. Leave it out to claim a
   * frontier plot: one next to at least two neutral districts, as far as possible
   * from the districts other players own.
   */
  districtId?: Id;
  credits?: number;
  supplies?: number;
  crews?: number;
  vans?: number;
  /** Hours of protection from the current time. */
  protectedHours?: number;
}

/**
 * Bootstraps a player with a district, crews, vans, credits and supplies, then
 * restocks the frontier. Returns the new state and the events (`player.joined`,
 * and `frontier.opened` if a plot had to be opened at once).
 */
export function addPlayerWithEvents(
  state: GameState,
  opts: AddPlayerOptions,
): { state: GameState; events: SimEvent[]; districtId: Id } {
  const next = JSON.parse(JSON.stringify(state)) as GameState;
  if (next.players[opts.id]) throw new Error(`player ${opts.id} already exists`);
  if (next.season.finale || next.nowMs >= next.season.finaleStartMs)
    throw new Error('the season finale has begun: no new players');
  const ctx: Ctx = { state: next, events: [] };
  const d = opts.districtId ? next.districts[opts.districtId] : chooseStartPlot(ctx, opts.id);
  if (!d)
    throw new Error(opts.districtId ? `unknown district ${opts.districtId}` : 'no plot is free');
  if (d.kind === 'hub') throw new Error('hubs are never owned');
  next.players[opts.id] = {
    id: opts.id,
    credits: toAtoms(opts.credits ?? balance.player.startCredits),
    stash: {},
    score: 0,
    tradeMs: 0,
    tradeDay: 0,
    tradeDayMs: 0,
    contractMs: 0,
    contractDay: 0,
    contractDayMs: 0,
    rushUntilMs: rushEndsAt(next.nowMs),
    jobs: [],
    jobNextMs: 0,
  };
  d.owner = opts.id;
  d.frontier = 'built';
  d.warehouse.supplies += toAtoms(opts.supplies ?? balance.player.startSupplies);
  d.warehouse.parts += toAtoms(balance.rush.kit.parts);
  d.warehouse.power += toAtoms(balance.rush.kit.power);
  d.warehouse.supplies += toAtoms(balance.rush.kit.supplies);
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
  afterWarehouseChange(ctx, d);
  emit(ctx, 'player.joined', [opts.id], [d.id], { reason: 'new' });
  startNewcomer(ctx, opts.id);
  postStarterContract(ctx, opts.id, d.id);
  ensureFrontier(ctx);
  observe(ctx);
  return { state: next, events: ctx.events, districtId: d.id };
}

/** Like `addPlayerWithEvents`, returning only the new state. */
export function addPlayer(state: GameState, opts: AddPlayerOptions): GameState {
  return addPlayerWithEvents(state, opts).state;
}

/**
 * A fresh plot for a player who lost their last district (ADR 0028): a frontier
 * plot chosen like a newcomer's, never the district just lost. Their crews and
 * carriers at `from` move there at once and it is protected. Returns `null` only
 * if no plot can be laid out.
 */
export function relocatePlayer(ctx: Ctx, playerId: Id, from: District): District | null {
  const { state } = ctx;
  const best = chooseStartPlot(ctx, playerId, from.id);
  if (!best) return null;
  best.owner = playerId;
  best.frontier = 'built';
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
  ensureFrontier(ctx);
  return best;
}
