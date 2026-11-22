import type { FeedItem, PlayerView } from '@nexum/contracts';
import { shortName } from './derive';

export interface DossierDistrict {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  /** `seen` now, or `remembered` from an earlier look. */
  readonly how: 'seen' | 'remembered';
  readonly protected: boolean;
  readonly besieged: boolean;
}

export interface Interaction {
  readonly seq: number;
  readonly at: number;
  readonly districtId: string | null;
  readonly text: string;
}

export interface Dossier {
  readonly playerId: string;
  readonly name: string;
  readonly rank: number | null;
  readonly score: number | null;
  readonly districtCount: number | null;
  /** Districts of theirs you can see or remember. */
  readonly districts: readonly DossierDistrict[];
  /** How they have treated you, from your own events. */
  readonly stance: 'hostile' | 'raided' | 'trading' | 'unknown';
  readonly stanceText: string;
  readonly interactions: readonly Interaction[];
}

type Data = FeedItem['event']['data'];
const str = (d: Data, k: string): string | undefined => {
  const v = d[k];
  return typeof v === 'string' ? v : undefined;
};

/** What is known about one rival: the plots you can see, their rank, and your history with them. */
export function buildDossier(
  view: PlayerView,
  feed: readonly FeedItem[],
  playerId: string,
  limit = 8,
): Dossier {
  const me = view.playerId;
  const standing = view.standings.find((s) => s.playerId === playerId);
  const districts: DossierDistrict[] = [];
  for (const d of Object.values(view.districts)) {
    if (d.relation === 'own') continue;
    if (d.relation === 'remembered') {
      if (d.lastKnownOwner === playerId) {
        districts.push({
          id: d.id,
          name: d.name,
          kind: d.kind,
          how: 'remembered',
          protected: false,
          besieged: false,
        });
      }
    } else if (d.owner === playerId) {
      districts.push({
        id: d.id,
        name: d.name,
        kind: d.kind,
        how: 'seen',
        protected: d.protected,
        besieged: d.siege !== null,
      });
    }
  }
  districts.sort((a, b) => a.name.localeCompare(b.name));

  const name = (id: string | undefined): string => view.districts[id ?? '']?.name ?? 'a district';
  const interactions: Interaction[] = [];
  let hostile = 0;
  let raided = 0;
  let trades = 0;
  for (let i = feed.length - 1; i >= 0; i--) {
    const item = feed[i];
    if (!item) continue;
    const { event } = item;
    if (!event.actors.includes(playerId) || !event.actors.includes(me)) continue;
    const where = event.districts[0] ?? null;
    const attacker = str(event.data, 'attacker');
    let text: string | null = null;
    switch (event.kind) {
      case 'siege.started':
        text =
          attacker === playerId
            ? `They started a siege on ${name(where ?? undefined)}.`
            : `You started a siege on ${name(where ?? undefined)}.`;
        if (attacker === playerId) hostile++;
        else raided++;
        break;
      case 'siege.captured':
        text =
          attacker === playerId
            ? `They captured ${name(where ?? undefined)}.`
            : `You captured ${name(where ?? undefined)}.`;
        if (attacker === playerId) hostile += 2;
        else raided++;
        break;
      case 'siege.broken':
        text =
          attacker === playerId
            ? `Their siege of ${name(where ?? undefined)} was broken.`
            : `Your siege of ${name(where ?? undefined)} ended without a capture.`;
        break;
      case 'trade.filled':
        text = `You traded with them in ${name(where ?? undefined)}.`;
        trades++;
        break;
      default:
        break;
    }
    if (text !== null && interactions.length < limit) {
      interactions.push({ seq: item.seq, at: event.at, districtId: where, text });
    }
  }

  const stance: Dossier['stance'] =
    hostile > 0 ? 'hostile' : raided > 0 ? 'raided' : trades > 0 ? 'trading' : 'unknown';
  const stanceText = {
    hostile: 'They have attacked you. Expect more.',
    raided: 'You have attacked them.',
    trading: 'You have traded, nothing worse.',
    unknown: 'No history with you yet.',
  }[stance];

  return {
    playerId,
    name: shortName(playerId),
    rank: standing?.rank ?? null,
    score: standing?.score ?? null,
    districtCount: districts.length > 0 || standing ? districts.length : null,
    districts,
    stance,
    stanceText,
    interactions,
  };
}
