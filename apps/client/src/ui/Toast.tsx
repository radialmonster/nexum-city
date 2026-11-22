import type { ReactNode } from 'react';
import styles from './Toast.module.css';
import { cx, toneColor, vars, type Tone } from './util';

export interface ToastProps {
  readonly tone?: Tone;
  readonly title: ReactNode;
  readonly children?: ReactNode;
  readonly onDismiss?: () => void;
  readonly className?: string;
}

/** A short-lived message: something happened, with an optional dismiss control. */
export function Toast({ tone = 'accent', title, children, onDismiss, className }: ToastProps) {
  return (
    <div
      className={cx(styles['toast'], className)}
      style={vars({ '--tone': toneColor(tone) })}
      role="status"
    >
      <div className={styles['text']}>
        <b className={styles['title']}>{title}</b>
        {children !== undefined && <span className={styles['message']}>{children}</span>}
      </div>
      {onDismiss !== undefined && (
        <button type="button" className={styles['close']} onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
