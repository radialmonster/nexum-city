/**
 * Demo data for `/map` when nobody is logged in: a client-side sim world with
 * made-up owners, passed through the sim's own `viewFor` so the demo and the
 * real `GET /api/me` share one shape.
 */
import {
  addPlayer,
  createWorld,
  districtId,
  shortestRoute,
  travelMs,
  viewFor,
  type DistrictView,
  type GameState,
  type Good,
  type Id,
  type Movement,
  type PlayerView,
} from '@nexum/sim';
import { GOOD_ORDER, type MapView } from './scene';

export const DEMO_SELF = 'you';

/**
 * The rival crews of the demo city. Ids sort in the order the map cycles
 * colour roles (raider, turtle, merchant, hunter, rival, newcomer), so each crew
 * gets a different faction colour.
 */
export const DEMO_RIVALS: readonly {
  id: Id;
  name: string;
  fx: number;
  fy: number;
  plots: number;
}[] = [
  { id: 'rival-1', name: 'Vex Syndicate', fx: 0.86, fy: 0.12, plots: 9 },
  { id: 'rival-2', name: 'Iron Choir', fx: 0.1, fy: 0.08, plots: 9 },
  { id: 'rival-3', name: 'Saffron Exchange', fx: 0.88, fy: 0.85, plots: 9 },
  { id: 'rival-4', name: 'Null Pact', fx: 0.1, fy: 0.82, plots: 8 },
  { id: 'rival-5', name: 'Helix', fx: 0.5, fy: 0.02, plots: 7 },
  { id: 'rival-6', name: 'Kestrel Crew', fx: 0.56, fy: 1, plots: 4 },
];

/** Display names for the demo crews. */
export function demoCrewNames(): Record<Id, string> {
  return Object.fromEntries(DEMO_RIVALS.map((r) => [r.id, r.name]));
}

export interface DemoOptions {
  seed?: number;
  /** World size; `large` gives 15 x 9 = 135 plots plus hubs. */
  large?: boolean;
  /** Show every district as visible instead of fogging what the player cannot see (the demo default). */
  reveal?: boolean;
}

/** How many plots across and down for the demo worlds. */
export function demoSize(large: boolean): { cols: number; rows: number } {
  return large ? { cols: 15, rows: 9 } : { cols: 6, rows: 4 };
}

function claim(state: GameState, id: Id, owner: Id): void {
  const d = state.districts[id];
  if (d && d.kind !== 'hub' && d.owner === 'neutral') {
    d.owner = owner;
    d.frontier = 'built';
  }
}

/** Claim a blob of plots around a centre, nearest first. */
function claimNear(state: GameState, owner: Id, cx: number, cy: number, count: number): void {
  const list = Object.values(state.districts)
    .filter((d) => d.kind !== 'hub' && d.owner === 'neutral')
    .sort(
      (a, b) => Math.hypot(a.pos.x - cx, a.pos.y - cy) - Math.hypot(b.pos.x - cx, b.pos.y - cy),
    );
  for (const d of list.slice(0, count)) claim(state, d.id, owner);
}

export function demoState(opts: DemoOptions = {}): GameState {
  const { cols, rows } = demoSize(opts.large === true);
  let state = createWorld(opts.seed ?? 7, { cols, rows });
  const at = (fx: number, fy: number): Id =>
    districtId(Math.round((cols - 1) * fx), Math.round((rows - 2) * fy));
  const crews: [Id, number, number, number][] = [
    [DEMO_SELF, 0.5, 0.55, 12],
    ...DEMO_RIVALS.map<[Id, number, number, number]>((r) => [r.id, r.fx, r.fy, r.plots]),
  ];
  for (const [id, fx, fy] of crews) {
    state = addPlayer(state, { id, districtId: at(fx, fy), protectedHours: 0 });
  }
  const scale = opts.large === true ? 1 : 0.4;
  for (const [id, fx, fy, plots] of crews) {
    const home = state.districts[at(fx, fy)];
    if (home) claimNear(state, id, home.pos.x, home.pos.y, Math.round(plots * scale));
  }
  // a siege on one of the player's plots and a few moving carriers
  const mine = Object.values(state.districts).filter((d) => d.owner === DEMO_SELF);
  const first = mine[0];
  const second = mine[mine.length - 1];
  if (first && second && first.id !== second.id) {
    const r = shortestRoute(state.graph, first.id, second.id);
    if (r) {
      const dur = travelMs(r.lengthM, 'van');
      const m: Movement = {
        id: 'demo-m1',
        owner: DEMO_SELF,
        kind: 'haul',
        carrierId: null,
        carrierKind: 'van',
        crewIds: [],
        cargo: { parts: 0, power: 0, data: 0, supplies: 0 },
        route: r.route,
        lengthM: r.lengthM,
        from: first.id,
        to: second.id,
        departMs: 0,
        arriveMs: dur,
      };
      state.movements[m.id] = m;
    }
  }
  return state;
}

function revealAll(view: PlayerView, state: GameState): PlayerView {
  const districts: Record<Id, DistrictView> = { ...view.districts };
  for (const [id, dv] of Object.entries(view.districts)) {
    if (dv.relation !== 'remembered') continue;
    const d = state.districts[id];
    if (!d) continue;
    districts[id] = {
      relation: 'visible',
      id,
      name: d.name,
      kind: d.kind,
      pos: d.pos,
      owner: d.owner,
      protected: false,
      presence: {},
      siege: null,
    };
  }
  return { ...view, districts };
}

/** The view a demo player sees, with the street graph attached for the map. */
export function demoView(opts: DemoOptions = {}): MapView {
  const state = demoState(opts);
  let player = viewFor(state, DEMO_SELF);
  if (opts.reveal === true) player = revealAll(player, state);
  // loop the carrier forever: the demo has no server clock
  const mine = Object.values(player.movements);
  return {
    player,
    graph: state.graph,
    prices: demoPrices(player),
    crewNames: demoCrewNames(),
    loopMovements: mine.length > 0,
  };
}

/** Stable made-up relative prices (0 to 1) for each hub, so the price bars have something to show. */
export function demoPrices(player: PlayerView): Record<Id, Partial<Record<Good, number>>> {
  const out: Record<Id, Partial<Record<Good, number>>> = {};
  for (const dv of Object.values(player.districts)) {
    if (dv.kind !== 'hub') continue;
    const row: Partial<Record<Good, number>> = {};
    GOOD_ORDER.forEach((g, i) => {
      let h = 17;
      for (const ch of dv.id + g) h = (h * 31 + ch.charCodeAt(0)) % 997;
      row[g] = 0.25 + ((h + i * 131) % 70) / 100;
    });
    out[dv.id] = row;
  }
  return out;
}
