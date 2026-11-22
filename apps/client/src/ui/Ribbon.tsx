import type { ReactNode } from 'react';
import styles from './Ribbon.module.css';
import { cx, toneColor, vars, type Tone } from './util';

export interface RibbonProps {
  readonly tone?: Tone;
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly children?: ReactNode;
  /** A solid badge at the right, such as a countdown or "VIEW". */
  readonly badge?: ReactNode;
  readonly className?: string | undefined;
}

/** Alert banner: slides in under the legend and never covers the middle of the map. */
export function Ribbon({ tone = 'danger', icon, title, children, badge, className }: RibbonProps) {
  return (
    <div
      className={cx(styles['ribbon'], className)}
      style={vars({ '--tone': toneColor(tone) })}
      role="alert"
    >
      {icon !== undefined && (
        <span className={styles['icon']} aria-hidden="true">
          {icon}
        </span>
      )}
      <b className={styles['title']}>{title}</b>
      {children !== undefined && <span>{children}</span>}
      {badge !== undefined && <em className={styles['badge']}>{badge}</em>}
    </div>
  );
}
