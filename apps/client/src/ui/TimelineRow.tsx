import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
  /** The order kind, for a distinct look: ambush bars wait dashed, return bars are muted. */
  readonly kind?: string;
  /** Phone layout: a label that does not fit the bar goes on its own line under the track. */
  readonly stackLabel?: boolean;
  readonly className?: string | undefined;
}

/** Bars shorter than this fraction of the track put their label beside the bar. */
const NARROW_BAR = 0.14;
/** Narrow bars starting past this fraction put the label on their left, so it stays on the track. */
const NARROW_FLIP = 0.6;

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
  kind,
  stackLabel = false,
  className,
}: TimelineRowProps) {
  const s = clamp01(start);
  const e = Math.max(s, clamp01(end));
  const hasText = children !== undefined && children !== null;
  const orderRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  // A label wider than its bar (measured, so it holds at any track width) moves out of the bar.
  useLayoutEffect(() => {
    const order = orderRef.current;
    const text = textRef.current;
    if (!order || !text || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      setClipped(text.scrollWidth > text.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(order);
    return () => {
      ro.disconnect();
    };
  }, [children, s, e]);
  // a bar too short to hold its label gets the label beside it
  const narrow = hasText && (e - s < NARROW_BAR || clipped);
  return (
    <div
      className={cx(styles['row'], stackLabel && narrow && styles['stack'], className)}
      style={vars({ '--k': factionColor(faction) })}
      role="listitem"
      data-kind={kind}
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
          ref={orderRef}
          className={cx(
            styles['order'],
            state === 'pending' && styles['pending'],
            state === 'hot' && styles['hot'],
          )}
          style={vars({ '--from': pct(s), '--size': pct(e - s), '--p': pct(progress) })}
          title={typeof children === 'string' ? children : undefined}
        >
          <span ref={textRef} className={cx(styles['text'], narrow && styles['text-moved'])}>
            {children}
          </span>
        </div>
        {narrow && (
          <span
            className={cx(styles['beside'], s > NARROW_FLIP && styles['beside-left'])}
            style={vars({ '--from': pct(s), '--end': pct(e) })}
            data-testid="timeline-beside"
          >
            {children}
          </span>
        )}
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
