import { z } from 'zod';
import {
  buildingTypeSchema,
  carrierKindSchema,
  goodSchema,
  idSchema,
  sideSchema,
  stanceSchema,
} from './orders.js';

/** JSON shapes of the sim types that cross the wire (a per-player view and the event feed). */

export const goodsSchema = z.object({
  parts: z.number(),
  power: z.number(),
  data: z.number(),
  supplies: z.number(),
});

const posSchema = z.object({ x: z.number(), y: z.number() });

export const DISTRICT_KINDS = [
  'docks',
  'grid',
  'archive',
  'farms',
  'stacks',
  'residential',
  'hub',
] as const;

export const districtSchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: z.enum(DISTRICT_KINDS),
  pos: posSchema,
  owner: z.string(),
  garrison: z.array(idSchema),
  stance: stanceSchema,
  buildings: z.array(z.object({ type: buildingTypeSchema, level: z.number() })),
  slots: z.number(),
  warehouse: goodsSchema,
  protectedUntilMs: z.number().optional(),
  frontier: z.enum(['open', 'surveying', 'built']),
  construction: z
    .object({ building: buildingTypeSchema, level: z.number(), completesAtMs: z.number() })
    .nullable(),
  overflowing: z.boolean(),
  wasted: z.number(),
});

export const playerSchema = z.object({
  id: idSchema,
  credits: z.number(),
  stash: z.record(z.string(), goodsSchema),
});

const unitLocationSchema = z.union([z.object({ at: idSchema }), z.object({ movement: idSchema })]);

export const crewSchema = z.object({
  id: idSchema,
  owner: idSchema,
  strength: z.number(),
  loc: unitLocationSchema,
  readyAtMs: z.number(),
});

export const carrierSchema = z.object({
  id: idSchema,
  owner: idSchema,
  kind: z.enum(['van', 'hauler', 'runner']),
  loc: unitLocationSchema,
});

export const movementSchema = z.object({
  id: idSchema,
  owner: idSchema,
  kind: z.enum(['move', 'haul', 'scout', 'siege', 'reinforce', 'settle']),
  carrierId: idSchema.nullable(),
  carrierKind: carrierKindSchema,
  crewIds: z.array(idSchema),
  cargo: goodsSchema,
  route: z.array(idSchema),
  lengthM: z.number(),
  from: idSchema,
  to: idSchema,
  departMs: z.number(),
  arriveMs: z.number(),
  recalledAtMs: z.number().optional(),
  recallFraction: z.number().optional(),
});

export const SIM_EVENT_KINDS = [
  'arrived',
  'siege.started',
  'siege.progress',
  'siege.captured',
  'siege.broken',
  'combat.round',
  'production.wasted',
  'build.done',
  'trade.filled',
  'player.joined',
  'frontier.opened',
  'settle.started',
  'settle.done',
  'settle.failed',
  'protection.ended',
  'score.tick',
  'order.rejected',
] as const;

export const simEventSchema = z.object({
  id: idSchema,
  at: z.number(),
  kind: z.enum(SIM_EVENT_KINDS),
  actors: z.array(idSchema),
  districts: z.array(idSchema),
  data: z.record(z.string(), z.json()),
});

/** An event with its position in the server's append-only event log. */
export const feedItemSchema = z.object({ seq: z.number().int(), event: simEventSchema });

const scoreSchema = z.object({ rank: z.number().int(), playerId: idSchema, score: z.number() });

/** A district's capture bar as a player may see it (progress 0 to 1). */
export const siegeViewSchema = z.object({ attacker: idSchema, progress: z.number() });

const districtBase = {
  id: idSchema,
  name: z.string(),
  kind: z.string(),
  pos: posSchema,
};

/** One district as seen through fog: full detail if own, coarse if in sight, a memory otherwise. */
export const districtViewSchema = z.discriminatedUnion('relation', [
  z.object({
    relation: z.literal('own'),
    ...districtBase,
    owner: idSchema,
    garrison: z.array(idSchema),
    stance: stanceSchema,
    buildings: z.array(z.object({ type: buildingTypeSchema, level: z.number() })),
    slots: z.number(),
    warehouse: goodsSchema,
    protectedUntilMs: z.number().optional(),
    frontier: z.enum(['open', 'surveying', 'built']),
    construction: z
      .object({ building: buildingTypeSchema, level: z.number(), completesAtMs: z.number() })
      .nullable(),
    overflowing: z.boolean(),
    siege: siegeViewSchema.nullable(),
  }),
  z.object({
    relation: z.enum(['visible', 'hub']),
    ...districtBase,
    owner: z.string(),
    protected: z.boolean(),
    /** Crews present by owner, as counts. */
    presence: z.record(idSchema, z.number()),
    siege: siegeViewSchema.nullable(),
  }),
  z.object({
    relation: z.literal('remembered'),
    ...districtBase,
    lastKnownOwner: z.string().nullable(),
  }),
]);

export const seenConvoySchema = z.object({
  id: idSchema,
  owner: idSchema,
  carrier: z.string(),
  position: posSchema,
  segment: z.tuple([idSchema, idSchema]),
});

const levelSchema = z.object({ price: z.number().int(), qty: z.number().int() });

/** A hub's public book for one good (prices in centi-credits per unit). */
export const marketBookViewSchema = z.object({
  bids: z.array(levelSchema),
  asks: z.array(levelSchema),
  civic: z.object({
    bid: z.number().int(),
    ask: z.number().int(),
    bidDepth: z.number().int(),
    askDepth: z.number().int(),
  }),
  refCents: z.number().int(),
  lastCents: z.number().int().nullable(),
});

/** A resting market order. */
export const marketOrderSchema = z.object({
  id: idSchema,
  owner: idSchema,
  hub: idSchema,
  good: goodSchema,
  side: sideSchema,
  price: z.number().int(),
  qty: z.number().int(),
  seq: z.number().int(),
});

/** Mirrors `PlayerView` from `viewFor` in `@nexum/sim`: fogged, never holds rivals' private data. */
export const playerViewSchema = z.object({
  playerId: idSchema,
  nowMs: z.number(),
  season: z.object({
    startMs: z.number(),
    endMs: z.number(),
    finaleStartMs: z.number(),
    finale: z.boolean(),
  }),
  self: z.object({
    credits: z.number(),
    stash: z.record(z.string(), goodsSchema),
    score: z.number(),
  }),
  standings: z.array(scoreSchema),
  districts: z.record(idSchema, districtViewSchema),
  crews: z.record(idSchema, crewSchema),
  carriers: z.record(idSchema, carrierSchema),
  movements: z.record(idSchema, movementSchema),
  convoys: z.array(seenConvoySchema),
  reveals: z.record(idSchema, z.number()),
  markets: z.record(idSchema, z.record(goodSchema, marketBookViewSchema)),
  orders: z.array(marketOrderSchema),
  graph: z.object({
    nodes: z.record(
      idSchema,
      z.object({ id: idSchema, type: z.enum(['district', 'junction']), pos: posSchema }),
    ),
    edges: z.array(z.object({ a: idSchema, b: idSchema, lengthM: z.number() })),
    hubs: z.array(idSchema),
  }),
});

/** Mirrors `Standing` from `standings` in `@nexum/sim`. */
export const standingSchema = z.object({
  rank: z.number().int(),
  playerId: idSchema,
  score: z.number(),
  scoreMs: z.number(),
  districts: z.number().int(),
  tradeScore: z.number(),
  tradeMs: z.number(),
});

export type GoodName = z.infer<typeof goodSchema>;
export type PlayerView = z.infer<typeof playerViewSchema>;
export type DistrictView = z.infer<typeof districtViewSchema>;
export type Standing = z.infer<typeof standingSchema>;
export type FeedItem = z.infer<typeof feedItemSchema>;
