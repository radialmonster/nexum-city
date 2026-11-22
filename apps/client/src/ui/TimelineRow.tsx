import type { ReactNode } from 'react';
import styles from './TimelineRow.module.css';
import { clamp01, cx, factionColor, pct, vars, type Faction } from './util';

export interface TimelinePreview {
  /** Fractions of the track, 0 to 1. */
  readonly start: number;
  readonly end: number;
}

export interface TimelineRowProps {
  /** The unit or carrier this order belongs to. */
  readonly label: ReactNode;
  readonly glyph?: ReactNode;
  readonly faction?: Faction;
  /** Where the order bar starts and ends on the track, 0 to 1. */
  readonly start: number;
  readonly end: number;
  /** How much of the order is done, 0 to 1. */
  readonly progress?: number;
  /** `pending` orders are dashed outlines; `hot` ones glow. */
  readonly state?: 'running' | 'pending' | 'hot';
  /** Text inside the order bar, such as "HAUL 40 ⚙". */
  readonly children?: ReactNode;
  /** Dashed "what would happen next" segments after the bar. */
  readonly previews?: readonly TimelinePreview[];
  readonly className?: string;
}

/** One line of the order timeline: an order bar with a progress fill and preview dashes. */
export function TimelineRow({
  label,
  glyph,
  faction = 'self',
  start,
  end,
  progress = 0,
  state = 'running',
  children,
  previews = [],
  className,
}: TimelineRowProps) {
  const s = clamp01(start);
  const e = Math.max(s, clamp01(end));
  return (
    <div
      className={cx(styles['row'], className)}
      style={vars({ '--k': factionColor(faction) })}
      role="listitem"
    >
      <span className={styles['who']}>
        {glyph !== undefined && (
          <i className={styles['glyph']} aria-hidden="true">
            {glyph}
          </i>
        )}
        <span className={styles['name']}>{label}</span>
      </span>
      <div className={styles['track']}>
        <div
          className={cx(
            styles['order'],
            state === 'pending' && styles['pending'],
            state === 'hot' && styles['hot'],
          )}
          style={vars({ '--from': pct(s), '--size': pct(e - s), '--p': pct(progress) })}
        >
          <span className={styles['text']}>{children}</span>
        </div>
        {previews.map((p, i) => {
          const from = clamp01(p.start);
          const to = Math.max(from, clamp01(p.end));
          return (
            <span
              key={i}
              className={styles['preview']}
              style={vars({ '--from': pct(from), '--size': pct(to - from) })}
            />
          );
        })}
      </div>
    </div>
  );
}
