import type { FeedItem, PlayerView } from '@nexum/contracts';

/** A small hand-built world for tests: you own `a`, a rival holds `b`, and a road joins them. */
export function makeView(over: Partial<PlayerView> = {}): PlayerView {
  const goods = { parts: 0, power: 0, data: 0, supplies: 0 };
  return {
    playerId: 'me',
    nowMs: 1_000_000,
    season: { startMs: 0, endMs: 10_000_000_000, finaleStartMs: 9_000_000_000, finale: false },
    self: { credits: 0, stash: {}, score: 0 },
    standings: [
      { rank: 1, playerId: 'rival', score: 10 },
      { rank: 2, playerId: 'me', score: 5 },
    ],
    districts: {
      a: {
        relation: 'own',
        id: 'a',
        name: 'Alpha Docks',
        kind: 'docks',
        pos: { x: 0, y: 0 },
        owner: 'me',
        garrison: ['c1'],
        stance: 'hold',
        buildings: [],
        slots: 2,
        warehouse: { ...goods },
        frontier: 'built',
        construction: null,
        overflowing: false,
        siege: null,
      },
      b: {
        relation: 'visible',
        id: 'b',
        name: 'Beta Stacks',
        kind: 'stacks',
        pos: { x: 100, y: 0 },
        owner: 'rival',
        protected: false,
        open: false,
        settling: null,
        presence: { rival: 2 },
        siege: null,
      },
    },
    crews: { c1: { id: 'c1', owner: 'me', strength: 100, loc: { at: 'a' }, readyAtMs: 0 } },
    carriers: {},
    movements: {},
    contracts: {},
    convoys: [],
    ambushes: [],
    reveals: {},
    markets: {},
    orders: [],
    graph: {
      nodes: {
        a: { id: 'a', type: 'district', pos: { x: 0, y: 0 } },
        b: { id: 'b', type: 'district', pos: { x: 100, y: 0 } },
      },
      edges: [{ a: 'a', b: 'b', lengthM: 500 }],
      hubs: [],
    },
    ...over,
  };
}

export function feedItem(
  seq: number,
  kind: FeedItem['event']['kind'],
  over: Partial<FeedItem['event']> = {},
): FeedItem {
  return {
    seq,
    event: {
      id: `e${String(seq)}`,
      at: seq * 1000,
      kind,
      actors: [],
      districts: [],
      data: {},
      ...over,
    },
  };
}

/** A fetch response with a JSON body. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
