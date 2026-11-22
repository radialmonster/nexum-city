import { describe, expect, it } from 'vitest';
import { balance } from '@nexum/sim';
import { siegeOdds } from './odds';

describe('siegeOdds', () => {
  it('has no capture time with no attackers', () => {
    const o = siegeOdds({ attackers: [], defenderCount: 1 });
    expect(o.edge).toBe(0);
    expect(o.hoursToCapture).toBe(Infinity);
  });

  it('marks a guess as estimated and exact strengths as known', () => {
    expect(siegeOdds({ attackers: [100], defenderCount: 2 }).estimated).toBe(true);
    expect(siegeOdds({ attackers: [100], defenders: [100] }).estimated).toBe(false);
  });

  it('favours more attackers, and walls help the defence and pulling back weakens it', () => {
    const base = siegeOdds({ attackers: [100], defenders: [100] });
    expect(siegeOdds({ attackers: [100, 100], defenders: [100] }).edge).toBeGreaterThan(base.edge);
    expect(siegeOdds({ attackers: [100], defenders: [100], wallsLevel: 3 }).edge).toBeLessThan(
      base.edge,
    );
    expect(siegeOdds({ attackers: [100], defenders: [100], pullback: true }).edge).toBeGreaterThan(
      base.edge,
    );
  });

  it('captures faster against the leader', () => {
    const plain = siegeOdds({ attackers: [100], defenders: [100] });
    const lead = siegeOdds({ attackers: [100], defenders: [100], leader: true });
    expect(lead.hoursToCapture).toBeLessThan(plain.hoursToCapture);
  });

  it('faces the neutral guard on an unowned plot, not the militia', () => {
    // one crew of 10 against the guard, and two crews of 10 against it
    const guard = balance.siege.neutralGuard;
    const o = siegeOdds({ attackers: [10], defenderCount: 0, neutral: true });
    expect(o.edge).toBeCloseTo(10 / (10 + guard), 2);
    expect(o.hoursToCapture).toBeGreaterThan(
      siegeOdds({ attackers: [10], defenderCount: 0 }).hoursToCapture,
    );
    expect(siegeOdds({ attackers: [10, 10], neutral: true }).edge).toBeCloseTo(
      20 / (20 + guard),
      2,
    );
  });
});
