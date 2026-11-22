import { PROGRESS_SCALE } from './balance.js';
import { costCents, emptyValue } from './cost.js';
import type { Ctx } from './ctx.js';
import { civicAsk, civicBid } from './market.js';
import { movementPosition, movementSegment } from './routing.js';
import { progressAt } from './siege.js';
import {
  GOODS,
  type BaseWhy,
  type Building,
  type Carrier,
  type Contract,
  type Construction,
  type Crew,
  type District,
  type Edge,
  type GraphNode,
  type FrontierState,
  type GameState,
  type Good,
  type Goods,
  type Id,
  type JobOffer,
  type MarketOrder,
  type Movement,
  type Owner,
  type Player,
  type Pos,
  type Season,
  type Stance,
} from './types.js';

/** Extra street hops of sight per level of a Watchtower. */
const WATCHTOWER = 'watchtower';

function neighbours(edges: readonly Edge[]): Map<Id, Id[]> {
  const out = new Map<Id, Id[]>();
  for (const e of edges) {
    (out.get(e.a) ?? out.set(e.a, []).get(e.a))?.push(e.b);
    (out.get(e.b) ?? out.set(e.b, []).get(e.b))?.push(e.a);
  }
  return out;
}

/** The street nodes a movement is seen on: both ends of the street for an ambush. */
function endsOf(state: GameState, m: Movement): Id[] {
  if (m.kind === 'ambush' && m.raid) return [m.raid.a, m.raid.b];
  return movementSegment(state.graph, m, state.nowMs);
}

function watchtowerLevel(buildings: readonly Building[]): number {
  return buildings.find((b) => b.type === WATCHTOWER)?.level ?? 0;
}

/**
 * The districts a player's Watchtowers cover: each tower sees `1 + level` hops around it. A pure
 * function of the state, used to tell tower owners about ambushes (`raid.spotted`).
 */
export function towerSight(state: GameState, playerId: Id): Set<Id> {
  return towerReach(state, (d) => d.owner === playerId);
}

/** Same as `towerSight`, for any set of tower districts chosen by `keep` (bots use it on visible rivals). */
export function towerReach(state: GameState, keep: (d: District) => boolean): Set<Id> {
  const adj = neighbours(state.graph.edges);
  const seen = new Set<Id>();
  for (const d of Object.values(state.districts)) {
    const level = d.kind !== 'hub' && keep(d) ? watchtowerLevel(d.buildings) : 0;
    if (level === 0) continue;
    let frontier = [d.id];
    seen.add(d.id);
    for (let i = 0; i <= level; i++) {
      const next: Id[] = [];
      for (const id of frontier) {
        for (const n of adj.get(id) ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
  }
  return seen;
}

/**
 * The districts a player can see right now: their own, everything one street
 * hop from their districts and crews (more with a Watchtower), the two ends of
 * the street any of their convoys is on, districts a scout has revealed, and
 * the hubs. Pure function of the state.
 */
export function sightOf(state: GameState, playerId: Id): Set<Id> {
  const adj = neighbours(state.graph.edges);
  const seen = new Set<Id>();
  const spread = (from: Id, hops: number): void => {
    let frontier = [from];
    seen.add(from);
    for (let i = 0; i < hops; i++) {
      const next: Id[] = [];
      for (const id of frontier) {
        for (const n of adj.get(id) ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
  };
  for (const d of Object.values(state.districts)) {
    if (d.kind === 'hub') seen.add(d.id);
    else if (d.owner === playerId) spread(d.id, 1 + watchtowerLevel(d.buildings));
  }
  for (const crew of Object.values(state.crews)) {
    if (crew.owner !== playerId) continue;
    if ('at' in crew.loc) spread(crew.loc.at, 1);
    else {
      const m = state.movements[crew.loc.movement];
      if (m) for (const id of endsOf(state, m)) seen.add(id);
    }
  }
  for (const m of Object.values(state.movements)) {
    if (m.owner !== playerId) continue;
    for (const id of endsOf(state, m)) seen.add(id);
  }
  for (const [key, until] of Object.entries(state.reveals)) {
    const [who, where] = key.split('|');
    if (who === playerId && where !== undefined && until > state.nowMs) seen.add(where);
  }
  return seen;
}

/**
 * Updates what each player remembers of each district's owner. Called by
 * `step` after every event and order (never at the end of a step), so the
 * memory does not depend on how time was sliced.
 */
export function observe(ctx: Ctx): void {
  const { state } = ctx;
  for (const playerId of Object.keys(state.players)) {
    const memory = (state.memory[playerId] ??= {});
    for (const id of sightOf(state, playerId)) {
      const d = state.districts[id];
      if (d) memory[id] = d.owner;
    }
  }
}

// ------------------------------------------------------------ the player's view

export interface OwnDistrictView {
  relation: 'own';
  id: Id;
  name: string;
  kind: string;
  pos: Pos;
  owner: Id;
  garrison: Id[];
  stance: Stance;
  buildings: Building[];
  slots: number;
  warehouse: Goods;
  protectedUntilMs?: number;
  frontier: FrontierState;
  construction: Construction | null;
  overflowing: boolean;
  siege: SiegeView | null;
}

export interface SeenDistrictView {
  relation: 'visible' | 'hub';
  id: Id;
  name: string;
  kind: string;
  pos: Pos;
  owner: Owner;
  protected: boolean;
  /** Crews present by owner, as counts (their strength stays hidden). */
  presence: Record<Id, number>;
  siege: SiegeView | null;
  /** An unclaimed plot that anyone can settle: neutral and open (not surveying, not built). */
  open: boolean;
  /** A settlement under way here, and who is making it (public inside your sight). */
  settling: SettlingView | null;
  /** Watchtower level (0 for none): a public landmark, so rivals can see it and plan around it. */
  watchtower: number;
}

export interface SettlingView {
  owner: Id;
  completesAtMs: number;
}

export interface RememberedDistrictView {
  relation: 'remembered';
  id: Id;
  name: string;
  kind: string;
  pos: Pos;
  /** Who owned it the last time you saw it; `null` if you never have. */
  lastKnownOwner: Owner | null;
}

export type DistrictView = OwnDistrictView | SeenDistrictView | RememberedDistrictView;

export interface SiegeView {
  attacker: Id;
  /** Capture bar, 0 to 1. */
  progress: number;
}

export interface SeenConvoyView {
  id: Id;
  owner: Id;
  carrier: string;
  position: Pos;
  /** The two ends of the street it is on. */
  segment: [Id, Id];
}

/** The fog on an ambush's strength: a quarter either way, rounded out, so the exact sum stays hidden. */
export const strengthRange = (strength: number): [number, number] => [
  Math.floor(strength * 0.75),
  Math.ceil(strength * 1.25),
];

/** An ambush of another player, seen because one end of its street is in your sight. */
export interface SeenAmbushView {
  id: Id;
  owner: Id;
  /** The two ends of the ambushed street. */
  edge: [Id, Id];
  untilMs: number;
  /** A range for the ambushers' total strength, `[low, high]` (a rough read, never the exact sum). */
  strength: [number, number];
}

/** One price level of a public book: total open units at a price. */
export interface BookLevel {
  price: number;
  qty: number;
}

/** A hub's public book for one good. Prices are centi-credits per unit. */
export interface MarketBookView {
  bids: BookLevel[];
  asks: BookLevel[];
  /** Civic traders' standing prices and how many units they will still take or give. */
  civic: { bid: number; ask: number; bidDepth: number; askDepth: number };
  refCents: number;
  lastCents: number | null;
  /** The hub's own long-run price for the good, and the parts that make it up (why it is high or low). */
  baseCents: number;
  why: BaseWhy;
}

/** Average cost per unit (centi-credits) of your own piles of goods; 0 for an empty pile. */
export interface CostView {
  /** By hub id: what your hub stash cost you. */
  stash: Record<Id, Goods>;
  /** By district id: your warehouses. */
  districts: Record<Id, Goods>;
  /** By movement id: what the cargo of your own movements cost you. */
  cargo: Record<Id, Goods>;
}

/**
 * A contract on a public board. Everyone sees who posted and who took it; how far the job has got
 * (`delivered`, `paid`) is shown only to its poster and its taker, and is `null` for others.
 */
export type ContractView = Omit<Contract, 'delivered' | 'paid'> & {
  delivered: number | null;
  paid: number | null;
};

export interface PlayerView {
  playerId: Id;
  nowMs: number;
  season: Pick<Season, 'startMs' | 'endMs' | 'finaleStartMs' | 'finale'>;
  self: {
    credits: number;
    stash: Record<Id, Goods>;
    /** What your goods cost you per unit, so the screens can show profit. */
    costs: CostView;
    score: number;
    /** The newcomer rush ends at this time (0 or in the past: no rush). */
    rushUntilMs: number;
    /** Your street jobs on offer. */
    jobs: JobOffer[];
    /** When the next street job arrives (0 while the list is full). */
    jobNextMs: number;
  };
  /** Public scoreboard: ranks and scores only. */
  standings: { rank: number; playerId: Id; score: number }[];
  districts: Record<Id, DistrictView>;
  crews: Record<Id, Crew>;
  carriers: Record<Id, Carrier>;
  movements: Record<Id, Movement>;
  /** Convoys of other players seen inside your sight. */
  convoys: SeenConvoyView[];
  /** Ambushes of other players on streets inside your sight (yours are in `movements`). */
  ambushes: SeenAmbushView[];
  /** Scout reveals you hold: district id to the time it ends. */
  reveals: Record<Id, number>;
  /** Public order books by hub id, then good. */
  markets: Record<Id, Record<Good, MarketBookView>>;
  /** Your own open orders. */
  orders: MarketOrder[];
  /** Every hub's contracts board: open offers and taken jobs, all public. */
  contracts: Record<Id, ContractView>;
  /** The street graph is public: every node and street, and which nodes are hubs. */
  graph: { nodes: Record<Id, GraphNode>; edges: Edge[]; hubs: Id[] };
}

function costGoods(goods: Goods, value: Goods): Goods {
  const out = emptyValue();
  for (const g of GOODS) out[g] = costCents(goods[g], value[g]);
  return out;
}

function costsFor(state: GameState, player: Player): CostView {
  const costs: CostView = { stash: {}, districts: {}, cargo: {} };
  for (const [hub, goods] of Object.entries(player.stash))
    costs.stash[hub] = costGoods(goods, player.stashValue[hub] ?? emptyValue());
  for (const d of Object.values(state.districts))
    if (d.owner === player.id) costs.districts[d.id] = costGoods(d.warehouse, d.warehouseValue);
  for (const m of Object.values(state.movements))
    if (m.owner === player.id) costs.cargo[m.id] = costGoods(m.cargo, m.value);
  return costs;
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * What a player is allowed to see. JSON-safe and built only from their own
 * data, what is inside their sight and what they remember: it never contains
 * another player's warehouses, credits, crews, orders or the random state.
 */
export function viewFor(state: GameState, playerId: Id): PlayerView {
  const player = state.players[playerId];
  if (!player) throw new Error(`unknown player ${playerId}`);
  const sight = sightOf(state, playerId);
  const memory = state.memory[playerId] ?? {};
  const sieges = (id: Id): SiegeView | null => {
    const s = state.sieges[id];
    return s
      ? { attacker: s.attacker, progress: progressAt(s, state.nowMs) / PROGRESS_SCALE }
      : null;
  };

  const districts: Record<Id, DistrictView> = {};
  for (const d of Object.values(state.districts)) {
    // Plots still being surveyed are not on the map yet.
    if (d.frontier === 'surveying') continue;
    const base = { id: d.id, name: d.name, kind: d.kind, pos: copy(d.pos) };
    if (d.owner === playerId) {
      districts[d.id] = {
        relation: 'own',
        ...base,
        owner: playerId,
        garrison: [...d.garrison],
        stance: d.stance,
        buildings: copy(d.buildings),
        slots: d.slots,
        warehouse: { ...d.warehouse },
        ...(d.protectedUntilMs !== undefined ? { protectedUntilMs: d.protectedUntilMs } : {}),
        frontier: d.frontier,
        construction: copy(d.construction),
        overflowing: d.overflowing,
        siege: sieges(d.id),
      };
    } else if (sight.has(d.id)) {
      const presence: Record<Id, number> = {};
      for (const crew of Object.values(state.crews)) {
        if (crew.owner !== playerId && 'at' in crew.loc && crew.loc.at === d.id) {
          presence[crew.owner] = (presence[crew.owner] ?? 0) + 1;
        }
      }
      districts[d.id] = {
        relation: d.kind === 'hub' ? 'hub' : 'visible',
        ...base,
        owner: d.owner,
        protected: d.protectedUntilMs !== undefined && d.protectedUntilMs > state.nowMs,
        presence,
        siege: sieges(d.id),
        open: d.owner === 'neutral' && d.frontier === 'open',
        settling: d.settling
          ? { owner: d.settling.owner, completesAtMs: d.settling.completesAtMs }
          : null,
        watchtower: watchtowerLevel(d.buildings),
      };
    } else {
      districts[d.id] = { relation: 'remembered', ...base, lastKnownOwner: memory[d.id] ?? null };
    }
  }

  const crews: Record<Id, Crew> = {};
  for (const c of Object.values(state.crews)) if (c.owner === playerId) crews[c.id] = copy(c);
  const carriers: Record<Id, Carrier> = {};
  for (const c of Object.values(state.carriers)) if (c.owner === playerId) carriers[c.id] = copy(c);
  const movements: Record<Id, Movement> = {};
  const convoys: SeenConvoyView[] = [];
  const ambushes: SeenAmbushView[] = [];
  for (const m of Object.values(state.movements)) {
    if (m.owner === playerId) {
      movements[m.id] = copy(m);
      continue;
    }
    if (m.kind === 'ambush' && m.raid) {
      const { a, b, untilMs } = m.raid;
      // Hidden unless the street is in sight; the target only learns when hit (`raid.hit`).
      if (sight.has(a) || sight.has(b))
        ambushes.push({
          id: m.id,
          owner: m.owner,
          edge: [a, b],
          untilMs,
          strength: strengthRange(
            m.crewIds.reduce((n, id) => n + (state.crews[id]?.strength ?? 0), 0),
          ),
        });
      continue;
    }
    const segment = movementSegment(state.graph, m, state.nowMs);
    if (!sight.has(segment[0]) && !sight.has(segment[1])) continue;
    convoys.push({
      id: m.id,
      owner: m.owner,
      carrier: m.carrierKind,
      position: movementPosition(state.graph, m, state.nowMs),
      segment,
    });
  }

  const reveals: Record<Id, number> = {};
  for (const [key, until] of Object.entries(state.reveals)) {
    const [who, where] = key.split('|');
    if (who === playerId && where !== undefined && until > state.nowMs) reveals[where] = until;
  }

  const levels = (list: readonly MarketOrder[]): BookLevel[] => {
    const out: BookLevel[] = [];
    for (const o of list) {
      const last = out[out.length - 1];
      if (last && last.price === o.price) last.qty += o.qty;
      else out.push({ price: o.price, qty: o.qty });
    }
    return out;
  };
  const markets: Record<Id, Record<Good, MarketBookView>> = {};
  const orders: MarketOrder[] = [];
  for (const [hub, books] of Object.entries(state.markets)) {
    const hubView = {} as Record<Good, MarketBookView>;
    for (const good of Object.keys(books) as Good[]) {
      const book = books[good];
      hubView[good] = {
        bids: levels(book.bids),
        asks: levels(book.asks),
        civic: {
          bid: civicBid(book),
          ask: civicAsk(book),
          bidDepth: book.bidDepth,
          askDepth: book.askDepth,
        },
        refCents: book.refCents,
        lastCents: book.lastCents,
        baseCents: book.baseCents,
        why: { ...book.why },
      };
      for (const o of [...book.bids, ...book.asks]) if (o.owner === playerId) orders.push(copy(o));
    }
    markets[hub] = hubView;
  }
  orders.sort((a, b) => a.seq - b.seq);

  const contracts: Record<Id, ContractView> = {};
  for (const c of Object.values(state.contracts)) {
    // A newcomer's starter contract is for them alone.
    if (c.reservedFor && c.reservedFor !== playerId) continue;
    const mine = c.poster === playerId || c.taker === playerId;
    contracts[c.id] = { ...c, delivered: mine ? c.delivered : null, paid: mine ? c.paid : null };
  }

  const board = Object.values(state.players)
    .map((p) => ({ playerId: p.id, score: p.score / 3_600_000 }))
    .sort((a, b) => b.score - a.score || (a.playerId < b.playerId ? -1 : 1))
    .map((r, i) => ({ rank: i + 1, ...r }));

  return {
    playerId,
    nowMs: state.nowMs,
    season: {
      startMs: state.season.startMs,
      endMs: state.season.endMs,
      finaleStartMs: state.season.finaleStartMs,
      finale: state.season.finale,
    },
    self: {
      credits: player.credits,
      stash: copy(player.stash),
      costs: costsFor(state, player),
      score: player.score / 3_600_000,
      rushUntilMs: player.rushUntilMs,
      jobs: copy(player.jobs),
      jobNextMs: player.jobNextMs,
    },
    standings: board,
    districts,
    crews,
    carriers,
    movements,
    convoys,
    ambushes,
    reveals,
    markets,
    orders,
    contracts,
    graph: {
      nodes: JSON.parse(JSON.stringify(state.graph.nodes)),
      edges: state.graph.edges.map((e) => ({ ...e })),
      hubs: Object.values(state.districts)
        .filter((d) => d.kind === 'hub')
        .map((d) => d.id)
        .sort(),
    },
  };
}
