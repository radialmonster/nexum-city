import type { BotKind } from '@nexum/sim';

/** A bot's public face: who the crew says it is, and the theme faction colour it is drawn with. */
export interface Persona {
  readonly name: string;
  readonly motto: string;
}

/** Theme faction roles (`packages/theme`), one per personality, so a bot gets the right colour. */
export const ROLE: Record<BotKind, 'raider' | 'turtle' | 'merchant' | 'hunter'> = {
  hunter: 'hunter',
  raider: 'raider',
  turtle: 'turtle',
  merchant: 'merchant',
};

/** Check-in rhythm: average hours between visits. Raiders are keen, turtles are slow and steady. */
export const CHECKIN_HOURS: Record<BotKind, number> = {
  raider: 5,
  merchant: 6,
  turtle: 8,
  hunter: 5,
};

/** The order in which a growing roster is filled, so any prefix is a sensible mix. */
export const ROSTER: readonly BotKind[] = [
  'raider',
  'turtle',
  'merchant',
  'raider',
  'merchant',
  'hunter',
];

export const PERSONAS: Record<BotKind, readonly Persona[]> = {
  hunter: [
    { name: 'Lamp Wardens', motto: 'We see the street before you do.' },
    { name: 'Night Shift Patrol', motto: 'Every road home gets an escort.' },
    { name: 'Tower Eleven', motto: 'Light on the ambush, steel on the rest.' },
    { name: 'Blue Lantern Watch', motto: 'Nobody gets jumped on our block.' },
    { name: 'Counterpoint', motto: 'We find the trap first.' },
    { name: 'Open Eyes Guild', motto: 'Safe hauls, loud sirens.' },
  ],
  raider: [
    { name: 'Static Wolves', motto: 'We take what the grid forgets.' },
    { name: 'Red Kestrels', motto: 'Fast hands, faster exits.' },
    { name: 'Chrome Jackals', motto: 'Every wall is a door with a price.' },
    { name: 'Zero Hour Gang', motto: 'We only ask once.' },
    { name: 'Razor Choir', motto: 'Loud neighbours make easy marks.' },
    { name: 'Ash Vipers', motto: 'Smoke first, paperwork never.' },
  ],
  turtle: [
    { name: 'Iron Orchard', motto: 'Dig in. Outlast them.' },
    { name: 'Hush Collective', motto: 'Quiet blocks, locked doors.' },
    { name: 'Slow Concrete', motto: 'Nothing gets through twice.' },
    { name: 'Deep Anchor', motto: 'We were here first and we are staying.' },
    { name: 'Moss Syndicate', motto: 'Grow slowly, hold forever.' },
    { name: 'Gate Nine', motto: 'The wall is the plan.' },
  ],
  merchant: [
    { name: 'Gilt Line Syndicate', motto: 'Everything has a price; we set it.' },
    { name: 'Lantern Exchange', motto: 'Light the market, take the margin.' },
    { name: 'Copper Saints', motto: 'Honest weights, hungry ledgers.' },
    { name: 'Velvet Ledger', motto: 'Sell calm, buy panic.' },
    { name: 'Night Market Co-op', motto: 'Open when you are not.' },
    { name: 'Paper Tiger Trade', motto: 'Soft contracts, hard bargains.' },
  ],
};

/** The next unused persona for a kind; past the end the names repeat with a numeral. */
export function pickPersona(kind: BotKind, used: ReadonlySet<string>): Persona {
  const pool = PERSONAS[kind];
  for (let round = 0; ; round++) {
    for (const p of pool) {
      const name = round === 0 ? p.name : `${p.name} ${String(round + 1)}`;
      if (!used.has(name)) return { name, motto: p.motto };
    }
  }
}
