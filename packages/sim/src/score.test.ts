import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, balance } from './balance.js';
import { scenario } from './fixtures.js';
import { hashState } from './hash.js';
import { checkInvariants } from './invariants.js';
import { standings } from './score.js';
import { step } from './step.js';
import { addPlayer } from './world.js';
import type { Input } from './types.js';

describe('season clock', () => {
  it('spans 168 hours with a finale for the last 48', () => {
    const s = scenario();
    expect(s.season.startMs).toBe(0);
    expect(s.season.endMs).toBe(168 * MS_PER_HOUR);
    expect(s.season.finaleStartMs).toBe(120 * MS_PER_HOUR);
    expect(s.season.finale).toBe(false);
  });

  it('flags the finale at the first tick at or after its start', () => {
    const s = scenario();
    const before = step(s, [], 119 * MS_PER_HOUR + 1);
    expect(before.state.season.finale).toBe(false);
    const after = step(before.state, [], 121 * MS_PER_HOUR);
    expect(after.state.season.finale).toBe(true);
    const tick = after.events.filter((e) => e.kind === 'score.tick').at(-1);
    expect(tick?.data['finale']).toBe(true);
  });

  it('refuses new players once the finale has begun', () => {
    const s = step(scenario(), [], 121 * MS_PER_HOUR).state;
    expect(() => addPlayer(s, { id: 'p9', districtId: 'd5_0' })).toThrow(/finale/);
  });

  it('stops scoring at the season end', () => {
    const s = step(scenario(), [], 200 * MS_PER_HOUR).state;
    expect(s.players['p1']?.score).toBe(2 * 168 * MS_PER_HOUR);
    expect(s.players['p2']?.score).toBe(168 * MS_PER_HOUR);
  });
});

describe('district-hours', () => {
  it('integrates exactly regardless of how time is sliced', () => {
    const jump = step(scenario(), [], 7 * MS_PER_HOUR + 12_345);
    let s = scenario();
    for (let t = 2000; t <= 7 * MS_PER_HOUR + 12_345; t += 2000) s = step(s, [], t).state;
    s = step(s, [], 7 * MS_PER_HOUR + 12_345).state;
    expect(s.players['p1']?.score).toBe(2 * (7 * MS_PER_HOUR + 12_345));
    expect(s.players['p2']?.score).toBe(7 * MS_PER_HOUR + 12_345);
    expect(hashState(s)).toBe(hashState(jump.state));
  });

  it('emits one score.tick per hour with standings', () => {
    const r = step(scenario(), [], 5 * MS_PER_HOUR);
    const ticks = r.events.filter((e) => e.kind === 'score.tick');
    expect(ticks.map((e) => e.at)).toEqual([1, 2, 3, 4, 5].map((h) => h * MS_PER_HOUR));
    expect(ticks.map((e) => e.data['hour'])).toEqual([1, 2, 3, 4, 5]);
    const last = ticks[4]?.data['standings'] as { playerId: string; score: number }[];
    expect(last[0]).toMatchObject({ rank: 1, playerId: 'p1', score: 10 });
    expect(last[1]).toMatchObject({ rank: 2, playerId: 'p2', score: 5 });
    expect(ticks[4]?.data['leaderId']).toBe('p1');
    expect(ticks[4]?.data['belowMedian']).toEqual(['p2']);
  });

  it('ranks players with the standings helper', () => {
    const s = step(scenario(), [], 3 * MS_PER_HOUR).state;
    expect(standings(s)).toEqual([
      {
        rank: 1,
        playerId: 'p1',
        score: 6,
        scoreMs: 6 * MS_PER_HOUR,
        districts: 2,
        tradeScore: 0,
        tradeMs: 0,
        contractScore: 0,
        contractMs: 0,
      },
      {
        rank: 2,
        playerId: 'p2',
        score: 3,
        scoreMs: 3 * MS_PER_HOUR,
        districts: 1,
        tradeScore: 0,
        tradeMs: 0,
        contractScore: 0,
        contractMs: 0,
      },
    ]);
  });

  it('gives no leader and nobody below the median on a tie', () => {
    const s = scenario();
    const d = s.districts['d3_1'];
    if (d) d.owner = 'neutral';
    const r = step(s, [], 2 * MS_PER_HOUR).state;
    expect(r.season.leaderId).toBeNull();
    expect(r.season.belowMedian).toEqual([]);
  });
});

describe('catch-up modifiers', () => {
  const recruit = (actorId: string, atMs: number): Input => ({
    actorId,
    order: { type: 'recruit', districtId: actorId === 'p1' ? 'd2_1' : 'd0_0' },
    atMs,
  });

  it('lets below-median players recruit 25 percent faster', () => {
    const s = step(scenario(), [], 2 * MS_PER_HOUR).state;
    expect(s.season.belowMedian).toEqual(['p2']);
    const at = 2 * MS_PER_HOUR + 10;
    const r = step(s, [recruit('p1', at), recruit('p2', at)], at).state;
    const ready = (owner: string) =>
      Object.values(r.crews)
        .filter((c) => c.owner === owner)
        .map((c) => c.readyAtMs - at)
        .sort((a, b) => b - a)[0] as number;
    const full = balance.recruit.readyMinutes * 60_000;
    expect(ready('p1')).toBe(full);
    expect(ready('p2')).toBe(full * 0.75);
    expect(checkInvariants(r)).toEqual([]);
  });
});
