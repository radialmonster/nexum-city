import { balance, toAtoms } from './balance.js';
import { costCents } from './cost.js';
import { totalGoods, warehouseCapacity } from './production.js';
import { GOODS, type GameState } from './types.js';

/** A pile's cost basis must be a safe non-negative integer, zero when empty, and sane per unit. */
function costProblem(problems: string[], what: string, atoms: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) problems.push(`${what} has bad cost ${value}`);
  else if (atoms <= 0 && value > 0) problems.push(`${what} is empty but has a cost`);
  else if (atoms > 0 && costCents(atoms, value) > balance.market.maxPrice)
    problems.push(`${what} costs more per unit than the price cap`);
}

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
  for (const c of Object.values(s.carriers)) {
    const wear = c.wear ?? 0;
    if (!Number.isInteger(wear) || wear < 0 || wear > balance.wear.max) {
      problems.push(`${c.id} has wear ${wear} out of range`);
    }
  }

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
    for (const g of GOODS) {
      if (m.cargo[g] < 0) problems.push(`${m.id} has negative ${g}`);
      costProblem(problems, `${m.id} cargo ${g}`, m.cargo[g], m.value[g]);
    }
  }
  for (const [unit, locs] of where) {
    if (locs.length !== 1) problems.push(`${unit} has ${locs.length} locations`);
  }

  for (const d of Object.values(s.districts)) {
    for (const g of GOODS) {
      if (d.warehouse[g] < 0) problems.push(`${d.id} has negative ${g}`);
      costProblem(problems, `${d.id} ${g}`, d.warehouse[g], d.warehouseValue[g]);
    }
    if (d.kind !== 'hub' && totalGoods(d.warehouse) > warehouseCapacity(d) && !d.overflowing) {
      // Starting stock may exceed capacity; production never pushes past it.
    }
    for (const id of d.garrison) {
      const loc = s.crews[id]?.loc;
      if (!loc || !('at' in loc) || loc.at !== d.id)
        problems.push(`${id} garrisoned in ${d.id} but not there`);
    }
  }
  for (const siege of Object.values(s.sieges)) {
    const d = s.districts[siege.districtId];
    if (!d || d.kind === 'hub') problems.push(`siege on invalid district ${siege.districtId}`);
    else if (d.owner === siege.attacker) problems.push(`${d.id} is besieged by its own owner`);
    if (siege.progress < 0 || siege.progress > 1_000_000) {
      problems.push(`siege on ${siege.districtId} has progress out of range`);
    }
    for (const id of siege.crewIds) {
      const crew = s.crews[id];
      if (
        !crew ||
        crew.owner !== siege.attacker ||
        !('at' in crew.loc) ||
        crew.loc.at !== siege.districtId
      ) {
        problems.push(`siege crew ${id} is not at ${siege.districtId}`);
      }
    }
  }
  for (const [k, v] of Object.entries(s.sink)) {
    if (!Number.isFinite(v) || v < 0) problems.push(`sink.${k} is ${v}`);
  }
  for (const sh of s.shortages) {
    if (sh.endMs < s.nowMs) problems.push(`shortage at ${sh.hub} has run past its end`);
  }
  for (const p of Object.values(s.players)) {
    if (p.score < 0) problems.push(`${p.id} has negative score`);
    if (p.credits < 0) problems.push(`${p.id} has negative credits`);
    if (p.jobs.length > balance.jobs.cap) problems.push(`${p.id} has ${p.jobs.length} street jobs`);
    const refills = s.queue.filter((e) => e.kind === 'job.refill' && e.playerId === p.id).length;
    const wantRefills = p.jobs.length < balance.jobs.cap ? 1 : 0;
    // A player with no jobs and no clock has had street jobs switched off (the harness's "before" runs).
    const jobsOff = p.jobs.length === 0 && p.jobNextMs === 0 && refills === 0;
    if (refills !== wantRefills && !jobsOff)
      problems.push(`${p.id} has ${refills} job refills queued`);
    for (const j of p.jobs) {
      if (j.creditsAtoms < 0 || (j.partsAtoms ?? 0) < 0)
        problems.push(`job ${j.id} pays a negative amount`);
    }
    for (const [hub, goods] of Object.entries(p.stash)) {
      for (const g of GOODS)
        if (goods[g] < 0) problems.push(`${p.id} stash at ${hub} negative ${g}`);
      for (const g of GOODS)
        costProblem(
          problems,
          `${p.id} stash at ${hub} ${g}`,
          goods[g],
          p.stashValue[hub]?.[g] ?? 0,
        );
    }
  }
  for (const c of Object.values(s.contracts)) {
    const tag = `contract ${c.id}`;
    const hub = s.districts[c.hub];
    if (!hub || hub.kind !== 'hub') problems.push(`${tag} is not at a hub`);
    if (c.poster !== 'civic' && !s.players[c.poster]) problems.push(`${tag} has no poster`);
    if (c.status === 'open') {
      if (c.taker !== null || c.deposit !== 0 || c.delivered !== 0 || c.paid !== 0) {
        problems.push(`${tag} is open but has a taker, deposit or progress`);
      }
    } else if (!c.taker || !s.players[c.taker] || c.taker === c.poster) {
      problems.push(`${tag} is taken by an invalid taker`);
    }
    if (c.delivered < 0 || c.delivered > toAtoms(c.qty))
      problems.push(`${tag} delivered out of range`);
    if (c.paid < 0 || c.paid > c.reward) problems.push(`${tag} paid out of range`);
    if (c.deposit < 0) problems.push(`${tag} has a negative deposit`);
    const due = s.queue.filter((e) => e.kind === 'contract.due' && e.contractId === c.id).length;
    if (due !== 1) problems.push(`${tag} has ${due} deadline events`);
  }
  for (const hub of Object.keys(s.markets)) {
    const n = Object.values(s.contracts).filter((c) => c.hub === hub && !c.reservedFor).length;
    if (n > balance.contracts.boardCap) problems.push(`${hub} board holds ${n} contracts`);
  }
  const orderIds = new Set<string>();
  for (const [hub, books] of Object.entries(s.markets)) {
    for (const good of GOODS) {
      const book = books[good];
      if (book.bidDepth < 0 || book.askDepth < 0)
        problems.push(`${hub} ${good} civic depth negative`);
      for (const [side, list] of [
        ['buy', book.bids],
        ['sell', book.asks],
      ] as const) {
        let prev: (typeof list)[number] | undefined;
        for (const o of list) {
          if (orderIds.has(o.id)) problems.push(`order ${o.id} is listed twice`);
          orderIds.add(o.id);
          if (o.qty <= 0) problems.push(`order ${o.id} has no open quantity`);
          if (side === 'sell') costProblem(problems, `order ${o.id}`, toAtoms(o.qty), o.value);
          if (o.side !== side || o.hub !== hub || o.good !== good)
            problems.push(`order ${o.id} is in the wrong book`);
          if (!s.players[o.owner]) problems.push(`order ${o.id} has no owner`);
          if (prev) {
            const ordered =
              side === 'buy'
                ? prev.price > o.price || (prev.price === o.price && prev.seq < o.seq)
                : prev.price < o.price || (prev.price === o.price && prev.seq < o.seq);
            if (!ordered) problems.push(`${hub} ${good} ${side} book is out of order at ${o.id}`);
          }
          prev = o;
        }
      }
    }
  }
  return problems;
}
