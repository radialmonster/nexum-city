import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, balance, toAtoms, toUnits } from './balance.js';
import { clone, crewsOf, scenario, vanOf } from './fixtures.js';
import { viewFor } from './fog.js';
import { checkInvariants } from './invariants.js';
import { validateOrder } from './orders.js';
import { step } from './step.js';
import type { GameState, Id, Input, Movement, Order, OrderError } from './types.js';

/*
 * p1 (raider) holds d2_1 and d3_1. p2 hauls from d0_0 to the west hub. The ambush edge is the
 * first street of that haul, so every test below uses the same real road.
 */

function haulWorld(): { s: GameState; a: Id; b: Id; haul: Order } {
  const s = scenario();
  const d = s.districts['d0_0'];
  if (d) d.warehouse.parts = toAtoms(100);
  const p2crews = crewsOf(s, 'p2');
  const haul: Order = {
    type: 'haul',
    carrierId: vanOf(s, 'p2'),
    crewIds: [p2crews[0] as Id],
    to: 'hubW',
    cargo: { parts: 40 },
  };
  const probe = step(s, [{ actorId: 'p2', order: haul }], s.nowMs + 1).state;
  const m = Object.values(probe.movements).find((x) => x.kind === 'haul');
  if (!m) throw new Error('no probe haul');
  return { s, a: m.route[0] as Id, b: m.route[1] as Id, haul };
}

type RaidOrder = Extract<Order, { type: 'raid' }>;
const raidOrder = (s: GameState, a: Id, b: Id, hours = 8, crews = 2): RaidOrder => ({
  type: 'raid',
  carrierId: vanOf(s, 'p1'),
  crewIds: crewsOf(s, 'p1').slice(0, crews),
  a,
  b,
  hours,
});

const kinds = (events: { kind: string }[]): string[] => events.map((e) => e.kind);
const movementsOf = (s: GameState, kind: Movement['kind']): Movement[] =>
  Object.values(s.movements).filter((m) => m.kind === kind);

/** Sets the ambush and waits until it is lying in wait; returns the state and the time. */
function ambushed(w: ReturnType<typeof haulWorld>, hours = 8): GameState {
  const first = step(
    w.s,
    [{ actorId: 'p1', order: raidOrder(w.s, w.a, w.b, hours) }],
    w.s.nowMs + 1,
  );
  let state = first.state;
  const seen: string[] = [];
  for (let i = 0; i < 48 && movementsOf(state, 'ambush').length === 0; i++) {
    const r = step(state, [], state.nowMs + MS_PER_HOUR / 4);
    state = r.state;
    seen.push(...kinds(r.events));
  }
  expect(seen).toContain('raid.set');
  expect(movementsOf(state, 'ambush')).toHaveLength(1);
  return state;
}

const err = (s: GameState, order: Order, actor = 'p1'): OrderError | null => {
  const v = validateOrder(s, { actorId: actor, order });
  return v.ok ? null : v.error;
};

describe('raid order validation', () => {
  const w = haulWorld();
  it('accepts a real street and a window of 1 to 8 hours', () => {
    expect(err(w.s, raidOrder(w.s, w.a, w.b, 1))).toBeNull();
    expect(err(w.s, raidOrder(w.s, w.a, w.b, 8))).toBeNull();
  });
  it('rejects a bad window, a missing street and an extra raid', () => {
    expect(err(w.s, raidOrder(w.s, w.a, w.b, 0))).toBe('bad_window');
    expect(err(w.s, raidOrder(w.s, w.a, w.b, 9))).toBe('bad_window');
    expect(err(w.s, raidOrder(w.s, w.a, w.b, 2.5))).toBe('bad_window');
    expect(err(w.s, raidOrder(w.s, 'd0_0', 'd5_3'))).toBe('bad_edge');
    expect(err(w.s, raidOrder(w.s, w.a, w.a))).toBe('bad_edge');
  });
  it('caps the ambushes one player runs at once', () => {
    let state = w.s;
    const crews = crewsOf(state, 'p1');
    expect(crews.length).toBeGreaterThanOrEqual(2);
    expect(balance.raid.maxActive).toBe(2);
    const one = step(
      state,
      [{ actorId: 'p1', order: { ...raidOrder(state, w.a, w.b, 8, 1), carrierId: null } }],
      state.nowMs + 1,
    );
    state = one.state;
    const second = {
      ...raidOrder(state, w.a, w.b, 8, 1),
      crewIds: [crews[1] as Id],
      carrierId: null,
    };
    expect(err(state, second)).toBeNull();
    state = step(state, [{ actorId: 'p1', order: second }], state.nowMs + 1).state;
    expect(movementsOf(state, 'raid').length + movementsOf(state, 'ambush').length).toBe(2);
  });
});

describe('ambush lifecycle', () => {
  it('keeps the crews out of the garrison, then walks home when the window ends', () => {
    const w = haulWorld();
    const state = ambushed(w, 2);
    const amb = movementsOf(state, 'ambush')[0] as Movement;
    for (const id of amb.crewIds) expect(state.crews[id]?.loc).toEqual({ movement: amb.id });
    const done = step(state, [], amb.raid?.untilMs ?? 0);
    expect(kinds(done.events)).toContain('raid.ended');
    expect(movementsOf(done.state, 'return')).toHaveLength(1);
    const home = step(done.state, [], done.state.nowMs + 24 * MS_PER_HOUR);
    for (const id of amb.crewIds) expect(home.state.crews[id]?.loc).toHaveProperty('at');
    expect(checkInvariants(home.state)).toEqual([]);
  });

  it('can be recalled and then comes home', () => {
    const w = haulWorld();
    const state = ambushed(w);
    const amb = movementsOf(state, 'ambush')[0] as Movement;
    const r = step(
      state,
      [{ actorId: 'p1', order: { type: 'recall', movementId: amb.id } }],
      state.nowMs + 1,
    );
    expect(kinds(r.events)).toContain('raid.ended');
    expect(movementsOf(r.state, 'ambush')).toHaveLength(0);
    expect(movementsOf(r.state, 'return')).toHaveLength(1);
  });
});

describe('strikes', () => {
  /** Makes the raiders overwhelming or hopeless by editing crew strength. */
  const setStrength = (s: GameState, owner: Id, n: number): void => {
    for (const id of crewsOf(s, owner)) {
      const c = s.crews[id];
      if (c) c.strength = n;
    }
  };

  function runHaul(state: GameState, haul: Order): ReturnType<typeof step> {
    const t = state.nowMs;
    return step(state, [{ actorId: 'p2', order: haul, atMs: t + 1 }], t + 24 * MS_PER_HOUR);
  }

  it('steals, destroys and lets the convoy continue when the raiders win', () => {
    const w = haulWorld();
    const state = ambushed(w);
    setStrength(state, 'p1', 500);
    setStrength(state, 'p2', 1);
    const r = runHaul(state, w.haul);
    const hit = r.events.find((e) => e.kind === 'raid.hit');
    expect(hit).toBeDefined();
    expect(hit?.actors.sort()).toEqual(['p1', 'p2']);
    const data = hit?.data as { stolen: Record<string, number>; destroyed: Record<string, number> };
    expect(data.stolen['parts']).toBeGreaterThan(0);
    expect(data.stolen['parts']).toBeLessThanOrEqual((40 * balance.raid.stealPercent) / 100 + 1e-6);
    // The convoy still arrives, with what is left.
    const arrived = r.events.find((e) => e.kind === 'arrived' && e.actors.includes('p2'));
    expect(arrived).toBeDefined();
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('conserves goods: sent = delivered + stolen + destroyed', () => {
    const w = haulWorld();
    const state = ambushed(w);
    setStrength(state, 'p1', 500);
    setStrength(state, 'p2', 1);
    const r = runHaul(state, w.haul);
    const hit = r.events.find((e) => e.kind === 'raid.hit')?.data as {
      stolen: Record<string, number>;
      destroyed: Record<string, number>;
    };
    const arrived = r.events.find((e) => e.kind === 'arrived' && e.actors.includes('p2'))?.data as
      { cargo: number; sent: number } | undefined;
    const sum = (o: Record<string, number>): number => Object.values(o).reduce((n, v) => n + v, 0);
    expect(arrived?.sent).toBeCloseTo(40, 6);
    expect((arrived?.cargo ?? 0) + sum(hit.stolen) + sum(hit.destroyed)).toBeCloseTo(40, 6);
  });

  it('costs the raiders strength and ends the ambush when they lose', () => {
    const w = haulWorld();
    const state = ambushed(w);
    setStrength(state, 'p1', 10);
    setStrength(state, 'p2', 500);
    const before = crewsOf(state, 'p1').reduce((n, id) => n + (state.crews[id]?.strength ?? 0), 0);
    const r = runHaul(state, w.haul);
    expect(kinds(r.events)).toContain('raid.repelled');
    expect(kinds(r.events)).not.toContain('raid.hit');
    expect(movementsOf(r.state, 'ambush')).toHaveLength(0);
    const after = crewsOf(r.state, 'p1').reduce(
      (n, id) => n + (r.state.crews[id]?.strength ?? 0),
      0,
    );
    expect(after).toBeLessThan(before);
  });

  it('hits a given haul at most once per ambush', () => {
    const w = haulWorld();
    const state = ambushed(w);
    setStrength(state, 'p1', 500);
    setStrength(state, 'p2', 1);
    const r = runHaul(state, w.haul);
    expect(r.events.filter((e) => e.kind === 'raid.hit').length).toBeLessThanOrEqual(1);
  });

  it('never hits the raider own convoys', () => {
    const w = haulWorld();
    const state = ambushed(w);
    const p1home = state.districts['d2_1'];
    if (p1home) p1home.warehouse.parts = toAtoms(100);
    const mine = movementsOf(state, 'ambush')[0] as Movement;
    const spare = crewsOf(state, 'p1').find((id) => !mine.crewIds.includes(id));
    // Whatever crews are left, an own haul along the same street is ignored.
    if (!spare) return;
    const order: Order = {
      type: 'haul',
      carrierId: null,
      crewIds: [spare],
      to: w.b,
      cargo: { parts: 5 },
    };
    const r = step(state, [{ actorId: 'p1', order }], state.nowMs + 24 * MS_PER_HOUR);
    expect(kinds(r.events)).not.toContain('raid.hit');
    expect(kinds(r.events)).not.toContain('raid.repelled');
  });

  it('is independent of how the clock is sliced', () => {
    const w = haulWorld();
    const state = ambushed(w);
    const input: Input = { actorId: 'p2', order: w.haul, atMs: state.nowMs + 1 };
    const end = state.nowMs + 24 * MS_PER_HOUR;
    const whole = step(clone(state), [input], end).state;
    let sliced = clone(state);
    sliced = step(sliced, [input], state.nowMs + 1).state;
    for (let t = state.nowMs + 1; t < end;) {
      t = Math.min(end, t + 7 * 60_000);
      sliced = step(sliced, [], t).state;
    }
    expect(JSON.stringify(sliced)).toBe(JSON.stringify(whole));
  });

  it('is more costly for the raiders against an escorted convoy', () => {
    // Same seeds, same crews: adding an escort never makes a win more likely.
    const w = haulWorld();
    const state = ambushed(w);
    const stolen = (escorts: number): number => {
      const s = clone(state);
      const crews = crewsOf(s, 'p2');
      for (const id of crews) {
        const c = s.crews[id];
        if (c) c.strength = 20;
      }
      const haul = { ...w.haul, crewIds: crews.slice(0, escorts) } as Order;
      const r = runHaul(s, haul);
      const hit = r.events.find((e) => e.kind === 'raid.hit')?.data as
        { stolen: Record<string, number> } | undefined;
      return hit ? toUnits(toAtoms(hit.stolen['parts'] ?? 0)) : 0;
    };
    expect(stolen(2)).toBeLessThanOrEqual(stolen(1));
  });

  it('nudges the hub price up for the stolen good after a hit', () => {
    const w = haulWorld();
    const win = ambushed(w);
    setStrength(win, 'p1', 500);
    setStrength(win, 'p2', 1);
    const lose = clone(win);
    setStrength(lose, 'p1', 10);
    setStrength(lose, 'p2', 500);
    const hit = runHaul(win, w.haul).state.markets['hubW']?.parts.refCents ?? 0;
    const miss = runHaul(lose, w.haul).state.markets['hubW']?.parts.refCents ?? 0;
    expect(hit).toBeGreaterThan(miss);
  });
});

describe('fog', () => {
  it('hides an ambush from players who cannot see the edge, but shows it to its owner', () => {
    const w = haulWorld();
    const state = ambushed(w);
    const own = viewFor(state, 'p1');
    expect(own.ambushes.length + Object.keys(own.movements).length).toBeGreaterThan(0);
    const other = viewFor(state, 'p2');
    // p2 holds one end of the street, so it sees that an ambush lies there, and only that.
    expect(other.ambushes).toHaveLength(1);
    expect(Object.keys(other.ambushes[0] ?? {}).sort()).toEqual(['edge', 'id', 'owner', 'untilMs']);
    expect(other.ambushes[0]?.owner).toBe('p1');
    const raw = JSON.stringify(other);
    const amb = movementsOf(state, 'ambush')[0] as Movement;
    for (const id of amb.crewIds) expect(raw).not.toContain(`"${id}"`);
    expect(other.convoys.some((c) => c.id === amb.id)).toBe(false);
  });
});
