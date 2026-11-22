import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';
import { cx } from './util';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  readonly variant?: 'primary' | 'ghost' | 'danger';
  readonly className?: string;
}

/** Chamfered action button. */
export function Button({
  variant = 'ghost',
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={cx(styles['button'], styles[variant], className)} {...rest}>
      {children}
    </button>
  );
}
