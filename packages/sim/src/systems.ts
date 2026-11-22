import type { Ctx } from './ctx.js';
import { contractSystem } from './contracts.js';
import { constructionSystem } from './construction.js';
import { observe } from './fog.js';
import { frontierSystem } from './frontier.js';
import { jobSystem } from './jobs.js';
import { marketSystem } from './market.js';
import { productionSystem } from './production.js';
import { raidSystem } from './raid.js';
import { rushSystem } from './rush.js';
import { scoreSystem } from './score.js';
import { settleSystem } from './settle.js';
import { shortageSystem } from './shortage.js';
import { sinkSystem } from './sink.js';
import { siegeSystem } from './siege.js';
import { travelSystem } from './travel.js';
import { wearSystem } from './wear.js';
import type { QueuedEvent, QueuedKind } from './types.js';

export type Handlers = {
  [K in QueuedKind]?: (ctx: Ctx, event: Extract<QueuedEvent, { kind: K }>) => void;
};

/**
 * A system owns one slice of the rules. `step` calls each system's `settle`
 * to integrate continuous rates across a span of time with no scheduled event
 * inside it, and routes each due queue event to the system that handles its
 * kind. Siege, markets, fog, scoring and the frontier (tasks 16-1A) plug in by
 * adding a system here and new members to `QueuedEvent`.
 */
export interface System {
  readonly name: string;
  settle?: (ctx: Ctx, fromMs: number, toMs: number) => void;
  handlers?: Handlers;
  /** Runs after each queue event and each order, never at the end of a step. */
  after?: (ctx: Ctx) => void;
}

const fogSystem: System = { name: 'fog', after: observe };

/** Order matters only for `settle` (all current systems are independent). */
export const systems: readonly System[] = [
  travelSystem,
  raidSystem,
  wearSystem,
  productionSystem,
  constructionSystem,
  siegeSystem,
  scoreSystem,
  marketSystem,
  contractSystem,
  shortageSystem,
  sinkSystem,
  jobSystem,
  rushSystem,
  frontierSystem,
  settleSystem,
  fogSystem,
];

export function runAfter(ctx: Ctx): void {
  for (const system of systems) system.after?.(ctx);
}

export function dispatch(ctx: Ctx, event: QueuedEvent): void {
  for (const system of systems) {
    const handler = system.handlers?.[event.kind] as ((c: Ctx, e: QueuedEvent) => void) | undefined;
    if (handler) {
      handler(ctx, event);
      return;
    }
  }
  throw new Error(`no system handles queued event kind "${event.kind}"`);
}
