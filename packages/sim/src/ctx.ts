import type { GameState, Id, JsonValue, QueuedEvent, SimEvent, SimEventKind } from './types.js';

/** What systems and order handlers work with during one `step`. */
export interface Ctx {
  state: GameState;
  events: SimEvent[];
}

export function emit(
  ctx: Ctx,
  kind: SimEventKind,
  actors: Id[],
  districts: Id[],
  data: Record<string, JsonValue>,
  at: number = ctx.state.nowMs,
): void {
  ctx.state.counters.event += 1;
  ctx.events.push({ id: `e${ctx.state.counters.event}`, at, kind, actors, districts, data });
}

type Payload = QueuedEvent extends infer E
  ? E extends unknown
    ? Omit<E, 'at' | 'seq'>
    : never
  : never;

/** Adds a scheduled event, keeping the queue sorted by (at, seq). */
export function schedule(ctx: Ctx, at: number, payload: Payload): void {
  const queue = ctx.state.queue;
  ctx.state.counters.seq += 1;
  const entry = { ...payload, at, seq: ctx.state.counters.seq } as QueuedEvent;
  let lo = 0;
  let hi = queue.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const m = queue[mid] as QueuedEvent;
    if (m.at < at || (m.at === at && m.seq < entry.seq)) lo = mid + 1;
    else hi = mid;
  }
  queue.splice(lo, 0, entry);
}

export function unschedule(state: GameState, match: (e: QueuedEvent) => boolean): void {
  state.queue = state.queue.filter((e) => !match(e));
}
