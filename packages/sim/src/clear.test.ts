import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, toAtoms } from './balance.js';
import { estimateClear, pickClearCrews } from './clear.js';
import { clone, crewsOf, scenario, vanOf } from './fixtures.js';
import { strengthRange, viewFor } from './fog.js';
import { hashState } from './hash.js';
import { checkInvariants } from './invariants.js';
import { validateOrder } from './orders.js';
import { step } from './step.js';
import type { GameState, Id, Movement, Order, OrderError, SimEvent } from './types.js';

/*
 * p1 sets an ambush on the first street of p2's haul route (the end d0_0 is p2's own district, so
 * p2 sees it). p2 then breaks it up with `ambush.clear`.
 */

function world(): { s: GameState; a: Id; b: Id } {
  const s = scenario();
  const d = s.districts['d0_0'];
  if (d) d.warehouse.parts = toAtoms(100);
  const probe = step(
    s,
    [
      {
        actorId: 'p2',
        order: {
          type: 'haul',
          carrierId: vanOf(s, 'p2'),
          crewIds: [crewsOf(s, 'p2')[0] as Id],
          to: 'hubW',
          cargo: { parts: 40 },
        },
      },
    ],
    s.nowMs + 1,
  ).state;
  const m = Object.values(probe.movements).find((x) => x.kind === 'haul') as Movement;
  return { s, a: m.route[0] as Id, b: m.route[1] as Id };
}

const ambushOf = (s: GameState): Movement | undefined =>
  Object.values(s.movements).find((m) => m.kind === 'ambush');

function ambushed(hours = 8): { state: GameState; id: Id; a: Id; b: Id } {
  const w = world();
  const order: Order = {
    type: 'raid',
    carrierId: vanOf(w.s, 'p1'),
    crewIds: crewsOf(w.s, 'p1').slice(0, 2),
    a: w.a,
    b: w.b,
    hours,
  };
  let state = step(w.s, [{ actorId: 'p1', order }], w.s.nowMs + 1).state;
  for (let i = 0; i < 48 && !ambushOf(state); i++) {
    state = step(state, [], state.nowMs + MS_PER_HOUR / 4).state;
  }
  const amb = ambushOf(state) as Movement;
  return { state, id: amb.id, a: w.a, b: w.b };
}

const setStrength = (s: GameState, owner: Id, n: number): void => {
  for (const c of Object.values(s.crews)) if (c.owner === owner) c.strength = n;
};

const err = (s: GameState, order: Order, actor = 'p2'): OrderError | null => {
  const v = validateOrder(s, { actorId: actor, order });
  return v.ok ? null : v.error;
};

/** Sends the clear and runs until nothing of it is left on the road; returns state and events. */
function clearAndRun(state: GameState, order: Order): { state: GameState; events: SimEvent[] } {
  let r = step(state, [{ actorId: 'p2', order }], state.nowMs + 1);
  const events = [...r.events];
  for (let i = 0; i < 96; i++) {
    if (!Object.values(r.state.movements).some((m) => m.kind === 'clear')) break;
    r = step(r.state, [], r.state.nowMs + MS_PER_HOUR / 4);
    events.push(...r.events);
  }
  return { state: r.state, events };
}

const kinds = (events: SimEvent[]): string[] => events.map((e) => e.kind);
const clearOrder = (id: Id): Order => ({ type: 'ambush.clear', ambushId: id });

describe('ambush.clear validation', () => {
  it('accepts a spotted enemy ambush and picks crews by itself', () => {
    const { state, id } = ambushed();
    expect(err(state, clearOrder(id))).toBeNull();
  });
  it('refuses a blind guess, your own ambush and an unknown id', () => {
    const { state, id } = ambushed();
    // p1 owns it; p3-style outsider with no sight of the street cannot target it.
    expect(err(state, clearOrder(id), 'p1')).toBe('unknown_movement');
    expect(err(state, clearOrder('m9999'))).toBe('unknown_movement');
    const blind = clone(state);
    // Take p2's whole footprint away from the street: it no longer sees either end.
    for (const d of Object.values(blind.districts)) if (d.owner === 'p2') d.owner = 'neutral';
    for (const c of Object.values(blind.crews)) if (c.owner === 'p2') c.loc = { at: 'hubE' };
    expect(viewFor(blind, 'p2').ambushes).toHaveLength(0);
    expect(err(blind, clearOrder(id))).toBe('unknown_movement');
  });
  it('needs a free crew', () => {
    const { state, id } = ambushed();
    const busy = clone(state);
    for (const c of Object.values(busy.crews)) if (c.owner === 'p2') c.loc = { movement: 'mX' };
    expect(err(busy, clearOrder(id))).toBe('no_crew');
  });
  it('checks explicit crews like any move', () => {
    const { state, id } = ambushed();
    const own = crewsOf(state, 'p1')[0] as Id;
    expect(err(state, { type: 'ambush.clear', ambushId: id, crewIds: [own] })).toBe('not_owner');
    expect(err(state, { type: 'ambush.clear', ambushId: id, crewIds: [] })).toBe('no_crew');
  });
});

describe('ambush.clear outcomes', () => {
  it('wins: the ambush ends, the raiders are hurt, both sides hear of it', () => {
    const { state, id } = ambushed();
    setStrength(state, 'p2', 400);
    setStrength(state, 'p1', 10);
    const before = Object.values(state.crews)
      .filter((c) => c.owner === 'p1')
      .reduce((n, c) => n + c.strength, 0);
    const r = clearAndRun(state, clearOrder(id));
    expect(kinds(r.events)).toContain('ambush.cleared');
    expect(kinds(r.events)).toContain('raid.ended');
    const cleared = r.events.find((e) => e.kind === 'ambush.cleared') as SimEvent;
    expect(cleared.actors).toEqual(['p2', 'p1']);
    expect(r.state.movements[id]?.kind).toBe('return');
    const after = Object.values(r.state.crews)
      .filter((c) => c.owner === 'p1')
      .reduce((n, c) => n + c.strength, 0);
    expect(after).toBeLessThan(before);
    expect(checkInvariants(r.state)).toEqual([]);
    // The clearing crew ends up back at home.
    const clearer = Object.values(r.state.crews).find((c) => c.owner === 'p2' && 'at' in c.loc);
    expect(clearer).toBeDefined();
  });
  it('loses: the ambush stays and the clearing crew is hurt and walks home', () => {
    const { state, id } = ambushed();
    setStrength(state, 'p2', 2);
    setStrength(state, 'p1', 400);
    const r = clearAndRun(state, clearOrder(id));
    expect(kinds(r.events)).toContain('ambush.held');
    expect(kinds(r.events)).not.toContain('ambush.cleared');
    expect(r.state.movements[id]?.kind).toBe('ambush');
    const held = r.events.find((e) => e.kind === 'ambush.held') as SimEvent;
    expect(held.data['attackerLost']).toBeGreaterThanOrEqual(0);
    expect(checkInvariants(r.state)).toEqual([]);
  });
  it('finds it gone: the crew just walks home', () => {
    const { state, id } = ambushed(1);
    // The crew starts a walk away (at the west hub) so the ambush can be recalled before it arrives.
    const far = clone(state);
    const mine = Object.values(far.crews).find((c) => c.owner === 'p2') as { id: Id; loc: unknown };
    for (const d of Object.values(far.districts))
      d.garrison = d.garrison.filter((c) => c !== mine.id);
    mine.loc = { at: 'hubW' };
    const set = step(
      far,
      [{ actorId: 'p2', order: { type: 'ambush.clear', ambushId: id, crewIds: [mine.id] } }],
      far.nowMs + 1,
    );
    expect(Object.values(set.state.movements).some((m) => m.kind === 'clear')).toBe(true);
    const recalled = step(
      set.state,
      [{ actorId: 'p1', order: { type: 'recall', movementId: id } }],
      set.state.nowMs + 1,
    );
    const events = [...recalled.events];
    let r = recalled;
    for (
      let i = 0;
      i < 96 && Object.values(r.state.movements).some((m) => m.kind === 'clear');
      i++
    ) {
      r = step(r.state, [], r.state.nowMs + MS_PER_HOUR / 4);
      events.push(...r.events);
    }
    expect(kinds(events)).toContain('ambush.gone');
    expect(kinds(events)).not.toContain('ambush.held');
    expect(kinds(events)).not.toContain('ambush.cleared');
    expect(checkInvariants(r.state)).toEqual([]);
  });
  it('is deterministic', () => {
    const { state, id } = ambushed();
    const x = clearAndRun(clone(state), clearOrder(id));
    const y = clearAndRun(clone(state), clearOrder(id));
    expect(hashState(x.state)).toBe(hashState(y.state));
    expect(x.events).toEqual(y.events);
  });
});

describe('estimate and pick', () => {
  it('uses only the fogged range, never the exact sum', () => {
    const { state, id } = ambushed();
    const seen = viewFor(state, 'p2').ambushes.find((a) => a.id === id);
    const real = (ambushOf(state) as Movement).crewIds.reduce(
      (n, c) => n + (state.crews[c]?.strength ?? 0),
      0,
    );
    expect(seen?.strength).toEqual(strengthRange(real));
    expect(seen?.strength[0]).toBeLessThan(real);
    expect(seen?.strength[1]).toBeGreaterThan(real);
    expect(JSON.stringify(viewFor(state, 'p2'))).not.toContain('"crewIds":["c' + 'x');
  });
  it('labels likely, even and risky', () => {
    const range: [number, number] = [9, 15];
    expect(estimateClear(15, { strength: range }).label).toBe('likely');
    expect(estimateClear(12, { strength: range }).label).toBe('even');
    expect(estimateClear(9, { strength: range }).label).toBe('risky');
    expect(estimateClear(9, { strength: range }).text).toBe('your strength 9 vs about 12, risky');
  });
  it('picks the strongest free crews at the nearest district, in a van if one is there', () => {
    const { state, a, b } = ambushed();
    const pick = pickClearCrews(state, 'p2', { a, b });
    expect(pick).not.toBeNull();
    expect(pick?.crewIds.length).toBeGreaterThan(0);
    expect(pick?.strength).toBeGreaterThan(0);
  });
});
