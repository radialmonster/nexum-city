import { z } from 'zod';

/**
 * Order shapes. They mirror the `Order` union in `@nexum/sim`; `sim-compat.test.ts` checks both
 * directions at compile time. Range and ownership rules are the sim's job (`validateOrder`), so
 * that a rejected order carries a typed sim error code rather than a generic schema failure.
 */

export const GOODS = ['parts', 'power', 'data', 'supplies'] as const;
export const BUILDING_TYPES = ['workshop', 'depot', 'walls'] as const;
export const CARRIER_KINDS = ['foot', 'van', 'hauler', 'runner'] as const;
export const STANCES = ['hold', 'pullback'] as const;

/** Maximum number of crews one order may name; a bound on payload size, not a game rule. */
export const MAX_CREWS_PER_ORDER = 64;

export const idSchema = z.string().min(1).max(64);
export const goodSchema = z.enum(GOODS);
export const buildingTypeSchema = z.enum(BUILDING_TYPES);
export const carrierKindSchema = z.enum(CARRIER_KINDS);
export const stanceSchema = z.enum(STANCES);
export const SIDES = ['buy', 'sell'] as const;
export const sideSchema = z.enum(SIDES);

const crewIds = z.array(idSchema).max(MAX_CREWS_PER_ORDER);

export const cargoRequestSchema = z.strictObject({
  parts: z.number().int().optional(),
  power: z.number().int().optional(),
  data: z.number().int().optional(),
  supplies: z.number().int().optional(),
});

export const orderSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('move'),
    carrierId: idSchema.nullable(),
    crewIds,
    to: idSchema,
  }),
  z.strictObject({
    type: z.literal('haul'),
    carrierId: idSchema.nullable(),
    crewIds,
    to: idSchema,
    cargo: cargoRequestSchema,
    /** Deliver this load to a contract you have taken; `to` must be the contract's hub. */
    contractId: idSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('build'),
    districtId: idSchema,
    building: buildingTypeSchema,
  }),
  z.strictObject({
    type: z.literal('siege'),
    carrierId: idSchema.nullable(),
    crewIds,
    target: idSchema,
  }),
  z.strictObject({
    type: z.literal('settle'),
    carrierId: idSchema.nullable(),
    crewIds,
    target: idSchema,
  }),
  z.strictObject({
    type: z.literal('raid'),
    carrierId: idSchema.nullable(),
    crewIds,
    a: idSchema,
    b: idSchema,
    hours: z.number().int().min(1).max(8),
  }),
  z.strictObject({
    type: z.literal('reinforce'),
    carrierId: idSchema.nullable(),
    crewIds,
    to: idSchema,
  }),
  z.strictObject({
    type: z.literal('scout'),
    crewId: idSchema,
    carrierId: idSchema.nullable(),
    target: idSchema,
  }),
  z.strictObject({
    type: z.literal('stance'),
    districtId: idSchema,
    stance: stanceSchema,
  }),
  z.strictObject({ type: z.literal('recall'), movementId: idSchema }),
  z.strictObject({ type: z.literal('recruit'), districtId: idSchema }),
  z.strictObject({
    type: z.literal('market.place'),
    hub: idSchema,
    side: sideSchema,
    good: goodSchema,
    /** Centi-credits per unit (integer). */
    price: z.number().int(),
    /** Whole units. */
    qty: z.number().int(),
  }),
  z.strictObject({ type: z.literal('market.cancel'), orderId: idSchema }),
  z.strictObject({
    type: z.literal('contract.post'),
    hub: idSchema,
    good: goodSchema,
    /** Whole units wanted. */
    qty: z.number().int(),
    /** Whole credits, escrowed until the job ends. */
    reward: z.number().int(),
    /** Hours the taker gets to deliver. */
    hours: z.number().int(),
  }),
  z.strictObject({ type: z.literal('contract.take'), contractId: idSchema }),
  z.strictObject({ type: z.literal('contract.cancel'), contractId: idSchema }),
]);

export type OrderBody = z.infer<typeof orderSchema>;

/** Typed rejection codes from `validateOrder`. Mirrors `ORDER_ERRORS` in `@nexum/sim`. */
export const ORDER_ERROR_CODES = [
  'unknown_actor',
  'unknown_crew',
  'unknown_carrier',
  'unknown_district',
  'unknown_movement',
  'not_owner',
  'crew_not_ready',
  'crew_busy',
  'carrier_busy',
  'carrier_locked',
  'not_colocated',
  'no_crew',
  'too_many_crews',
  'duplicate_unit',
  'invalid_target',
  'no_route',
  'empty_cargo',
  'bad_quantity',
  'over_capacity',
  'insufficient_goods',
  'insufficient_credits',
  'slot_unavailable',
  'max_level',
  'already_building',
  'already_recalled',
  'protected',
  'unknown_good',
  'bad_price',
  'unknown_order',
  'too_many_orders',
  'not_open_plot',
  'already_settling',
  'bad_edge',
  'bad_window',
  'too_many_raids',
  'protected_no_raid',
  'unknown_contract',
  'contract_taken',
  'contract_closed',
  'not_taker',
  'own_contract',
  'board_full',
  'too_many_contracts',
  'bad_reward',
  'wrong_cargo',
] as const;
export const orderErrorCodeSchema = z.enum(ORDER_ERROR_CODES);
export type OrderErrorCode = z.infer<typeof orderErrorCodeSchema>;
