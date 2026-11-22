import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, balance, toAtoms, toUnits } from './balance.js';
import type { Ctx } from './ctx.js';
import { clone, crewsOf, scenario, vanOf } from './fixtures.js';
import { hashState } from './hash.js';
import { checkInvariants } from './invariants.js';
import { afterWarehouseChange } from './production.js';
import { progressAt } from './siege.js';
import { step } from './step.js';
import type { GameState, Id, Input, SimEvent } from './types.js';

const get = (s: GameState, id: Id) => {
  const d = s.districts[id];
  if (!d) throw new Error(`no district ${id}`);
  return d;
};

/**
 * p1 (Docks d2_1 + Grid d3_1, two crews, a van) against p2, who holds d0_0
 * (two crews, a depot and a workshop, 50 parts) and the refuge d1_0.
 */
function duel(): GameState {
  const s = scenario();
  const ctx: Ctx = { state: s, events: [] };
  const target = get(s, 'd0_0');
  target.warehouse.parts = toAtoms(50);
  target.warehouse.power = toAtoms(10);
  target.buildings = [
    { type: 'depot', level: 2 },
    { type: 'workshop', level: 1 },
  ];
  const refuge = get(s, 'd1_0');
  refuge.owner = 'p2';
  afterWarehouseChange(ctx, refuge);
  afterWarehouseChange(ctx, target);
  return s;
}

const attack = (s: GameState, target: Id = 'd0_0'): Input => ({
  actorId: 'p1',
  order: {
    type: 'siege',
    carrierId: vanOf(s, 'p1'),
    crewIds: crewsOf(s, 'p1'),
    target,
  },
});

/** Runs hour by hour until `stop` returns true, collecting events. */
function run(
  start: GameState,
  inputs: Input[],
  maxHours: number,
  stop: (events: SimEvent[]) => boolean,
): { state: GameState; events: SimEvent[]; hours: number } {
  let s = start;
  const events: SimEvent[] = [];
  let pending = inputs;
  let t = start.nowMs;
  while (t < start.nowMs + maxHours * MS_PER_HOUR) {
    t += 60_000;
    const r = step(s, pending, t);
    pending = [];
    s = r.state;
    events.push(...r.events);
    expect(checkInvariants(s)).toEqual([]);
    if (stop(events)) break;
  }
  return { state: s, events, hours: t / MS_PER_HOUR };
}

const of = (events: SimEvent[], kind: SimEvent['kind']) => events.filter((e) => e.kind === kind);

describe('siege orders', () => {
  it('rejects hubs, own districts and protected districts', () => {
    const s = duel();
    const [a, b] = crewsOf(s, 'p1') as [string, string];
    const order = (target: Id): Input => ({
      actorId: 'p1',
      order: { type: 'siege', carrierId: null, crewIds: [a], target },
    });
    const errors = (input: Input) =>
      of(step(s, [input], 1).events, 'order.rejected').map((e) => e.data['error']);
    expect(errors(order('hubW'))).toEqual(['invalid_target']);
    expect(errors(order('d3_1'))).toEqual(['invalid_target']);
    const guarded = clone(s);
    get(guarded, 'd0_0').protectedUntilMs = 5 * MS_PER_HOUR;
    expect(
      of(step(guarded, [order('d0_0')], 1).events, 'order.rejected').map((e) => e.data['error']),
    ).toEqual(['protected']);
    expect(b).toBeDefined();
  });

  it('lets a siege start once protection has ended', () => {
    const s = duel();
    get(s, 'd0_0').protectedUntilMs = 2 * MS_PER_HOUR;
    const r = step(s, [{ ...attack(s), atMs: 2 * MS_PER_HOUR }], 5 * MS_PER_HOUR);
    expect(of(r.events, 'siege.started')).toHaveLength(1);
  });

  it('reinforce brings crews to a district of your own', () => {
    const s = duel();
    const [a] = crewsOf(s, 'p1') as [string];
    const input: Input = {
      actorId: 'p1',
      order: { type: 'reinforce', carrierId: null, crewIds: [a], to: 'd3_1' },
    };
    const r = step(s, [input], 3 * MS_PER_HOUR);
    expect(get(r.state, 'd3_1').garrison).toContain(a);
    const bad: Input = {
      ...input,
      order: { type: 'reinforce', carrierId: null, crewIds: [a], to: 'd0_0' },
    };
    expect(of(step(s, [bad], 1).events, 'order.rejected')).toHaveLength(1);
  });
});

describe('a siege between two players', () => {
  const s0 = duel();
  const result = run(s0, [attack(s0)], 30, (e) => of(e, 'siege.captured').length > 0);
  const captured = of(result.events, 'siege.captured')[0] as SimEvent;
  const started = of(result.events, 'siege.started')[0] as SimEvent;
  const durationH = (captured.at - started.at) / MS_PER_HOUR;

  it('travels, starts, and captures within 6 to 12 hours of arriving', () => {
    expect(started.data['attacker']).toBe('p1');
    expect(started.data['defender']).toBe('p2');
    expect(durationH).toBeGreaterThan(6);
    expect(durationH).toBeLessThan(12);
  });

  it('emits progress every 10 percent and combat rounds every 30 minutes', () => {
    const percents = of(result.events, 'siege.progress').map((e) => e.data['percent']);
    expect(percents).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    const rounds = of(result.events, 'combat.round');
    expect(rounds.length).toBe(Math.floor((captured.at - started.at) / (30 * 60_000)));
    const gap = (rounds[1] as SimEvent).at - (rounds[0] as SimEvent).at;
    expect(gap).toBe(30 * 60_000);
  });

  it('transfers the district and keeps the attackers as its garrison', () => {
    const d = get(result.state, 'd0_0');
    expect(d.owner).toBe('p1');
    expect(d.stance).toBe('hold');
    expect(d.garrison.length).toBeGreaterThan(0);
    for (const id of d.garrison) expect(result.state.crews[id]?.owner).toBe('p1');
    expect(result.state.sieges['d0_0']).toBeUndefined();
  });

  it('lowers every building by one level', () => {
    const d = get(result.state, 'd0_0');
    expect(d.buildings).toEqual([{ type: 'depot', level: 1 }]);
  });

  it('loots 30 percent of the warehouse onto the attackers carriers', () => {
    const report = captured.data['report'] as Record<string, unknown>;
    const loot = report['loot'] as Record<string, number>;
    expect(loot['parts']).toBeLessThanOrEqual(15);
    expect(loot['parts']).toBeGreaterThan(0);
    // The goods left the warehouse and are on a haul bound for p1.
    const haul = Object.values(result.state.movements).find((m) => m.kind === 'haul');
    const delivered = of(result.events, 'arrived').some((e) => e.data['movement'] === 'haul');
    expect(haul !== undefined || delivered).toBe(true);
  });

  it('sends the garrison to the nearest district of the defender', () => {
    const report = captured.data['report'] as {
      defender: { retreatedTo: string | null; retreated: string[] };
    };
    expect(report.defender.retreatedTo).toBe('d1_0');
    expect(report.defender.retreated.length).toBe(2);
    const final = step(result.state, [], result.state.nowMs + 6 * MS_PER_HOUR).state;
    for (const id of report.defender.retreated) {
      expect(get(final, 'd1_0').garrison).toContain(id);
    }
  });

  it('writes a battle report', () => {
    const report = captured.data['report'] as {
      districtId: string;
      rounds: number;
      attacker: { started: number; lost: number };
      buildingsDamaged: unknown;
    };
    expect(report.districtId).toBe('d0_0');
    expect(report.rounds).toBeGreaterThan(5);
    expect(report.attacker.started).toBe(20);
    expect(report.attacker.lost).toBeGreaterThanOrEqual(0);
    expect(report.buildingsDamaged).toEqual([
      { building: 'depot', from: 2, to: 1 },
      { building: 'workshop', from: 1, to: 0 },
    ]);
  });
});

describe('capture rate', () => {
  const at = (s: GameState, hours: number) => {
    const r = step(s, [attack(s)], hours * MS_PER_HOUR);
    const siege = r.state.sieges['d0_0'];
    return siege ? progressAt(siege, r.state.nowMs) : -1;
  };

  it('is slower against walls', () => {
    const plain = duel();
    const walled = duel();
    get(walled, 'd0_0').buildings.push({ type: 'walls', level: 2 });
    expect(at(walled, 5)).toBeLessThan(at(plain, 5));
  });

  it('is faster against a pulled-back stance', () => {
    const hold = duel();
    const back = duel();
    get(back, 'd0_0').stance = 'pullback';
    expect(at(back, 5)).toBeGreaterThan(at(hold, 5));
  });

  it('is 10 percent faster against the season leader', () => {
    const rate = (s: GameState) => {
      const r = step(s, [attack(s)], 1.2 * MS_PER_HOUR).state.sieges['d0_0']?.rate;
      return r?.mode === 'up' ? r.bonus : -1;
    };
    const lead = duel();
    const p2 = lead.players['p2'];
    if (p2) p2.score = 100 * MS_PER_HOUR;
    expect(rate(duel())).toBe(100);
    expect(rate(lead)).toBe(110);
  });

  it('uses the strength of a neutral guard of 10', () => {
    const s = duel();
    const first = step(s, [attack(s, 'd2_0')], 5 * MS_PER_HOUR);
    const siege = first.state.sieges['d2_0'];
    expect(siege?.rate.mode).toBe('up');
    // The neutral guard is the 10 militia alone.
    if (siege && siege.rate.mode === 'up') {
      expect(siege.rate.d).toBe(10 * 100 * 100);
    }
    expect(balance.siege.militia).toBe(10);
  });
});

describe('breaking a siege', () => {
  it('lets the bar decay once the attackers leave, then breaks it', () => {
    const s0 = duel();
    const base = run(s0, [attack(s0)], 4, () => false);
    const withdraw: Input[] = crewsOf(base.state, 'p1').map((id) => ({
      actorId: 'p1',
      order: { type: 'move', carrierId: null, crewIds: [id], to: 'd2_1' },
    }));
    const withdrawn = step(base.state, withdraw, base.state.nowMs + 1);
    const siege = withdrawn.state.sieges['d0_0'];
    expect(siege?.rate.mode).toBe('down');
    const later = run(withdrawn.state, [], 20, (e) => of(e, 'siege.broken').length > 0);
    const broken = of(later.events, 'siege.broken')[0] as SimEvent;
    expect(broken.data['attacker']).toBe('p1');
    expect(later.state.sieges['d0_0']).toBeUndefined();
    expect(get(later.state, 'd0_0').owner).toBe('p2');
  });

  it('routs a crew that falls to 3 strength and sends it home on foot', () => {
    const s0 = duel();
    const [a] = crewsOf(s0, 'p1') as [string, string];
    const weak = s0.crews[a];
    if (weak) weak.strength = 3;
    const r = run(s0, [attack(s0)], 3, (e) => of(e, 'combat.round').length > 0);
    const crew = r.state.crews[a];
    expect(crew && 'movement' in crew.loc).toBe(true);
    const m = Object.values(r.state.movements).find((x) => x.crewIds.includes(a));
    expect(m?.carrierKind).toBe('foot');
    expect(m?.to).toBe('d2_1');
    expect(r.state.sieges['d0_0']?.crewIds).not.toContain(a);
  });
});

describe('capturing a neutral district', () => {
  it('works against the guard and leaves nothing behind', () => {
    const s = duel();
    const r = run(s, [attack(s, 'd2_0')], 40, (e) => of(e, 'siege.captured').length > 0);
    const cap = of(r.events, 'siege.captured')[0] as SimEvent;
    expect(cap.data['defender']).toBe('neutral');
    expect(get(r.state, 'd2_0').owner).toBe('p1');
  });
});

describe('losing the last district', () => {
  it('places the defender on a fresh protected district with their crews', () => {
    const s = duel();
    get(s, 'd1_0').owner = 'neutral';
    const r = run(s, [attack(s)], 30, (e) => of(e, 'siege.captured').length > 0);
    const joined = of(r.events, 'player.joined').find((e) => e.data['reason'] === 'relocated');
    expect(joined).toBeDefined();
    const home = joined?.districts[0] as Id;
    expect(get(r.state, home).owner).toBe('p2');
    expect(get(r.state, home).protectedUntilMs).toBeGreaterThan(r.state.nowMs);
    expect(
      Object.values(r.state.crews)
        .filter((c) => c.owner === 'p2')
        .every((c) => 'at' in c.loc && c.loc.at === home),
    ).toBe(true);
    expect(toUnits(get(r.state, home).warehouse.supplies)).toBeGreaterThan(0);
  });
});

describe('determinism with a siege', () => {
  const s0 = duel();
  const orders: Input[] = [
    { ...attack(s0), atMs: 4000 },
    {
      actorId: 'p2',
      order: { type: 'stance', districtId: 'd0_0', stance: 'pullback' },
      atMs: 3 * MS_PER_HOUR + 2000,
    },
    {
      actorId: 'p2',
      order: { type: 'stance', districtId: 'd0_0', stance: 'hold' },
      atMs: 5 * MS_PER_HOUR,
    },
    { actorId: 'p2', order: { type: 'recruit', districtId: 'd0_0' }, atMs: 6 * MS_PER_HOUR },
  ];
  const T = 14 * MS_PER_HOUR;
  const TICK = 2000;

  it('gives the same hash and events for 2 s ticks and one jump', () => {
    let ticked = s0;
    const events: SimEvent[] = [];
    for (let t = TICK; t <= T; t += TICK) {
      const due = orders.filter((o) => (o.atMs ?? 0) > t - TICK && (o.atMs ?? 0) <= t);
      const r = step(ticked, due, t);
      ticked = r.state;
      events.push(...r.events);
    }
    const jump = step(s0, orders, T);
    expect(hashState(ticked)).toBe(hashState(jump.state));
    expect(events).toEqual(jump.events);
    expect(of(jump.events, 'siege.started')).toHaveLength(1);
    expect(of(jump.events, 'combat.round').length).toBeGreaterThan(5);
    expect(checkInvariants(jump.state)).toEqual([]);
  });

  it('agrees for uneven chunk sizes, through a capture', () => {
    let s = s0;
    const times = [777, 123_457, 3_600_001, 9_999_999, 20_000_000, 40_000_000, T];
    for (const t of times) {
      s = step(
        s,
        orders.filter((o) => (o.atMs ?? 0) <= t && (o.atMs ?? 0) > s.nowMs),
        t,
      ).state;
    }
    expect(hashState(s)).toBe(hashState(step(s0, orders, T).state));
  });
});
