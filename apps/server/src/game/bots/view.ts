import { GOODS } from '@nexum/sim';
import type {
  Book,
  District,
  GameState,
  Good,
  Goods,
  Owner,
  PlayerView,
  Player,
  Siege,
} from '@nexum/sim';

const zeroGoods = (): Goods => ({ parts: 0, power: 0, data: 0, supplies: 0 });

/** Trade-score bookkeeping (task 54). Bots only read it through the score, so it stays zero. */
const noTrade = { tradeMs: 0, tradeDay: -1, tradeDayMs: 0 };

/**
 * Rebuilds a `GameState`-shaped object from what a player may see, so the sim's bot decision
 * functions (which take a `GameState`) can run on a bot's fogged `PlayerView` and never on the
 * full world. Only what a client could know is filled in:
 *
 * - your own districts, crews, carriers, movements, stash and credits are real;
 * - other districts carry just their (last known) owner, name, kind and protection;
 * - capture bars are keyed by district with the attacker only;
 * - market books carry the reference price and civic depth but no individual orders.
 *
 * Everything a view does not carry (RNG, event queue, fog memory, other players' credits and
 * stashes, building and garrison detail of rivals) is left empty, so a bot that tried to read it
 * would find nothing. The result is for reading only; it is never stepped or stored.
 */
export function stateFromView(view: PlayerView): GameState {
  const districts: Record<string, District> = {};
  const sieges: Record<string, Siege> = {};
  for (const d of Object.values(view.districts)) {
    const base = {
      id: d.id,
      name: d.name,
      kind: d.kind as District['kind'],
      pos: d.pos,
      garrison: [] as string[],
      stance: 'hold' as const,
      buildings: [],
      slots: 0,
      warehouse: zeroGoods(),
      construction: null,
      overflowing: false,
      wasted: 0,
    };
    if (d.relation === 'own') {
      districts[d.id] = {
        ...base,
        owner: d.owner,
        garrison: [...d.garrison],
        stance: d.stance,
        buildings: d.buildings,
        slots: d.slots,
        warehouse: d.warehouse,
        frontier: d.frontier,
        construction: d.construction,
        overflowing: d.overflowing,
        ...(d.protectedUntilMs !== undefined ? { protectedUntilMs: d.protectedUntilMs } : {}),
      };
    } else if (d.relation === 'remembered') {
      const owner: Owner = d.lastKnownOwner ?? 'neutral';
      districts[d.id] = { ...base, owner, frontier: owner === 'neutral' ? 'open' : 'built' };
    } else {
      districts[d.id] = {
        ...base,
        owner: d.owner,
        frontier: d.owner === 'neutral' ? 'open' : 'built',
        ...(d.protected ? { protectedUntilMs: view.nowMs + 1 } : {}),
      };
    }
    const siege = 'siege' in d ? d.siege : null;
    if (siege) {
      sieges[d.id] = {
        districtId: d.id,
        attacker: siege.attacker,
        crewIds: [],
        progress: 0,
        sinceMs: view.nowMs,
        rate: { mode: 'down' },
        milestone: 0,
        roundAtMs: null,
        startedMs: view.nowMs,
        stats: { attackerStart: 0, attackerLost: 0, defenderLost: 0, rounds: 0 },
      };
    }
  }

  const players: Record<string, Player> = {};
  for (const s of view.standings) {
    players[s.playerId] = { id: s.playerId, credits: 0, stash: {}, score: s.score, ...noTrade };
  }
  players[view.playerId] = {
    id: view.playerId,
    credits: view.self.credits,
    stash: view.self.stash,
    score: view.self.score,
    ...noTrade,
  };

  const markets: GameState['markets'] = {};
  for (const [hub, books] of Object.entries(view.markets)) {
    const out = {} as Record<Good, Book>;
    for (const good of GOODS) {
      const b = books[good];
      out[good] = {
        bids: [],
        asks: [],
        refCents: b.refCents,
        bidDepth: b.civic.bidDepth,
        askDepth: b.civic.askDepth,
        lastCents: b.lastCents,
      };
    }
    markets[hub] = out;
  }

  const reveals: Record<string, number> = {};
  for (const [district, until] of Object.entries(view.reveals)) {
    reveals[`${view.playerId}|${district}`] = until;
  }

  return {
    version: 1,
    seed: 0,
    nowMs: view.nowMs,
    rng: [0, 0, 0, 0],
    counters: { crew: 0, carrier: 0, movement: 0, event: 0, seq: 0, order: 0 },
    world: { cols: 0, rows: 0, soundY: 0 },
    graph: { nodes: view.graph.nodes, edges: view.graph.edges },
    districts,
    players,
    crews: view.crews,
    carriers: view.carriers,
    movements: view.movements,
    reveals,
    sieges,
    season: { ...view.season, leaderId: null, belowMedian: [] },
    markets,
    memory: {},
    queue: [],
  };
}
