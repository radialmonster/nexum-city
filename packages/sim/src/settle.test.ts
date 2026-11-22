import { describe, expect, it } from 'vitest';
import { ATOMS_PER_UNIT, MS_PER_HOUR, balance } from './balance.js';
import { validateOrder } from './orders.js';
import { standings } from './score.js';
import { step } from './step.js';
import type { District, GameState, Id, Input, Order } from './types.js';
import { addPlayer, createWorld } from './world.js';

const SUPPLIES = 200 * ATOMS_PER_UNIT;

function start(players = 2): GameState {
  let s = createWorld(5, { seasonHours: 24 * 7 });
  for (let i = 1; i <= players; i++) s = addPlayer(s, { id: `p${i}` });
  s = step(s, [], 3 * MS_PER_HOUR).state;
  for (const d of Object.values(s.districts))
    if (d.owner.startsWith('p')) d.warehouse.supplies = SUPPLIES;
  return s;
}

const home = (s: GameState, id: Id): District => {
  const d = Object.values(s.districts).find((x) => x.owner === id);
  if (!d) throw new Error('no home');
  return d;
};

const openPlot = (s: GameState): District => {
  const d = Object.values(s.districts).find(
    (x) => x.owner === 'neutral' && x.frontier === 'open' && x.kind !== 'hub',
  );
  if (!d) throw new Error('no open plot');
  return d;
};

const settle = (s: GameState, id: Id, target: Id, atMs = s.nowMs): Input => {
  const from = home(s, id);
  const crew = from.garrison.map((c) => s.crews[c]).find((c) => c && c.owner === id);
  const order: Order = { type: 'settle', carrierId: null, crewIds: [crew?.id ?? ''], target };
  return { actorId: id, order, atMs };
};

describe('settle order', () => {
  it('turns an open plot into the settler district after arrival plus the timer', () => {
    const s = start(1);
    const plot = openPlot(s);
    const input = settle(s, 'p1', plot.id);
    expect(validateOrder(s, input).ok).toBe(true);
    const r = step(s, [input], s.nowMs + 1);
    // The supplies are in the cargo, not the warehouse.
    expect(home(r.state, 'p1').warehouse.supplies).toBe(
      SUPPLIES - balance.settle.supplies * ATOMS_PER_UNIT,
    );
    // Walk and wait it out; the plot starts and then finishes.
    const done = step(r.state, [], r.state.nowMs + 72 * MS_PER_HOUR);
    const kinds = done.events.map((e) => e.kind);
    expect(kinds).toContain('settle.started');
    expect(kinds).toContain('settle.done');
    expect(done.state.districts[plot.id]?.owner).toBe('p1');
    expect(done.state.districts[plot.id]?.settling).toBeUndefined();
  });

  it('does not own the plot before the timer ends', () => {
    const s = start(1);
    const plot = openPlot(s);
    const first = step(s, [settle(s, 'p1', plot.id)], s.nowMs + 1);
    const started = step(first.state, [], first.state.nowMs + 1).state;
    let state = started;
    // Step hour by hour until the timer starts.
    for (let i = 0; i < 72 && !state.districts[plot.id]?.settling; i++) {
      state = step(state, [], state.nowMs + MS_PER_HOUR).state;
    }
    const d = state.districts[plot.id];
    expect(d?.settling?.owner).toBe('p1');
    expect(d?.owner).toBe('neutral');
    const at = d?.settling?.completesAtMs ?? 0;
    expect(at - (d?.settling?.startedMs ?? 0)).toBe(balance.settle.hours * MS_PER_HOUR);
    const almost = step(state, [], at - 1).state;
    expect(almost.districts[plot.id]?.owner).toBe('neutral');
    const after = step(almost, [], at).state;
    expect(after.districts[plot.id]?.owner).toBe('p1');
  });

  it('rejects owned plots, hubs and plots someone is already settling', () => {
    const s = start(2);
    const mine = home(s, 'p1');
    const bad = settle(s, 'p1', home(s, 'p2').id);
    const verdict = validateOrder(s, bad);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toBe('not_open_plot');
    expect(mine.id).not.toBe(bad.order.type === 'settle' ? bad.order.target : '');
    const plot = openPlot(s);
    plot.settling = { owner: 'p2', crewIds: [], startedMs: s.nowMs, completesAtMs: s.nowMs + 1 };
    const taken = validateOrder(s, settle(s, 'p1', plot.id));
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.error).toBe('already_settling');
  });

  it('rejects a settle order without enough supplies', () => {
    const s = start(1);
    home(s, 'p1').warehouse.supplies = 10 * ATOMS_PER_UNIT;
    const verdict = validateOrder(s, settle(s, 'p1', openPlot(s).id));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toBe('insufficient_goods');
  });

  it('turns the second settler back and refunds the supplies', () => {
    const s = start(2);
    for (const id of ['p1', 'p2']) {
      const w = home(s, id).warehouse;
      w.parts = 0;
      w.power = 0;
      w.data = 0;
      w.supplies = 100 * ATOMS_PER_UNIT;
    }
    const plot = openPlot(s);
    let state = step(s, [settle(s, 'p1', plot.id), settle(s, 'p2', plot.id)], s.nowMs + 1).state;
    let failed: { data: Record<string, unknown> } | undefined;
    let before = 0;
    for (let i = 0; i < 40 && !failed; i++) {
      const r = step(state, [], state.nowMs + MS_PER_HOUR);
      before = Math.min(...['p1', 'p2'].map((id) => home(state, id).warehouse.supplies));
      state = r.state;
      failed = r.events.find((e) => e.kind === 'settle.failed');
    }
    expect(failed?.data['reason']).toBe('taken');
    const loser = String(failed?.data['owner']);
    // The refund lands back in the loser's warehouse: well above where it stood a step earlier.
    expect(home(state, loser).warehouse.supplies).toBeGreaterThan(before + 10 * ATOMS_PER_UNIT);
  });
});

describe('neutral guard and loot', () => {
  it('keeps the neutral guard above the old value of 10', () => {
    expect(balance.siege.neutralGuard).toBeGreaterThan(balance.siege.militia);
    expect(balance.siege.neutralLootPercent).toBeLessThan(25);
  });
});

describe('trade score', () => {
  it('starts every standing at zero and is part of the standings rows', () => {
    const s = start(2);
    for (const row of standings(s)) {
      expect(row.tradeScore).toBe(0);
      expect(row.tradeMs).toBe(0);
    }
  });
});
