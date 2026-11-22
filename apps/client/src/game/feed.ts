import type { FeedItem, PlayerView } from '@nexum/contracts';
import type { Tone } from '../ui';

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

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Whole units with thousands separators and no decimals below one. */
export function formatUnits(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Turns a sim event into a feed line, or `null` for events a player does not need to read
 * (siege progress ticks, combat rounds, score ticks).
 */
export function describeEvent(item: FeedItem, view: PlayerView): FeedEntry | null {
  const { event } = item;
  const d = event.data;
  const me = view.playerId;
  const placeId = event.districts[0] ?? null;
  const name = (id: string | null | undefined): string => {
    if (!id) return 'the city';
    return view.districts[id]?.name ?? id;
  };
  const who = (id: string | undefined): string => (id === me ? 'You' : (id ?? 'Someone'));
  const base = { seq: item.seq, at: event.at, districtId: placeId };

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
    case 'frontier.opened':
      return {
        ...base,
        kind: 'CITY GROWS',
        glyph: '#',
        tone: 'special',
        text: `A new plot opened: ${name(placeId)}.`,
      };
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
        text: `${formatUnits(amount)} units were lost at ${name(placeId)}.`,
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
    case 'player.joined':
      return {
        ...base,
        kind: 'NEWCOMER',
        glyph: '+',
        tone: 'special',
        text: 'A new player joined the city.',
      };
    case 'order.rejected':
      return {
        ...base,
        kind: 'ORDER',
        glyph: '!',
        tone: 'warn',
        text: 'One of your orders could not run when its time came.',
      };
    default:
      return null;
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
