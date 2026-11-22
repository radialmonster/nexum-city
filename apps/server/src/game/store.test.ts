import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@nexum/sim';
import { openDatabase } from './db.js';
import { Store } from './store.js';

const HOUR = 3_600_000;

function fill(id: string, at: number, price: number, qty: number, hub = 'h1'): SimEvent {
  return {
    id,
    at,
    kind: 'trade.filled',
    actors: [],
    districts: [],
    data: { hub, good: 'parts', price, qty, buyer: 'civic', seller: 'p1' },
  };
}

describe('trade log', () => {
  it('records fills once, buckets them by hour and keeps only the latest buckets', () => {
    const store = new Store(openDatabase(':memory:'));
    const events = [
      fill('e1', 0, 100, 2),
      fill('e2', 10, 120, 3),
      fill('e3', 20, 90, 1),
      fill('e4', HOUR + 5, 150, 4),
      fill('e5', 2 * HOUR, 80, 1),
      fill('e6', 0, 999, 1, 'h2'),
    ];
    store.insertEvents(events);
    store.insertEvents(events); // replay is idempotent
    const all = store.tradeSeries('h1', 'parts', HOUR, 10);
    expect(all).toEqual([
      { t: 0, open: 100, low: 90, high: 120, close: 90, qty: 6, n: 3 },
      { t: HOUR, open: 150, low: 150, high: 150, close: 150, qty: 4, n: 1 },
      { t: 2 * HOUR, open: 80, low: 80, high: 80, close: 80, qty: 1, n: 1 },
    ]);
    expect(store.tradeSeries('h1', 'parts', HOUR, 2).map((b) => b.t)).toEqual([HOUR, 2 * HOUR]);
    expect(store.tradeSeries('h2', 'parts', HOUR, 10)).toHaveLength(1);
  });

  it('is cleared at season reset', () => {
    const store = new Store(openDatabase(':memory:'));
    store.insertEvents([fill('e1', 0, 100, 1)]);
    store.clearWorldData();
    expect(store.tradeSeries('h1', 'parts', HOUR, 10)).toEqual([]);
  });
});
