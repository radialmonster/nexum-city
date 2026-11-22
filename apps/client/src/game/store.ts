import type { FeedItem, PlayerView } from '@nexum/contracts';
import { useContext, useSyncExternalStore, createContext } from 'react';
import type { Tone } from '../ui';

export const FEED_KEEP = 200;

export interface Account {
  readonly id: number;
  readonly username: string;
}

export interface ToastMessage {
  readonly id: number;
  readonly tone: Tone;
  readonly title: string;
  readonly text?: string;
}

/** The open order card: what to do and where. Crews and carrier are picked inside the card. */
export interface OrderDraft {
  readonly kind: 'move' | 'haul' | 'siege' | 'reinforce' | 'scout' | 'build';
  readonly districtId: string;
}

export type SessionStatus = 'loading' | 'anon' | 'ready';
export type LinkState = 'off' | 'live' | 'polling';

export interface GameState {
  readonly status: SessionStatus;
  readonly account: Account | null;
  readonly view: PlayerView | null;
  /** Wall-clock time (ms) when `view` arrived, to keep the game clock moving between updates. */
  readonly viewAt: number;
  /** Oldest first, deduplicated by `seq`. */
  readonly feed: readonly FeedItem[];
  readonly cursor: number;
  /** Game time (ms) of the previous visit; feed entries after it are new. */
  readonly lastSeenMs: number;
  readonly link: LinkState;
  readonly toasts: readonly ToastMessage[];
  readonly selected: string | null;
  /** Asks the map to fly to a district; `n` makes a repeated request to the same place count. */
  readonly flyTo: { readonly id: string; readonly n: number } | null;
  readonly draft: OrderDraft | null;
}

export const initialState: GameState = {
  status: 'loading',
  account: null,
  view: null,
  viewAt: 0,
  feed: [],
  cursor: 0,
  lastSeenMs: 0,
  link: 'off',
  toasts: [],
  selected: null,
  flyTo: null,
  draft: null,
};

export type GameAction =
  | { type: 'anon' }
  | { type: 'session'; account: Account; view: PlayerView; at: number; lastSeenMs: number }
  | { type: 'view'; view: PlayerView; at: number }
  | { type: 'feed'; items: readonly FeedItem[] }
  | { type: 'link'; link: LinkState }
  | { type: 'toast'; toast: ToastMessage }
  | { type: 'dismiss'; id: number }
  | { type: 'select'; id: string | null }
  | { type: 'fly'; id: string }
  | { type: 'draft'; draft: OrderDraft | null }
  | { type: 'seen'; ms: number };

/** Merges new feed items into the list: ordered by `seq`, no repeats, newest `FEED_KEEP` kept. */
export function mergeFeed(
  feed: readonly FeedItem[],
  items: readonly FeedItem[],
): readonly FeedItem[] {
  if (items.length === 0) return feed;
  const have = new Set(feed.map((f) => f.seq));
  const fresh = items.filter((i) => !have.has(i.seq));
  if (fresh.length === 0) return feed;
  const all = [...feed, ...fresh].sort((a, b) => a.seq - b.seq);
  return all.length > FEED_KEEP ? all.slice(all.length - FEED_KEEP) : all;
}

export function reduce(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'anon':
      return { ...initialState, status: 'anon' };
    case 'session':
      return {
        ...state,
        status: 'ready',
        account: action.account,
        view: action.view,
        viewAt: action.at,
        lastSeenMs: action.lastSeenMs,
      };
    case 'view':
      return { ...state, view: action.view, viewAt: action.at };
    case 'feed': {
      const feed = mergeFeed(state.feed, action.items);
      if (feed === state.feed) return state;
      return { ...state, feed, cursor: Math.max(state.cursor, ...feed.map((f) => f.seq)) };
    }
    case 'link':
      return state.link === action.link ? state : { ...state, link: action.link };
    case 'toast':
      return { ...state, toasts: [...state.toasts, action.toast].slice(-4) };
    case 'dismiss':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case 'select':
      return { ...state, selected: action.id };
    case 'fly':
      return {
        ...state,
        selected: action.id,
        flyTo: { id: action.id, n: (state.flyTo?.n ?? 0) + 1 },
      };
    case 'draft':
      return { ...state, draft: action.draft };
    case 'seen':
      return { ...state, lastSeenMs: Math.max(state.lastSeenMs, action.ms) };
  }
}

export interface GameStore {
  getState(): GameState;
  dispatch(action: GameAction): void;
  subscribe(listener: () => void): () => void;
}

export function createStore(): GameStore {
  let state = initialState;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reduce(state, action);
      if (next === state) return;
      state = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const GameContext = createContext<GameStore | null>(null);

export function useStore(): GameStore {
  const store = useContext(GameContext);
  if (!store) throw new Error('GameContext is missing');
  return store;
}

/** Subscribe to one slice of the game state. */
export function useGame<T>(select: (s: GameState) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

/** The game clock: the view's time plus the wall time since it arrived. */
export function gameNow(state: Pick<GameState, 'view' | 'viewAt'>, wallMs: number): number {
  return state.view ? state.view.nowMs + Math.max(0, wallMs - state.viewAt) : 0;
}
