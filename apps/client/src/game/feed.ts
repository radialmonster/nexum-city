import type { FeedItem, PlayerView } from '@nexum/contracts';
import type { Tone } from '../ui';
import { contractIdOf, describeContract } from './contractFeed';
import { streetEnds, whoIs, type CrewNames } from './derive';

/** One line of the "While you were away" column. */
export interface FeedEntry {
  readonly seq: number;
  readonly at: number;
  /** Upper-case kind word, as in the mockup: THREAT, SIEGE, DELIVERY, MARKET, CITY GROWS, ... */
  readonly kind: string;
  readonly glyph: string;
  readonly tone: Tone;
  readonly text: string;
  /** The district to fly the map to when the entry is clicked. */
  readonly districtId: string | null;
  /** The sim event kind, so the column can open a battle report for siege events. */
  readonly eventKind: string;
  /** A running siege: rounds fought so far and the latest strengths. */
  readonly siege?: {
    readonly rounds: number;
    readonly attackerStrength: number;
    readonly defenderStrength: number;
  };
}

type Data = FeedItem['event']['data'];

const str = (d: Data, k: string): string | undefined => {
  const v = d[k];
  return typeof v === 'string' ? v : undefined;
};
const num = (d: Data, k: string): number | undefined => {
  const v = d[k];
  return typeof v === 'number' ? v : undefined;
};

/** A goods-in-units record from event data, as "12 parts, 3 power", or null when it is empty. */
export function goodsText(d: Data, k: string): string | null {
  const v = d[k];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const parts: string[] = [];
  for (const g of ['parts', 'power', 'data', 'supplies']) {
    const n = v[g];
    if (typeof n === 'number' && n > 0) parts.push(`${formatUnits(n)} ${g}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Whole units with thousands separators and no decimals below one. */
export function formatUnits(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Turns a sim event into a feed line, or `null` for events a player does not need to read
 * (siege progress ticks, score ticks). Combat rounds are folded into the siege entry by
 * `feedEntries`.
 */
export function describeEvent(
  item: FeedItem,
  view: PlayerView,
  names: CrewNames = {},
): FeedEntry | null {
  const { event } = item;
  const d = event.data;
  const me = view.playerId;
  const placeId = event.districts[0] ?? null;
  const name = (id: string | null | undefined): string => {
    if (!id) return 'the city';
    return view.districts[id]?.name ?? id;
  };
  const streetName = (a: string | null | undefined, b: string | null | undefined): string =>
    a && b ? `between ${streetEnds(name(a), name(b))}` : 'on a street';
  const who = (id: string | undefined): string => (id ? whoIs(names, me, id) : 'Someone');
  const base = { seq: item.seq, at: event.at, districtId: placeId, eventKind: event.kind };

  switch (event.kind) {
    case 'siege.started': {
      const attacker = str(d, 'attacker');
      const defender = str(d, 'defender');
      if (defender === me) {
        return {
          ...base,
          kind: 'THREAT',
          glyph: '!',
          tone: 'danger',
          text: `${who(attacker)} started a siege on ${name(placeId)}.`,
        };
      }
      return {
        ...base,
        kind: 'SIEGE',
        glyph: 'x',
        tone: attacker === me ? 'accent' : 'news',
        text:
          attacker === me
            ? `Your crews began the siege of ${name(placeId)}.`
            : `${who(attacker)} is besieging ${name(placeId)}.`,
      };
    }
    case 'siege.captured': {
      const attacker = str(d, 'attacker');
      const defender = str(d, 'defender');
      if (attacker === me) {
        return {
          ...base,
          kind: 'SIEGE',
          glyph: 'x',
          tone: 'ok',
          text: `You captured ${name(placeId)}.`,
        };
      }
      return {
        ...base,
        kind: defender === me ? 'THREAT' : 'SIEGE',
        glyph: defender === me ? '!' : 'x',
        tone: defender === me ? 'danger' : 'news',
        text: `${who(attacker)} captured ${name(placeId)}.`,
      };
    }
    case 'siege.broken': {
      const attacker = str(d, 'attacker');
      const mineDefence = str(d, 'defender') === me;
      return {
        ...base,
        kind: 'SIEGE',
        glyph: 'x',
        tone: attacker === me ? 'warn' : mineDefence ? 'ok' : 'news',
        text:
          attacker === me
            ? `Your siege of ${name(placeId)} ended without a capture.`
            : mineDefence
              ? `The siege on ${name(placeId)} was broken.`
              : `A siege of ${name(placeId)} ended.`,
      };
    }
    case 'raid.set': {
      const street = streetName(placeId, event.districts[1]);
      return {
        ...base,
        kind: 'AMBUSH',
        glyph: '!',
        tone: 'accent',
        text: `Your crews are waiting in ambush ${street}.`,
      };
    }
    case 'raid.hit': {
      const street = streetName(placeId, event.districts[1]);
      const raider = event.actors[0];
      const victim = event.actors[1];
      const stolen = goodsText(d, 'stolen') ?? 'nothing';
      if (victim === me) {
        return {
          ...base,
          kind: 'RAID',
          glyph: '!',
          tone: 'danger',
          text: `Raiders hit your haul ${street}: lost ${stolen}.`,
        };
      }
      return {
        ...base,
        kind: 'RAID',
        glyph: '!',
        tone: raider === me ? 'ok' : 'news',
        text:
          raider === me
            ? `Your ambush ${street} stole ${stolen}.`
            : `${who(raider)} raided ${who(victim)}'s haul ${street}.`,
      };
    }
    case 'raid.repelled': {
      const street = streetName(placeId, event.districts[1]);
      const raider = event.actors[0];
      const victim = event.actors[1];
      return {
        ...base,
        kind: 'RAID',
        glyph: 'x',
        tone: raider === me ? 'warn' : victim === me ? 'ok' : 'news',
        text:
          raider === me
            ? `Your ambush ${street} was beaten off by an escort.`
            : victim === me
              ? `Your escort beat off raiders ${street}.`
              : `${who(victim)}'s escort beat off ${who(raider)} ${street}.`,
      };
    }
    case 'raid.evaded': {
      const street = streetName(placeId, event.districts[1]);
      const raider = event.actors[0];
      const victim = event.actors[1];
      return {
        ...base,
        kind: 'RAID',
        glyph: '>',
        tone: raider === me ? 'warn' : victim === me ? 'ok' : 'news',
        text:
          victim === me
            ? `Your Runner slipped past an ambush ${street}.`
            : raider === me
              ? `A Runner slipped past your ambush ${street}.`
              : `${who(victim)}'s Runner slipped past ${who(raider)}'s ambush ${street}.`,
      };
    }
    case 'carrier.bought': {
      if (event.actors[0] !== me) return null;
      const kind = str(d, 'kind') ?? 'runner';
      return {
        ...base,
        kind: 'FLEET',
        glyph: '+',
        tone: 'accentAlt',
        text: `You bought a ${cap(kind)}${placeId ? ` at ${name(placeId)}` : ''}.`,
      };
    }
    case 'raid.ended': {
      const street = streetName(placeId, event.districts[1]);
      const loot = goodsText(d, 'loot');
      const reason = str(d, 'reason');
      const why =
        reason === 'recalled'
          ? 'called off'
          : reason === 'repelled'
            ? 'beaten off'
            : reason === 'full'
              ? 'ended with full hands'
              : 'ran out of time';
      return {
        ...base,
        kind: 'AMBUSH',
        glyph: '!',
        tone: loot ? 'ok' : 'warn',
        text: `Your ambush ${street} ${why}${loot ? `, carrying home ${loot}` : ' with no loot'}.`,
      };
    }
    case 'arrived': {
      const movement = d['movement'];
      const kind =
        movement && typeof movement === 'object' && !Array.isArray(movement)
          ? movement['kind']
          : undefined;
      const recalled = d['recalled'] === true;
      const word =
        kind === 'haul'
          ? 'Delivery arrived at'
          : kind === 'siege'
            ? 'Siege crews reached'
            : kind === 'scout'
              ? 'Scouts reached'
              : recalled
                ? 'Crews came back to'
                : 'Crews arrived at';
      return {
        ...base,
        kind: 'DELIVERY',
        glyph: '>',
        tone: 'ok',
        text: `${word} ${name(placeId)}.`,
      };
    }
    case 'job.done': {
      const kind = str(d, 'job') ?? 'courier';
      const credits = num(d, 'credits') ?? 0;
      const parts = num(d, 'parts') ?? 0;
      const pay = [
        credits > 0 ? `${formatUnits(credits)} credits` : null,
        parts > 0 ? `${formatUnits(parts)} parts` : null,
      ].filter((x) => x !== null);
      const found = num(d, 'found') ?? 0;
      const what =
        kind === 'courier'
          ? 'Courier run done'
          : kind === 'salvage'
            ? 'Salvage done'
            : found > 0
              ? `Patrol done: ${String(found)} ambush${found === 1 ? '' : 'es'} revealed`
              : 'Patrol done: no ambushes found';
      return {
        ...base,
        kind: 'JOB',
        glyph: '$',
        tone: 'ok',
        text: `${what} from ${name(placeId)}${pay.length > 0 ? `. Paid ${pay.join(' and ')}` : ''}.`,
      };
    }
    case 'job.failed': {
      const sent = num(d, 'sent') ?? 0;
      const back = num(d, 'returned') ?? 0;
      return {
        ...base,
        kind: 'JOB',
        glyph: '!',
        tone: 'warn',
        text: `Courier run from ${name(placeId)} was raided: ${formatUnits(back)} of ${formatUnits(sent)} came home. No pay.`,
      };
    }
    case 'rush.ended':
      return {
        ...base,
        kind: 'NEWCOMER',
        glyph: '+',
        tone: 'special',
        text: 'Your newcomer rush is over: builds and settling run at normal speed now.',
      };
    case 'build.done': {
      const building = str(d, 'building') ?? 'building';
      const level = num(d, 'level');
      return {
        ...base,
        kind: 'BUILD',
        glyph: '+',
        tone: 'accentAlt',
        text: `${cap(building)}${level === undefined ? '' : ` level ${String(level)}`} finished in ${name(placeId)}.`,
      };
    }
    case 'trade.filled': {
      const good = str(d, 'good') ?? 'goods';
      const qty = num(d, 'qty') ?? 0;
      const price = (num(d, 'price') ?? 0) / 100;
      const buyer = str(d, 'buyer');
      const side = buyer === me ? 'Bought' : str(d, 'seller') === me ? 'Sold' : 'Traded';
      return {
        ...base,
        kind: 'MARKET',
        glyph: '$',
        tone: 'news',
        text: `${side} ${formatUnits(qty)} ${good} at ${price.toFixed(2)} each in ${name(placeId)}.`,
      };
    }
    case 'frontier.opened': {
      const plot = placeId ? view.districts[placeId] : undefined;
      const kind = str(d, 'kind') ?? plot?.kind;
      return {
        ...base,
        kind: 'CITY GROWS',
        glyph: '#',
        tone: 'special',
        text: `A new plot opened on the frontier: ${placeId ? name(placeId) : (kind ?? 'unknown')}.`,
      };
    }
    case 'production.wasted': {
      if (d['ongoing'] === true) {
        return {
          ...base,
          kind: 'FULL',
          glyph: '!',
          tone: 'warn',
          text: `${name(placeId)} is full and wasting output.`,
        };
      }
      const amount = num(d, 'amount') ?? 0;
      if (amount <= 0) return null;
      return {
        ...base,
        kind: 'FULL',
        glyph: '!',
        tone: 'warn',
        text: `Storage full at ${name(placeId)}: ${formatUnits(amount)} units spoiled. Build storage or sell sooner.`,
      };
    }
    case 'protection.ended':
      return {
        ...base,
        kind: 'PROTECTION',
        glyph: '!',
        tone: 'warn',
        text: `New-owner protection ended on ${name(placeId)}.`,
      };
    case 'player.joined': {
      const actor = event.actors[0];
      const crew = actor
        ? (names[actor] ?? str(d, 'crew') ?? actor)
        : (str(d, 'crew') ?? 'A new crew');
      const district = str(d, 'district') ?? (placeId ? name(placeId) : 'a plot');
      const side = str(d, 'side');
      const where = side && side !== 'centre' ? ` on the ${side} frontier` : '';
      const relocated = str(d, 'reason') === 'relocated';
      const text =
        actor === me
          ? relocated
            ? `You were resettled in ${district}${where}.`
            : `You founded ${district}${where}.`
          : relocated
            ? `Crew ${crew} lost its last district and resettled in ${district}${where}.`
            : `New crew ${crew} founded ${district}${where}.`;
      return { ...base, kind: 'NEWCOMER', glyph: '+', tone: 'special', text };
    }
    case 'order.rejected':
      return {
        ...base,
        kind: 'ORDER',
        glyph: '!',
        tone: 'warn',
        text: 'One of your orders could not run when its time came.',
      };
    case 'settle.started': {
      const mine = str(d, 'owner') === me;
      return {
        ...base,
        kind: 'SETTLE',
        glyph: 'F',
        tone: mine ? 'accentAlt' : 'warn',
        text: mine
          ? `Your crew is settling ${name(placeId)}.`
          : `A rival is settling ${name(placeId)}.`,
      };
    }
    case 'settle.done': {
      const mine = str(d, 'owner') === me;
      return {
        ...base,
        kind: 'SETTLE',
        glyph: 'F',
        tone: mine ? 'ok' : 'warn',
        text: mine ? `${name(placeId)} is yours.` : `A rival settled ${name(placeId)}.`,
      };
    }
    case 'settle.failed': {
      const reason = str(d, 'reason');
      const why =
        reason === 'taken'
          ? 'someone else got there first'
          : reason === 'captured'
            ? 'the plot was captured'
            : 'the settlement was abandoned';
      return {
        ...base,
        kind: 'SETTLE',
        glyph: '!',
        tone: 'danger',
        text: `Settling ${name(placeId)} failed: ${why}.`,
      };
    }
    default:
      return event.kind.startsWith('contract.') ? describeContract(item, view, names) : null;
  }
}

/** "now", "5m ago", "3h ago", "2d ago". */
export function ago(nowMs: number, atMs: number): string {
  const s = Math.max(0, Math.round((nowMs - atMs) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${String(h)}h ago`;
  return `${String(Math.floor(h / 24))}d ago`;
}

const num2 = (v: unknown): number => (typeof v === 'number' ? v : 0);

/**
 * The feed column's entries, newest first. Combat rounds are not lines of their own: the latest
 * round of a siege that is still running is folded into its `siege.started` card, which then
 * sits at the top as one running entry. A card is "running" until a capture or break closes it.
 * A contract's events fold into one card showing its latest state. Likewise an ambush's end card is folded into its hit or repelled card unless loot came home (hit, repelled and evaded cards all absorb it).
 */
export function buildFeedEntries(
  view: PlayerView,
  feed: readonly FeedItem[],
  names: CrewNames = {},
  limit = 40,
): FeedEntry[] {
  const out: FeedEntry[] = [];
  /** district id -> index in `out` of the siege card still open there */
  const open = new Map<string, number>();
  /** contract id -> seq of its latest event that makes a card: older ones fold into it */
  const lastContract = new Map<string, number>();
  for (const item of feed) {
    const id = contractIdOf(item);
    if (id !== undefined && describeContract(item, view, names)) lastContract.set(id, item.seq);
  }
  for (const item of feed) {
    const { event } = item;
    const cid = contractIdOf(item);
    if (cid !== undefined && lastContract.get(cid) !== item.seq) continue;
    const place = event.districts[0];
    if (event.kind === 'combat.round') {
      const i = place === undefined ? undefined : open.get(place);
      const card = i === undefined ? undefined : out[i];
      if (i !== undefined && card) {
        out.splice(i, 1);
        // the card moves to the end: it was active most recently
        out.push({
          ...card,
          at: event.at,
          siege: {
            rounds: (card.siege?.rounds ?? 0) + 1,
            attackerStrength: num2(event.data['attackerStrength']),
            defenderStrength: num2(event.data['defenderStrength']),
          },
        });
        for (const [k, v] of open) if (v > i) open.set(k, v - 1);
        open.set(place as string, out.length - 1);
      }
      continue;
    }
    if (event.kind === 'siege.captured' || event.kind === 'siege.broken') {
      if (place !== undefined) open.delete(place);
    }
    if (event.kind === 'raid.ended') {
      // a hit, repelled or evaded card already told the story: only loot coming home adds news
      if ((num(event.data, 'struck') ?? 0) > 0 && !goodsText(event.data, 'loot')) continue;
    }
    const entry = describeEvent(item, view, names);
    if (!entry) continue;
    out.push(entry);
    if (event.kind === 'siege.started' && place !== undefined) open.set(place, out.length - 1);
  }
  return out.reverse().slice(0, limit);
}

/** The running-siege line under a card's text, or null for any other entry. */
export function siegeProgress(e: FeedEntry): string | null {
  if (!e.siege) return null;
  const n = e.siege.rounds;
  return `Round ${String(n)}: attack ${formatUnits(e.siege.attackerStrength)} against defence ${formatUnits(e.siege.defenderStrength)}.`;
}
