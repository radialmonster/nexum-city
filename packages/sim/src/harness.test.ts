import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR } from './balance.js';
import { replay, runSeason } from './harness.js';

// The reference season: 7 days, six bots (two raiders, two turtles, two merchants).
// One test timeout of 5 s covers the whole run, which is the speed budget.
describe('season fast-forward', () => {
  const season = runSeason({ seed: 1 });

  it('plays out a week with captures and market fills', () => {
    expect(Object.keys(season.final.districts).length).toBeGreaterThanOrEqual(30);
    expect(season.players).toHaveLength(6);
    expect(season.captures).toBeGreaterThanOrEqual(1);
    expect(season.fills).toBeGreaterThanOrEqual(1);
    expect(season.final.nowMs).toBe(season.final.season.endMs);
  });

  it('never breaks an invariant (no negative stock or credits, no unit in two places)', () => {
    expect(season.problems).toEqual([]);
  });

  it('is deterministic', () => {
    expect(runSeason({ seed: 1 }).hash).toBe(season.hash);
    expect(runSeason({ seed: 2 }).hash).not.toBe(season.hash);
  });

  it('gives the same hash in one jump and in 60 s ticks', () => {
    expect(replay(season.start, season.inputs, 0)).toBe(season.hash);
    expect(replay(season.start, season.inputs, 60_000)).toBe(season.hash);
  }, 5_000);

  it('gives the same hash in 2 s ticks (first 6 hours; a full week takes about 20 s)', () => {
    const to = 6 * MS_PER_HOUR;
    expect(replay(season.start, season.inputs, 2_000, to)).toBe(
      replay(season.start, season.inputs, 0, to),
    );
  }, 15_000);

  it('runs a whole season in under 5 seconds', () => {
    runSeason({ seed: 3 });
  }, 5_000);
});
