import type { PlayerView } from '@nexum/contracts';
import { balance, toUnits } from '@nexum/sim';
import { formatUnits } from './feed';
export type JobOffer = PlayerView['self']['jobs'][number];
type Movement = PlayerView['movements'][string];

/** The player-facing name of a street job kind. */
export const JOB_NAMES: Record<JobOffer['kind'], string> = {
  courier: 'Courier run',
  salvage: 'Salvage',
  patrol: 'Patrol',
};

/** One plain sentence about what the errand is. */
export function jobSentence(job: JobOffer): string {
  switch (job.kind) {
    case 'courier':
      return `Carry ${formatUnits(job.qty ?? 0)} ${job.good ?? 'goods'} from your district to the nearest hub and bring them back.`;
    case 'salvage':
      return 'Scour the next street for usable scrap, then walk home.';
    case 'patrol':
      return 'Walk the next street. Ambushes waiting there are revealed.';
  }
}

/** What the errand pays: credits, parts or both. */
export function jobPay(job: JobOffer): string {
  const parts: string[] = [];
  const credits = toUnits(job.creditsAtoms);
  if (credits > 0) parts.push(`${formatUnits(credits)} credits`);
  const scrap = toUnits(job.partsAtoms ?? 0);
  if (scrap > 0) parts.push(`${formatUnits(scrap)} parts`);
  return parts.join(' and ') || 'nothing';
}

/** What can go wrong, in plain words. */
export function jobRisk(job: JobOffer): string {
  switch (job.kind) {
    case 'courier':
      return 'Couriers can be raided on the road. Goods stolen mean no pay.';
    case 'salvage':
      return 'No risk. Pays no credits.';
    case 'patrol':
      return `Reveals ambushes for ${String(balance.jobs.patrolRevealMinutes)} min.`;
  }
}

/** Minutes the errand takes on foot, and with a carrier. */
export const jobMinutes = (job: JobOffer, carried: boolean): number =>
  carried ? Math.round((job.minutes * balance.jobs.carrierTimePercent) / 100) : job.minutes;

/** "6 min, 4 min with a carrier". */
export function jobDuration(job: JobOffer): string {
  return `${String(job.minutes)} min, ${String(jobMinutes(job, true))} min with a carrier`;
}

/** The "Next job in 18m" line, or null when the list is full. */
export function nextJobText(view: PlayerView, nowMs: number): string | null {
  if (view.self.jobs.length >= balance.jobs.cap) return null;
  const left = Math.max(0, view.self.jobNextMs - nowMs);
  if (view.self.jobNextMs === 0) return null;
  return `Next job in ${String(Math.max(1, Math.ceil(left / 60_000)))}m`;
}

/** Jobs you have already started (taken ones leave the list): the movements that carry one. */
export const myJobMovements = (view: PlayerView): Movement[] =>
  Object.values(view.movements).filter((m) => m.owner === view.playerId && m.job !== undefined);
