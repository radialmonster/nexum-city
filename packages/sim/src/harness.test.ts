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

// Task 54 targets, over seeds 1 to 5.
describe('balance pass', () => {
  const seeds = [1, 2, 3, 4, 5].map((seed) => runSeason({ seed }));

  it('keeps bot orders valid: under 10 percent are refused', () => {
    for (const r of seeds) expect(r.botRejected / Math.max(1, r.botOrders)).toBeLessThan(0.1);
  });

  it('has no invariant problems and at least one player-vs-player capture', () => {
    for (const r of seeds) expect(r.problems).toEqual([]);
    expect(seeds.reduce((n, r) => n + r.pvpCaptures, 0)).toBeGreaterThanOrEqual(1);
  });

  it('plays raids and keeps goods conserved', () => {
    expect(seeds.reduce((n, r) => n + r.raids, 0)).toBeGreaterThanOrEqual(1);
    expect(seeds.reduce((n, r) => n + r.raidHits, 0)).toBeGreaterThanOrEqual(1);
    // Conservation problems are reported in `problems`, which the test above requires to be empty.
  });

  it('settles frontier plots', () => {
    expect(seeds.reduce((n, r) => n + r.settled, 0)).toBeGreaterThanOrEqual(1);
  });

  it('gives every bot type at least 3 districts on average, raiders ahead by less than 2x', () => {
    // Seeds 1 to 8, the same set the docs report: five seeds are too noisy to rank the types now
    // that contracts add a second income stream.
    const eight = [...seeds, ...[6, 7, 8].map((seed) => runSeason({ seed }))];
    const agg: Record<string, { n: number; d: number; score: number }> = {};
    for (const r of eight) {
      for (const s of r.standings) {
        const bot = r.players.find((p) => p.id === s.playerId)?.bot ?? '?';
        const a = (agg[bot] ??= { n: 0, d: 0, score: 0 });
        a.n++;
        a.d += s.districts;
        a.score += s.score;
      }
    }
    for (const a of Object.values(agg)) expect(a.d / a.n).toBeGreaterThanOrEqual(3);
    const avg = (k: string) => (agg[k] ? agg[k].score / agg[k].n : 0);
    const best = Math.max(avg('turtle'), avg('merchant'));
    expect(avg('raider')).toBeGreaterThan(best);
    expect(avg('raider')).toBeLessThan(2 * best);
  });
});
