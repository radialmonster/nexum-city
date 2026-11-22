import type { ContractView } from '@nexum/contracts';
import { ATOMS_PER_UNIT } from '@nexum/sim';
import { describe, expect, it } from 'vitest';
import { checkPost, contractSentence, lateWarning, remainingUnits, takeBlocker } from './contracts';
import { buildFeedEntries } from './feed';
import { feedItem, makeView } from './testing';

const cr = (n: number) => n * ATOMS_PER_UNIT;

const contract = (over: Partial<ContractView> = {}): ContractView => ({
  id: 'k1',
  hub: 'a',
  good: 'power',
  qty: 30,
  reward: cr(420),
  poster: 'civic',
  hours: 12,
  postedMs: 0,
  offerEndsMs: 100_000_000,
  status: 'open',
  taker: null,
  takenMs: 0,
  dueMs: 0,
  deposit: cr(42),
  delivered: null,
  paid: null,
  ...over,
});

describe('contract helpers', () => {
  it('writes the plain-language sentence', () => {
    expect(contractSentence(makeView(), contract())).toBe(
      'Bring 30 power to Alpha Docks within 12 h. Pays 420 cr. Deposit 42 cr, lost if late.',
    );
  });

  it('counts the units still to bring', () => {
    expect(remainingUnits(contract({ delivered: cr(0) + 10 * ATOMS_PER_UNIT }))).toBe(20);
    expect(remainingUnits(contract())).toBe(30);
  });

  it('blocks taking your own job, a taken job, and a broke taker', () => {
    const view = makeView({
      self: {
        credits: cr(100),
        stash: {},
        costs: { stash: {}, districts: {}, cargo: {} },
        score: 0,
        rushUntilMs: 0,
        jobs: [],
        jobNextMs: 0,
      },
    });
    expect(takeBlocker(view, contract())).toBeNull();
    expect(takeBlocker(view, contract({ poster: 'me' }))).toMatch(/own job/);
    expect(takeBlocker(view, contract({ status: 'taken', taker: 'x' }))).toMatch(/taken/);
    expect(takeBlocker(makeView(), contract())).toMatch(/deposit/);
  });

  it('checks a posting like the server does', () => {
    const view = makeView({
      self: {
        credits: cr(10_000),
        stash: {},
        costs: { stash: {}, districts: {}, cargo: {} },
        score: 0,
        rushUntilMs: 0,
        jobs: [],
        jobNextMs: 0,
      },
    });
    const base = { hub: 'a', good: 'power', qty: '30', reward: '420', hours: '12' } as const;
    const bad = checkPost(view, { ...base, qty: '2' });
    expect(bad.ok).toBe(false);
    const short = checkPost(view, { ...base, hours: '1' });
    expect(short.ok).toBe(false);
    const poor = checkPost(makeView(), base);
    expect(poor.ok).toBe(false);
  });
});

describe('contract feed cards', () => {
  it('folds a contract into one card with its latest state', () => {
    const view = makeView();
    const data = { contractId: 'k1', taker: 'me', good: 'power', qty: 30, civic: true };
    const items = [
      feedItem(1, 'contract.taken', {
        actors: ['me'],
        districts: ['a'],
        data: { ...data, reward: 420, deposit: 42, dueMs: 5_000_000 },
      }),
      feedItem(2, 'contract.progress', {
        actors: ['me'],
        districts: ['a'],
        data: { ...data, accepted: 10, excess: 0, delivered: 10, paidNow: 140, paid: 140 },
      }),
    ];
    const out = buildFeedEntries(view, items, {});
    expect(out.filter((e) => e.kind === 'CONTRACT')).toHaveLength(1);
    expect(out[0]?.eventKind).toBe('contract.progress');
  });

  it('says storage is full in plain words', () => {
    const view = makeView();
    const out = buildFeedEntries(
      view,
      [
        feedItem(1, 'production.wasted', {
          districts: ['a'],
          actors: ['me'],
          data: { amount: 12 },
        }),
      ],
      {},
    );
    const text = out.map((e) => e.text).join(' ');
    expect(text).toContain('Build storage or sell sooner');
  });
});

describe('in-transit deliveries', () => {
  it('counts only your own hauls for the contract and leaves the rest to send', async () => {
    const { inTransit, unitsToSend } = await import('./contracts');
    const c = contract({ qty: 30, status: 'taken', taker: 'me' });
    const none = makeView();
    expect(inTransit(none, c)).toBeNull();
    expect(unitsToSend(none, c)).toBe(30);
    const v = makeView({
      movements: {
        m1: {
          id: 'm1',
          kind: 'haul',
          owner: 'me',
          contractId: 'k1',
          cargo: { power: cr(20) },
          arriveMs: 5_000_000,
        },
      } as never,
    });
    expect(inTransit(v, c)).toEqual({ units: 20, arriveMs: 5_000_000 });
    expect(unitsToSend(v, c)).toBe(10);
  });
});

describe('starter contract hook', () => {
  it('derives the trip from the window minus grace, or from the van on its way', async () => {
    const { starterHookCopy } = await import('./contracts');
    const c = contract({ windowMs: 70 * 60_000, reservedFor: 'me' });
    expect(starterHookCopy(makeView(), c)).toBe(
      'Your van gets there in about 50 min. Come back to collect your pay.',
    );
    const v = makeView({
      movements: {
        m1: {
          id: 'm1',
          kind: 'haul',
          owner: 'me',
          contractId: 'k1',
          cargo: { power: cr(5) },
          arriveMs: 1_000_000 + 12 * 60_000,
        },
      } as never,
    });
    expect(starterHookCopy(v, c)).toContain('about 12 min');
  });
});

describe('lateWarning', () => {
  const taken = (over: Partial<ContractView> = {}) =>
    contract({ status: 'taken', dueMs: 14 * 60_000, ...over });
  it('warns when the trip outlasts the deadline, naming the deposit', () => {
    const w = lateWarning(taken(), 51 * 60_000, 0);
    expect(w).toContain('Arrives 51m, but the contract is due in 14m.');
    expect(w).toContain('lose the deposit');
  });
  it('does not mention a deposit when it is zero', () => {
    expect(lateWarning(taken({ deposit: 0 }), 51 * 60_000, 0)).not.toContain('deposit');
  });
  it('stays quiet when you will make it', () => {
    expect(lateWarning(taken(), 10 * 60_000, 0)).toBeNull();
    expect(lateWarning(contract(), 99 * 60_000, 0)).toBeNull();
  });
});
