import { toAtoms } from '@nexum/sim';
import type { ContractView } from '@nexum/contracts';
import { describe, expect, it } from 'vitest';
import { buyRunnerBlocker, compareCarriers, suggestRunner } from './runner';
import { makeView } from './testing';

const NOW = 1_000_000;
const carrier = (id: string, kind: 'van' | 'runner') =>
  ({ id, owner: 'me', kind, loc: { at: 'a' } }) as const;
const contract = (over: Partial<ContractView> = {}): ContractView => ({
  id: 'k1',
  hub: 'b',
  good: 'parts',
  qty: 10,
  reward: toAtoms(100),
  poster: 'civic',
  hours: 2,
  postedMs: 0,
  offerEndsMs: 0,
  status: 'taken',
  taker: 'me',
  takenMs: NOW,
  dueMs: NOW + 10 * 60_000,
  deposit: 0,
  delivered: 0,
  paid: null,
  ...over,
});

describe('buyRunnerBlocker', () => {
  it('needs 300 credits and stops at two Runners', () => {
    const poor = makeView({
      self: {
        credits: toAtoms(299),
        stash: {},
        costs: { stash: {}, districts: {}, cargo: {} },
        score: 0,
        rushUntilMs: 0,
        jobs: [],
        jobNextMs: 0,
      },
    });
    expect(buyRunnerBlocker(poor)).toContain('300 credits');
    const rich = makeView({
      self: {
        credits: toAtoms(300),
        stash: {},
        costs: { stash: {}, districts: {}, cargo: {} },
        score: 0,
        rushUntilMs: 0,
        jobs: [],
        jobNextMs: 0,
      },
    });
    expect(buyRunnerBlocker(rich)).toBeNull();
    const full = makeView({
      self: {
        credits: toAtoms(900),
        stash: {},
        costs: { stash: {}, districts: {}, cargo: {} },
        score: 0,
        rushUntilMs: 0,
        jobs: [],
        jobNextMs: 0,
      },
      carriers: { r1: carrier('r1', 'runner'), r2: carrier('r2', 'runner') },
    });
    expect(buyRunnerBlocker(full)).toContain('2 Runners');
  });
});

describe('compareCarriers', () => {
  it('lists each idle kind, slowest first, with the Runner quicker and smaller', () => {
    const view = makeView({ carriers: { v: carrier('v', 'van'), r: carrier('r', 'runner') } });
    const [van, runner] = compareCarriers(view, 'a', 'b', 20);
    expect(van).toMatchObject({ kind: 'van', cargo: 40, tooSmall: false });
    expect(runner).toMatchObject({ kind: 'runner', cargo: 16, tooSmall: true, speedX: 1.6 });
    expect((runner?.etaMs ?? 0) < (van?.etaMs ?? 0)).toBe(true);
    expect(runner?.note).toContain('35% dodge');
  });
});

describe('suggestRunner', () => {
  const view = (c: ContractView) =>
    makeView({ nowMs: NOW, carriers: { r: carrier('r', 'runner') }, contracts: { k1: c } });
  it('picks an idle Runner for a small load on a tight deadline', () => {
    const s = suggestRunner(view(contract()), 'k1', ['a'], NOW);
    expect(s).toMatchObject({ from: 'a', carrierId: 'r' });
    expect(s?.text).toContain('deadline is tight');
  });
  it('stays quiet when the load is big, the deadline is loose or there is no Runner', () => {
    expect(suggestRunner(view(contract({ qty: 17 })), 'k1', ['a'], NOW)).toBeNull();
    expect(
      suggestRunner(view(contract({ dueMs: NOW + 600 * 60_000 })), 'k1', ['a'], NOW),
    ).toBeNull();
    expect(suggestRunner(makeView({ contracts: { k1: contract() } }), 'k1', ['a'], NOW)).toBeNull();
  });
});
