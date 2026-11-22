import type { PlayerView } from '@nexum/contracts';
import { balance, eta, toAtoms, type CarrierKind } from '@nexum/sim';
import { runnerCreditsAt, wearInfo, wearOfBest, wornRoute } from './wear';
import { carriersAt, carrierLabel, formatEta, seatsFor } from './derive';
import { unitsToSend, msLeft } from './contracts';

const R = balance.runner;

/** A van trip taking over this share of the time left counts as a tight deadline. */
const TIGHT_SHARE = 0.4;

/** Plain-language pitch for the buy button. */
export const RUNNER_PITCH = `Fast (1.6× van) but carries only ${String(balance.carriers.runner.cargo)} and loses any fight. ${String(R.evadePercent)}% chance to slip past an ambush.`;

export const ownedRunners = (view: PlayerView): number =>
  Object.values(view.carriers).filter((c) => c.owner === view.playerId && c.kind === 'runner')
    .length;

/** Why a Runner cannot be bought now, or null when it can. */
export function buyRunnerBlocker(view: PlayerView, districtId?: string): string | null {
  const here = districtId ? view.districts[districtId] : undefined;
  const price = runnerCreditsAt(here?.relation === 'own' ? here : undefined);
  if (ownedRunners(view) >= R.maxOwned) {
    return `You already own ${String(R.maxOwned)} Runners, the most allowed.`;
  }
  if (view.self.credits < toAtoms(price)) {
    return `Needs ${String(price)} credits.`;
  }
  return null;
}

/** One carrier option in the haul card's comparison. */
export interface CarrierOption {
  readonly kind: CarrierKind;
  readonly label: string;
  readonly speedX: number;
  readonly etaMs: number | null;
  readonly cargo: number;
  /** Wear (0 to 100) of the carrier of this kind the card would send. */
  readonly wear: number;
  /** How much slower that wear makes it, in percent (0 when none). */
  readonly slowPercent: number;
  readonly seats: number;
  /** Plain-language trade-off. */
  readonly note: string;
  /** The option cannot carry what the card holds. */
  readonly tooSmall: boolean;
}

const NOTES: Record<CarrierKind, string> = {
  foot: 'slowest, no cargo to speak of',
  van: 'slow, can be escorted',
  runner: `fast, ${String(R.evadePercent)}% dodge, no escort seat`,
  hauler: 'biggest load, slow, can be escorted',
};

const speedVan = balance.carriers.van.speed;

/** One row per kind of carrier you have idle at `from`, in the order they are listed. */
export function compareCarriers(
  view: PlayerView,
  from: string,
  to: string,
  units: number,
): CarrierOption[] {
  const kinds: CarrierKind[] = [];
  for (const c of carriersAt(view, from)) if (!kinds.includes(c.kind)) kinds.push(c.kind);
  kinds.sort((a, b) => balance.carriers[a].speed - balance.carriers[b].speed);
  return kinds.map((kind) => {
    const spec = balance.carriers[kind];
    const { wear, slowPercent } = wearInfo({ wear: wearOfBest(view, from, kind) });
    const route = wornRoute(view, from, to, kind, wear);
    const name = kind.charAt(0).toUpperCase() + kind.slice(1);
    return {
      kind,
      label: name,
      speedX: Math.round((spec.speed / speedVan) * 10) / 10,
      etaMs: route ? route.durationMs : null,
      cargo: spec.cargo,
      wear,
      slowPercent,
      seats: seatsFor(kind),
      note: NOTES[kind],
      tooSmall: units > spec.cargo,
    };
  });
}

export interface RunnerSuggestion {
  readonly from: string;
  readonly carrierId: string;
  readonly text: string;
}

/**
 * For a contract delivery: a Runner is the better pick when what is left fits in it, you own an
 * idle one at a node where a crew is ready, and a van would eat a big share of the time left.
 */
export function suggestRunner(
  view: PlayerView,
  contractId: string | undefined,
  readyFrom: readonly string[],
  nowMs: number,
): RunnerSuggestion | null {
  const c = contractId ? view.contracts[contractId] : undefined;
  if (!c || c.taker !== view.playerId || c.status !== 'taken') return null;
  const units = unitsToSend(view, c);
  if (units <= 0 || units > balance.carriers.runner.cargo) return null;
  const left = msLeft(c, nowMs);
  for (const node of readyFrom) {
    const runner = carriersAt(view, node).find((x) => x.kind === 'runner');
    if (!runner) continue;
    const van = eta(view.graph, node, c.hub, 'van');
    if (!van || van.durationMs < left * TIGHT_SHARE) continue;
    const fast = eta(view.graph, node, c.hub, 'runner');
    return {
      from: node,
      carrierId: runner.id,
      text: `${carrierLabel(view, runner.id)} suggested: only ${String(units)} units are left and the deadline is tight. The Runner takes ${fast ? formatEta(fast.durationMs) : 'less time'}; a van takes ${formatEta(van.durationMs)}.`,
    };
  }
  return null;
}
