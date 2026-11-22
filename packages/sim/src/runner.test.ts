import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, balance, toAtoms, toUnits } from './balance.js';
import { clone, crewsOf, scenario, vanOf } from './fixtures.js';
import { checkInvariants } from './invariants.js';
import { validateOrder } from './orders.js';
import { step } from './step.js';
import type { GameState, Id, Order, OrderError } from './types.js';

const buy = (districtId: Id): Order => ({ type: 'carrier.buy', districtId, kind: 'runner' });
const err = (s: GameState, order: Order, actor = 'p1'): OrderError | null => {
  const v = validateOrder(s, { actorId: actor, order });
  return v.ok ? null : v.error;
};
const runnersOf = (s: GameState, owner: Id) =>
  Object.values(s.carriers).filter((c) => c.owner === owner && c.kind === 'runner');

describe('carrier.buy', () => {
  it('costs credits, and the Runner is ready at once at that district', () => {
    const s = scenario();
    const p = s.players['p1'];
    if (p) p.credits = toAtoms(1000);
    const r = step(s, [{ actorId: 'p1', order: buy('d2_1') }], s.nowMs + 1);
    const owned = runnersOf(r.state, 'p1');
    expect(owned).toHaveLength(1);
    expect(owned[0]?.loc).toEqual({ at: 'd2_1' });
    expect(toUnits(r.state.players['p1']?.credits ?? 0)).toBe(1000 - balance.runner.credits);
    const ev = r.events.find((e) => e.kind === 'carrier.bought');
    expect(ev?.actors).toEqual(['p1']);
    expect(ev?.data).toMatchObject({ kind: 'runner', credits: balance.runner.credits });
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('rejects the wrong district, a poor buyer and a fourth Runner', () => {
    const s = scenario();
    const p = s.players['p1'];
    if (p) p.credits = toAtoms(5000);
    expect(err(s, buy('zz'))).toBe('unknown_district');
    expect(err(s, buy('d0_0'))).toBe('not_owner');
    expect(err(s, buy('hubW'))).toBe('not_owner');
    const poor = clone(s);
    const pp = poor.players['p1'];
    if (pp) pp.credits = toAtoms(balance.runner.credits - 1);
    expect(err(poor, buy('d2_1'))).toBe('insufficient_credits');
    let cur = s;
    for (let i = 0; i < balance.runner.maxOwned; i++) {
      expect(err(cur, buy('d2_1'))).toBeNull();
      cur = step(cur, [{ actorId: 'p1', order: buy('d2_1') }], cur.nowMs + 1).state;
    }
    expect(err(cur, buy('d2_1'))).toBe('too_many_carriers');
  });
});

describe('Runner on the road', () => {
  it('arrives sooner than a van over the same route', () => {
    const s = scenario();
    const p = s.players['p1'];
    if (p) p.credits = toAtoms(1000);
    const withRunner = step(s, [{ actorId: 'p1', order: buy('d2_1') }], s.nowMs + 1).state;
    const rid = runnersOf(withRunner, 'p1')[0]?.id as Id;
    const crew = crewsOf(withRunner, 'p1')[0] as Id;
    const go = (carrierId: Id) =>
      step(
        withRunner,
        [
          {
            actorId: 'p1',
            order: { type: 'move', carrierId, crewIds: [crew], to: 'd3_1' },
          },
        ],
        withRunner.nowMs + 1,
      ).state;
    const arrive = (st: GameState) =>
      Object.values(st.movements).find((m) => m.carrierId !== undefined)?.arriveMs ?? 0;
    expect(arrive(go(rid))).toBeLessThan(arrive(go(vanOf(withRunner, 'p1'))));
  });
});

/** An ambush on p2's first street, with p2 hauling a small load by Runner. */
function evasionRun(seed: number): string[] {
  const s = scenario(seed);
  const d = s.districts['d0_0'];
  if (d) d.warehouse.parts = toAtoms(100);
  s.carriers['rn'] = { id: 'rn', owner: 'p2', kind: 'runner', loc: { at: 'd0_0' } };
  const haul: Order = {
    type: 'haul',
    carrierId: 'rn',
    crewIds: [crewsOf(s, 'p2')[0] as Id],
    to: 'hubW',
    cargo: { parts: 10 },
  };
  const probe = step(s, [{ actorId: 'p2', order: haul }], s.nowMs + 1).state;
  const m = Object.values(probe.movements).find((x) => x.kind === 'haul');
  const a = m?.route[0] as Id;
  const b = m?.route[1] as Id;
  const set = step(
    s,
    [
      {
        actorId: 'p1',
        order: {
          type: 'raid',
          carrierId: vanOf(s, 'p1'),
          crewIds: crewsOf(s, 'p1').slice(0, 2),
          a,
          b,
          hours: 8,
        },
      },
    ],
    s.nowMs + 1,
  );
  let state = set.state;
  for (let i = 0; i < 48 && !Object.values(state.movements).some((x) => x.kind === 'ambush'); i++) {
    state = step(state, [], state.nowMs + MS_PER_HOUR / 4).state;
  }
  const r = step(
    state,
    [{ actorId: 'p2', order: haul, atMs: state.nowMs + 1 }],
    state.nowMs + 24 * MS_PER_HOUR,
  );
  expect(checkInvariants(r.state)).toEqual([]);
  return r.events.map((e) => e.kind);
}

describe('Runner evasion', () => {
  const runs = Array.from({ length: 24 }, (_, i) => evasionRun(i + 1));
  it('sometimes slips away and sometimes is caught, never both', () => {
    const evaded = runs.filter((k) => k.includes('raid.evaded'));
    const caught = runs.filter((k) => k.includes('raid.hit') || k.includes('raid.repelled'));
    expect(evaded.length).toBeGreaterThan(0);
    expect(caught.length).toBeGreaterThan(0);
    for (const k of runs) {
      expect(k.includes('raid.evaded') && k.includes('raid.hit')).toBe(false);
    }
  });
  it('is deterministic for a seed', () => {
    expect(evasionRun(3)).toEqual(evasionRun(3));
  });
});
