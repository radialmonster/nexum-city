import styles from './StanceSwitch.module.css';
import { cx } from './util';

export type Stance = 'hold' | 'pullBack';

export interface StanceSwitchProps {
  readonly value: Stance;
  readonly onChange: (stance: Stance) => void;
  readonly className?: string | undefined;
}

const OPTIONS: readonly { id: Stance; label: string }[] = [
  { id: 'hold', label: 'HOLD' },
  { id: 'pullBack', label: 'PULL BACK' },
];

/** Hold the district, or pull back. Pulling back is the cautious (warning-coloured) choice. */
export function StanceSwitch({ value, onChange, className }: StanceSwitchProps) {
  return (
    <div className={cx(styles['stance'], className)} role="radiogroup" aria-label="Stance">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          className={cx(
            styles['option'],
            o.id === value && styles['on'],
            o.id === 'pullBack' && styles['pull'],
          )}
          onClick={() => {
            onChange(o.id);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
