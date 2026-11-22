import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type api } from './api';
import { createSession, type SessionDeps } from './session';
import { createStore } from './store';
import { makeView } from './testing';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const me = () => ({
  ok: true as const,
  account: { id: 1, username: 'ann' },
  playerId: 'me',
  names: { me: 'Ann' },
  view: makeView(),
});

function setup(over: Partial<typeof api> = {}) {
  const fake = {
    me: vi.fn(() => Promise.resolve(me())),
    feed: vi.fn(() =>
      Promise.resolve({ ok: true as const, nowMs: 1, items: [], cursor: 0, hasMore: false }),
    ),
    login: vi.fn(() =>
      Promise.resolve({ ok: true as const, account: me().account, playerId: 'me' }),
    ),
    register: vi.fn(),
    logout: vi.fn(() => Promise.resolve()),
    placeOrder: vi.fn(() => Promise.resolve({ ok: true as const, seq: 1, atMs: 1 })),
    ...over,
  } as unknown as typeof api;
  const store = createStore();
  const saved = new Map<string, string>();
  const deps: Partial<SessionDeps> = {
    api: fake,
    wallNow: () => 5000,
    storage: {
      getItem: (k) => saved.get(k) ?? null,
      setItem: (k, v) => void saved.set(k, v),
    },
    openStream: undefined,
  };
  const session = createSession(store, deps);
  return { store, session, fake, saved };
}

describe('session', () => {
  it('boots into the game and restores the last-seen time', async () => {
    const { store, session, saved } = setup();
    saved.set('nexum.lastSeen.me', '1234');
    await session.start();
    session.stop();
    expect(store.getState().status).toBe('ready');
    expect(store.getState().lastSeenMs).toBe(1234);
  });

  it('goes to the login screen when /me is refused', async () => {
    const { store, session } = setup({
      me: vi.fn(() => Promise.reject(new ApiError('unauthorized', 401))),
    } as never);
    await session.start();
    expect(store.getState().status).toBe('anon');
  });

  it('shows a plain-language toast when sign-in fails', async () => {
    const { store, session } = setup({
      login: vi.fn(() => Promise.reject(new ApiError('invalid_credentials', 401))),
    } as never);
    expect(await session.login({ username: 'ann', password: 'wrong-pass' })).toBe(false);
    expect(store.getState().toasts[0]?.text).toBe('Wrong username or password.');
  });

  it('refreshes after an accepted order', async () => {
    const { session, fake } = setup();
    await session.start();
    session.stop();
    const before = vi.mocked(fake.me).mock.calls.length;
    expect(await session.placeOrder({ type: 'recall', movementId: 'm' })).toBe(true);
    expect(vi.mocked(fake.me).mock.calls.length).toBe(before + 1);
  });

  it('turns a rejected order into a toast', async () => {
    const { store, session } = setup({
      placeOrder: vi.fn(() => Promise.reject(new ApiError('crew_not_ready', 400))),
    } as never);
    expect(await session.placeOrder({ type: 'recall', movementId: 'm' })).toBe(false);
    const t = store.getState().toasts[0];
    expect(t?.title).toBe('Order refused');
    expect(t?.text).toMatch(/resting/);
  });

  it('saves how far the player has read', async () => {
    const { session, saved } = setup();
    await session.start();
    session.stop();
    session.markSeen();
    expect(saved.get('nexum.lastSeen.me')).toBe('1000000');
  });
});
