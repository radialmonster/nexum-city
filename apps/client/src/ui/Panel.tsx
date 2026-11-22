import type { ReactNode } from 'react';
import styles from './Panel.module.css';
import { cx } from './util';

export interface PanelProps {
  readonly title?: ReactNode;
  /** Small mono text at the right of the header. */
  readonly tag?: ReactNode;
  readonly className?: string;
  readonly children?: ReactNode;
}

/** Glass panel with corner brackets and chamfered corners, and an optional header. */
export function Panel({ title, tag, className, children }: PanelProps) {
  return (
    <section className={cx(styles['panel'], className)}>
      {title !== undefined && (
        <h3 className={styles['header']}>
          <span>{title}</span>
          {tag !== undefined && <small className={styles['tag']}>{tag}</small>}
        </h3>
      )}
      <div className={styles['body']}>{children}</div>
    </section>
  );
}
