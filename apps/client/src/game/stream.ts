import { feedItemSchema, type FeedItem } from '@nexum/contracts';
import type { LinkState } from './store';

export interface EventSourceLike {
  readyState: number;
  onerror: ((ev: Event) => void) | null;
  onopen: ((ev: Event) => void) | null;
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void;
  close(): void;
}

export interface StreamDeps {
  /** `new EventSource(url)`; absent when the browser has none, which means polling only. */
  readonly open?: ((url: string) => EventSourceLike) | undefined;
  /** Fetches feed items after a cursor, for the polling fallback and for catching up. */
  readonly fetchFeed: (after: number) => Promise<readonly FeedItem[]>;
  readonly cursor: () => number;
  readonly onItems: (items: readonly FeedItem[]) => void;
  readonly onTick: (nowMs: number) => void;
  readonly onLink: (link: LinkState) => void;
  readonly pollMs?: number;
  readonly retrySseMs?: number;
}

/**
 * Keeps the game live: server-sent events when they work, polling `/feed` when they do not.
 * While polling it tries the stream again from time to time. Returns a stop function.
 */
export function startStream(deps: StreamDeps): () => void {
  const pollMs = deps.pollMs ?? 5000;
  const retryMs = deps.retrySseMs ?? 30_000;
  let source: EventSourceLike | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const stopPolling = () => {
    if (poll !== null) clearInterval(poll);
    poll = null;
  };

  const pollOnce = () => {
    deps
      .fetchFeed(deps.cursor())
      .then((items) => {
        if (!stopped && items.length > 0) deps.onItems(items);
      })
      .catch(() => {
        /* the next poll will try again */
      });
  };

  const startPolling = () => {
    if (stopped || poll !== null) return;
    deps.onLink('polling');
    pollOnce();
    poll = setInterval(pollOnce, pollMs);
    if (deps.open) {
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, retryMs);
    }
  };

  const connect = () => {
    if (stopped || !deps.open) {
      startPolling();
      return;
    }
    let es: EventSourceLike;
    try {
      es = deps.open('/api/stream');
    } catch {
      startPolling();
      return;
    }
    source = es;
    es.onopen = () => {
      if (stopped || source !== es) return;
      stopPolling();
      if (retry !== null) clearTimeout(retry);
      retry = null;
      deps.onLink('live');
    };
    es.addEventListener('game', (ev) => {
      try {
        const item = feedItemSchema.parse(JSON.parse(String(ev.data)));
        deps.onItems([item]);
      } catch {
        /* ignore a malformed event */
      }
    });
    es.addEventListener('tick', (ev) => {
      try {
        const parsed: unknown = JSON.parse(String(ev.data));
        const nowMs =
          parsed && typeof parsed === 'object' && 'nowMs' in parsed ? parsed.nowMs : undefined;
        if (typeof nowMs === 'number') deps.onTick(nowMs);
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      if (stopped || source !== es) return;
      es.close();
      source = null;
      startPolling();
    };
  };

  connect();
  return () => {
    stopped = true;
    stopPolling();
    if (retry !== null) clearTimeout(retry);
    source?.close();
    source = null;
  };
}
