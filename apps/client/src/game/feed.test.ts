import { describe, expect, it } from 'vitest';
import {
  ago,
  buildFeedEntries,
  describeEvent,
  formatUnits,
  siegeProgress,
  type FeedEntry,
} from './feed';
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
    for (const k of ['siege.progress', 'score.tick'] as const)
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

describe('buildFeedEntries', () => {
  const started = feedItem(1, 'siege.started', {
    actors: ['rival'],
    districts: ['a'],
    data: { attacker: 'rival', defender: 'me' },
  });
  const rnd = (seq: number, r: number, a: number, d: number) =>
    feedItem(seq, 'combat.round', {
      districts: ['a'],
      data: { round: r, attackerStrength: a, defenderStrength: d },
    });
  const view = makeView();

  it('shows siege.started and folds rounds into one running card', () => {
    const out = buildFeedEntries(view, [started, rnd(2, 1, 90, 70), rnd(3, 2, 80, 60)], {});
    expect(out).toHaveLength(1);
    expect(out[0]?.eventKind).toBe('siege.started');
    expect(out[0]?.siege).toEqual({ rounds: 2, attackerStrength: 80, defenderStrength: 60 });
    expect(siegeProgress(out[0] as FeedEntry)).toContain('Round 2');
  });

  it('ignores rounds with no open siege and closes the card on capture', () => {
    expect(buildFeedEntries(view, [rnd(1, 1, 5, 5)], {})).toHaveLength(0);
    const out = buildFeedEntries(
      view,
      [
        started,
        feedItem(2, 'siege.broken', { districts: ['a'], actors: ['rival'] }),
        rnd(3, 1, 1, 1),
      ],
      {},
    );
    expect(out.every((e) => !e.siege)).toBe(true);
  });

  it('uses crew names', () => {
    const out = buildFeedEntries(view, [started], { rival: 'Iron Wolves' });
    expect(JSON.stringify(out)).toContain('Iron Wolves');
  });
});

describe('settle events', () => {
  it('words started, done and failed for you and for rivals', () => {
    const at = { districts: ['b'] };
    expect(
      describeEvent(feedItem(1, 'settle.started', { ...at, data: { owner: 'me' } }), view)?.text,
    ).toContain('Your crew is settling');
    expect(
      describeEvent(feedItem(2, 'settle.started', { ...at, data: { owner: 'rival' } }), view)?.text,
    ).toContain('A rival is settling');
    expect(
      describeEvent(feedItem(3, 'settle.done', { ...at, data: { owner: 'me' } }), view)?.text,
    ).toContain('is yours');
    const failed = describeEvent(
      feedItem(4, 'settle.failed', { ...at, data: { owner: 'me', reason: 'taken' } }),
      view,
    );
    expect(failed).toMatchObject({ kind: 'SETTLE', tone: 'danger' });
    expect(failed?.text).toContain('someone else got there first');
  });
});

describe('raid events', () => {
  const at = { districts: ['a', 'b'] };
  const hit = (actors: string[]) =>
    feedItem(1, 'raid.hit', {
      ...at,
      actors,
      data: {
        stolen: { parts: 12 },
        destroyed: {},
        remaining: { parts: 18 },
        raiderStrength: 5,
        guard: 0,
        escortLost: 0,
      },
    });

  it('words a hit from the victim, the raider and a bystander', () => {
    const victim = describeEvent(hit(['rival', 'me']), view);
    expect(victim?.tone).toBe('danger');
    expect(victim?.text).toContain('Raiders hit your haul between');
    expect(victim?.text).toContain('lost 12 parts');
    const raider = describeEvent(hit(['me', 'rival']), view);
    expect(raider?.text).toContain('Your ambush between');
    expect(raider?.text).toContain('stole 12 parts');
    expect(describeEvent(hit(['x', 'y']), view)?.text).toContain('raided');
  });

  it('announces an ambush being set, repelled and ended', () => {
    const set = describeEvent(feedItem(2, 'raid.set', { ...at, actors: ['me'] }), view);
    expect(set?.kind).toBe('AMBUSH');
    expect(set?.text).toContain('waiting in ambush');
    expect(
      describeEvent(
        feedItem(3, 'raid.repelled', {
          ...at,
          actors: ['rival', 'me'],
          data: { raiderStrength: 3, guard: 6, raiderLost: 1 },
        }),
        view,
      ),
    ).toBeTruthy();
    const ended = describeEvent(
      feedItem(4, 'raid.ended', {
        ...at,
        actors: ['me'],
        data: { loot: { parts: 7 }, reason: 'expired', struck: 1 },
      }),
      view,
    );
    expect(ended?.text).toContain('7 parts');
  });

  it('folds the ambush end card into the strike card unless loot came home', () => {
    const rep = feedItem(3, 'raid.repelled', {
      ...at,
      actors: ['me', 'rival'],
      data: { raiderStrength: 3, guard: 6, raiderLost: 1 },
    });
    const end = (seq: number, data: Record<string, string | number | Record<string, number>>) =>
      feedItem(seq, 'raid.ended', { ...at, actors: ['me'], data });
    const kinds = (items: ReturnType<typeof feedItem>[]) =>
      buildFeedEntries(view, items).map((e) => e.eventKind);
    expect(kinds([rep, end(4, { reason: 'repelled', struck: 1, loot: {} })])).toEqual([
      'raid.repelled',
    ]);
    expect(kinds([end(4, { reason: 'expired', struck: 0, loot: {} })])).toEqual(['raid.ended']);
    expect(kinds([rep, end(4, { reason: 'full', struck: 1, loot: { parts: 7 } })])).toEqual([
      'raid.ended',
      'raid.repelled',
    ]);
  });

  it('words an evaded ambush from both sides and folds the ambush end card into it', () => {
    const at2 = { districts: ['a', 'b'] };
    const data = { movementId: 'm1', haulId: 'h1', chancePercent: 35 };
    const mine = describeEvent(
      feedItem(5, 'raid.evaded', { ...at2, actors: ['rival', 'me'], data }),
      view,
    );
    expect(mine).toMatchObject({ kind: 'RAID', tone: 'ok' });
    expect(mine?.text).toContain('Your Runner slipped past an ambush between');
    const theirs = describeEvent(
      feedItem(5, 'raid.evaded', { ...at2, actors: ['me', 'rival'], data }),
      view,
    );
    expect(theirs?.tone).toBe('warn');
    expect(theirs?.text).toContain('A Runner slipped past your ambush between');
    const end = feedItem(6, 'raid.ended', {
      ...at2,
      actors: ['me'],
      data: { reason: 'expired', struck: 1, loot: {} },
    });
    expect(
      buildFeedEntries(view, [
        feedItem(5, 'raid.evaded', { ...at2, actors: ['me', 'rival'], data }),
        end,
      ]).map((e) => e.eventKind),
    ).toEqual(['raid.evaded']);
  });

  it('shows only your own Runner purchases', () => {
    const bought = (who: string) =>
      describeEvent(
        feedItem(7, 'carrier.bought', {
          districts: ['a'],
          actors: [who],
          data: { carrierId: 'k9', kind: 'runner', credits: 700 },
        }),
        view,
      );
    expect(bought('me')?.text).toBe('You bought a Runner at Alpha Docks.');
    expect(bought('rival')).toBeNull();
  });
});

describe('watchtower and wear events', () => {
  it('describes a spotted ambush with the street and the end time', () => {
    const e = describeEvent(
      feedItem(1, 'raid.spotted', {
        districts: ['a', 'b'],
        data: { movementId: 'm1', untilMs: 14 * 3_600_000 + 20 * 60_000, owner: 'rival' },
      }),
      view,
    );
    expect(e).toMatchObject({ kind: 'WATCHTOWER', tone: 'warn' });
    expect(e?.text).toContain('until 14:20');
  });

  it('folds worn and repaired carriers away quietly', () => {
    expect(
      describeEvent(feedItem(1, 'carrier.worn', { data: { carrierId: 'v1' } }), view),
    ).toBeNull();
    expect(
      describeEvent(feedItem(2, 'carrier.repaired', { data: { carrierId: 'v1' } }), view),
    ).toBeNull();
  });
});
