import type { FeedItem, OrderBody } from '@nexum/contracts';
import { api, ApiError, type Credentials } from './api';
import { messageFor } from './messages';
import { startStream, type EventSourceLike } from './stream';
import type { GameStore, OrderDraft } from './store';

const VIEW_REFRESH_MS = 10_000;
const FEED_WINDOW_MS = 48 * 3_600_000;

export interface SessionDeps {
  readonly api: typeof api;
  readonly wallNow: () => number;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly openStream: ((url: string) => EventSourceLike) | undefined;
}

function defaults(): SessionDeps {
  let storage: Storage | null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    api,
    wallNow: () => Date.now(),
    storage,
    openStream:
      typeof EventSource === 'function'
        ? (url) => new EventSource(url, { withCredentials: true })
        : undefined,
  };
}

const seenKey = (playerId: string) => `nexum.lastSeen.${playerId}`;

/** Events that change the world enough to reload the view at once. */
const QUIET = new Set(['siege.progress', 'combat.round', 'score.tick']);

export interface Session {
  start(): Promise<void>;
  login(c: Credentials): Promise<boolean>;
  register(c: Credentials): Promise<boolean>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  placeOrder(order: OrderBody): Promise<boolean>;
  openDraft(draft: OrderDraft | null): void;
  /** Remember how far the player has read, for the next visit. */
  markSeen(): void;
  toast(tone: 'ok' | 'warn' | 'danger' | 'accent', title: string, text?: string): void;
  stop(): void;
}

export function createSession(store: GameStore, overrides: Partial<SessionDeps> = {}): Session {
  const deps = { ...defaults(), ...overrides };
  let stopStream: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRefresh = 0;
  let toastId = 0;

  const toast: Session['toast'] = (tone, title, text) => {
    toastId += 1;
    store.dispatch({
      type: 'toast',
      toast: { id: toastId, tone, title, ...(text === undefined ? {} : { text }) },
    });
  };

  const readSeen = (playerId: string): number => {
    try {
      const raw = deps.storage?.getItem(seenKey(playerId));
      const n = raw ? Number(raw) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  };

  const refresh = async () => {
    lastRefresh = deps.wallNow();
    try {
      const me = await deps.api.me();
      store.dispatch({ type: 'view', view: me.view, at: deps.wallNow() });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'unauthorized') {
        stopLive();
        store.dispatch({ type: 'anon' });
      }
    }
  };

  const scheduleRefresh = (delayMs: number) => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, delayMs);
  };

  const onItems = (items: readonly FeedItem[]) => {
    store.dispatch({ type: 'feed', items });
    if (items.some((i) => !QUIET.has(i.event.kind))) scheduleRefresh(300);
  };

  const startLive = () => {
    stopLive();
    stopStream = startStream({
      open: deps.openStream,
      fetchFeed: async (after) => (await deps.api.feed({ after })).items,
      cursor: () => store.getState().cursor,
      onItems,
      onTick: () => {
        if (deps.wallNow() - lastRefresh >= VIEW_REFRESH_MS) scheduleRefresh(0);
      },
      onLink: (link) => {
        store.dispatch({ type: 'link', link });
      },
    });
  };

  function stopLive() {
    stopStream?.();
    stopStream = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    store.dispatch({ type: 'link', link: 'off' });
  }

  const boot = async () => {
    const me = await deps.api.me();
    const at = deps.wallNow();
    store.dispatch({
      type: 'session',
      account: me.account,
      view: me.view,
      at,
      lastSeenMs: readSeen(me.playerId),
    });
    lastRefresh = at;
    try {
      const since = Math.max(0, me.view.nowMs - FEED_WINDOW_MS);
      const feed = await deps.api.feed({ since, limit: 200 });
      store.dispatch({ type: 'feed', items: feed.items });
    } catch {
      /* the live stream will fill the feed */
    }
    startLive();
  };

  const signIn = async (call: () => Promise<unknown>): Promise<boolean> => {
    try {
      await call();
      await boot();
      return true;
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network';
      toast('danger', 'Could not sign in', messageFor(code));
      return false;
    }
  };

  return {
    async start() {
      try {
        await boot();
      } catch {
        store.dispatch({ type: 'anon' });
      }
    },
    login: (c) => signIn(() => deps.api.login(c)),
    register: (c) => signIn(() => deps.api.register(c)),
    async logout() {
      this.markSeen();
      stopLive();
      try {
        await deps.api.logout();
      } catch {
        /* signed out locally either way */
      }
      store.dispatch({ type: 'anon' });
    },
    refresh,
    async placeOrder(order) {
      try {
        await deps.api.placeOrder(order);
        await refresh();
        return true;
      } catch (e) {
        const code = e instanceof ApiError ? e.code : 'network';
        toast('warn', 'Order refused', messageFor(code));
        return false;
      }
    },
    openDraft(draft) {
      store.dispatch({ type: 'draft', draft });
    },
    markSeen() {
      const { view } = store.getState();
      if (!view) return;
      try {
        deps.storage?.setItem(seenKey(view.playerId), String(view.nowMs));
      } catch {
        /* storage may be blocked */
      }
    },
    toast,
    stop: stopLive,
  };
}
