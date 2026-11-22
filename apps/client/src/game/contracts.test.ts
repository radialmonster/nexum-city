import type { ContractView } from '@nexum/contracts';
import { ATOMS_PER_UNIT } from '@nexum/sim';
import { describe, expect, it } from 'vitest';
import { checkPost, contractSentence, remainingUnits, takeBlocker } from './contracts';
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
  takenMs: null,
  dueMs: null,
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
    const view = makeView({ self: { credits: cr(100), stash: {}, score: 0 } });
    expect(takeBlocker(view, contract())).toBeNull();
    expect(takeBlocker(view, contract({ poster: 'me' }))).toMatch(/own job/);
    expect(takeBlocker(view, contract({ status: 'taken', taker: 'x' }))).toMatch(/taken/);
    expect(takeBlocker(makeView(), contract())).toMatch(/deposit/);
  });

  it('checks a posting like the server does', () => {
    const view = makeView({ self: { credits: cr(10_000), stash: {}, score: 0 } });
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
