import { MS_PER_HOUR, balance } from '@nexum/sim';
import type { GameState } from '@nexum/sim';

/**
 * Shape of the JSON stored in `snapshots.state`. Bump it when `GameState` gains or changes a
 * field and add the matching step to `UPGRADES`, so an old snapshot still loads.
 *
 * - 0: before versioning (everything up to the balance pass, task 54).
 * - 1: players carry `tradeMs`, `tradeDay`, `tradeDayMs`; districts may carry `settling`.
 * - 2: contracts board (task 73): `contracts`, `counters.contract`, players carry `contractMs`,
 *   `contractDay`, `contractDayMs`, and the queue holds a `contract.civic` tick.
 */
export const SNAPSHOT_VERSION = 2;

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
 */
export const RULES_VERSION = 3;

type Json = Record<string, unknown>;

/** Spacing of the civic contract tick (`balance.contracts.civicEveryHours`). */
const CIVIC_EVERY_MS = balance.contracts.civicEveryHours * MS_PER_HOUR;

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
