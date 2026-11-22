import { MS_PER_MINUTE } from './balance.js';
import { BOTS, type BotKind } from './bots.js';
import { civicAsk } from './market.js';
import { validateOrder } from './orders.js';
import { stripNewcomerPerks } from './rush.js';
import { shortestRoute } from './routing.js';
import { step } from './step.js';
import type { GameState, Id, Input, Order, SimEventKind } from './types.js';
import { addPlayer, createWorld } from './world.js';

/**
 * The "first 15 minutes" measurement (docs/rewrite/sim-spec.md, "Newcomer rush and street jobs"):
 * a scripted newcomer plays the opening a new player is pointed at, once a minute, and we count
 * the distinct meaningful actions the game accepted and the things that finished.
 *
 * The script, in the order it tries things each minute: buy supplies at the nearest hub, build a
 * workshop, take the starter contract and haul it to the hub, settle a plot (as soon as 60
 * supplies are home and the first street job is done), take street jobs whenever a crew is free,
 * and recruit a crew once the settle is in. Whatever the game refuses is simply tried
 * again next minute. It is a fixture, not a player model: it shows how much there is to do and
 * how much of it finishes, not how well anyone plays.
 */

export interface SessionResult {
  seed: number;
  /** Accepted actions within 15 and 30 minutes, claim included. */
  actions15: number;
  actions30: number;
  /** Things that finished (build, street job, trade fill, contract paid, settled). */
  completions15: number;
  completions30: number;
  /** The accepted actions by kind, for the report. */
  kinds: Record<string, number>;
  /** Minute of the first completion, or null. */
  firstCompletionMin: number | null;
  /** Minute the game first accepted a settle order, or null (the aim is within 30). */
  settleMin: number | null;
  /** Minute the starter contract was paid, or null. */
  starterPaidMin: number | null;
}

const DONE: SimEventKind[] = [
  'build.done',
  'job.done',
  'trade.filled',
  'contract.done',
  'settle.done',
];

const nearestHub = (s: GameState, from: Id): Id | undefined =>
  Object.values(s.districts)
    .filter((d) => d.kind === 'hub')
    .map((d) => ({ id: d.id, len: shortestRoute(s.graph, from, d.id)?.lengthM ?? Infinity }))
    .filter((x) => Number.isFinite(x.len))
    .sort((a, b) => a.len - b.len || (a.id < b.id ? -1 : 1))[0]?.id;

/** Plays the opening for one newcomer next to three bots; `perks` false is the game before the rush. */
export function firstSession(seed: number, perks: boolean): SessionResult {
  let s = createWorld(seed, { seasonHours: 7 * 24 });
  const bots: { id: Id; bot: BotKind }[] = [
    { id: 'b1', bot: 'raider' },
    { id: 'b2', bot: 'turtle' },
    { id: 'b3', bot: 'merchant' },
  ];
  s = addPlayer(s, { id: 'n1' });
  for (const b of bots) s = addPlayer(s, { id: b.id });
  if (!perks) stripNewcomerPerks(s, { jobs: true });

  const me = 'n1';
  const home = Object.values(s.districts).find((d) => d.owner === me);
  if (!home) throw new Error('newcomer has no district');
  const hub = nearestHub(s, home.id);
  const t0 = s.nowMs;
  const kinds: Record<string, number> = {};
  const result: SessionResult = {
    seed,
    actions15: 0,
    actions30: 0,
    completions15: 0,
    completions30: 0,
    kinds,
    firstCompletionMin: null,
    settleMin: null,
    starterPaidMin: null,
  };
  const count = (kind: string, minute: number): void => {
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (minute < 15) result.actions15 += 1;
    result.actions30 += 1;
  };
  count('claim', 0);

  const done = new Set<string>();
  let jobsDone = 0;
  for (let minute = 0; minute < 30; minute++) {
    const at = t0 + minute * MS_PER_MINUTE;
    const batch: Input[] = [];
    if (minute % 15 === 0) {
      for (const b of bots) {
        for (const order of BOTS[b.bot](s, b.id)) {
          const input: Input = { actorId: b.id, order, atMs: at };
          if (validateOrder(s, input).ok) batch.push(input);
        }
      }
    }
    const used = new Set<Id>();
    const mine: Order[] = [];
    const player = s.players[me];
    const crews = Object.values(s.crews).filter((c) => c.owner === me);
    const idleIds = new Set(
      crews
        .filter(
          (c) =>
            'at' in c.loc &&
            c.loc.at === home.id &&
            c.readyAtMs <= s.nowMs &&
            !Object.values(s.movements).some((m) => m.crewIds.includes(c.id)),
        )
        .map((c) => c.id),
    );
    const idle = (): Id | undefined => crews.find((c) => idleIds.has(c.id) && !used.has(c.id))?.id;
    const starterWaiting = (): boolean =>
      !done.has('haul') &&
      Object.values(s.contracts).some((c) => c.reservedFor === me || c.taker === me);
    const van = Object.values(s.carriers).find(
      (c) => c.owner === me && c.kind === 'van' && 'at' in c.loc && c.loc.at === home.id,
    )?.id;
    const attempt = (key: string | null, kind: string, order: Order): boolean => {
      if (key && done.has(key)) return false;
      const input: Input = { actorId: me, order, atMs: at };
      if (!validateOrder(s, input).ok) return false;
      mine.push(order);
      batch.push(input);
      if ('crewIds' in order) for (const id of order.crewIds) used.add(id);
      if ('crewId' in order) used.add(order.crewId);
      if (key) done.add(key);
      count(kind, minute);
      return true;
    };

    const spare = (): Id | undefined => {
      const free = crews.filter((c) => idleIds.has(c.id) && !used.has(c.id));
      const keep = starterWaiting() ? 1 : 0;
      return free.length > keep ? free[0]?.id : undefined;
    };
    if (hub) {
      const book = s.markets[hub]?.['supplies'];
      if (book) {
        attempt('buy', 'market.place', {
          type: 'market.place',
          hub,
          side: 'buy',
          good: 'supplies',
          price: civicAsk(book),
          qty: 10,
        });
      }
    }
    attempt('build', 'build', { type: 'build', districtId: home.id, building: 'workshop' });
    if (player) {
      // The starter contract: take it, then haul its goods to the hub with the van.
      const starter = Object.values(s.contracts).find(
        (c) => c.reservedFor === me && c.status === 'open',
      );
      if (starter)
        attempt('take', 'contract.take', { type: 'contract.take', contractId: starter.id });
      const mineTaken = Object.values(s.contracts).find(
        (c) => c.taker === me && c.status === 'taken',
      );
      const crew = idle();
      if (mineTaken && crew && !done.has('haul')) {
        const haulOk = attempt('haul', 'haul', {
          type: 'haul',
          carrierId: van ?? null,
          crewIds: [crew],
          to: mineTaken.hub,
          cargo: { [mineTaken.good]: mineTaken.qty },
          contractId: mineTaken.id,
        });
        if (haulOk && van) used.add(van);
      }
      // Street jobs: quick ones first, a courier run with the van. The crew for the starter haul
      // is kept back until that haul has left.
      // After the first quick errand is done the next crew that frees up is kept for the settle.
      const holdForSettle = jobsDone >= 1 && !done.has('settle');
      for (const job of holdForSettle
        ? []
        : [...player.jobs].sort((x, y) => x.minutes - y.minutes)) {
        const free = spare();
        if (!free) break;
        const carrier = job.kind === 'courier' && van && !used.has(van) ? van : null;
        if (
          attempt(null, 'job.take', {
            type: 'job.take',
            jobId: job.id,
            crewId: free,
            carrierId: carrier,
          })
        ) {
          if (carrier) used.add(carrier);
        }
      }
      // Settle last: it takes whatever crew the quick jobs and the starter haul left free.
      const plot = Object.values(s.districts)
        .filter((d) => d.kind !== 'hub' && d.owner === 'neutral' && d.frontier === 'open')
        .sort(
          (a, b) =>
            (shortestRoute(s.graph, home.id, a.id)?.lengthM ?? 1e9) -
            (shortestRoute(s.graph, home.id, b.id)?.lengthM ?? 1e9),
        )[0];
      const settler = spare();
      if (plot && settler) {
        if (
          attempt('settle', 'settle', {
            type: 'settle',
            carrierId: van && !used.has(van) ? van : null,
            crewIds: [settler],
            target: plot.id,
          })
        ) {
          result.settleMin ??= minute;
          if (van) used.add(van);
        }
      }
    }
    const homeNow = s.districts[home.id];
    // Recruiting costs 20 supplies, so it waits until the settle (60 supplies) has been sent.
    if (homeNow && minute >= 1 && done.has('settle'))
      attempt('recruit', 'recruit', { type: 'recruit', districtId: home.id });
    const r = step(s, batch, at + MS_PER_MINUTE);
    s = r.state;
    for (const e of r.events) {
      if (DONE.includes(e.kind) && (e.actors.includes(me) || e.kind === 'trade.filled')) {
        if (e.kind === 'trade.filled' && !e.actors.includes(me)) continue;
        if (e.kind === 'job.done') jobsDone += 1;
        if (e.kind === 'contract.done') result.starterPaidMin ??= minute;
        if (minute < 15) result.completions15 += 1;
        result.completions30 += 1;
        result.firstCompletionMin ??= minute;
      }
    }
  }
  return result;
}
