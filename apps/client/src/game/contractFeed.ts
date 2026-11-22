import type { FeedItem, PlayerView } from '@nexum/contracts';
import { whoIs, type CrewNames } from './derive';
import type { FeedEntry } from './feed';

type Data = FeedItem['event']['data'];

const str = (d: Data, k: string): string | undefined => {
  const v = d[k];
  return typeof v === 'string' ? v : undefined;
};
const num = (d: Data, k: string): number => {
  const v = d[k];
  return typeof v === 'number' ? v : 0;
};
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** The contract id an event is about, or undefined for other events. */
export const contractIdOf = (item: FeedItem): string | undefined =>
  item.event.kind.startsWith('contract.') ? str(item.event.data, 'contractId') : undefined;

/**
 * A feed card for a `contract.*` event, written for whoever is reading: the taker, the poster or
 * a bystander. Returns null for events nobody needs to read (the city's own postings and its
 * lapsed offers, and other players' ordinary postings).
 */
export function describeContract(
  item: FeedItem,
  view: PlayerView,
  names: CrewNames,
): FeedEntry | null {
  const { event } = item;
  const d = event.data;
  const me = view.playerId;
  const hub = event.districts[0] ?? null;
  const hubName = hub === null ? 'the city' : (view.districts[hub]?.name ?? hub);
  const who = (id: string | undefined): string => (id ? whoIs(names, me, id) : 'Someone');
  const good = str(d, 'good') ?? 'goods';
  const qty = num(d, 'qty');
  const job = `${fmt(qty)} ${good} to ${hubName}`;
  const base = {
    seq: item.seq,
    at: event.at,
    districtId: hub,
    eventKind: event.kind,
    kind: 'CONTRACT',
    glyph: '$',
  } as const;
  const taker = str(d, 'taker');
  const poster = event.actors.find((a) => a !== taker);
  const civic = d['civic'] === true;

  switch (event.kind) {
    case 'contract.posted': {
      const mine = poster === me;
      if (civic || (!mine && d['notable'] !== true)) return null;
      return {
        ...base,
        tone: mine ? 'accent' : 'news',
        text: mine
          ? `Your job is posted: bring ${job} within ${fmt(num(d, 'hours'))} h. Pays ${fmt(num(d, 'reward'))} cr.`
          : `${who(poster)} posted a big job at ${hubName}: ${fmt(num(d, 'reward'))} cr for ${fmt(qty)} ${good}.`,
      };
    }
    case 'contract.taken': {
      const text =
        taker === me
          ? `You took a job: bring ${job} before the deadline. ${num(d, 'deposit') > 0 ? `Deposit ${fmt(num(d, 'deposit'))} cr, lost if late.` : 'No deposit.'}`
          : poster === me
            ? `${who(taker)} took your job: ${job}. They have until the deadline.`
            : `${who(taker)} took a job at ${hubName}: ${job}.`;
      return { ...base, tone: taker === me || poster === me ? 'accent' : 'news', text };
    }
    case 'contract.progress': {
      const so = `${fmt(num(d, 'delivered'))} of ${fmt(qty)} ${good} delivered`;
      const pay = num(d, 'paid') > 0 ? ` Paid so far ${fmt(num(d, 'paid'))} cr.` : '';
      return {
        ...base,
        tone: 'accent',
        text:
          taker === me
            ? `Contract at ${hubName}: ${so}.${pay}`
            : `${who(taker)} has delivered ${so} for your job at ${hubName}.`,
      };
    }
    case 'contract.done': {
      const text =
        taker === me
          ? `Contract done at ${hubName}: you earned ${fmt(num(d, 'paid'))} cr and got your ${fmt(num(d, 'depositReturned'))} cr deposit back.`
          : `${who(taker)} finished your job: ${job}.`;
      return { ...base, tone: 'ok', text };
    }
    case 'contract.failed': {
      const text =
        taker === me
          ? `Contract at ${hubName} failed: you were late${num(d, 'forfeited') > 0 ? ` and lost your ${fmt(num(d, 'forfeited'))} cr deposit` : ''}.`
          : `${who(taker)} was late on your job at ${hubName}. ${num(d, 'forfeited') > 0 ? `You keep their ${fmt(num(d, 'forfeited'))} cr deposit and get` : 'You get'} your reward back.`;
      return { ...base, tone: 'danger', text };
    }
    case 'contract.expired': {
      if (civic || poster !== me) return null;
      const cancelled = str(d, 'reason') === 'cancelled';
      return {
        ...base,
        tone: 'warn',
        text: cancelled
          ? `You cancelled your job at ${hubName}. ${fmt(num(d, 'refunded'))} cr came back.`
          : `Nobody took your job at ${hubName}, so it lapsed. ${fmt(num(d, 'refunded'))} cr came back.`,
      };
    }
    default:
      return null;
  }
}
