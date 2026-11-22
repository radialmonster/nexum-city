import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, balance, toAtoms } from './balance.js';
import { clone, scenario } from './fixtures.js';
import { checkInvariants } from './invariants.js';
import { step } from './step.js';
import { upkeepDistricts } from './sink.js';

const DAY = 24 * MS_PER_HOUR;

describe('credit sinks', () => {
  it('start at zero and are counted when the daily city levy and upkeep run', () => {
    const s = clone(scenario());
    expect(s.sink).toEqual({ feesAtoms: 0, upkeepAtoms: 0, levyAtoms: 0 });
    const p = s.players['p1'];
    if (!p) throw new Error('no p1');
    p.credits = toAtoms(1_000);
    const before = p.credits;
    const r = step(s, [], s.nowMs + DAY + 1);
    const after = r.state.players['p1']?.credits ?? 0;
    const taken = r.state.sink.levyAtoms + r.state.sink.upkeepAtoms;
    expect(taken).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('has the levy switched off: rich players pay upkeep only', () => {
    expect(balance.sink.levyPercent).toBe(0);
    const s = clone(scenario());
    for (const o of Object.values(s.players))
      o.credits = toAtoms(balance.sink.levyFreeCredits + 5_000);
    const r = step(s, [], s.nowMs + DAY + 1);
    expect(r.state.sink.levyAtoms).toBe(0);
    expect(r.state.sink.upkeepAtoms).toBeGreaterThan(0);
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('charges upkeep for districts beyond the free ones and never more than the player holds', () => {
    const s = clone(scenario());
    expect(upkeepDistricts(s, 'p1')).toBe(Math.max(0, 2 - balance.sink.freeDistricts));
    const p = s.players['p1'];
    if (!p) throw new Error('no p1');
    for (const o of Object.values(s.players)) o.credits = 0;
    p.credits = 0;
    const r = step(s, [], s.nowMs + DAY + 1);
    expect(r.state.players['p1']?.credits).toBeGreaterThanOrEqual(0);
    expect(r.state.sink.levyAtoms).toBe(0);
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('keeps running every day to the end of the season', () => {
    let s = clone(scenario());
    for (const p of Object.values(s.players)) p.credits = toAtoms(5_000);
    let last = 0;
    for (let d = 1; d <= 3; d++) {
      s = step(s, [], s.nowMs + DAY).state;
      const total = s.sink.levyAtoms + s.sink.upkeepAtoms;
      expect(total).toBeGreaterThanOrEqual(last);
      last = total;
    }
    expect(last).toBeGreaterThan(0);
    expect(checkInvariants(s)).toEqual([]);
  });
});
