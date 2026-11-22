import type { FeedItem, PlayerView } from '@nexum/contracts';
import { Button, Panel } from '../ui';
import { cx, toneColor, vars } from '../ui/util';
import { ago, buildFeedEntries, siegeProgress, type FeedEntry } from './feed';
import type { CrewNames } from './derive';
import styles from './FeedPanel.module.css';
import { hasReport } from './report';
import { hasRaidReport } from './raidReport';
import { clearUnderway, findAmbush } from './clearAmbush';
import { isOwn } from './derive';
import type { OrderDraft } from './store';
import { surplusHaulDraft } from './surplus';

export interface FeedPanelProps {
  readonly view: PlayerView;
  readonly feed: readonly FeedItem[];
  /** Game time of the previous visit: entries after it are marked new. */
  readonly lastSeenMs: number;
  readonly nowMs: number;
  readonly names?: CrewNames | undefined;
  readonly onFly: (districtId: string) => void;
  /** Opens the battle report for a siege event (by feed seq). */
  readonly onReport?: ((seq: number) => void) | undefined;
  /** Opens the Break it up card for a spotted ambush. */
  readonly onBreakUp?: ((ambushId: string) => void) | undefined;
  /** Opens a prefilled haul that sells a full plot's surplus at the nearest hub. */
  readonly onHaulSurplus?: ((draft: OrderDraft) => void) | undefined;
  /** Entries to show, newest first. */
  readonly limit?: number;
}

/** What the column shows: readable entries, newest first. */
export function feedEntries(
  view: PlayerView,
  feed: readonly FeedItem[],
  limit: number,
  names: CrewNames = {},
): FeedEntry[] {
  return buildFeedEntries(view, feed, names, limit);
}

/** "While you were away": events since the last visit, newest first; a click flies the map there. */
export function FeedPanel({
  view,
  feed,
  lastSeenMs,
  nowMs,
  names,
  onFly,
  onReport,
  onBreakUp,
  onHaulSurplus,
  limit = 40,
}: FeedPanelProps) {
  const entries = feedEntries(view, feed, limit, names);
  const away = lastSeenMs > 0 ? ago(nowMs, lastSeenMs) : null;
  /** A full-warehouse entry offers a prefilled sell haul while that plot is still overflowing. */
  const surplusFor = (e: FeedEntry): OrderDraft | null => {
    if (e.eventKind !== 'production.wasted' || e.districtId === null) return null;
    const d = view.districts[e.districtId];
    return isOwn(d) && d.overflowing ? surplusHaulDraft(view, d) : null;
  };
  const fresh = entries.filter((e) => e.at > lastSeenMs).length;
  return (
    <Panel
      title="While you were away"
      tag={away === null ? 'FIRST VISIT' : `${away} / ${String(fresh)} NEW`}
      className={styles['feed']}
    >
      {entries.length === 0 ? (
        <p className={styles['empty']}>Quiet so far. Events will show up here.</p>
      ) : (
        <ul className={styles['list']}>
          {entries.map((e) => (
            <li key={e.seq}>
              <button
                type="button"
                className={cx(styles['entry'], e.at > lastSeenMs && styles['fresh'])}
                style={vars({ '--k': toneColor(e.tone) })}
                disabled={
                  e.districtId === null &&
                  !(onReport && (hasReport(e.eventKind) || hasRaidReport(e.eventKind)))
                }
                onClick={() => {
                  if (onReport && (hasReport(e.eventKind) || hasRaidReport(e.eventKind)))
                    onReport(e.seq);
                  else if (e.districtId !== null) onFly(e.districtId);
                }}
              >
                <span className={styles['glyph']} aria-hidden="true">
                  {e.glyph}
                </span>
                <span className={styles['body']}>
                  <span className={styles['kind']}>
                    {e.kind} <small>{ago(nowMs, e.at)}</small>
                  </span>
                  <span className={styles['text']}>{e.text}</span>
                  {siegeProgress(e) && <span className={styles['text']}>{siegeProgress(e)}</span>}
                </span>
              </button>
              {onBreakUp &&
                e.ambushId !== undefined &&
                findAmbush(view, e.ambushId, nowMs) !== undefined &&
                !clearUnderway(view, e.ambushId) && (
                  <div className={styles['actions']}>
                    <Button
                      variant="danger"
                      onClick={() => {
                        onBreakUp(e.ambushId as string);
                      }}
                    >
                      BREAK IT UP
                    </Button>
                  </div>
                )}
              {onHaulSurplus && surplusFor(e) && (
                <div className={styles['actions']}>
                  <Button
                    onClick={() => {
                      const draft = surplusFor(e);
                      if (draft) onHaulSurplus(draft);
                    }}
                  >
                    HAUL SURPLUS TO THE NEAREST HUB
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
