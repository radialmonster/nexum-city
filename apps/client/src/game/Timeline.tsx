import type { FeedItem, PlayerView } from '@nexum/contracts';
import { Button, Panel, TimelineRow } from '../ui';
import styles from './Timeline.module.css';
import { shortDuration, timelineEntries, timelineRows, TIMELINE_SPAN_MS } from './orderTimeline';

export interface TimelineProps {
  readonly view: PlayerView;
  readonly feed: readonly FeedItem[];
  readonly nowMs: number;
  readonly onRecall: (movementId: string) => void;
  readonly onFly: (districtId: string) => void;
}

const TICKS = [0, 1, 2, 3, 4] as const;

/** The bottom band: one row per busy asset on a time axis from now to about four hours ahead. */
export function Timeline({ view, feed, nowMs, onRecall, onFly }: TimelineProps) {
  const rows = timelineRows(timelineEntries(view, feed, nowMs), nowMs);
  return (
    <Panel
      title="Active orders"
      tag={rows.length === 0 ? 'NOTHING RUNNING' : `${String(rows.length)} RUNNING`}
      className={styles['timeline']}
    >
      <div className={styles['line']} aria-hidden="true">
        <div className={styles['axis']}>
          <span />
          <div className={styles['ticks']}>
            {TICKS.map((t) => (
              <span key={t}>
                {t === 0 ? 'NOW' : `+${shortDuration((TIMELINE_SPAN_MS / 4) * t)}`}
              </span>
            ))}
          </div>
        </div>
        <span className={styles['actions']} />
      </div>
      {rows.length === 0 ? (
        <p className={styles['empty']}>
          No orders in progress. Crews, hauls, builds and sieges you start will run here.
        </p>
      ) : (
        <div className={styles['rows']} role="list" aria-label="Active orders">
          {rows.map((r) => (
            <div key={r.id} className={styles['line']}>
              <TimelineRow
                label={r.label}
                glyph={r.glyph}
                faction={r.faction}
                start={r.start}
                end={r.end}
                progress={r.progress}
                state={r.state}
              >
                {r.text}
              </TimelineRow>
              <span className={styles['actions']}>
                {r.districtId !== null && (
                  <Button
                    onClick={() => {
                      if (r.districtId !== null) onFly(r.districtId);
                    }}
                    aria-label={`Show ${r.label} on the map`}
                  >
                    SHOW
                  </Button>
                )}
                {r.recallId !== null && (
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (r.recallId !== null) onRecall(r.recallId);
                    }}
                  >
                    RECALL
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
