import { describe, expect, it } from 'vitest';
import { balance, MS_PER_HOUR, MS_PER_MINUTE, toAtoms, toUnits } from './balance.js';
import { hashState } from './hash.js';
import { createRng, nextFloat, nextInt, nextU32, shuffle } from './rng.js';
import { eta, shortestRoute, travelMs } from './routing.js';
import { createWorld } from './world.js';

describe('rng', () => {
  it('is reproducible from a seed and lives in plain state', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([nextU32(a), nextU32(a), nextU32(a)]).toEqual([nextU32(b), nextU32(b), nextU32(b)]);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
  it('differs by seed and stays in range', () => {
    expect(nextU32(createRng(1))).not.toBe(nextU32(createRng(2)));
    const r = createRng(9);
    for (let i = 0; i < 500; i++) {
      const f = nextFloat(r);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      expect(nextInt(r, 7)).toBeLessThan(7);
    }
  });
  it('shuffles deterministically without losing items', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const one = shuffle(createRng(3), [...items]);
    expect(shuffle(createRng(3), [...items])).toEqual(one);
    expect([...one].sort()).toEqual(items);
  });
});

describe('hashState', () => {
  it('ignores key order and changes when state changes', () => {
    const s = createWorld(1);
    const reordered = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(s).reverse())),
    ) as typeof s;
    expect(hashState(reordered)).toBe(hashState(s));
    expect(hashState({ ...s, nowMs: 1 })).not.toBe(hashState(s));
  });
});

describe('world', () => {
  const s = createWorld(5);
  it('builds the default city', () => {
    expect(Object.values(s.districts).filter((d) => d.kind !== 'hub')).toHaveLength(24);
    expect(Object.values(s.districts).filter((d) => d.kind === 'hub')).toHaveLength(2);
    expect(s.world.soundY).toBe(s.world.rows);
    expect(s.districts['d0_3']?.kind).toBe('docks');
  });
  it('is deterministic per seed and differs across seeds', () => {
    expect(hashState(createWorld(5))).toBe(hashState(s));
    expect(hashState(createWorld(6))).not.toBe(hashState(s));
  });
  it('keeps adjacent travel by van within 15-25 minutes', () => {
    for (const e of s.graph.edges) {
      if (e.a.startsWith('hub') || e.b.startsWith('hub')) continue;
      const min = travelMs(e.lengthM, 'van') / MS_PER_MINUTE;
      expect(min).toBeGreaterThanOrEqual(15);
      expect(min).toBeLessThanOrEqual(25);
    }
  });
  it('is fully connected', () => {
    for (const id of Object.keys(s.districts)) {
      expect(shortestRoute(s.graph, 'hubW', id)).not.toBeNull();
    }
  });
});

describe('routing', () => {
  const s = createWorld(5);
  it('routes between neighbours and across the city', () => {
    const near = eta(s.graph, 'd0_0', 'd1_0', 'foot');
    expect(near?.route).toEqual(['d0_0', 'd1_0']);
    const far = eta(s.graph, 'd0_0', 'd5_2', 'van');
    expect(far).not.toBeNull();
    expect(far?.route.length).toBeGreaterThan(5);
  });
  it('is faster by van than on foot, and zero-length for the same node', () => {
    const foot = eta(s.graph, 'd0_0', 'd2_2', 'foot');
    const van = eta(s.graph, 'd0_0', 'd2_2', 'van');
    expect(van?.durationMs).toBeLessThan(foot?.durationMs ?? 0);
    expect(shortestRoute(s.graph, 'd0_0', 'd0_0')?.lengthM).toBe(0);
  });
  it('returns null for unknown nodes', () => {
    expect(shortestRoute(s.graph, 'd0_0', 'nowhere')).toBeNull();
  });
});

describe('balance', () => {
  it('converts atoms exactly', () => {
    expect(toUnits(toAtoms(12.5))).toBe(12.5);
    expect(toAtoms(1)).toBe(360_000_000);
    expect(MS_PER_HOUR).toBe(3_600_000);
  });
  it('locks the runner', () => {
    expect(balance.carriers.runner.locked).toBe(true);
  });
});
