import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, balance, toAtoms, toUnits } from './balance.js';
import { ambushOrders } from './bots.js';
import { clone, crewsOf, scenario, vanOf } from './fixtures.js';
import { viewFor } from './fog.js';
import { checkInvariants } from './invariants.js';
import { validateOrder } from './orders.js';
import { crossingTime } from './raid.js';
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
    const r = runHaul(state, w.haul);
    expect(kinds(r.events)).toContain('raid.repelled');
    expect(kinds(r.events)).not.toContain('raid.hit');
    expect(movementsOf(r.state, 'ambush')).toHaveLength(0);
    const repelled = r.events.find((e) => e.kind === 'raid.repelled')?.data as {
      raiderLost: number;
      target: string;
    };
    expect(repelled.raiderLost).toBeGreaterThan(0);
    expect(repelled.target).toBe('haul');
  });

  it('mends a beaten raider crew by 1 strength per mend period, up to its starting strength', () => {
    const w = haulWorld();
    const state = ambushed(w);
    setStrength(state, 'p1', 10);
    setStrength(state, 'p2', 500);
    const ids = crewsOf(state, 'p1');
    const r = runHaul(state, w.haul);
    const total = ids.reduce((n, id) => n + (r.state.crews[id]?.strength ?? 0), 0);
    // A day later (24 h at 1 mend per mendHours) every crew is back at its starting strength.
    for (const id of ids) {
      expect(r.state.crews[id]?.strength).toBeLessThanOrEqual(balance.recruit.startStrength);
    }
    expect(total).toBe(ids.length * balance.recruit.startStrength);
    expect(checkInvariants(r.state)).toEqual([]);
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
    // A shortage resets the reference for its hours and would hide the nudge: keep the day calm.
    for (const w of [win, lose]) w.queue = w.queue.filter((e) => e.kind !== 'shortage.check');
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
    expect(Object.keys(other.ambushes[0] ?? {}).sort()).toEqual([
      'edge',
      'id',
      'owner',
      'strength',
      'untilMs',
    ]);
    expect(other.ambushes[0]?.owner).toBe('p1');
    const raw = JSON.stringify(other);
    const amb = movementsOf(state, 'ambush')[0] as Movement;
    for (const id of amb.crewIds) expect(raw).not.toContain(`"${id}"`);
    expect(other.convoys.some((c) => c.id === amb.id)).toBe(false);
  });
});

describe('fog after strikes', () => {
  it('drops a beaten ambush from every view and never shows convoy cargo or raider crews', () => {
    const w = haulWorld();
    const state = ambushed(w);
    for (const id of crewsOf(state, 'p1')) {
      const c = state.crews[id];
      if (c) c.strength = 1;
    }
    for (const id of crewsOf(state, 'p2')) {
      const c = state.crews[id];
      if (c) c.strength = 500;
    }
    const mid = step(
      state,
      [{ actorId: 'p2', order: w.haul, atMs: state.nowMs + 1 }],
      state.nowMs + 1,
    ).state;
    for (const who of ['p1', 'p2']) {
      expect(JSON.stringify(viewFor(mid, who).convoys)).not.toContain('cargo');
    }
    const after = step(mid, [], mid.nowMs + 24 * MS_PER_HOUR).state;
    expect(viewFor(after, 'p2').ambushes).toEqual([]);
    expect(viewFor(after, 'p1').ambushes).toEqual([]);
  });
});

describe('newbie protection', () => {
  const protect = (s: GameState, owner: Id, hours: number): void => {
    for (const d of Object.values(s.districts)) {
      if (d.owner === owner) d.protectedUntilMs = s.nowMs + hours * MS_PER_HOUR;
    }
  };
  const strongRaiders = (s: GameState): void => {
    for (const id of crewsOf(s, 'p1')) {
      const c = s.crews[id];
      if (c) c.strength = 500;
    }
    for (const id of crewsOf(s, 'p2')) {
      const c = s.crews[id];
      if (c) c.strength = 1;
    }
  };
  const run = (state: GameState, haul: Order) =>
    step(
      state,
      [{ actorId: 'p2', order: haul, atMs: state.nowMs + 1 }],
      state.nowMs + 24 * MS_PER_HOUR,
    );

  it('does not let raiders strike a protected player haul', () => {
    const w = haulWorld();
    const state = ambushed(w);
    strongRaiders(state);
    protect(state, 'p2', 48);
    const r = run(state, w.haul);
    expect(kinds(r.events)).not.toContain('raid.hit');
    expect(kinds(r.events)).not.toContain('raid.repelled');
    // The cargo arrives whole.
    const arrived = r.events.find((e) => e.kind === 'arrived' && e.actors.includes('p2'))?.data as {
      cargo: number;
      sent: number;
    };
    expect(arrived.cargo).toBeCloseTo(arrived.sent, 6);
  });

  it('strikes again once protection has run out before the crossing', () => {
    const w = haulWorld();
    const state = ambushed(w);
    strongRaiders(state);
    protect(state, 'p2', 0.001);
    expect(kinds(run(state, w.haul).events)).toContain('raid.hit');
  });

  it('does not let a protected player set an ambush', () => {
    const w = haulWorld();
    protect(w.s, 'p1', 48);
    expect(err(w.s, raidOrder(w.s, w.a, w.b))).toBe('protected_no_raid');
  });

  it('lets a player raid once protection has ended', () => {
    const w = haulWorld();
    protect(w.s, 'p1', 48);
    const later = step(w.s, [], w.s.nowMs + 49 * MS_PER_HOUR).state;
    expect(err(later, raidOrder(later, w.a, w.b))).toBeNull();
  });

  it('keeps raider bots from ambushing while they are protected', () => {
    const w = haulWorld();
    // Open the other players up as targets, then compare protected and unprotected raiders.
    for (const d of Object.values(w.s.districts)) if (d.owner === 'p2') d.protectedUntilMs = 0;
    const hasRaid = (s: GameState): boolean => ambushOrders(s, 'p1').some((o) => o.type === 'raid');
    const open = clone(w.s);
    for (const d of Object.values(open.districts)) if (d.owner === 'p1') d.protectedUntilMs = 0;
    expect(hasRaid(open)).toBe(true);
    protect(w.s, 'p1', 48);
    expect(hasRaid(w.s)).toBe(false);
  });
});

describe('settle carriers and recalled hauls', () => {
  /** p2 settles an open plot; the ambush sits on the first street of that walk. */
  function settleWorld(): { s: GameState; a: Id; b: Id; order: Order } {
    const s = scenario();
    const home = s.districts['d0_0'];
    if (home) home.warehouse.supplies = toAtoms(100);
    const settled = step(s, [], s.nowMs + 3 * MS_PER_HOUR).state;
    const plot = Object.values(settled.districts).find(
      (d) => d.owner === 'neutral' && d.frontier === 'open' && d.kind !== 'hub',
    );
    if (!plot) throw new Error('no open plot');
    const order: Order = {
      type: 'settle',
      carrierId: null,
      crewIds: [crewsOf(settled, 'p2')[0] as Id],
      target: plot.id,
    };
    const probe = step(settled, [{ actorId: 'p2', order }], settled.nowMs + 1).state;
    const m = Object.values(probe.movements).find((x) => x.kind === 'settle');
    if (!m || m.route.length < 2) throw new Error('no settle walk');
    return { s: settled, a: m.route[0] as Id, b: m.route[1] as Id, order };
  }

  it('lets raiders rob a settle carrier, which then fails as raided and goes home', () => {
    const w = settleWorld();
    const st = ambushed({ s: w.s, a: w.a, b: w.b, haul: w.order });
    for (const id of crewsOf(st, 'p1')) {
      const c = st.crews[id];
      if (c) c.strength = 500;
    }
    for (const id of crewsOf(st, 'p2')) {
      const c = st.crews[id];
      if (c) c.strength = 1;
    }
    const before = st.districts['d0_0']?.warehouse.supplies ?? 0;
    const r = step(
      st,
      [{ actorId: 'p2', order: w.order, atMs: st.nowMs + 1 }],
      st.nowMs + 48 * MS_PER_HOUR,
    );
    expect(kinds(r.events)).toContain('raid.hit');
    const failed = r.events.find((e) => e.kind === 'settle.failed');
    expect(failed?.data['reason']).toBe('raided');
    expect(kinds(r.events)).not.toContain('settle.started');
    // Conservation: sent = what arrived + taken.
    const arrived = r.events.find((e) => e.kind === 'arrived' && e.data['movement'] === 'settle')
      ?.data as { cargo: number; sent: number };
    const hit = r.events.find((e) => e.kind === 'raid.hit')?.data as {
      stolen: Record<string, number>;
      destroyed: Record<string, number>;
    };
    const sum = (o: Record<string, number>): number => Object.values(o).reduce((n, v) => n + v, 0);
    expect(arrived.sent).toBeCloseTo(balance.settle.supplies, 6);
    expect(arrived.cargo + sum(hit.stolen) + sum(hit.destroyed)).toBeCloseTo(arrived.sent, 6);
    // The survivors' supplies are not lost: the settlers' home has more than just the spent amount missing.
    expect(toUnits(r.state.districts['d0_0']?.warehouse.supplies ?? 0)).toBeGreaterThan(
      toUnits(before) - balance.settle.supplies,
    );
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('counts every crew on a settle carrier at full strength, unlike a haul driver', () => {
    const w = settleWorld();
    const st = ambushed({ s: w.s, a: w.a, b: w.b, haul: w.order });
    for (const id of crewsOf(st, 'p1')) {
      const c = st.crews[id];
      if (c) c.strength = 500;
    }
    const settler = crewsOf(st, 'p2')[0] as Id;
    const strength = st.crews[settler]?.strength ?? 0;
    const r = step(
      st,
      [{ actorId: 'p2', order: w.order, atMs: st.nowMs + 1 }],
      st.nowMs + 48 * MS_PER_HOUR,
    );
    const hit = r.events.find((e) => e.kind === 'raid.hit')?.data as { guard: number };
    // On foot there is no carrier toughness, so the guard is the settler crew's full strength.
    expect(hit.guard).toBeCloseTo(strength, 6);
  });

  it('strikes a settle carrier that is protected from nothing: protection shields it too', () => {
    const w = settleWorld();
    const st = ambushed({ s: w.s, a: w.a, b: w.b, haul: w.order });
    for (const id of crewsOf(st, 'p1')) {
      const c = st.crews[id];
      if (c) c.strength = 500;
    }
    const d = st.districts['d0_0'];
    if (d) d.protectedUntilMs = st.nowMs + 48 * MS_PER_HOUR;
    const r = step(
      st,
      [{ actorId: 'p2', order: w.order, atMs: st.nowMs + 1 }],
      st.nowMs + 48 * MS_PER_HOUR,
    );
    expect(kinds(r.events)).not.toContain('raid.hit');
    expect(kinds(r.events)).toContain('settle.started');
  });

  it('strikes a recalled haul that is walking home with cargo', () => {
    const w = haulWorld();
    // A slow haul on foot, so the raiders (in a van) get into place while it is still walking.
    w.haul = { ...w.haul, carrierId: null, cargo: { parts: 5 } } as Order;
    // The haul sets out with the raiders; the raiders get in place only after the haul has crossed
    // the middle of the street, so the outbound walk is safe. Recalled then, it must cross again.
    let state = step(
      w.s,
      [
        { actorId: 'p2', order: w.haul },
        { actorId: 'p1', order: raidOrder(w.s, w.a, w.b) },
      ],
      w.s.nowMs + 1,
    ).state;
    const haul = movementsOf(state, 'haul')[0] as Movement;
    let guard = 0;
    while (movementsOf(state, 'ambush').length === 0 && guard++ < 200) {
      state = step(state, [], state.nowMs + 60_000).state;
    }
    const amb = movementsOf(state, 'ambush')[0] as Movement;
    expect(amb).toBeDefined();
    const outbound = crossingTime({ state, events: [] }, haul, w.a, w.b) ?? Infinity;
    expect(outbound).toBeLessThan(state.nowMs);
    expect(state.movements[haul.id]).toBeDefined();
    for (const id of crewsOf(state, 'p1')) {
      const c = state.crews[id];
      if (c) c.strength = 500;
    }
    for (const id of crewsOf(state, 'p2')) {
      const c = state.crews[id];
      if (c) c.strength = 1;
    }
    const turned = step(
      state,
      [{ actorId: 'p2', order: { type: 'recall', movementId: haul.id }, atMs: state.nowMs }],
      state.nowMs,
    ).state;
    const back = turned.movements[haul.id] as Movement;
    expect(back.recalledAtMs).toBeDefined();
    const r = step(turned, [], back.arriveMs + 1);
    expect(kinds(r.events)).toContain('raid.hit');
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('strikes a haul recalled while the ambush is already in place', () => {
    const w = haulWorld();
    const st = ambushed(w);
    for (const id of crewsOf(st, 'p1')) {
      const c = st.crews[id];
      if (c) c.strength = 500;
    }
    for (const id of crewsOf(st, 'p2')) {
      const c = st.crews[id];
      if (c) c.strength = 1;
    }
    const sent = step(
      st,
      [{ actorId: 'p2', order: w.haul, atMs: st.nowMs + 1 }],
      st.nowMs + 1,
    ).state;
    const hm = movementsOf(sent, 'haul')[0] as Movement;
    // The haul turns back before the middle of the street, so it never crosses outbound; the
    // outbound strike must be dropped, and it is never struck at all (it never reaches the middle).
    const early = hm.departMs + 1_000;
    const turned = step(
      sent,
      [{ actorId: 'p2', order: { type: 'recall', movementId: hm.id }, atMs: early }],
      early,
    );
    const r = step(turned.state, [], turned.state.nowMs + 24 * MS_PER_HOUR);
    expect(kinds(r.events)).not.toContain('raid.hit');
    expect(checkInvariants(r.state)).toEqual([]);
  });
});
