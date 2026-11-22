import { balance } from './balance.js';
import { mainGood } from './production.js';
import {
  GOODS,
  type BaseWhy,
  type District,
  type GameState,
  type Good,
  type Graph,
  type Id,
} from './types.js';

/*
 * Regional prices (economy plan, stage 2). The rules, the reasons and the results are in
 * docs/rewrite/sim-spec.md, "Regional prices (task 80)". Everything here is integer maths and
 * reads only the state, so the result is the same on every machine.
 *
 * A hub's base price for a good is the cheapest delivered cost: the global base, plus the
 * transport charge for the street distance from the nearest producing district (any owner,
 * surveying plots excluded), plus a raid premium for recent trouble on the streets of that haul,
 * plus a demand push for the neutral residential districts that count the hub as their nearest.
 */

/** Neutral residential districts eat these goods (they never pay, and players pay no upkeep). */
const DEMAND_GOODS: readonly Good[] = ['supplies', 'power'];

const R = balance.market.regional;

export const edgeKey = (a: Id, b: Id): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Records raid activity on a street (an ambush set, a convoy hit). It decays hourly. */
export function addHeat(state: GameState, a: Id, b: Id, amount: number): void {
  const key = edgeKey(a, b);
  state.heat[key] = (state.heat[key] ?? 0) + amount;
}

interface Tree {
  dist: Map<Id, number>;
  prev: Map<Id, Id>;
}

/** Dijkstra from one node over the whole street graph, ties broken by node id (deterministic). */
export function treeFrom(graph: Graph, src: Id): Tree {
  const adj = new Map<Id, { to: Id; m: number }[]>();
  for (const id of Object.keys(graph.nodes)) adj.set(id, []);
  for (const e of graph.edges) {
    adj.get(e.a)?.push({ to: e.b, m: e.lengthM });
    adj.get(e.b)?.push({ to: e.a, m: e.lengthM });
  }
  const dist = new Map<Id, number>([[src, 0]]);
  const prev = new Map<Id, Id>();
  const done = new Set<Id>();
  // A binary heap of [distance, id], ordered by distance then id.
  const heap: [number, Id][] = [[0, src]];
  const less = (a: [number, Id], b: [number, Id]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (x: [number, Id]): void => {
    heap.push(x);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!less(heap[i] as [number, Id], heap[p] as [number, Id])) break;
      [heap[i], heap[p]] = [heap[p] as [number, Id], heap[i] as [number, Id]];
      i = p;
    }
  };
  const pop = (): [number, Id] => {
    const top = heap[0] as [number, Id];
    const last = heap.pop() as [number, Id];
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l] as [number, Id], heap[m] as [number, Id])) m = l;
        if (r < heap.length && less(heap[r] as [number, Id], heap[m] as [number, Id])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m] as [number, Id], heap[i] as [number, Id]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length > 0) {
    const [d, id] = pop();
    if (done.has(id)) continue;
    done.add(id);
    for (const n of adj.get(id) ?? []) {
      const nd = d + n.m;
      const cur = dist.get(n.to);
      if (cur === undefined || nd < cur || (nd === cur && id < (prev.get(n.to) as Id))) {
        dist.set(n.to, nd);
        prev.set(n.to, id);
        push([nd, n.to]);
      }
    }
  }
  return { dist, prev };
}

/** Sum of the raid heat on the streets from `node` back to the tree's root. */
function pathHeat(state: GameState, tree: Tree, node: Id): number {
  let sum = 0;
  for (let cur = node; ;) {
    const p = tree.prev.get(cur);
    if (p === undefined) break;
    sum += state.heat[edgeKey(cur, p)] ?? 0;
    cur = p;
  }
  return sum;
}

const isProducer = (d: District, good: Good): boolean =>
  d.kind !== 'hub' && d.frontier !== 'surveying' && mainGood(d.kind) === good;

/** Whole percent of `base`, rounded down. */
const percentOf = (base: number, percent: number): number => Math.floor((base * percent) / 100);

/**
 * Recomputes every hub's base price for every good, each district's nearest hub, and decays the
 * raid heat. Called hourly from `market.tick` and once when the world is made.
 */
export function refreshRegional(state: GameState): void {
  for (const key of Object.keys(state.heat)) {
    const kept = Math.floor(((state.heat[key] as number) * R.heatKeepPercent) / 100);
    if (kept > 0) state.heat[key] = kept;
    else Reflect.deleteProperty(state.heat, key);
  }
  const hubs = Object.keys(state.markets).sort();
  const trees = new Map<Id, Tree>();
  for (const hub of hubs) trees.set(hub, treeFrom(state.graph, hub));
  const ids = Object.keys(state.districts).sort();
  const demand = new Map<Id, number>();
  for (const id of ids) {
    const d = state.districts[id] as District;
    if (d.kind === 'hub') continue;
    let best: Id | null = null;
    let bestM = Infinity;
    for (const hub of hubs) {
      const m = (trees.get(hub) as Tree).dist.get(id);
      if (m !== undefined && m < bestM) {
        best = hub;
        bestM = m;
      }
    }
    if (best !== null && d.nearHub !== best) d.nearHub = best;
    if (
      best !== null &&
      d.kind === 'residential' &&
      d.owner === 'neutral' &&
      d.frontier === 'built'
    )
      demand.set(best, (demand.get(best) ?? 0) + 1);
  }
  for (const hub of hubs) {
    const tree = trees.get(hub) as Tree;
    for (const good of GOODS) {
      const book = state.markets[hub]?.[good];
      if (!book) continue;
      const global = Math.round((balance.market.baseRefCents[good] * R.producerPercent) / 100);
      let from: Id | null = null;
      let distM = Infinity;
      for (const id of ids) {
        const d = state.districts[id] as District;
        if (!isProducer(d, good)) continue;
        const m = tree.dist.get(id);
        if (m !== undefined && m < distM) {
          from = id;
          distM = m;
        }
      }
      const why: BaseWhy = {
        from,
        distM: from === null ? 0 : distM,
        global,
        transport: 0,
        demand: 0,
        raid: 0,
        shortage: 0,
      };
      if (from !== null) {
        why.transport = Math.floor((global * R.transportPercentPerKm * distM) / 100_000);
        const heat = pathHeat(state, tree, from);
        why.raid = percentOf(global, Math.min(R.raidCapPercent, heat * R.raidPercentPerHeat));
      }
      if (DEMAND_GOODS.includes(good)) {
        const n = demand.get(hub) ?? 0;
        why.demand = percentOf(
          global,
          Math.min(R.demandCapPercent, n * R.demandPercentPerDistrict),
        );
      }
      const plain = global + why.transport + why.raid + why.demand;
      if (state.shortages.some((s) => s.hub === hub && s.good === good)) {
        why.shortage = percentOf(plain, balance.shortage.refPercent);
      }
      book.baseCents = plain + why.shortage;
      book.why = why;
    }
  }
}
