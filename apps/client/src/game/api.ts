import {
  authResponseSchema,
  errorResponseSchema,
  etaResponseSchema,
  feedResponseSchema,
  meResponseSchema,
  okResponseSchema,
  placeOrderResponseSchema,
  seasonsResponseSchema,
  standingsResponseSchema,
  type AuthResponse,
  type EtaResponse,
  type FeedResponse,
  type MeResponse,
  type OrderBody,
  type SeasonsResponse,
  type StandingsResponse,
} from '@nexum/contracts';

/** What went wrong: a server error code, or one of two client-side causes. */
export type ApiErrorCode =
  ReturnType<typeof errorResponseSchema.parse>['error'] | 'network' | 'bad_response';

/** A failed API call. `code` is the server's typed code when it sent one. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryAfterS: number | undefined;
  constructor(code: ApiErrorCode, status: number, retryAfterS?: number) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfterS = retryAfterS;
  }
}

/** The slice of a zod schema this client needs. */
interface Parser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

async function call<T>(
  path: string,
  schema: Parser<T>,
  init?: { method: 'POST'; body?: unknown },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init?.method ?? 'GET',
      credentials: 'same-origin',
      ...(init
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(init.body ?? {}),
          }
        : {}),
    });
  } catch {
    throw new ApiError('network', 0);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('bad_response', res.status);
  }
  if (!res.ok) {
    const err = errorResponseSchema.safeParse(json);
    if (err.success) throw new ApiError(err.data.error, res.status, err.data.retryAfterS);
    throw new ApiError(res.status === 401 ? 'unauthorized' : 'bad_response', res.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError('bad_response', res.status);
  return parsed.data;
}

export interface Credentials {
  readonly username: string;
  readonly password: string;
}

export const api = {
  register: (c: Credentials): Promise<AuthResponse> =>
    call('/auth/register', authResponseSchema, { method: 'POST', body: c }),
  login: (c: Credentials): Promise<AuthResponse> =>
    call('/auth/login', authResponseSchema, { method: 'POST', body: c }),
  logout: async (): Promise<void> => {
    await call('/auth/logout', okResponseSchema, { method: 'POST' });
  },
  me: (): Promise<MeResponse> => call('/me', meResponseSchema),
  seasons: (): Promise<SeasonsResponse> => call('/seasons', seasonsResponseSchema),
  standings: (): Promise<StandingsResponse> => call('/standings', standingsResponseSchema),
  placeOrder: (order: OrderBody) =>
    call('/orders', placeOrderResponseSchema, { method: 'POST', body: { order } }),
  eta: (from: string, to: string, carrier: string): Promise<EtaResponse> =>
    call(
      `/eta?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&carrier=${encodeURIComponent(carrier)}`,
      etaResponseSchema,
    ),
  feed: (q: { since?: number; after?: number; limit?: number } = {}): Promise<FeedResponse> => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) p.set(k, String(v));
    const qs = p.toString();
    return call(`/feed${qs ? `?${qs}` : ''}`, feedResponseSchema);
  },
};
