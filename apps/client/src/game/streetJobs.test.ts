import { ATOMS_PER_UNIT, balance } from '@nexum/sim';

const fromUnits = (n: number): number => n * ATOMS_PER_UNIT;
import { describe, expect, it } from 'vitest';
import { longSpan, rushed } from './derive';
import { buildFeedEntries, describeEvent } from './feed';
import {
  jobDuration,
  jobPay,
  jobRisk,
  jobSentence,
  nextJobText,
  type JobOffer,
} from './streetJobs';
import { feedItem, makeView } from './testing';

const courier: JobOffer = {
  id: 'j1',
  kind: 'courier',
  minutes: 6,
  good: 'parts',
  qty: 8,
  creditsAtoms: fromUnits(9),
  pick: 0,
};
const patrol: JobOffer = {
  id: 'j2',
  kind: 'patrol',
  minutes: 5,
  creditsAtoms: fromUnits(5),
  pick: 1,
};

describe('street jobs text', () => {
  it('describes pay, duration and risk in plain words', () => {
    expect(jobPay(courier)).toBe('9 credits');
    expect(jobSentence(courier)).toContain('8 parts');
    expect(jobDuration(courier)).toBe('6 min, 4 min with a carrier');
    expect(jobRisk(courier)).toContain('raided');
    expect(jobRisk(patrol)).toContain(String(balance.jobs.patrolRevealMinutes));
  });

  it('shows the next job only while fewer than the cap are on offer', () => {
    const now = 1_000_000;
    const some = makeView({
      self: {
        credits: 0,
        stash: {},
        costs: { stash: {}, districts: {}, cargo: {} },
        score: 0,
        rushUntilMs: 0,
        jobs: [courier],
        jobNextMs: now + 18 * 60_000,
      },
    });
    expect(nextJobText(some, now)).toBe('Next job in 18m');
    const full = makeView({
      self: {
        credits: 0,
        stash: {},
        costs: { stash: {}, districts: {}, cargo: {} },
        score: 0,
        rushUntilMs: 0,
        jobs: [courier, patrol, { ...patrol, id: 'j3' }],
        jobNextMs: 0,
      },
    });
    expect(nextJobText(full, now)).toBeNull();
  });
});

describe('rush helpers', () => {
  it('divides build times only while the rush runs', () => {
    const now = 1_000_000;
    const on = makeView({
      self: {
        credits: 0,
        stash: {},
        costs: { stash: {}, districts: {}, cargo: {} },
        score: 0,
        rushUntilMs: now + 1000,
        jobs: [],
        jobNextMs: 0,
      },
    });
    const off = makeView();
    expect(rushed(on, now, 120 * 60_000)).toBe((120 * 60_000) / balance.rush.factor);
    expect(rushed(off, now, 120 * 60_000)).toBe(120 * 60_000);
  });

  it('formats long spans', () => {
    expect(longSpan(5 * 3_600_000 + 12 * 60_000)).toBe('5h 12m');
    expect(longSpan(42 * 60_000)).toBe('42m');
  });
});

describe('job feed cards', () => {
  const view = makeView();
  it('describes a done job with its pay and a raided courier as a warning', () => {
    const done = describeEvent(
      feedItem(1, 'job.done', { districts: ['a'], data: { job: 'courier', credits: 9, parts: 0 } }),
      view,
    );
    expect(done).toMatchObject({ kind: 'JOB', tone: 'ok' });
    expect(done?.text).toContain('9 credits');
    const failed = describeEvent(
      feedItem(2, 'job.failed', {
        districts: ['a'],
        data: { job: 'courier', sent: 8, returned: 4, reason: 'raided' },
      }),
      view,
    );
    expect(failed).toMatchObject({ kind: 'JOB', tone: 'warn' });
    expect(failed?.text).toContain('4 of 8');
  });

  it('shows a rush.ended card', () => {
    const e = describeEvent(feedItem(3, 'rush.ended', { data: { untilMs: 1 } }), view);
    expect(e?.kind).toBe('NEWCOMER');
    expect(buildFeedEntries(view, [feedItem(3, 'rush.ended')])).toHaveLength(1);
  });
});
