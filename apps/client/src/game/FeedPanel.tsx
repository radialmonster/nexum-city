import type { FeedItem, PlayerView } from '@nexum/contracts';
import { Panel } from '../ui';
import { cx, toneColor, vars } from '../ui/util';
import { ago, describeEvent, type FeedEntry } from './feed';
import styles from './FeedPanel.module.css';
import { hasReport } from './report';

export interface FeedPanelProps {
  readonly view: PlayerView;
  readonly feed: readonly FeedItem[];
  /** Game time of the previous visit: entries after it are marked new. */
  readonly lastSeenMs: number;
  readonly nowMs: number;
  readonly onFly: (districtId: string) => void;
  /** Opens the battle report for a siege event (by feed seq). */
  readonly onReport?: ((seq: number) => void) | undefined;
  /** Entries to show, newest first. */
  readonly limit?: number;
}

/** What the column shows: readable entries, newest first. */
export function feedEntries(
  view: PlayerView,
  feed: readonly FeedItem[],
  limit: number,
): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (let i = feed.length - 1; i >= 0 && out.length < limit; i--) {
    const item = feed[i];
    if (!item) continue;
    const e = describeEvent(item, view);
    if (e) out.push(e);
  }
  return out;
}

/** "While you were away": events since the last visit, newest first; a click flies the map there. */
export function FeedPanel({
  view,
  feed,
  lastSeenMs,
  nowMs,
  onFly,
  onReport,
  limit = 40,
}: FeedPanelProps) {
  const entries = feedEntries(view, feed, limit);
  const away = lastSeenMs > 0 ? ago(nowMs, lastSeenMs) : null;
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
                disabled={e.districtId === null && !(onReport && hasReport(e.eventKind))}
                onClick={() => {
                  if (onReport && hasReport(e.eventKind)) onReport(e.seq);
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
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
