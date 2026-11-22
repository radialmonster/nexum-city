import { describe, expect, it } from 'vitest';
import { crewName, empireSummary, whoIs } from './derive';
import { makeView } from './testing';

describe('crew names', () => {
  it('resolves names, you, and falls back to a short id', () => {
    expect(whoIs({ rival: 'Iron Wolves' }, 'me', 'rival')).toBe('Iron Wolves');
    expect(whoIs({}, 'me', 'me')).toBe('You');
    expect(crewName({}, 'abcdef0123456789').length).toBeGreaterThan(0);
  });
});

describe('empireSummary', () => {
  it('counts what the player holds', () => {
    const e = empireSummary(makeView());
    expect(e.districts).toBeGreaterThanOrEqual(0);
    expect(e.totalPerHour).toBeGreaterThanOrEqual(0);
    expect(e.besieged).toBeLessThanOrEqual(e.districts);
  });
});
