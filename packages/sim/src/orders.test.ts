import { describe, expect, it } from 'vitest';
import { toAtoms } from './balance.js';
import { clone, crewsOf, scenario, vanOf } from './fixtures.js';
import { validateOrder } from './orders.js';
import { step } from './step.js';
import type { Input, OrderError } from './types.js';

const s0 = scenario();
const [c1, c2] = crewsOf(s0, 'p1') as [string, string];
const van = vanOf(s0, 'p1');
const o = (order: Input['order'], actorId = 'p1'): Input => ({ actorId, order });
const err = (input: Input, state = s0): OrderError | null => {
  const v = validateOrder(state, input);
  return v.ok ? null : v.error;
};

describe('validateOrder', () => {
  it('accepts plain moves, hauls, builds, stance, recruit', () => {
    expect(err(o({ type: 'move', carrierId: null, crewIds: [c1], to: 'd3_1' }))).toBeNull();
    expect(
      err(o({ type: 'haul', carrierId: van, crewIds: [c1], to: 'd3_1', cargo: { parts: 30 } })),
    ).toBeNull();
    expect(err(o({ type: 'build', districtId: 'd2_1', building: 'workshop' }))).toBeNull();
    expect(err(o({ type: 'stance', districtId: 'd2_1', stance: 'pullback' }))).toBeNull();
    expect(err(o({ type: 'recruit', districtId: 'd2_1' }))).toBeNull();
  });
  it('rejects the wrong actor and unknown things', () => {
    expect(err(o({ type: 'move', carrierId: null, crewIds: [c1], to: 'd3_1' }, 'p2'))).toBe(
      'not_owner',
    );
    expect(err(o({ type: 'move', carrierId: null, crewIds: [c1], to: 'd3_1' }, 'ghost'))).toBe(
      'unknown_actor',
    );
    expect(err(o({ type: 'move', carrierId: null, crewIds: ['zz'], to: 'd3_1' }))).toBe(
      'unknown_crew',
    );
    expect(err(o({ type: 'move', carrierId: 'zz', crewIds: [c1], to: 'd3_1' }))).toBe(
      'unknown_carrier',
    );
    expect(err(o({ type: 'move', carrierId: null, crewIds: [c1], to: 'zz' }))).toBe(
      'unknown_district',
    );
    expect(err(o({ type: 'recall', movementId: 'm9' }))).toBe('unknown_movement');
  });
  it('enforces crews and seats', () => {
    expect(err(o({ type: 'move', carrierId: null, crewIds: [], to: 'd3_1' }))).toBe('no_crew');
    expect(err(o({ type: 'move', carrierId: null, crewIds: [c1, c1], to: 'd3_1' }))).toBe(
      'duplicate_unit',
    );
    expect(err(o({ type: 'move', carrierId: null, crewIds: [c1, c2], to: 'd3_1' }))).toBe(
      'too_many_crews',
    );
    expect(err(o({ type: 'move', carrierId: null, crewIds: [c1], to: 'd2_1' }))).toBe(
      'invalid_target',
    );
  });
  it('rejects cargo problems', () => {
    const haul = (cargo: Record<string, number>): Input =>
      o({ type: 'haul', carrierId: van, crewIds: [c1], to: 'd3_1', cargo });
    expect(err(haul({}))).toBe('empty_cargo');
    expect(err(haul({ parts: -3 }))).toBe('bad_quantity');
    expect(err(haul({ parts: 41 }))).toBe('over_capacity');
    expect(err(haul({ data: 5 }))).toBe('insufficient_goods');
  });
  it('rejects the locked Runner', () => {
    const s = clone(s0);
    s.carriers['r1'] = { id: 'r1', owner: 'p1', kind: 'runner', loc: { at: 'd2_1' } };
    expect(err(o({ type: 'move', carrierId: 'r1', crewIds: [c1], to: 'd3_1' }), s)).toBe(
      'carrier_locked',
    );
  });
  it('checks build and recruit costs', () => {
    expect(err(o({ type: 'build', districtId: 'd0_0', building: 'depot' }))).toBe('not_owner');
    expect(err(o({ type: 'build', districtId: 'd3_1', building: 'workshop' }))).toBe(
      'insufficient_goods',
    );
    const poor = clone(s0);
    const p = poor.players['p1'];
    if (p) p.credits = toAtoms(10);
    expect(err(o({ type: 'recruit', districtId: 'd2_1' }), poor)).toBe('insufficient_credits');
  });
  it('rejects building twice at once and past max level', () => {
    const { state } = step(
      s0,
      [o({ type: 'build', districtId: 'd2_1', building: 'workshop' })],
      1000,
    );
    expect(err(o({ type: 'build', districtId: 'd2_1', building: 'depot' }), state)).toBe(
      'already_building',
    );
    const maxed = clone(s0);
    maxed.districts['d2_1']?.buildings.push({ type: 'workshop', level: 3 });
    expect(err(o({ type: 'build', districtId: 'd2_1', building: 'workshop' }), maxed)).toBe(
      'max_level',
    );
  });
  it('emits order.rejected when step is given a bad order', () => {
    const { events, state } = step(s0, [o({ type: 'recruit', districtId: 'd0_0' })], 1000);
    expect(events.map((e) => e.kind)).toContain('order.rejected');
    expect(Object.keys(state.crews)).toHaveLength(Object.keys(s0.crews).length);
  });
});
