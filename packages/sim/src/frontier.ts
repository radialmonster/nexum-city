import { MS_PER_HOUR, balance } from './balance.js';
import { emit, schedule, type Ctx } from './ctx.js';
import { emptyGoods } from './production.js';
import { nextInt, nextRange } from './rng.js';
import type { System } from './systems.js';
import type { District, DistrictKind, GameState, Id } from './types.js';

export function districtId(x: number, y: number): Id {
  return `d${x}_${y}`;
}

/**
 * One axis of a sector name. Non-negative cells count up from 1; cells beyond the
 * original grid (negative coordinates) read as `N1`, `N2`... on the row axis and
 * `W1`, `W2`... on the column axis, so names never contain "--".
 */
function axisLabel(n: number, negativePrefix: 'N' | 'W'): string {
  return n >= 0 ? String(n + 1) : `${negativePrefix}${String(-n)}`;
}

/** The player-facing name of the sector at a grid cell, e.g. `Sector 3-N1`. */
export function sectorName(x: number, y: number): string {
  return `Sector ${axisLabel(x, 'W')}-${axisLabel(y, 'N')}`;
}

export function newDistrict(
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

const NEIGHBOURS = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
] as const;

const cellKey = (x: number, y: number): string => `${x},${y}`;

function cellMap(state: GameState): Map<string, District> {
  const cells = new Map<string, District>();
  for (const d of Object.values(state.districts)) cells.set(cellKey(d.pos.x, d.pos.y), d);
  return cells;
}

const hasStreet = (state: GameState, a: Id, b: Id): boolean =>
  state.graph.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

/** The number of open or surveyed-but-unfinished plots. */
function pendingPlots(state: GameState): { open: number; surveying: number } {
  let open = 0;
  let surveying = 0;
  for (const d of Object.values(state.districts)) {
    if (d.owner !== 'neutral') continue;
    if (d.frontier === 'open' && d.settling) continue;
    if (d.frontier === 'open') open += 1;
    else if (d.frontier === 'surveying') surveying += 1;
  }
  return { open, surveying };
}

/** How many open plots the city wants: `max(4, players / 3)`, rounded up. */
export function wantedOpenPlots(state: GameState): number {
  const players = Object.keys(state.players).length;
  return Math.max(balance.frontier.minOpen, Math.ceil(players / balance.frontier.playersPerPlot));
}

/**
 * The best empty cell for a new plot: next to at least one finished district
 * (so it can be connected), never south of the Sound, and as compact as possible
 * (most occupied neighbours first, then closest to the middle of the city).
 */
function chooseCell(state: GameState): { x: number; y: number } | null {
  const cells = cellMap(state);
  const { cols, rows } = state.world;
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  let best: { x: number; y: number; score: number; dist: number } | null = null;
  const seen = new Set<string>();
  for (const d of Object.values(state.districts)) {
    if (d.kind === 'hub' || d.frontier === 'surveying') continue;
    for (const [dx, dy] of NEIGHBOURS) {
      const x = d.pos.x + dx;
      const y = d.pos.y + dy;
      const key = cellKey(x, y);
      if (seen.has(key) || cells.has(key) || y >= state.world.soundY) continue;
      seen.add(key);
      let score = 0;
      for (const [ax, ay] of NEIGHBOURS) if (cells.has(cellKey(x + ax, y + ay))) score += 1;
      const dist = (x - cx) ** 2 + (y - cy) ** 2;
      const better =
        !best ||
        score > best.score ||
        (score === best.score && dist < best.dist) ||
        (score === best.score &&
          dist === best.dist &&
          (y < best.y || (y === best.y && x < best.x)));
      if (better) best = { x, y, score, dist };
    }
  }
  return best;
}

function pickKind(state: GameState, y: number): DistrictKind {
  if (y === state.world.rows - 1) return 'docks';
  const kinds: DistrictKind[] = [];
  for (const [kind, n] of Object.entries(balance.world.kindMix)) {
    if (kind === 'docks') continue;
    for (let i = 0; i < n; i++) kinds.push(kind as DistrictKind);
  }
  return kinds[nextInt(state.rng, kinds.length)] ?? 'residential';
}

/** Joins a plot to every finished neighbouring district it is not yet connected to. */
function connect(state: GameState, plot: District): void {
  const cells = cellMap(state);
  for (const [dx, dy] of NEIGHBOURS) {
    const other = cells.get(cellKey(plot.pos.x + dx, plot.pos.y + dy));
    if (!other || other.kind === 'hub' || other.frontier === 'surveying') continue;
    if (hasStreet(state, plot.id, other.id)) continue;
    state.graph.edges.push({
      a: plot.id,
      b: other.id,
      lengthM: nextRange(state.rng, balance.world.edgeMinM, balance.world.edgeMaxM),
    });
  }
}

function openPlot(ctx: Ctx, plot: District): void {
  const { state } = ctx;
  plot.frontier = 'open';
  state.graph.nodes[plot.id] = { id: plot.id, type: 'district', pos: plot.pos };
  connect(state, plot);
  emit(ctx, 'frontier.opened', [], [plot.id], { district: plot.id, kind: plot.kind });
}

/**
 * Keeps the frontier stocked: while fewer than `max(4, players / 3)` plots are open
 * or being surveyed, lay out a new plot on the compact edge of the city. A plot is
 * surveyed for a few hours (a `frontier.survey` event) and then opens, with its
 * streets. `instant` opens plots at once (world creation, or when a player needs a
 * plot now and none is open).
 */
export function ensureFrontier(ctx: Ctx, instant = false): void {
  const { state } = ctx;
  const want = wantedOpenPlots(state);
  for (;;) {
    const { open, surveying } = pendingPlots(state);
    if (instant ? open >= want : open + surveying >= want) return;
    const cell = chooseCell(state);
    if (!cell) return;
    const plot = newDistrict(
      districtId(cell.x, cell.y),
      sectorName(cell.x, cell.y),
      pickKind(state, cell.y),
      cell.x,
      cell.y,
      balance.buildings.slots,
    );
    state.districts[plot.id] = plot;
    if (instant) {
      openPlot(ctx, plot);
    } else {
      plot.frontier = 'surveying';
      schedule(ctx, state.nowMs + balance.frontier.surveyHours * MS_PER_HOUR, {
        kind: 'frontier.survey',
        districtId: plot.id,
      });
    }
  }
}

/**
 * Picks an open plot for a newcomer: prefer plots next to at least two neutral
 * districts, then the one farthest from anyone else's districts (ties by id).
 * Opens one at once if none is available.
 */
export function chooseStartPlot(ctx: Ctx, playerId: Id, exclude?: Id): District | null {
  const { state } = ctx;
  const candidates = (): District[] =>
    Object.values(state.districts).filter(
      (d) =>
        d.frontier === 'open' &&
        d.owner === 'neutral' &&
        d.id !== exclude &&
        !d.settling &&
        !state.sieges[d.id],
    );
  let list = candidates();
  if (list.length === 0) {
    // Nothing open: survey and open plots at once.
    ensureFrontier(ctx, true);
    list = candidates();
  }
  if (list.length === 0) return null;

  const others = Object.values(state.districts).filter(
    (d) => d.owner !== 'neutral' && d.owner !== playerId,
  );
  const neutralNeighbours = (d: District): number => {
    let n = 0;
    for (const e of state.graph.edges) {
      const otherId = e.a === d.id ? e.b : e.b === d.id ? e.a : null;
      if (!otherId) continue;
      const o = state.districts[otherId];
      if (o && o.kind !== 'hub' && o.owner === 'neutral') n += 1;
    }
    return n;
  };
  const far = (d: District): number => {
    let nearest = 999;
    for (const o of others) {
      nearest = Math.min(nearest, Math.abs(o.pos.x - d.pos.x) + Math.abs(o.pos.y - d.pos.y));
    }
    return nearest;
  };
  let best: { d: District; ok: boolean; far: number } | null = null;
  for (const d of list) {
    const cand = { d, ok: neutralNeighbours(d) >= 2, far: far(d) };
    if (
      !best ||
      (cand.ok && !best.ok) ||
      (cand.ok === best.ok && cand.far > best.far) ||
      (cand.ok === best.ok && cand.far === best.far && d.id < best.d.id)
    ) {
      best = cand;
    }
  }
  return best?.d ?? null;
}

export const frontierSystem: System = {
  name: 'frontier',
  handlers: {
    'frontier.survey': (ctx, ev) => {
      const plot = ctx.state.districts[ev.districtId];
      if (plot && plot.frontier === 'surveying') openPlot(ctx, plot);
      ensureFrontier(ctx);
    },
  },
};
