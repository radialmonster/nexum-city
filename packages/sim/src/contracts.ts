import { MS_PER_HOUR, balance, toAtoms, toUnits } from './balance.js';
import { emit, schedule, unschedule, type Ctx } from './ctx.js';
import { ATOMS_PER_CENT } from './market.js';
import { deposit, emptyGoods } from './production.js';
import { nextInt } from './rng.js';
import { addContractScore } from './score.js';
import type { System } from './systems.js';
import {
  GOODS,
  type CargoRequest,
  type Contract,
  type GameState,
  type Good,
  type Id,
  type Movement,
  type Order,
  type OrderError,
} from './types.js';

/**
 * The contracts board (milestone 2, docs/rewrite/sim-spec.md). A contract is a delivery job at a
 * hub: bring `qty` of a good to the hub before the deadline for a credit reward. Rules in short:
 *  - a hub's board holds at most `boardCap` live contracts;
 *  - the city posts civic contracts from the seeded RNG (it pays, and consumes the goods);
 *  - a player posts one by escrowing the reward; the goods end up in the poster's hub stash;
 *  - taking needs a deposit; one taker per contract; a taker may hold `maxTaken` at once;
 *  - the taker delivers with an ordinary haul to the hub, tagged with the contract id;
 *  - each delivery pays pro rata; the last one pays the rest, returns the deposit and scores;
 *  - a contract that is late fails: the deposit goes to the poster (burnt for civic), the
 *    unpaid escrow goes back to the poster, and no score is earned.
 * Contracts are removed from `state.contracts` when they end and reported as events.
 */

const C = balance.contracts;
const big = (n: number): bigint => BigInt(Math.trunc(n));

const credits = (atoms: number): number => toUnits(atoms);

/** Contracts at a hub (live ones only: done, failed and expired ones are removed). */
export function boardOf(state: GameState, hub: Id): Contract[] {
  return Object.values(state.contracts).filter((c) => c.hub === hub);
}

/** The reference value of `qty` units of a good at a hub, in credit atoms. */
export function referenceValue(state: GameState, hub: Id, good: Good, qty: number): number {
  const ref = state.markets[hub]?.[good].refCents ?? balance.market.baseRefCents[good];
  return qty * ref * ATOMS_PER_CENT;
}

export const depositFor = (reward: number): number => Math.floor((reward * C.depositPercent) / 100);

function participants(c: Contract, ...extra: Id[]): Id[] {
  const out: Id[] = [];
  for (const id of [
    ...extra,
    ...(c.poster === 'civic' ? [] : [c.poster]),
    ...(c.taker ? [c.taker] : []),
  ]) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

type PostOrder = Extract<Order, { type: 'contract.post' }>;

export function validatePost(state: GameState, actorId: Id, o: PostOrder): OrderError | null {
  const hub = state.districts[o.hub];
  if (!hub) return 'unknown_district';
  if (hub.kind !== 'hub') return 'invalid_target';
  if (!(GOODS as readonly string[]).includes(o.good)) return 'unknown_good';
  if (!Number.isInteger(o.qty) || o.qty < C.minQty || o.qty > C.maxQty) return 'bad_quantity';
  if (!Number.isInteger(o.hours) || o.hours < C.minHours || o.hours > C.maxHours) {
    return 'bad_window';
  }
  if (!Number.isInteger(o.reward) || o.reward < 1) return 'bad_reward';
  const ref = referenceValue(state, o.hub, o.good, o.qty);
  const reward = toAtoms(o.reward);
  if (reward * 100 < ref * C.minRewardPercent || reward * 100 > ref * C.maxRewardPercent) {
    return 'bad_reward';
  }
  const player = state.players[actorId];
  if (!player) return 'unknown_actor';
  const posted = Object.values(state.contracts).filter((c) => c.poster === actorId).length;
  if (posted >= C.maxPosted) return 'too_many_contracts';
  if (boardOf(state, o.hub).length >= C.boardCap) return 'board_full';
  if (player.credits < reward) return 'insufficient_credits';
  return null;
}

function newContract(
  ctx: Ctx,
  hub: Id,
  good: Good,
  qty: number,
  rewardAtoms: number,
  poster: Id | 'civic',
  hours: number,
): Contract {
  const { state } = ctx;
  state.counters.contract += 1;
  const c: Contract = {
    id: `k${state.counters.contract}`,
    hub,
    good,
    qty,
    reward: rewardAtoms,
    poster,
    hours,
    postedMs: state.nowMs,
    offerEndsMs: state.nowMs + C.offerHours * MS_PER_HOUR,
    status: 'open',
    taker: null,
    takenMs: 0,
    dueMs: 0,
    deposit: 0,
    delivered: 0,
    paid: 0,
  };
  state.contracts[c.id] = c;
  schedule(ctx, c.offerEndsMs, { kind: 'contract.due', contractId: c.id });
  emit(ctx, 'contract.posted', poster === 'civic' ? [] : [poster], [hub], {
    contractId: c.id,
    good,
    qty,
    reward: credits(rewardAtoms),
    hours,
    civic: poster === 'civic',
    notable: credits(rewardAtoms) >= C.notableCredits,
  });
  return c;
}

/** Posts a player contract: the reward leaves the poster's credits and sits in escrow. */
export function postContract(ctx: Ctx, actorId: Id, o: PostOrder): Contract {
  const reward = toAtoms(o.reward);
  (ctx.state.players[actorId] as { credits: number }).credits -= reward;
  return newContract(ctx, o.hub, o.good, o.qty, reward, actorId, o.hours);
}

export function validateTake(state: GameState, actorId: Id, contractId: Id): OrderError | null {
  const c = state.contracts[contractId];
  if (!c) return 'unknown_contract';
  if (c.status !== 'open') return 'contract_taken';
  if (c.poster === actorId) return 'own_contract';
  const player = state.players[actorId];
  if (!player) return 'unknown_actor';
  const held = Object.values(state.contracts).filter((k) => k.taker === actorId).length;
  if (held >= C.maxTaken) return 'too_many_contracts';
  if (player.credits < depositFor(c.reward)) return 'insufficient_credits';
  return null;
}

export function takeContract(ctx: Ctx, actorId: Id, contractId: Id): void {
  const { state } = ctx;
  const c = state.contracts[contractId] as Contract;
  const player = state.players[actorId] as { credits: number };
  c.deposit = depositFor(c.reward);
  player.credits -= c.deposit;
  c.status = 'taken';
  c.taker = actorId;
  c.takenMs = state.nowMs;
  c.dueMs = state.nowMs + c.hours * MS_PER_HOUR;
  unschedule(state, (e) => e.kind === 'contract.due' && e.contractId === c.id);
  schedule(ctx, c.dueMs, { kind: 'contract.due', contractId: c.id });
  emit(ctx, 'contract.taken', participants(c, actorId), [c.hub], {
    contractId: c.id,
    taker: actorId,
    good: c.good,
    qty: c.qty,
    reward: credits(c.reward),
    deposit: credits(c.deposit),
    dueMs: c.dueMs,
  });
}

export function validateCancel(state: GameState, actorId: Id, contractId: Id): OrderError | null {
  const c = state.contracts[contractId];
  if (!c) return 'unknown_contract';
  if (c.poster !== actorId) return 'not_owner';
  if (c.status !== 'open') return 'contract_taken';
  return null;
}

/** Withdraws an untaken contract: the escrow is refunded in full. */
export function cancelContract(ctx: Ctx, contractId: Id): void {
  const c = ctx.state.contracts[contractId] as Contract;
  end(ctx, c);
  refund(ctx, c.poster, c.reward);
  emit(ctx, 'contract.expired', participants(c), [c.hub], {
    contractId: c.id,
    reason: 'cancelled',
    refunded: credits(c.reward),
  });
}

/** Checks the contract part of a tagged haul: right taker, right good, right hub. */
export function validateContractHaul(
  state: GameState,
  actorId: Id,
  contractId: Id,
  to: Id,
  cargo: CargoRequest,
): OrderError | null {
  const c = state.contracts[contractId];
  if (!c) return 'unknown_contract';
  if (c.taker !== actorId) return 'not_taker';
  if (to !== c.hub) return 'invalid_target';
  for (const [good, qty] of Object.entries(cargo)) {
    if (qty !== undefined && qty > 0 && good !== c.good) return 'wrong_cargo';
  }
  return null;
}

function refund(ctx: Ctx, poster: Id | 'civic', atoms: number): void {
  if (poster === 'civic' || atoms <= 0) return;
  const p = ctx.state.players[poster];
  if (p) p.credits += atoms;
}

function end(ctx: Ctx, c: Contract): void {
  Reflect.deleteProperty(ctx.state.contracts, c.id);
  unschedule(ctx.state, (e) => e.kind === 'contract.due' && e.contractId === c.id);
}

/**
 * A tagged haul arrived at the contract's hub. The contract good it carries is accepted up to the
 * quantity still missing and paid pro rata; the poster gets the goods (the city consumes them);
 * anything over goes into the taker's own hub stash. If the contract is gone (it failed while the
 * haul was in transit) the cargo is simply stored for its owner.
 */
export function deliverToContract(ctx: Ctx, m: Movement): void {
  const { state } = ctx;
  const c = m.contractId ? state.contracts[m.contractId] : undefined;
  if (!c || c.taker !== m.owner) {
    deposit(ctx, m.owner, m.to, m.cargo);
    return;
  }
  const want = toAtoms(c.qty);
  const arrived = m.cargo[c.good];
  const accepted = Math.min(arrived, want - c.delivered);
  const extra = emptyGoods();
  for (const g of GOODS) extra[g] = g === c.good ? arrived - accepted : m.cargo[g];
  deposit(ctx, m.owner, m.to, extra);
  if (c.poster !== 'civic') {
    const goods = emptyGoods();
    goods[c.good] = accepted;
    deposit(ctx, c.poster, c.hub, goods);
  }
  c.delivered += accepted;
  const complete = c.delivered >= want;
  const owed = complete
    ? c.reward - c.paid
    : Number((big(c.reward) * big(c.delivered)) / big(want)) - c.paid;
  const taker = state.players[m.owner] as { credits: number };
  taker.credits += owed;
  c.paid += owed;
  const data = {
    contractId: c.id,
    taker: m.owner,
    movementId: m.id,
    good: c.good,
    qty: c.qty,
    accepted: toUnits(accepted),
    excess: toUnits(arrived - accepted),
    delivered: toUnits(c.delivered),
    paidNow: credits(owed),
    paid: credits(c.paid),
    civic: c.poster === 'civic',
  };
  if (!complete) {
    emit(ctx, 'contract.progress', participants(c), [c.hub], data);
    return;
  }
  taker.credits += c.deposit;
  const points = addContractScore(ctx, m.owner, c.reward);
  end(ctx, c);
  emit(ctx, 'contract.done', participants(c), [c.hub], {
    ...data,
    depositReturned: credits(c.deposit),
    score: points / MS_PER_HOUR,
  });
}

/** The deadline passed with the job unfinished: the taker loses the deposit, the rest is refunded. */
function fail(ctx: Ctx, c: Contract): void {
  end(ctx, c);
  const unpaid = c.reward - c.paid;
  refund(ctx, c.poster, unpaid + c.deposit);
  emit(ctx, 'contract.failed', participants(c), [c.hub], {
    contractId: c.id,
    taker: c.taker,
    good: c.good,
    qty: c.qty,
    delivered: toUnits(c.delivered),
    paid: credits(c.paid),
    refunded: credits(c.poster === 'civic' ? 0 : unpaid),
    forfeited: credits(c.deposit),
    forfeitedTo: c.poster === 'civic' ? null : c.poster,
    civic: c.poster === 'civic',
    reason: 'late',
  });
}

function expire(ctx: Ctx, c: Contract): void {
  end(ctx, c);
  refund(ctx, c.poster, c.reward);
  emit(ctx, 'contract.expired', participants(c), [c.hub], {
    contractId: c.id,
    reason: 'untaken',
    refunded: credits(c.poster === 'civic' ? 0 : c.reward),
    civic: c.poster === 'civic',
  });
}

const GOOD_LIST: readonly Good[] = GOODS;
const QTY_STEPS = Math.floor((C.civicMaxQty - C.civicMinQty) / C.qtyStep) + 1;
const HOUR_STEPS = C.maxHours - C.minHours + 1;

/** One civic tick: each hub may post one contract. The RNG draws never depend on the outcome. */
function civicTick(ctx: Ctx): void {
  const { state } = ctx;
  const hubs = Object.values(state.districts)
    .filter((d) => d.kind === 'hub')
    .map((d) => d.id)
    .sort();
  for (const hub of hubs) {
    const good = GOOD_LIST[nextInt(state.rng, GOOD_LIST.length)] as Good;
    const qty = C.civicMinQty + nextInt(state.rng, QTY_STEPS) * C.qtyStep;
    const hours = C.minHours + nextInt(state.rng, HOUR_STEPS);
    const board = boardOf(state, hub);
    if (board.length >= C.boardCap) continue;
    if (board.filter((c) => c.poster === 'civic').length >= C.civicCap) continue;
    const reward = Math.floor(
      (referenceValue(state, hub, good, qty) * (100 + C.civicPremiumPercent)) / 100,
    );
    newContract(ctx, hub, good, qty, reward, 'civic', hours);
  }
}

export const contractSystem: System = {
  name: 'contracts',
  handlers: {
    'contract.civic': (ctx, ev) => {
      if (ctx.state.nowMs < ctx.state.season.endMs) civicTick(ctx);
      const next = ev.at + C.civicEveryHours * MS_PER_HOUR;
      if (next <= ctx.state.season.endMs) schedule(ctx, next, { kind: 'contract.civic' });
    },
    'contract.due': (ctx, ev) => {
      const c = ctx.state.contracts[ev.contractId];
      if (!c) return;
      if (c.status === 'open' && ev.at >= c.offerEndsMs) expire(ctx, c);
      else if (c.status === 'taken' && ev.at >= c.dueMs) fail(ctx, c);
    },
  },
};
