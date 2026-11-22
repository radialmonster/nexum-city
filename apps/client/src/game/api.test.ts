import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
import { messageFor } from './messages';
import { jsonResponse, makeView } from './testing';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stub = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  const mock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(fn(url, init)));
  vi.stubGlobal('fetch', mock);
  return mock;
};

describe('api', () => {
  it('parses /me with the contract schema', async () => {
    stub(() =>
      jsonResponse({
        ok: true,
        account: { id: 1, username: 'ann' },
        playerId: 'me',
        names: { me: 'Me' },
        view: makeView(),
      }),
    );
    const me = await api.me();
    expect(me.playerId).toBe('me');
    expect(me.view.districts['a']?.name).toBe('Alpha Docks');
  });

  it('posts an order as {order} with a JSON body', async () => {
    const mock = stub(() => jsonResponse({ ok: true, seq: 3, atMs: 9 }, 202));
    await api.placeOrder({ type: 'stance', districtId: 'a', stance: 'hold' });
    const [url, init] = mock.mock.calls[0] ?? [];
    expect(url).toBe('/api/orders');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      order: { type: 'stance', districtId: 'a', stance: 'hold' },
    });
  });

  it('turns a typed rejection into an ApiError with its code', async () => {
    stub(() => jsonResponse({ ok: false, error: 'crew_busy' }, 400));
    const err = await api.placeOrder({ type: 'recall', movementId: 'm' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('crew_busy');
    expect(messageFor('crew_busy')).toMatch(/road/);
  });

  it('maps a 401 without a body code to unauthorized', async () => {
    stub(() => jsonResponse({ nope: 1 }, 401));
    await expect(api.me()).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('reports a response that fails the schema as bad_response', async () => {
    stub(() => jsonResponse({ ok: true, account: 1 }));
    await expect(api.me()).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('reports a dead network', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('down')));
    await expect(api.me()).rejects.toMatchObject({ code: 'network' });
  });

  it('builds the feed query string', async () => {
    const mock = stub(() =>
      jsonResponse({ ok: true, nowMs: 1, items: [], cursor: 0, hasMore: false }),
    );
    await api.feed({ after: 5, limit: 10 });
    expect(mock.mock.calls[0]?.[0]).toBe('/api/feed?after=5&limit=10');
  });

  it('falls back to a generic line for an unknown code', () => {
    expect(messageFor('???')).toBe('The order was refused.');
  });
});
