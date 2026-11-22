import { z } from 'zod';
import { feedItemSchema, playerViewSchema, standingSchema } from './game.js';
import { ORDER_ERROR_CODES, carrierKindSchema, idSchema, orderSchema } from './orders.js';

/** Request and response shapes for every `/api` route. */

export const API_ERROR_CODES = [
  'invalid_request',
  'unsupported_media_type',
  'unauthorized',
  'invalid_credentials',
  'username_taken',
  'rate_limited',
  'world_full',
  'season_over',
  'not_found',
  'no_route',
  'internal',
] as const;

export const errorCodeSchema = z.enum([...API_ERROR_CODES, ...ORDER_ERROR_CODES]);

export const errorResponseSchema = z.object({
  ok: z.literal(false),
  error: errorCodeSchema,
  /** Human-readable schema problems for `invalid_request`. */
  issues: z.array(z.string()).optional(),
  retryAfterS: z.number().optional(),
});

export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export const usernameSchema = z.string().regex(USERNAME_PATTERN);
export const credentialsSchema = z.strictObject({
  username: usernameSchema,
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});
export const registerRequestSchema = credentialsSchema;
export const loginRequestSchema = z.strictObject({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(PASSWORD_MAX),
});

export const accountSchema = z.object({ id: z.number().int(), username: z.string() });

export const authResponseSchema = z.object({
  ok: z.literal(true),
  account: accountSchema,
  playerId: idSchema,
});
export const okResponseSchema = z.object({ ok: z.literal(true) });

/** Crew names by player id: usernames for humans, crew names for bots. Public to every player. */
export const crewNamesSchema = z.record(idSchema, z.string());

export const meResponseSchema = z.object({
  ok: z.literal(true),
  account: accountSchema,
  playerId: idSchema,
  view: playerViewSchema,
  names: crewNamesSchema,
});

export const standingsResponseSchema = z.object({
  ok: z.literal(true),
  nowMs: z.number(),
  standings: z.array(standingSchema),
  names: crewNamesSchema,
});

export const placeOrderRequestSchema = z.strictObject({ order: orderSchema });
export const placeOrderResponseSchema = z.object({
  ok: z.literal(true),
  /** Position in the append-only input log; the order is durable once this is returned. */
  seq: z.number().int(),
  /** Game time (ms) at which the order takes effect. */
  atMs: z.number().int(),
});

export const etaQuerySchema = z.object({
  from: idSchema,
  to: idSchema,
  carrier: carrierKindSchema,
});
export const etaResponseSchema = z.object({
  ok: z.literal(true),
  eta: z.object({
    route: z.array(idSchema),
    lengthM: z.number(),
    durationMs: z.number(),
  }),
});

export const FEED_MAX_LIMIT = 500;
export const FEED_DEFAULT_LIMIT = 200;
export const feedQuerySchema = z.object({
  /** Only events with `at > since` (game ms). */
  since: z.coerce.number().int().min(0).optional(),
  /** Only events with `seq > after`; a cursor that never misses events at the same millisecond. */
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(FEED_MAX_LIMIT).optional(),
});
export const feedResponseSchema = z.object({
  ok: z.literal(true),
  nowMs: z.number(),
  items: z.array(feedItemSchema),
  /** Highest `seq` in `items`, or the request's `after`; pass it back as `after`. */
  cursor: z.number().int(),
  hasMore: z.boolean(),
});

/** Server-sent events on `GET /api/stream`. Each event's `data` is JSON of the named schema. */
export const streamHelloSchema = z.object({ nowMs: z.number(), playerId: idSchema });
export const streamTickSchema = z.object({ nowMs: z.number() });
export const streamGameSchema = feedItemSchema;
export const STREAM_EVENTS = ['hello', 'tick', 'game', 'heartbeat'] as const;

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type StandingsResponse = z.infer<typeof standingsResponseSchema>;
export type PlaceOrderResponse = z.infer<typeof placeOrderResponseSchema>;
export type EtaResponse = z.infer<typeof etaResponseSchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;

/** Headline numbers frozen with a finished season. */
export const seasonStatsSchema = z.object({
  players: z.number().int(),
  districtsHeld: z.number().int(),
  topTraderId: idSchema.nullable(),
  topTradeScore: z.number(),
});

/** One row of the hall of fame: a finished season, frozen. */
export const seasonSummarySchema = z.object({
  number: z.number().int(),
  startMs: z.number(),
  endMs: z.number(),
  /** `ended` when the clock ran out, `rules_change` when a new rules version closed it early. */
  reason: z.enum(['ended', 'rules_change']),
  standings: z.array(standingSchema),
  /** Crew names as they were at the end of that season. */
  names: crewNamesSchema,
  stats: seasonStatsSchema,
});

/** The season being played (or just finished and waiting out its break). */
export const currentSeasonSchema = z.object({
  number: z.number().int(),
  startMs: z.number(),
  endMs: z.number(),
  finaleStartMs: z.number(),
  /** True once the clock has run out: scoring has stopped and orders are refused. */
  over: z.boolean(),
  /** When the next season starts, or null while this one is still running. */
  nextStartMs: z.number().nullable(),
});

export const seasonsResponseSchema = z.object({
  ok: z.literal(true),
  nowMs: z.number(),
  current: currentSeasonSchema,
  /** Finished seasons, newest first. */
  seasons: z.array(seasonSummarySchema),
});

export type SeasonStats = z.infer<typeof seasonStatsSchema>;
export type SeasonSummary = z.infer<typeof seasonSummarySchema>;
export type CurrentSeason = z.infer<typeof currentSeasonSchema>;
export type SeasonsResponse = z.infer<typeof seasonsResponseSchema>;
