import type { GameState } from '@nexum/sim';

/**
 * Shape of the JSON stored in `snapshots.state`. Bump it when `GameState` gains or changes a
 * field and add the matching step to `UPGRADES`, so an old snapshot still loads.
 *
 * - 0: before versioning (everything up to the balance pass, task 54).
 * - 1: players carry `tradeMs`, `tradeDay`, `tradeDayMs`; districts may carry `settling`.
 */
export const SNAPSHOT_VERSION = 1;

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
 */
export const RULES_VERSION = 1;

type Json = Record<string, unknown>;

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
