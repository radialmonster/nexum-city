import type { ContractView, GoodName, PlayerView } from '@nexum/contracts';
import { balance, toAtoms, toUnits } from '@nexum/sim';
import { crewName, formatEta, formatHours, whoIs, type CrewNames } from './derive';
import { formatUnits } from './feed';

const C = balance.contracts;
const HOUR_MS = 3_600_000;

/** The contracts on one hub's board, nearest deadline first (open ones by offer end). */
export function hubBoard(view: PlayerView, hub: string): ContractView[] {
  return Object.values(view.contracts)
    .filter((c) => c.hub === hub)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** Contracts you have taken and not yet finished. */
export const myTaken = (view: PlayerView): ContractView[] =>
  Object.values(view.contracts)
    .filter((c) => c.taker === view.playerId)
    .sort((a, b) => a.dueMs - b.dueMs);

/** Contracts you posted that are still live. */
export const myPosted = (view: PlayerView): ContractView[] =>
  Object.values(view.contracts).filter((c) => c.poster === view.playerId);

/** Whole credits. */
export const creditsOf = (atoms: number): number => Math.round(toUnits(atoms));

/** Units of the good still to bring. Only known for your own contracts, else the full amount. */
export function remainingUnits(c: ContractView): number {
  return Math.max(0, c.qty - Math.floor(toUnits(c.delivered ?? 0)));
}

/** Milliseconds left on the deadline (taken) or the offer (open). */
export function msLeft(c: ContractView, nowMs: number): number {
  return Math.max(0, (c.status === 'taken' ? c.dueMs : c.offerEndsMs) - nowMs);
}

export const timeLeft = (c: ContractView, nowMs: number): string =>
  formatHours(msLeft(c, nowMs) / HOUR_MS);

/**
 * A plain warning when the haul would land after the deadline of a contract you took,
 * or null when it is on time (or the contract has no deadline for you yet).
 */
export function lateWarning(c: ContractView, etaMs: number, nowMs: number): string | null {
  if (c.status !== 'taken' || nowMs + etaMs <= c.dueMs) return null;
  const left = Math.max(0, c.dueMs - nowMs);
  const deposit = creditsOf(c.deposit);
  return (
    `Arrives ${formatEta(etaMs)}, but the contract is due in ${formatEta(left)}. ` +
    (deposit > 0
      ? "You'll be late and lose the deposit."
      : "You'll be late and the contract fails.")
  );
}

const hubName = (view: PlayerView, hub: string): string => view.districts[hub]?.name ?? hub;

/** The plain-language sentence for a contract. */
export function contractSentence(view: PlayerView, c: ContractView): string {
  return (
    `Bring ${formatUnits(c.qty)} ${c.good} to ${hubName(view, c.hub)} within ${String(c.hours)} h. ` +
    `Pays ${formatUnits(creditsOf(c.reward))} cr. ` +
    (c.reservedFor
      ? 'No deposit for your starter contract.'
      : `Deposit ${formatUnits(creditsOf(c.deposit > 0 ? c.deposit : depositFor(c.reward)))} cr, lost if late.`)
  );
}

/** The deposit a taker puts up (10% of the reward, rounded down). */
export const depositFor = (rewardAtoms: number): number =>
  Math.floor((rewardAtoms * C.depositPercent) / 100);

/** Who posted it, for display. */
export const posterName = (names: CrewNames, me: string, c: ContractView): string =>
  c.poster === 'civic' ? 'The city' : whoIs(names, me, c.poster);

export const takerName = (names: CrewNames, me: string, c: ContractView): string =>
  c.taker === null ? 'nobody yet' : c.taker === me ? 'you' : crewName(names, c.taker);

/** What the job is worth in goods at the hub's city price, in whole credits. */
export function referenceCredits(
  view: PlayerView,
  hub: string,
  good: GoodName,
  qty: number,
): number {
  const cents = view.markets[hub]?.[good].refCents ?? balance.market.baseRefCents[good];
  return Math.round((qty * cents) / balance.market.priceScale);
}

export interface PostDraft {
  readonly hub: string;
  readonly good: GoodName;
  readonly qty: string;
  readonly reward: string;
  readonly hours: string;
}

export type PostCheck =
  | {
      readonly ok: true;
      readonly qty: number;
      readonly reward: number;
      readonly hours: number;
      /** The credits set aside until the job ends (the reward). */
      readonly escrow: number;
    }
  | { readonly ok: false; readonly message: string };

const whole = (s: string): number | null => {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
};

/** Mirrors the server's `validatePost`, so the form can say what is wrong before sending. */
export function checkPost(view: PlayerView, d: PostDraft): PostCheck {
  const qty = whole(d.qty);
  if (qty === null || qty < C.minQty || qty > C.maxQty) {
    return {
      ok: false,
      message: `Ask for between ${String(C.minQty)} and ${String(C.maxQty)} whole units.`,
    };
  }
  const reward = whole(d.reward);
  const ref = referenceCredits(view, d.hub, d.good, qty);
  const lo = Math.max(1, Math.ceil((ref * C.minRewardPercent) / 100));
  const hi = Math.floor((ref * C.maxRewardPercent) / 100);
  if (reward === null || reward < lo || reward > hi) {
    return {
      ok: false,
      message: `Offer between ${formatUnits(lo)} and ${formatUnits(hi)} credits. The goods are worth about ${formatUnits(ref)}.`,
    };
  }
  const hours = whole(d.hours);
  if (hours === null || hours < C.minHours || hours > C.maxHours) {
    return {
      ok: false,
      message: `Give the taker between ${String(C.minHours)} and ${String(C.maxHours)} whole hours.`,
    };
  }
  if (myPosted(view).length >= C.maxPosted) {
    return { ok: false, message: `You can have ${String(C.maxPosted)} jobs posted at once.` };
  }
  if (hubBoard(view, d.hub).length >= C.boardCap) {
    return { ok: false, message: 'This board is full. Try again when a job ends.' };
  }
  if (view.self.credits < toAtoms(reward)) {
    return { ok: false, message: `You need ${formatUnits(reward)} credits to set aside.` };
  }
  return { ok: true, qty, reward, hours, escrow: reward };
}

/** Why you cannot take this contract right now, or null. */
export function takeBlocker(view: PlayerView, c: ContractView): string | null {
  if (c.status !== 'open') return 'Already taken.';
  if (c.poster === view.playerId) return 'This is your own job.';
  if (myTaken(view).length >= C.maxTaken) {
    return `You can hold ${String(C.maxTaken)} jobs at once.`;
  }
  if (view.self.credits < depositFor(c.reward)) return 'Not enough credits for the deposit.';
  return null;
}

/** Your vans already carrying goods for a contract: how many units and when the last arrives. */
export function inTransit(
  view: PlayerView,
  c: ContractView,
): { readonly units: number; readonly arriveMs: number } | null {
  let units = 0;
  let arriveMs = 0;
  for (const m of Object.values(view.movements)) {
    if (m.owner !== view.playerId || m.kind !== 'haul' || m.contractId !== c.id) continue;
    units += Math.floor(toUnits(m.cargo[c.good] ?? 0));
    arriveMs = Math.max(arriveMs, m.arriveMs);
  }
  return units > 0 ? { units, arriveMs } : null;
}

/** What is still owed and not yet on its way: the amount a new DELIVER should carry. */
export function unitsToSend(view: PlayerView, c: ContractView): number {
  return Math.max(0, remainingUnits(c) - (inTransit(view, c)?.units ?? 0));
}

/**
 * How long the starter contract's van trip takes, in minutes: from the van already on its way
 * when there is one, otherwise the contract's window minus the grace the sim adds to the trip.
 */
export function starterTripMinutes(view: PlayerView, c: ContractView): number | null {
  const onWay = inTransit(view, c);
  if (onWay) return Math.max(1, Math.ceil((onWay.arriveMs - view.nowMs) / 60_000));
  if (c.windowMs === undefined) return null;
  return Math.max(1, Math.round(c.windowMs / 60_000 - balance.rush.starter.graceMinutes));
}

/** The "come back later" line for a starter contract. */
export function starterHookCopy(view: PlayerView, c: ContractView): string | null {
  const m = starterTripMinutes(view, c);
  if (m === null) return null;
  return `Your van gets there in about ${String(m)} min. Come back to collect your pay.`;
}
