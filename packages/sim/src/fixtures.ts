import { toAtoms } from './balance.js';
import type { Ctx } from './ctx.js';
import { afterWarehouseChange } from './production.js';
import type { GameState, Id } from './types.js';
import { stripNewcomerPerks } from './rush.js';
import { addPlayer, createWorld } from './world.js';

export { stripNewcomerPerks };

/**
 * Shared setup for tests: a seeded city where `p1` holds two adjacent districts
 * (`d2_1` Docks with stock, `d3_1` Grid), two crews and a van, and `p2` is far away.
 */
export function scenario(seed = 7): GameState {
  let s = addPlayer(createWorld(seed), { id: 'p2', districtId: 'd0_0', protectedHours: 0 });
  s = addPlayer(s, { id: 'p1', districtId: 'd2_1', protectedHours: 0 });
  const first = s.districts['d2_1'];
  const second = s.districts['d3_1'];
  stripNewcomerPerks(s);
  if (!first || !second) throw new Error('scenario districts missing');
  second.owner = 'p1';
  second.kind = 'grid';
  first.kind = 'docks';
  first.warehouse.parts = toAtoms(40);
  first.warehouse.power = toAtoms(20);
  const ctx: Ctx = { state: s, events: [] };
  afterWarehouseChange(ctx, first);
  afterWarehouseChange(ctx, second);
  return s;
}

export function crewsOf(s: GameState, owner: Id): Id[] {
  return Object.values(s.crews)
    .filter((c) => c.owner === owner)
    .map((c) => c.id);
}

export function vanOf(s: GameState, owner: Id): Id {
  const van = Object.values(s.carriers).find((c) => c.owner === owner && c.kind === 'van');
  if (!van) throw new Error('no van');
  return van.id;
}

/** Deep copy of plain state (the sim state is JSON by design). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
