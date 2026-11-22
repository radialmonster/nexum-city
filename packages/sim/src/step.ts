import type { Ctx } from './ctx.js';
import { applyOrder } from './orders.js';
import { dispatch, runAfter, systems } from './systems.js';
import type { GameState, Input, QueuedEvent, StepResult } from './types.js';

function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/**
 * The quiet-step copy. With nothing due, `step` only integrates rates, so the only things that
 * change are `nowMs`, each owner's credits and score, and each owned district's stock and waste.
 * Copy just those and share the rest with `prev` (graph, crews, books, memory and queue are the
 * bulk of the state). Results are plain data: treat any state as read-only and pass it to `step`.
 */
function cloneForQuietStep(prev: GameState): GameState {
  const districts: GameState['districts'] = {};
  for (const id of Object.keys(prev.districts)) {
    const d = prev.districts[id] as GameState['districts'][string];
    districts[id] =
      d.owner === 'neutral'
        ? d
        : { ...d, warehouse: { ...d.warehouse }, warehouseValue: { ...d.warehouseValue } };
  }
  const players: GameState['players'] = {};
  for (const id of Object.keys(prev.players)) {
    players[id] = { ...(prev.players[id] as GameState['players'][string]) };
  }
  return { ...prev, districts, players };
}

function advanceTo(ctx: Ctx, toMs: number): void {
  const from = ctx.state.nowMs;
  if (toMs <= from) return;
  for (const system of systems) system.settle?.(ctx, from, toMs);
  ctx.state.nowMs = toMs;
}

/**
 * The simulation core. Pure: it returns a new state and never touches the input.
 *
 * Time advances from `state.nowMs` to `toMs`. Scheduled events (arrivals,
 * completions) and inputs are processed in time order, scheduled events first
 * at equal times, inputs in the order given. Between them, continuous rates are
 * integrated exactly, so stepping in 2-second chunks or in one jump gives the
 * same state and the same events.
 *
 * Inputs with `atMs` after `toMs` are ignored; the caller passes them to a
 * later step.
 */
export function step(prev: GameState, inputs: readonly Input[], toMs: number): StepResult {
  if (!Number.isInteger(toMs) || toMs < prev.nowMs) {
    throw new RangeError(`toMs must be an integer >= state.nowMs (${prev.nowMs}), got ${toMs}`);
  }
  const nothingQueued = (prev.queue[0]?.at ?? Infinity) > toMs;
  const quiet = nothingQueued && inputs.every((i) => (i.atMs ?? prev.nowMs) > toMs);
  const ctx: Ctx = { state: quiet ? cloneForQuietStep(prev) : clone(prev), events: [] };
  const { state } = ctx;

  const due = inputs
    .map((input, index) => ({ input, index, at: Math.max(input.atMs ?? state.nowMs, state.nowMs) }))
    .filter((i) => i.at <= toMs)
    .sort((a, b) => a.at - b.at || a.index - b.index);

  let next = 0;
  for (;;) {
    const ev: QueuedEvent | undefined = state.queue[0];
    const evAt = ev && ev.at <= toMs ? ev.at : Infinity;
    const inp = due[next];
    const inAt = inp ? inp.at : Infinity;
    if (evAt === Infinity && inAt === Infinity) break;
    if (evAt <= inAt) {
      advanceTo(ctx, evAt);
      state.queue.shift();
      dispatch(ctx, ev as QueuedEvent);
      runAfter(ctx);
    } else if (inp) {
      advanceTo(ctx, inAt);
      applyOrder(ctx, inp.input);
      runAfter(ctx);
      next += 1;
    }
  }
  advanceTo(ctx, toMs);
  return { state, events: ctx.events };
}
