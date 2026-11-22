import { describe, expect, it } from 'vitest';
import { ambushesAt, clearUnderway, findAmbush, planClear } from './clearAmbush';
import { describeEvent } from './feed';
import { feedItem, makeView } from './testing';

const seen = (over = {}) => ({
  id: 'am1',
  owner: 'rival',
  edge: ['a', 'b'] as [string, string],
  untilMs: 5_000_000,
  ...over,
});
// the view shape is checked by the type of makeView's `ambushes`
const withAmbush = () => makeView({ ambushes: [seen()] as never });

describe('clear ambush helpers', () => {
  it('lists rival ambushes at a district and skips your own and expired ones', () => {
    const v = makeView({
      ambushes: [
        seen(),
        seen({ id: 'am2', owner: 'me' }),
        seen({ id: 'am3', untilMs: 1 }),
      ] as never,
    });
    expect(ambushesAt(v, 'a', 1_000_000).map((x) => x.id)).toEqual(['am1']);
    expect(ambushesAt(v, 'zzz', 1_000_000)).toEqual([]);
    expect(findAmbush(v, 'am1', 1_000_000)?.id).toBe('am1');
    expect(findAmbush(v, 'am3', 1_000_000)).toBeUndefined();
  });

  it('knows when a clear is already underway', () => {
    expect(clearUnderway(withAmbush(), 'am1')).toBe(false);
  });

  it('plans a clear with no estimate when no crew is free', () => {
    const base = makeView();
    const v = makeView({
      ambushes: [seen()] as never,
      crews: { c1: { ...base.crews.c1, id: 'c1', readyAtMs: 99_000_000 } } as never,
    });
    const plan = planClear(v, seen() as never, 1_000_000);
    expect(plan.pick).toBeNull();
    expect(plan.estimate).toBeNull();
  });
});

describe('ambush result cards', () => {
  const v = makeView();
  it('tells the clearer and the raider apart', () => {
    const mine = describeEvent(
      feedItem(1, 'ambush.cleared', { districts: ['a', 'b'], actors: ['me', 'rival'] }),
      v,
    );
    expect(mine).toMatchObject({ kind: 'BREAK IT UP', tone: 'ok' });
    const theirs = describeEvent(
      feedItem(2, 'ambush.cleared', { districts: ['a', 'b'], actors: ['rival', 'me'] }),
      v,
    );
    expect(theirs).toMatchObject({ kind: 'AMBUSH', tone: 'danger' });
    expect(theirs?.text).toContain('broken up');
    expect(
      describeEvent(feedItem(3, 'ambush.held', { districts: ['a', 'b'], actors: ['me'] }), v)?.tone,
    ).toBe('warn');
    expect(
      describeEvent(feedItem(4, 'ambush.gone', { districts: ['a', 'b'], actors: ['me'] }), v)?.text,
    ).toContain('already gone');
  });

  it('carries the ambush id on a spotted card', () => {
    const e = describeEvent(
      feedItem(5, 'raid.spotted', {
        districts: ['a', 'b'],
        data: { movementId: 'am1', untilMs: 3_600_000, owner: 'rival' },
      }),
      v,
    );
    expect(e?.ambushId).toBe('am1');
  });
});
