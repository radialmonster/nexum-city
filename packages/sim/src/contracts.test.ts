import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, balance, toAtoms, toUnits } from './balance.js';
import { depositFor } from './contracts.js';
import { clone, crewsOf, scenario, vanOf } from './fixtures.js';
import { viewFor } from './fog.js';
import { checkInvariants } from './invariants.js';
import { validateOrder } from './orders.js';
import { standings } from './score.js';
import { step } from './step.js';
import type { GameState, Id, Input, Order, OrderError, SimEvent } from './types.js';

const C = balance.contracts;

/** p2 posts a 40-parts job at the west hub for 500 credits; p1 (with parts at d2_1) can take it. */
function posted(reward = 500, qty = 40, hours = 12): { s: GameState; id: Id } {
  let s = scenario();
  (s.players['p2'] as { credits: number }).credits = toAtoms(5000);
  const post: Input = {
    actorId: 'p2',
    order: { type: 'contract.post', hub: 'hubW', good: 'parts', qty, reward, hours },
    atMs: s.nowMs,
  };
  const r = step(s, [post], s.nowMs + 1);
  s = r.state;
  const id = Object.keys(s.contracts)[0] as Id;
  expect(r.events.map((e) => e.kind)).toContain('contract.posted');
  return { s, id };
}

const err = (s: GameState, actor: Id, order: Order): OrderError | null => {
  const v = validateOrder(s, { actorId: actor, order });
  return v.ok ? null : v.error;
};
const credits = (s: GameState, id: Id): number => toUnits(s.players[id]?.credits ?? 0);

function take(s: GameState, id: Id, actor = 'p1'): { s: GameState; events: SimEvent[] } {
  const r = step(
    s,
    [{ actorId: actor, order: { type: 'contract.take', contractId: id } }],
    s.nowMs + 1,
  );
  return { s: r.state, events: r.events };
}

function haul(s: GameState, id: Id, qty: number): Order {
  return {
    type: 'haul',
    carrierId: vanOf(s, 'p1'),
    crewIds: [crewsOf(s, 'p1')[0] as Id],
    to: 'hubW',
    cargo: { parts: qty },
    contractId: id,
  };
}

function run(s: GameState, hours: number): { s: GameState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  let state = s;
  const end = s.nowMs + hours * MS_PER_HOUR;
  while (state.nowMs < end) {
    const r = step(state, [], Math.min(end, state.nowMs + MS_PER_HOUR / 4));
    state = r.state;
    events.push(...r.events);
  }
  return { s: state, events };
}

describe('contracts board', () => {
  it('escrows the reward when a player posts', () => {
    const { s, id } = posted(500);
    expect(credits(s, 'p2')).toBeCloseTo(5000 - 500);
    expect(s.contracts[id]).toMatchObject({ poster: 'p2', status: 'open', hub: 'hubW' });
    expect(checkInvariants(s)).toEqual([]);
  });

  it('refuses bad posts', () => {
    const s = scenario();
    const post = (o: Partial<Extract<Order, { type: 'contract.post' }>>): Order => ({
      type: 'contract.post',
      hub: 'hubW',
      good: 'parts',
      qty: 40,
      reward: 500,
      hours: 12,
      ...o,
    });
    expect(err(s, 'p2', post({ hub: 'd0_0' }))).not.toBeNull();
    expect(err(s, 'p2', post({ hours: C.maxHours + 1 }))).toBe('bad_window');
    expect(err(s, 'p2', post({ qty: C.maxQty + 5 }))).toBe('bad_quantity');
    expect(err(s, 'p2', post({ reward: 1 }))).toBe('bad_reward');
    (s.players['p2'] as { credits: number }).credits = toAtoms(100);
    expect(err(s, 'p2', post({ reward: 500 }))).toBe('insufficient_credits');
    (s.players['p2'] as { credits: number }).credits = toAtoms(5000);
    expect(err(s, 'p2', post({}))).toBeNull();
  });

  it('takes with a deposit, one taker, not your own', () => {
    const { s, id } = posted(500);
    expect(err(s, 'p2', { type: 'contract.take', contractId: id })).toBe('own_contract');
    expect(err(s, 'p1', { type: 'contract.take', contractId: 'nope' })).toBe('unknown_contract');
    const before = credits(s, 'p1');
    const t = take(s, id);
    expect(t.s.contracts[id]).toMatchObject({ status: 'taken', taker: 'p1' });
    expect(credits(t.s, 'p1')).toBeCloseTo(before - toUnits(depositFor(toAtoms(500))));
    expect(t.events.map((e) => e.kind)).toContain('contract.taken');
    expect(err(t.s, 'p3', { type: 'contract.take', contractId: id })).not.toBeNull();
    expect(checkInvariants(t.s)).toEqual([]);
  });

  it('only the taker may haul for it, with the right good and hub', () => {
    const { s, id } = posted();
    const t = take(s, id).s;
    expect(err(t, 'p1', haul(t, id, 40))).toBeNull();
    expect(err(t, 'p1', { ...(haul(t, id, 40) as object), to: 'hubE' } as Order)).not.toBeNull();
    expect(err(t, 'p1', { ...(haul(t, id, 40) as object), cargo: { power: 10 } } as Order)).toBe(
      'wrong_cargo',
    );
    expect(err(s, 'p1', haul(s, id, 40))).toBe('not_taker');
  });

  it('pays the taker on full delivery and returns the deposit', () => {
    const { s, id } = posted(500);
    const t = take(s, id).s;
    const p1 = credits(t, 'p1');
    const p2 = credits(t, 'p2');
    const sent = step(t, [{ actorId: 'p1', order: haul(t, id, 40) }], t.nowMs + 1);
    const done = run(sent.state, 12);
    const kinds = done.events.map((e) => e.kind);
    expect(kinds).toContain('contract.done');
    expect(done.s.contracts[id]).toBeUndefined();
    // Reward 500 plus the deposit back; the poster paid the escrow up front.
    expect(credits(done.s, 'p1')).toBeCloseTo(p1 + 500 + toUnits(depositFor(toAtoms(500))));
    expect(credits(done.s, 'p2')).toBeCloseTo(p2);
    expect(done.s.districts['hubW']).toBeDefined();
    expect(checkInvariants(done.s)).toEqual([]);
  });

  it('counts partial deliveries and pays pro rata', () => {
    const { s, id } = posted(400, 40);
    let t = take(s, id).s;
    const first = step(t, [{ actorId: 'p1', order: haul(t, id, 20) }], t.nowMs + 1);
    const a = run(first.state, 8);
    expect(a.events.map((e) => e.kind)).toContain('contract.progress');
    t = a.s;
    // Bring the van and crew home (the harness bots do this with a plain haul back).
    for (const u of [...Object.values(t.carriers), ...Object.values(t.crews)]) {
      if (u.owner === 'p1') u.loc = { at: 'd2_1' };
    }
    const c = t.contracts[id];
    expect(c?.status).toBe('taken');
    expect(toUnits(c?.delivered ?? 0)).toBeCloseTo(20);
    expect(toUnits(c?.paid ?? 0)).toBeCloseTo(200);
    const second = step(t, [{ actorId: 'p1', order: haul(t, id, 20) }], t.nowMs + 1);
    const b = run(second.state, 8);
    expect(b.events.map((e) => e.kind)).toContain('contract.done');
    expect(checkInvariants(b.s)).toEqual([]);
  });

  it('fails late: deposit lost, escrow refunded to the poster', () => {
    const { s, id } = posted(500, 40, 6);
    const t = take(s, id).s;
    const p2 = credits(t, 'p2');
    const late = run(t, 7);
    const failed = late.events.find((e) => e.kind === 'contract.failed');
    expect(failed).toBeDefined();
    expect(late.s.contracts[id]).toBeUndefined();
    // Escrow back plus the forfeited deposit.
    expect(credits(late.s, 'p2')).toBeCloseTo(p2 + 500 + toUnits(depositFor(toAtoms(500))));
    expect(checkInvariants(late.s)).toEqual([]);
  });

  it('expires an untaken contract and refunds the poster', () => {
    const { s, id } = posted(500);
    const before = credits(s, 'p2');
    const r = run(s, C.offerHours + 1);
    expect(r.s.contracts[id]).toBeUndefined();
    expect(r.events.find((e) => e.kind === 'contract.expired')?.data['reason']).toBe('untaken');
    expect(credits(r.s, 'p2')).toBeCloseTo(before + 500);
  });

  it('lets the poster cancel an open contract only', () => {
    const { s, id } = posted(500);
    expect(err(s, 'p1', { type: 'contract.cancel', contractId: id })).toBe('not_owner');
    expect(err(s, 'p2', { type: 'contract.cancel', contractId: id })).toBeNull();
    const r = step(
      s,
      [{ actorId: 'p2', order: { type: 'contract.cancel', contractId: id } }],
      s.nowMs + 1,
    );
    expect(r.state.contracts[id]).toBeUndefined();
    const t = take(s, id).s;
    expect(err(t, 'p2', { type: 'contract.cancel', contractId: id })).toBe('contract_taken');
  });

  it('caps the board and what one player may post', () => {
    let s = scenario();
    for (let i = 0; i < C.maxPosted; i++) {
      const r = step(
        s,
        [
          {
            actorId: 'p2',
            order: {
              type: 'contract.post',
              hub: 'hubW',
              good: 'parts',
              qty: 10,
              reward: 100,
              hours: 12,
            },
          },
        ],
        s.nowMs + 1,
      );
      s = r.state;
    }
    expect(
      err(s, 'p2', {
        type: 'contract.post',
        hub: 'hubW',
        good: 'parts',
        qty: 10,
        reward: 100,
        hours: 12,
      }),
    ).toBe('too_many_contracts');
  });

  it('posts civic contracts on a cadence, deterministically, within the cap', () => {
    const a = run(scenario(), 48);
    const b = run(scenario(), 48);
    expect(JSON.stringify(a.s.contracts)).toBe(JSON.stringify(b.s.contracts));
    const civic = a.events.filter((e) => e.kind === 'contract.posted');
    expect(civic.length).toBeGreaterThan(0);
    for (const hub of ['hubW', 'hubE']) {
      expect(Object.values(a.s.contracts).filter((c) => c.hub === hub).length).toBeLessThanOrEqual(
        C.boardCap,
      );
    }
    expect(checkInvariants(a.s)).toEqual([]);
  });

  it('hides progress of other players contracts', () => {
    const { s, id } = posted(400, 40);
    const t = take(s, id).s;
    const sent = step(t, [{ actorId: 'p1', order: haul(t, id, 20) }], t.nowMs + 1);
    const a = run(sent.state, 8).s;
    expect(viewFor(a, 'p1').contracts[id]?.delivered).not.toBeNull();
    expect(viewFor(a, 'p2').contracts[id]?.delivered).not.toBeNull();
    const m = clone(a);
    m.players['p3'] = clone(m.players['p1']) as never;
    const other = viewFor(m, 'p3').contracts[id];
    expect(other?.taker).toBe('p1');
    expect(other?.delivered).toBeNull();
    expect(other?.paid).toBeNull();
  });

  it('gives score on completion, capped per day', () => {
    const { s, id } = posted(2000, 40, 12);
    const t = take(s, id).s;
    const sent = step(t, [{ actorId: 'p1', order: haul(t, id, 40) }], t.nowMs + 1);
    const done = run(sent.state, 12).s;
    const mine = standings(done).find((x) => x.playerId === 'p1');
    expect(mine?.contractScore).toBeGreaterThan(0);
    expect(mine?.contractScore).toBeLessThanOrEqual(balance.contractScore.dailyCapPoints);
  });
});
