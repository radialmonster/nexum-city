import type { ReactNode } from 'react';
import styles from './Chip.module.css';
import { cx, factionColor, vars, type Faction } from './util';

export interface ChipProps {
  /** A glyph such as a resource icon. */
  readonly icon?: ReactNode;
  readonly label?: ReactNode;
  readonly value: ReactNode;
  readonly faction?: Faction;
  readonly className?: string | undefined;
}

/** Compact resource chip: an icon, an optional label and a bright value. */
export function Chip({ icon, label, value, faction = 'self', className }: ChipProps) {
  return (
    <span className={cx(styles['chip'], className)} style={vars({ '--k': factionColor(faction) })}>
      {icon !== undefined && (
        <span className={styles['icon']} aria-hidden="true">
          {icon}
        </span>
      )}
      {label !== undefined && <span className={styles['label']}>{label}</span>}
      <b className={styles['value']}>{value}</b>
    </span>
  );
}
