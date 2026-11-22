import { createRng, nextFloat } from '@nexum/sim';
import type { BotKind } from '@nexum/sim';
import { CHECKIN_HOURS } from './personalities.js';

const HOUR_MS = 3_600_000;

/** A stable 32-bit number from a player id such as `p7`. */
function idNumber(playerId: string): number {
  let h = 2166136261;
  for (const ch of playerId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Hours until a bot's `index`-th check-in after the previous one: its personality's rhythm with
 * 40% jitter either way (and, for index 0, anywhere in the first rhythm so a new roster does not
 * all act at once). A pure function of the world seed, the bot and the index, so a restart
 * reproduces the same times and no wall clock is involved.
 */
export function checkinGapMs(seed: number, playerId: string, kind: BotKind, index: number): number {
  const rng = createRng((seed ^ idNumber(playerId) ^ Math.imul(index + 1, 2654435761)) >>> 0);
  const base = CHECKIN_HOURS[kind];
  const factor = index === 0 ? nextFloat(rng) : 0.6 + 0.8 * nextFloat(rng);
  return Math.max(1, Math.round(base * factor * HOUR_MS));
}
