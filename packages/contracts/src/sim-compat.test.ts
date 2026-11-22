import { ORDER_ERRORS } from '@nexum/sim';
import type { GameState, Order, SimEvent } from '@nexum/sim';
import { describe, expect, it } from 'vitest';
import { orderSchema, simEventSchema } from './index.js';
import type { OrderBody } from './index.js';

// Compile-time: the sim's orders and events are valid contract shapes. The reverse direction
// (a parsed body being a sim `Order`) cannot be assignment-checked because zod types optional
// keys as `?: T | undefined`, so the server casts after parsing; the runtime tests below cover it.
const toBody = (o: Order): OrderBody => o;
const toEvent = (e: SimEvent): ReturnType<typeof simEventSchema.parse> => e;
void toBody;
void toEvent;

describe('contracts mirror the sim', () => {
  it('lists exactly the sim order errors', async () => {
    const { ORDER_ERROR_CODES } = await import('./orders.js');
    expect([...ORDER_ERROR_CODES]).toEqual([...ORDER_ERRORS]);
  });

  it('accepts every order shape and rejects junk', () => {
    const orders: Order[] = [
      { type: 'move', carrierId: null, crewIds: ['c1'], to: 'd1_1' },
      { type: 'haul', carrierId: 'v1', crewIds: ['c1'], to: 'hubW', cargo: { parts: 5 } },
      { type: 'build', districtId: 'd0_0', building: 'workshop' },
      { type: 'scout', crewId: 'c1', carrierId: null, target: 'd2_2' },
      { type: 'stance', districtId: 'd0_0', stance: 'pullback' },
      { type: 'recall', movementId: 'm1' },
      { type: 'recruit', districtId: 'd0_0' },
    ];
    for (const o of orders) expect(orderSchema.parse(o)).toEqual(o);
    expect(orderSchema.safeParse({ type: 'nuke', districtId: 'x' }).success).toBe(false);
    expect(orderSchema.safeParse({ type: 'recruit', districtId: 'x', extra: 1 }).success).toBe(
      false,
    );
    expect(
      orderSchema.safeParse({ type: 'move', carrierId: null, crewIds: [], to: '' }).success,
    ).toBe(false);
  });

  it('parses a real world', async () => {
    const { createWorld, addPlayer } = await import('@nexum/sim');
    const state: GameState = addPlayer(createWorld(1), { id: 'p1', districtId: 'd0_0' });
    const { playerViewSchema } = await import('./index.js');
    const view = {
      nowMs: state.nowMs,
      world: state.world,
      player: state.players['p1'],
      districts: state.districts,
      crews: state.crews,
      carriers: state.carriers,
      movements: state.movements,
    };
    expect(playerViewSchema.safeParse(view).success).toBe(true);
  });
});
