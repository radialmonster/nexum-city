import { describe, expect, it } from 'vitest';
import { ago, describeEvent, formatUnits } from './feed';
import { feedItem, makeView } from './testing';

const view = makeView();

describe('describeEvent', () => {
  it('flags a siege on your district as a threat that flies to it', () => {
    const e = describeEvent(
      feedItem(1, 'siege.started', {
        districts: ['a'],
        data: { attacker: 'rival', defender: 'me' },
      }),
      view,
    );
    expect(e).toMatchObject({ kind: 'THREAT', tone: 'danger', districtId: 'a' });
    expect(e?.text).toContain('Alpha Docks');
  });

  it('describes your own siege differently from a rival one', () => {
    const e = describeEvent(
      feedItem(1, 'siege.started', {
        districts: ['b'],
        data: { attacker: 'me', defender: 'rival' },
      }),
      view,
    );
    expect(e?.text).toMatch(/Your crews/);
  });

  it('announces a new crew with its plot and frontier side', () => {
    const e = describeEvent(
      feedItem(1, 'player.joined', {
        actors: ['p9'],
        districts: ['a'],
        data: { reason: 'new', crew: 'kestrel_9', district: 'Kestrel Yard', side: 'east' },
      }),
      view,
    );
    expect(e).toMatchObject({ kind: 'NEWCOMER', tone: 'special' });
    expect(e?.text).toBe('New crew kestrel_9 founded Kestrel Yard on the east frontier.');
  });

  it('tells you when you are the newcomer', () => {
    const e = describeEvent(
      feedItem(1, 'player.joined', {
        actors: ['me'],
        districts: ['a'],
        data: { reason: 'new', crew: 'me', district: 'Kestrel Yard', side: 'centre' },
      }),
      view,
    );
    expect(e?.text).toBe('You founded Kestrel Yard.');
  });

  it('describes a frontier plot opening', () => {
    const e = describeEvent(feedItem(1, 'frontier.opened', { districts: ['a'] }), view);
    expect(e).toMatchObject({ kind: 'CITY GROWS' });
    expect(e?.text).toContain('Alpha Docks');
  });

  it('hides events a player does not need to read', () => {
    for (const k of ['siege.progress', 'combat.round', 'score.tick'] as const)
      expect(describeEvent(feedItem(1, k), view)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats whole units', () => {
    expect(formatUnits(1234.6)).toBe('1,235');
  });
  it('says how long ago', () => {
    expect(ago(10 * 60_000, 0)).toMatch(/10/);
  });
});
