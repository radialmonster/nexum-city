import type { ReactNode } from 'react';
import styles from './Tag.module.css';
import { cx, factionColor, vars, type Faction } from './util';

export interface TagProps {
  readonly faction?: Faction;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/** Small outlined mono label, coloured by faction role. */
export function Tag({ faction = 'self', className, children }: TagProps) {
  return (
    <span className={cx(styles['tag'], className)} style={vars({ '--k': factionColor(faction) })}>
      {children}
    </span>
  );
}
