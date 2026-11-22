import { GOODS, MS_PER_HOUR, balance, toAtoms } from '@nexum/sim';
import type { GameState } from '@nexum/sim';

/**
 * Shape of the JSON stored in `snapshots.state`. Bump it when `GameState` gains or changes a
 * field and add the matching step to `UPGRADES`, so an old snapshot still loads.
 *
 * - 0: before versioning (everything up to the balance pass, task 54).
 * - 1: players carry `tradeMs`, `tradeDay`, `tradeDayMs`; districts may carry `settling`.
 * - 2: contracts board (task 73): `contracts`, `counters.contract`, players carry `contractMs`,
 *   `contractDay`, `contractDayMs`, and the queue holds a `contract.civic` tick.
 * - 3: newcomer rush and street jobs (task 77): players carry `rushUntilMs`, `jobs`, `jobNextMs`,
 *   and `counters.job` exists. Players already in a season get no rush and no jobs.
 * - 4: cost basis and regional prices (economy plan stages 1 and 2, tasks 79 and 80): districts
 *   carry `warehouseValue`, players `stashValue`, movements `value`, sell orders `value`, books
 *   `baseCents` and `why`, and the state has `heat`. Old piles are valued at the global base price.
 * - 5: shortages, fuel and the credit sink (economy plan stages 3 and 4, tasks 81 and 82): the state
 *   has `shortages` (empty) and `sink` (all zero), each book's `why` has `shortage` (0), and the
 *   queue holds a `shortage.check` and an `upkeep.day` tick.
 */
export const SNAPSHOT_VERSION = 5;

/**
 * Version of the sim rules the stored state was produced under. Bump it whenever a sim change
 * would make the same inputs play out differently (balance, new orders, scoring).
 *
 * Policy: the inputs log is only ever replayed on top of a snapshot written under the same rules
 * version. A snapshot from another rules version is loaded (shape-upgraded) only to archive its
 * final standings, and then a new season starts. We never replay old inputs under new rules,
 * because the result would silently diverge from what the players saw.
 *
 * - 0: unversioned snapshots (before task 61).
 * - 1: settle order, tougher neutrals, trade score (task 54).
 * - 2: raids and escorts (task 71): raid order, ambush strikes, raider and merchant bot changes.
 * - 3: contracts board (task 73): three new orders, civic posts that draw from the seeded RNG
 *   (so every later random roll shifts), contract score, and bot changes. Same inputs now play
 *   out differently, so an old season is archived rather than replayed.
 *
 * Task 77 (newcomer rush, street jobs, the Runner pricing pass) stayed at 3: nothing was deployed
 * under 3 that must replay, and no live player exists yet.
 */
export const RULES_VERSION = 3;

type Json = Record<string, unknown>;

/** Spacing of the civic contract tick (`balance.contracts.civicEveryHours`). */
const CIVIC_EVERY_MS = balance.contracts.civicEveryHours * MS_PER_HOUR;
const SHORTAGE_EVERY_MS = balance.shortage.everyHours * MS_PER_HOUR;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `UPGRADES[n]` turns a version `n` state into a version `n + 1` state. Pure and total. */
const UPGRADES: readonly ((state: Json) => Json)[] = [
  // 0 -> 1: the trade score fields.
  (state) => {
    const players: Json = {};
    for (const [id, p] of Object.entries(isObject(state['players']) ? state['players'] : {})) {
      players[id] = isObject(p) ? { tradeMs: 0, tradeDay: 0, tradeDayMs: 0, ...p } : p;
    }
    return { ...state, players };
  },
  // 1 -> 2: the contracts board starts empty and its civic tick is queued.
  (state) => {
    const players: Json = {};
    for (const [id, p] of Object.entries(isObject(state['players']) ? state['players'] : {})) {
      players[id] = isObject(p) ? { contractMs: 0, contractDay: 0, contractDayMs: 0, ...p } : p;
    }
    const counters = isObject(state['counters']) ? state['counters'] : {};
    const seq = (typeof counters['seq'] === 'number' ? counters['seq'] : 0) + 1;
    const nowMs = typeof state['nowMs'] === 'number' ? state['nowMs'] : 0;
    const queue = Array.isArray(state['queue']) ? state['queue'] : [];
    const tick = { at: nowMs + CIVIC_EVERY_MS, seq, kind: 'contract.civic' };
    const at = (e: unknown): number => (isObject(e) && typeof e['at'] === 'number' ? e['at'] : 0);
    const index = queue.findIndex((e) => at(e) > tick.at);
    const next = [...queue];
    next.splice(index < 0 ? next.length : index, 0, tick);
    return {
      ...state,
      players,
      contracts: isObject(state['contracts']) ? state['contracts'] : {},
      counters: { ...counters, seq, contract: 0 },
      queue: next,
    };
  },
  // 2 -> 3: no rush and no street jobs for players who joined before them.
  (state) => {
    const players: Json = {};
    for (const [id, p] of Object.entries(isObject(state['players']) ? state['players'] : {})) {
      players[id] = isObject(p) ? { rushUntilMs: 0, jobs: [], jobNextMs: 0, ...p } : p;
    }
    const counters = isObject(state['counters']) ? state['counters'] : {};
    return { ...state, players, counters: { job: 0, ...counters } };
  },
  // 3 -> 4: cost basis (old piles are worth the global base price) and the regional price fields.
  (state) => {
    const base = balance.market.baseRefCents as Record<string, number>;
    const worth = (goods: unknown): Json => {
      const out: Json = {};
      const g = isObject(goods) ? goods : {};
      for (const good of GOODS) {
        const n = typeof g[good] === 'number' ? g[good] : 0;
        out[good] = n * (base[good] ?? 0);
      }
      return out;
    };
    const map = (rec: unknown, f: (v: Json) => Json): Json => {
      const out: Json = {};
      for (const [id, v] of Object.entries(isObject(rec) ? rec : {}))
        out[id] = isObject(v) ? f(v) : v;
      return out;
    };
    const markets: Json = {};
    for (const [hub, books] of Object.entries(isObject(state['markets']) ? state['markets'] : {})) {
      const out: Json = {};
      for (const [good, book] of Object.entries(isObject(books) ? books : {})) {
        if (!isObject(book)) continue;
        const global = base[good] ?? 0;
        const asks = Array.isArray(book['asks']) ? book['asks'] : [];
        const bids = Array.isArray(book['bids']) ? book['bids'] : [];
        const ref = typeof book['refCents'] === 'number' ? book['refCents'] : global;
        out[good] = {
          baseCents: global,
          why: { from: null, distM: 0, global, transport: 0, demand: 0, raid: 0 },
          ...book,
          // A resting sell order's goods are valued at the book's reference price.
          asks: asks.map((o) =>
            isObject(o) ? { value: toAtoms(Number(o['qty'])) * ref, ...o } : o,
          ),
          bids: bids.map((o) => (isObject(o) ? { value: 0, ...o } : o)),
        };
      }
      markets[hub] = out;
    }
    return {
      ...state,
      heat: isObject(state['heat']) ? state['heat'] : {},
      districts: map(state['districts'], (d) => ({ warehouseValue: worth(d['warehouse']), ...d })),
      players: map(state['players'], (p) => ({
        stashValue: map(p['stash'], worth),
        ...p,
      })),
      movements: map(state['movements'], (m) => ({ value: worth(m['cargo']), ...m })),
      markets,
    };
  },
  // 4 -> 5: no shortage running, a clean sink ledger, and the two new ticks queued.
  (state) => {
    const markets: Json = {};
    for (const [hub, books] of Object.entries(isObject(state['markets']) ? state['markets'] : {})) {
      const out: Json = {};
      for (const [good, book] of Object.entries(isObject(books) ? books : {})) {
        out[good] = isObject(book)
          ? { ...book, why: { shortage: 0, ...(isObject(book['why']) ? book['why'] : {}) } }
          : book;
      }
      markets[hub] = out;
    }
    const counters = isObject(state['counters']) ? state['counters'] : {};
    let seq = typeof counters['seq'] === 'number' ? counters['seq'] : 0;
    const nowMs = typeof state['nowMs'] === 'number' ? state['nowMs'] : 0;
    const next = [...(Array.isArray(state['queue']) ? state['queue'] : [])];
    const at = (e: unknown): number => (isObject(e) && typeof e['at'] === 'number' ? e['at'] : 0);
    for (const tick of [
      { at: nowMs + SHORTAGE_EVERY_MS, kind: 'shortage.check' },
      { at: nowMs + 24 * MS_PER_HOUR, kind: 'upkeep.day' },
    ]) {
      seq += 1;
      const index = next.findIndex((e) => at(e) > tick.at);
      next.splice(index < 0 ? next.length : index, 0, { ...tick, seq });
    }
    return {
      ...state,
      markets,
      shortages: Array.isArray(state['shortages']) ? state['shortages'] : [],
      sink: isObject(state['sink'])
        ? state['sink']
        : { feesAtoms: 0, upkeepAtoms: 0, levyAtoms: 0 },
      counters: { ...counters, seq },
      queue: next,
    };
  },
];

/** Upgrades a parsed snapshot of any known version to the current shape. */
export function upgradeSnapshot(raw: unknown, fromVersion: number): GameState {
  if (!isObject(raw)) throw new Error('snapshot is not an object');
  if (fromVersion > SNAPSHOT_VERSION) {
    throw new Error(
      `snapshot version ${String(fromVersion)} is newer than this server (${String(SNAPSHOT_VERSION)})`,
    );
  }
  let state: Json = raw;
  for (let v = fromVersion; v < SNAPSHOT_VERSION; v++) {
    const up = UPGRADES[v];
    if (!up) throw new Error(`no upgrade from snapshot version ${String(v)}`);
    state = up(state);
  }
  return state as unknown as GameState;
}
