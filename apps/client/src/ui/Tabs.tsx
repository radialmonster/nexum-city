import { useId, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Tabs.module.css';
import { cx } from './util';

export interface TabItem {
  readonly id: string;
  readonly label: ReactNode;
}

export interface TabsProps {
  readonly tabs: readonly TabItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly label: string;
  readonly className?: string;
}

/** Underlined tab strip. Arrow keys move between tabs. */
export function Tabs({ tabs, value, onChange, label, className }: TabsProps) {
  const base = useId();
  const move = (e: KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next !== undefined) onChange(next.id);
  };
  return (
    <div className={cx(styles['tabs'], className)} role="tablist" aria-label={label}>
      {tabs.map((tab, i) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            id={`${base}-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={cx(styles['tab'], selected && styles['selected'])}
            onClick={() => {
              onChange(tab.id);
            }}
            onKeyDown={(e) => {
              move(e, i);
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
