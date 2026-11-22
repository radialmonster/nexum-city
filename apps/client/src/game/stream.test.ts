import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startStream, type EventSourceLike } from './stream';
import { feedItem } from './testing';

class FakeSource implements EventSourceLike {
  readyState = 0;
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  closed = false;
  private handlers = new Map<string, (ev: MessageEvent) => void>();
  addEventListener(type: string, listener: (ev: MessageEvent) => void) {
    this.handlers.set(type, listener);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    this.handlers.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(open?: (url: string) => EventSourceLike) {
  const calls = { items: [] as number[], links: [] as string[], ticks: [] as number[], polls: 0 };
  const stop = startStream({
    open,
    fetchFeed: () => {
      calls.polls += 1;
      return Promise.resolve([feedItem(9, 'arrived')]);
    },
    cursor: () => 0,
    onItems: (items) => calls.items.push(...items.map((i) => i.seq)),
    onTick: (n) => calls.ticks.push(n),
    onLink: (l) => calls.links.push(l),
    pollMs: 1000,
    retrySseMs: 5000,
  });
  return { calls, stop };
}

describe('startStream', () => {
  it('goes live on open and passes game and tick events on', () => {
    const src = new FakeSource();
    const { calls } = setup(() => src);
    src.onopen?.(new Event('open'));
    src.emit('game', feedItem(3, 'arrived'));
    src.emit('game', { junk: true });
    src.emit('tick', { nowMs: 42 });
    expect(calls.links).toEqual(['live']);
    expect(calls.items).toEqual([3]);
    expect(calls.ticks).toEqual([42]);
  });

  it('polls when there is no EventSource', async () => {
    const { calls, stop } = setup(undefined);
    await vi.advanceTimersByTimeAsync(2100);
    expect(calls.links[0]).toBe('polling');
    expect(calls.polls).toBeGreaterThanOrEqual(3);
    expect(calls.items).toContain(9);
    stop();
  });

  it('falls back to polling on error, then tries the stream again', async () => {
    const sources: FakeSource[] = [];
    const { calls, stop } = setup(() => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    });
    sources[0]?.onerror?.(new Event('error'));
    expect(sources[0]?.closed).toBe(true);
    expect(calls.links).toEqual(['polling']);
    await vi.advanceTimersByTimeAsync(5100);
    expect(sources).toHaveLength(2);
    sources[1]?.onopen?.(new Event('open'));
    expect(calls.links.at(-1)).toBe('live');
    stop();
    expect(sources[1]?.closed).toBe(true);
  });
});
