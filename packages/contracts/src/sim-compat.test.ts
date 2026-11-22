import { ORDER_ERRORS, addPlayer, createWorld, standings, viewFor } from '@nexum/sim';
import type {
  GameState,
  Movement,
  Order,
  PlayerView as SimPlayerView,
  SimEvent,
  SimEventKind,
  Standing as SimStanding,
} from '@nexum/sim';
import { describe, expect, it } from 'vitest';
import {
  SIM_EVENT_KINDS,
  movementSchema,
  orderSchema,
  playerViewSchema,
  simEventSchema,
  standingSchema,
} from './index.js';
import type { OrderBody } from './index.js';

// Compile-time: everything the sim produces or accepts is a valid contract shape. The reverse
// direction for orders (a parsed body being a sim `Order`) cannot be assignment-checked because
// zod types optional keys as `?: T | undefined`, so the server casts after parsing; the runtime
// tests below cover it.
const toBody = (o: Order): OrderBody => o;
const toEvent = (e: SimEvent): ReturnType<typeof simEventSchema.parse> => e;
const toMovement = (m: Movement): ReturnType<typeof movementSchema.parse> => m;
const toView = (v: SimPlayerView): ReturnType<typeof playerViewSchema.parse> => v;
const toStanding = (s: SimStanding): ReturnType<typeof standingSchema.parse> => s;
void [toBody, toEvent, toMovement, toView, toStanding];

// Compile-time: the event-kind lists agree in both directions (a kind missing on either side
// makes one of these fail to compile).
type ContractKind = (typeof SIM_EVENT_KINDS)[number];
const simKindsCovered: SimEventKind extends ContractKind ? true : never = true;
const contractKindsExist: ContractKind extends SimEventKind ? true : never = true;
void [simKindsCovered, contractKindsExist];

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
      { type: 'siege', carrierId: null, crewIds: ['c1', 'c2'], target: 'd1_0' },
      { type: 'reinforce', carrierId: 'v1', crewIds: ['c1'], to: 'd0_0' },
      { type: 'scout', crewId: 'c1', carrierId: null, target: 'd2_2' },
      { type: 'stance', districtId: 'd0_0', stance: 'pullback' },
      { type: 'recall', movementId: 'm1' },
      { type: 'recruit', districtId: 'd0_0' },
      { type: 'settle', carrierId: 'v1', crewIds: ['c1'], target: 'd3_0' },
      { type: 'raid', carrierId: 'v1', crewIds: ['c1', 'c2'], a: 'n1', b: 'n2', hours: 6 },
      {
        type: 'haul',
        carrierId: 'v1',
        crewIds: ['c1'],
        to: 'hubW',
        cargo: { parts: 20 },
        contractId: 'k1',
      },
      { type: 'contract.post', hub: 'hubW', good: 'parts', qty: 20, reward: 400, hours: 12 },
      { type: 'contract.take', contractId: 'k1' },
      { type: 'contract.cancel', contractId: 'k1' },
    ];
    for (const o of orders) expect(orderSchema.parse(o)).toEqual(o);
    expect(orderSchema.safeParse({ type: 'nuke', districtId: 'x' }).success).toBe(false);
    expect(orderSchema.safeParse({ type: 'recruit', districtId: 'x', extra: 1 }).success).toBe(
      false,
    );
    expect(orderSchema.safeParse({ type: 'siege', carrierId: null, crewIds: [] }).success).toBe(
      false,
    );
    expect(
      orderSchema.safeParse({ type: 'move', carrierId: null, crewIds: [], to: '' }).success,
    ).toBe(false);
  });

  it('parses a real fogged view and the standings', () => {
    let state: GameState = addPlayer(createWorld(1), { id: 'p1', districtId: 'd0_0' });
    state = addPlayer(state, { id: 'p2', districtId: 'd5_3' });
    const view = viewFor(state, 'p1');
    expect(playerViewSchema.parse(view)).toEqual(view);
    expect(Object.values(view.districts).some((d) => d.relation === 'remembered')).toBe(true);
    const board = standings(state);
    expect(board.map((s) => standingSchema.parse(s))).toEqual(board);
  });

  it('parses contracts on the board, hiding rivals progress', () => {
    let state: GameState = addPlayer(createWorld(1), { id: 'p1', districtId: 'd0_0' });
    state = addPlayer(state, { id: 'p2', districtId: 'd5_3' });
    const base = {
      hub: 'hubW',
      good: 'parts' as const,
      qty: 20,
      reward: 100,
      poster: 'p1',
      hours: 12,
      postedMs: 0,
      offerEndsMs: 1,
      takenMs: 0,
      dueMs: 0,
      deposit: 0,
      delivered: 0,
      paid: 0,
    };
    state.contracts['k1'] = { ...base, id: 'k1', status: 'open', taker: null };
    state.contracts['k2'] = { ...base, id: 'k2', status: 'taken', taker: 'p1', poster: 'civic' };
    const view = viewFor(state, 'p2');
    expect(playerViewSchema.parse(view)).toEqual(view);
    expect(view.contracts['k2']?.delivered).toBeNull();
    expect(viewFor(state, 'p1').contracts['k2']?.delivered).toBe(0);
  });
});
