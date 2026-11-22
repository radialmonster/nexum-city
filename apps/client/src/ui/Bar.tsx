import styles from './Bar.module.css';
import { clamp01, cx, factionColor, pct, vars, type Faction } from './util';

export interface BarProps {
  /** Fill from 0 to 1. */
  readonly value: number;
  readonly faction?: Faction;
  /** Segmented cells instead of a continuous fill. */
  readonly segmented?: boolean;
  readonly label: string;
  readonly className?: string;
}

/** Progress or capture bar, coloured by faction role. */
export function Bar({ value, faction = 'self', segmented = false, label, className }: BarProps) {
  const v = clamp01(value);
  return (
    <div
      className={cx(styles['bar'], segmented && styles['segmented'], className)}
      style={vars({ '--k': factionColor(faction), '--p': pct(v) })}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <i className={styles['fill']} />
    </div>
  );
}
