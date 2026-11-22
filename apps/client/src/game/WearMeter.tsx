import { Bar } from '../ui';
import { slowText, wearInfo } from './wear';
import styles from './WearMeter.module.css';

export interface WearMeterProps {
  /** Wear 0 to 100, as the carrier view reports it (absent means fresh). */
  readonly wear: number | undefined;
  /** Name of the carrier, used as the bar's label. */
  readonly label: string;
  /** Show the bar even for a fresh carrier. Off by default so healthy carriers stay quiet. */
  readonly always?: boolean;
}

/** A small wear bar with "+12% slower" once a carrier is worn past the point where it matters. */
export function WearMeter({ wear, label, always = false }: WearMeterProps) {
  const info = wearInfo({ wear });
  if (info.wear <= 0 && !always) return null;
  const slow = slowText(info.slowPercent);
  return (
    <span className={styles['meter']} data-testid="wear-meter" data-slow={slow !== null}>
      <Bar
        value={info.wear / 100}
        faction={slow ? 'raider' : 'self'}
        label={`${label} wear`}
        className={styles['bar']}
      />
      <small className={styles['text']}>{slow ?? `Wear ${String(info.wear)}`}</small>
    </span>
  );
}
