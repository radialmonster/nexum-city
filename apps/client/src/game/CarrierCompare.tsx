import type { CarrierKind } from '@nexum/sim';
import { formatEta } from './derive';
import type { CarrierOption } from './runner';
import styles from './CarrierCompare.module.css';

export interface CarrierCompareProps {
  readonly options: readonly CarrierOption[];
  /** The carrier kind picked in the card. */
  readonly chosen: CarrierKind | 'foot';
  /** Why a Runner was picked for the player, if it was. */
  readonly suggestion: string | null;
}

/** A compact side-by-side of the carriers you could send: speed and trip time, load, safety. */
export function CarrierCompare({ options, chosen, suggestion }: CarrierCompareProps) {
  if (options.length === 0) return null;
  return (
    <div className={styles['compare']} data-testid="carrier-compare">
      <span className={styles['cap']}>CARRIERS HERE</span>
      <ul className={styles['rows']}>
        {options.map((o) => (
          <li key={o.kind} className={styles['row']} data-picked={o.kind === chosen}>
            <span className={styles['name']}>
              {o.label}: {o.note}
            </span>
            <span className={styles['facts']}>
              {o.speedX}× speed / ETA {o.etaMs === null ? '-' : formatEta(o.etaMs)} / holds{' '}
              {o.cargo}
              {o.tooSmall ? ' (too small for this load)' : ''}
            </span>
          </li>
        ))}
      </ul>
      {suggestion && (
        <p className={styles['suggest']} data-testid="runner-suggestion">
          {suggestion}
        </p>
      )}
    </div>
  );
}
