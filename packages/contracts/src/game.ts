import { z } from 'zod';
import {
  buildingTypeSchema,
  carrierKindSchema,
  goodSchema,
  idSchema,
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
  kind: z.enum(['move', 'haul', 'scout']),
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

export const playerViewSchema = z.object({
  nowMs: z.number(),
  world: z.object({ cols: z.number(), rows: z.number(), soundY: z.number() }),
  player: playerSchema,
  /** Own districts plus hubs. */
  districts: z.record(idSchema, districtSchema),
  crews: z.record(idSchema, crewSchema),
  carriers: z.record(idSchema, carrierSchema),
  movements: z.record(idSchema, movementSchema),
});

export type GoodName = z.infer<typeof goodSchema>;
export type PlayerView = z.infer<typeof playerViewSchema>;
export type FeedItem = z.infer<typeof feedItemSchema>;
