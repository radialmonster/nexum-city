import styles from './Gauge.module.css';
import { cx, toneColor, vars, type Tone } from './util';

export interface GaugeSegment {
  readonly id: string;
  /** Cells of capacity this good fills. */
  readonly units: number;
  readonly tone: Tone;
}

export interface GaugeProps {
  /** What is stored, in stack order. */
  readonly segments: readonly GaugeSegment[];
  /** Total cells; whatever is not filled shows as free space. */
  readonly capacity: number;
  readonly label: string;
  readonly className?: string;
}

/** Warehouse fill: one cell per unit of capacity, coloured by the good stored in it. */
export function Gauge({ segments, capacity, label, className }: GaugeProps) {
  const total = Math.max(1, Math.floor(capacity));
  const cells: Tone[] = [];
  for (const s of segments) {
    for (let i = 0; i < Math.floor(s.units) && cells.length < total; i++) cells.push(s.tone);
  }
  const used = cells.length;
  return (
    <div className={cx(styles['gauge'], className)}>
      <div
        className={styles['stack']}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
      >
        {Array.from({ length: total }, (_, i) => {
          const tone = cells[i];
          return tone === undefined ? (
            <i key={i} className={cx(styles['cell'], styles['free'])} />
          ) : (
            <i key={i} className={styles['cell']} style={vars({ '--k': toneColor(tone) })} />
          );
        })}
      </div>
      <div className={styles['caption']}>
        <span>{label}</span>
        <span>
          {used} / {total}
        </span>
      </div>
    </div>
  );
}
