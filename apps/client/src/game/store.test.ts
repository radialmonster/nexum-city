import { describe, expect, it } from 'vitest';
import { createStore, FEED_KEEP, gameNow, initialState, mergeFeed, reduce } from './store';
import { feedItem, makeView } from './testing';

describe('mergeFeed', () => {
  it('orders by seq and drops repeats', () => {
    const feed = mergeFeed(
      [feedItem(2, 'arrived')],
      [feedItem(3, 'arrived'), feedItem(1, 'arrived')],
    );
    expect(feed.map((f) => f.seq)).toEqual([1, 2, 3]);
    expect(mergeFeed(feed, [feedItem(2, 'arrived')])).toBe(feed);
  });

  it('keeps only the newest entries', () => {
    const many = Array.from({ length: FEED_KEEP + 5 }, (_, i) => feedItem(i + 1, 'arrived'));
    const feed = mergeFeed([], many);
    expect(feed).toHaveLength(FEED_KEEP);
    expect(feed[0]?.seq).toBe(6);
  });
});

describe('reduce', () => {
  const account = { id: 1, username: 'ann' };

  it('starts a session and goes anonymous again', () => {
    const s = reduce(initialState, {
      type: 'session',
      account,
      view: makeView(),
      at: 5,
      lastSeenMs: 77,
    });
    expect(s.status).toBe('ready');
    expect(s.lastSeenMs).toBe(77);
    expect(reduce(s, { type: 'anon' }).view).toBeNull();
  });

  it('advances the cursor with new feed items only', () => {
    const a = reduce(initialState, { type: 'feed', items: [feedItem(4, 'arrived')] });
    expect(a.cursor).toBe(4);
    expect(reduce(a, { type: 'feed', items: [feedItem(4, 'arrived')] })).toBe(a);
  });

  it('keeps at most four toasts and dismisses by id', () => {
    let s = initialState;
    for (let id = 1; id <= 6; id++)
      s = reduce(s, { type: 'toast', toast: { id, tone: 'ok', title: 't' } });
    expect(s.toasts.map((t) => t.id)).toEqual([3, 4, 5, 6]);
    expect(reduce(s, { type: 'dismiss', id: 4 }).toasts.map((t) => t.id)).toEqual([3, 5, 6]);
  });

  it('counts repeated fly requests and selects the place', () => {
    const a = reduce(initialState, { type: 'fly', id: 'a' });
    const b = reduce(a, { type: 'fly', id: 'a' });
    expect(b.flyTo?.n).toBe(2);
    expect(b.selected).toBe('a');
  });

  it('never moves last-seen backwards', () => {
    const s = reduce({ ...initialState, lastSeenMs: 50 }, { type: 'seen', ms: 10 });
    expect(s.lastSeenMs).toBe(50);
  });
});

describe('store and clock', () => {
  it('notifies subscribers only on change', () => {
    const store = createStore();
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    store.dispatch({ type: 'link', link: 'live' });
    store.dispatch({ type: 'link', link: 'live' });
    off();
    store.dispatch({ type: 'link', link: 'off' });
    expect(calls).toBe(1);
  });

  it('runs the game clock from the view time', () => {
    const state = { view: makeView({ nowMs: 1000 }), viewAt: 500 };
    expect(gameNow(state, 800)).toBe(1300);
    expect(gameNow({ view: null, viewAt: 0 }, 800)).toBe(0);
  });
});

describe('city charge notices', () => {
  const base = makeView();
  const districts = {
    ...base.districts,
    x0: { ...(Object.values(base.districts)[0] as object), id: 'x0' } as never,
  };
  const day = (upkeep: number) =>
    makeView({
      districts,
      sink: { feesAtoms: 0, upkeepAtoms: upkeep * 360_000_000, levyAtoms: 0 },
    });

  it('adds one notice when the shared upkeep total rises, and not again for the same night', () => {
    let s = reduce(initialState, { type: 'view', view: day(0), at: 0 });
    expect(s.charges).toHaveLength(0);
    s = reduce(s, { type: 'view', view: { ...day(50), nowMs: 1_000_100 }, at: 1 });
    expect(s.charges).toHaveLength(1);
    s = reduce(s, { type: 'view', view: { ...day(50), nowMs: 1_000_200 }, at: 2 });
    expect(s.charges).toHaveLength(1);
  });

  it('adds nothing when only a levy total rises, since the levy is off', () => {
    let s = reduce(initialState, { type: 'view', view: makeView(), at: 0 });
    const v = makeView({ sink: { feesAtoms: 0, upkeepAtoms: 0, levyAtoms: 5 } });
    s = reduce(s, { type: 'view', view: { ...v, nowMs: 1_000_100 }, at: 1 });
    expect(s.charges).toHaveLength(0);
  });
});
