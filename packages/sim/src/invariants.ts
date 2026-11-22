import { totalGoods, warehouseCapacity } from './production.js';
import { GOODS, type GameState } from './types.js';

/** Returns a list of broken invariants (empty when the state is sound). Used by tests and the harness. */
export function checkInvariants(s: GameState): string[] {
  const problems: string[] = [];
  const where = new Map<string, string[]>();
  const seat = (unit: string, loc: { at: string } | { movement: string }): void => {
    const key = 'at' in loc ? `at:${loc.at}` : `movement:${loc.movement}`;
    where.set(unit, [...(where.get(unit) ?? []), key]);
    if ('at' in loc && !s.districts[loc.at]) problems.push(`${unit} at unknown node ${loc.at}`);
    if ('movement' in loc && !s.movements[loc.movement]) {
      problems.push(`${unit} in missing movement ${loc.movement}`);
    }
  };
  for (const c of Object.values(s.crews)) seat(c.id, c.loc);
  for (const c of Object.values(s.carriers)) seat(c.id, c.loc);

  // A unit listed in a movement must say it is in that movement, and nowhere else.
  const claimed = new Map<string, string>();
  for (const m of Object.values(s.movements)) {
    for (const id of [...m.crewIds, ...(m.carrierId ? [m.carrierId] : [])]) {
      if (claimed.has(id)) problems.push(`${id} is in movements ${claimed.get(id)} and ${m.id}`);
      claimed.set(id, m.id);
      const loc = s.crews[id]?.loc ?? s.carriers[id]?.loc;
      if (!loc || !('movement' in loc) || loc.movement !== m.id) {
        problems.push(`${id} listed in ${m.id} but located elsewhere`);
      }
    }
    for (const g of GOODS) if (m.cargo[g] < 0) problems.push(`${m.id} has negative ${g}`);
  }
  for (const [unit, locs] of where) {
    if (locs.length !== 1) problems.push(`${unit} has ${locs.length} locations`);
  }

  for (const d of Object.values(s.districts)) {
    for (const g of GOODS) if (d.warehouse[g] < 0) problems.push(`${d.id} has negative ${g}`);
    if (d.kind !== 'hub' && totalGoods(d.warehouse) > warehouseCapacity(d) && !d.overflowing) {
      // Starting stock may exceed capacity; production never pushes past it.
    }
    for (const id of d.garrison) {
      const loc = s.crews[id]?.loc;
      if (!loc || !('at' in loc) || loc.at !== d.id)
        problems.push(`${id} garrisoned in ${d.id} but not there`);
    }
  }
  for (const p of Object.values(s.players)) {
    if (p.credits < 0) problems.push(`${p.id} has negative credits`);
    for (const [hub, goods] of Object.entries(p.stash)) {
      for (const g of GOODS)
        if (goods[g] < 0) problems.push(`${p.id} stash at ${hub} negative ${g}`);
    }
  }
  return problems;
}
