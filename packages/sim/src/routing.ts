import { MS_PER_MINUTE, balance } from './balance.js';
import type { CarrierKind, Graph, Id, Movement, Pos } from './types.js';

export interface Route {
  /** Node ids from start to end, inclusive. */
  route: Id[];
  lengthM: number;
}

export interface Eta extends Route {
  durationMs: number;
}

function adjacency(graph: Graph): Map<Id, { to: Id; lengthM: number }[]> {
  const adj = new Map<Id, { to: Id; lengthM: number }[]>();
  for (const id of Object.keys(graph.nodes)) adj.set(id, []);
  for (const e of graph.edges) {
    adj.get(e.a)?.push({ to: e.b, lengthM: e.lengthM });
    adj.get(e.b)?.push({ to: e.a, lengthM: e.lengthM });
  }
  return adj;
}

/**
 * Dijkstra over the street graph. Ties are broken by node id, so the result is
 * the same on every machine. Returns `null` when there is no path.
 */
export function shortestRoute(graph: Graph, from: Id, to: Id): Route | null {
  if (!(from in graph.nodes) || !(to in graph.nodes)) return null;
  if (from === to) return { route: [from], lengthM: 0 };
  const adj = adjacency(graph);
  const ids = Object.keys(graph.nodes).sort();
  const dist = new Map<Id, number>([[from, 0]]);
  const prev = new Map<Id, Id>();
  const done = new Set<Id>();
  for (;;) {
    let best: Id | null = null;
    let bestD = Infinity;
    for (const id of ids) {
      const d = dist.get(id);
      if (d !== undefined && !done.has(id) && d < bestD) {
        best = id;
        bestD = d;
      }
    }
    if (best === null) return null;
    if (best === to) break;
    done.add(best);
    for (const n of adj.get(best) ?? []) {
      const nd = bestD + n.lengthM;
      const cur = dist.get(n.to);
      if (cur === undefined || nd < cur) {
        dist.set(n.to, nd);
        prev.set(n.to, best);
      }
    }
  }
  const route: Id[] = [to];
  for (let cur = to; cur !== from;) {
    const p = prev.get(cur) as Id;
    route.push(p);
    cur = p;
  }
  return { route: route.reverse(), lengthM: dist.get(to) as number };
}

export function travelMs(lengthM: number, carrier: CarrierKind): number {
  return Math.ceil((lengthM / balance.carriers[carrier].speed) * MS_PER_MINUTE);
}

/**
 * Route and travel time for a carrier. Exported so the client can preview it.
 * Locked carriers still return an estimate; the order validator refuses them.
 */
export function eta(graph: Graph, from: Id, to: Id, carrier: CarrierKind): Eta | null {
  const r = shortestRoute(graph, from, to);
  if (!r) return null;
  return { ...r, durationMs: travelMs(r.lengthM, carrier) };
}

/** Fraction (0 to 1) of its route a movement has covered at `nowMs`. */
export function movementProgress(m: Movement, nowMs: number): number {
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  if (m.recalledAtMs !== undefined && m.recallFraction !== undefined) {
    const span = m.arriveMs - m.recalledAtMs;
    return span <= 0 ? 0 : m.recallFraction * clamp(1 - (nowMs - m.recalledAtMs) / span);
  }
  const span = m.arriveMs - m.departMs;
  return span <= 0 ? 1 : clamp((nowMs - m.departMs) / span);
}

/** Map position of a movement, for drawing. Interpolates along the route's streets. */
export function movementPosition(graph: Graph, m: Movement, nowMs: number): Pos {
  let target = movementProgress(m, nowMs) * m.lengthM;
  const nodePos = (id: Id): Pos => (graph.nodes[id] as { pos: Pos }).pos;
  for (let i = 0; i + 1 < m.route.length; i++) {
    const a = m.route[i] as Id;
    const b = m.route[i + 1] as Id;
    const edge = graph.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
    const len = edge?.lengthM ?? 0;
    if (target <= len || i + 2 === m.route.length) {
      const t = len === 0 ? 1 : Math.min(1, target / len);
      const pa = nodePos(a);
      const pb = nodePos(b);
      return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
    }
    target -= len;
  }
  return nodePos(m.route[0] as Id);
}

/**
 * The two nodes of the street a movement is on at `nowMs` (equal when it is
 * exactly at a node). Used for sight: a convoy is seen from either end.
 */
export function movementSegment(graph: Graph, m: Movement, nowMs: number): [Id, Id] {
  let target = movementProgress(m, nowMs) * m.lengthM;
  for (let i = 0; i + 1 < m.route.length; i++) {
    const a = m.route[i] as Id;
    const b = m.route[i + 1] as Id;
    const edge = graph.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
    const len = edge?.lengthM ?? 0;
    if (target <= len || i + 2 === m.route.length) return [a, b];
    target -= len;
  }
  const first = m.route[0] as Id;
  return [first, first];
}
