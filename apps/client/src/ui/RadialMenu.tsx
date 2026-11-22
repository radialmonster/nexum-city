import type { KeyboardEvent, ReactNode } from 'react';
import styles from './RadialMenu.module.css';
import { cx } from './util';

export interface RadialItem {
  readonly id: string;
  readonly glyph: ReactNode;
  readonly label: string;
}

export interface RadialMenuProps {
  readonly items: readonly RadialItem[];
  readonly selected?: string | undefined;
  readonly onSelect: (id: string) => void;
  /** Shown in the hub in the middle. */
  readonly title?: string;
  readonly className?: string | undefined;
}

// geometry, in viewBox units (the SVG is drawn at about 1 unit per CSS px at --s: 1)
const VIEW = 300;
const CENTRE = VIEW / 2;
const RING = 100;
const BUTTON = 30;
const HUB = 44;

/** Circular action menu around a point, such as around a district on the map. */
export function RadialMenu({ items, selected, onSelect, title, className }: RadialMenuProps) {
  const activate = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(id);
    }
  };
  return (
    <svg
      className={cx(styles['radial'], className)}
      viewBox={`0 0 ${String(VIEW)} ${String(VIEW)}`}
      role="menu"
      aria-label={title ?? 'Actions'}
    >
      <circle className={styles['ring']} cx={CENTRE} cy={CENTRE} r={RING} />
      <circle className={styles['hub']} cx={CENTRE} cy={CENTRE} r={HUB} />
      {title !== undefined && (
        <text className={styles['hub-text']} x={CENTRE} y={CENTRE} dy="0.35em">
          {title}
        </text>
      )}
      {items.map((item, i) => {
        const angle = (i / items.length) * 2 * Math.PI - Math.PI / 2;
        const x = CENTRE + RING * Math.cos(angle);
        const y = CENTRE + RING * Math.sin(angle);
        const on = item.id === selected;
        return (
          <g
            key={item.id}
            className={cx(styles['item'], on && styles['on'])}
            role="menuitem"
            tabIndex={0}
            aria-label={item.label}
            onClick={() => {
              onSelect(item.id);
            }}
            onKeyDown={(e) => {
              activate(e, item.id);
            }}
          >
            <circle className={styles['button']} cx={x} cy={y} r={BUTTON} />
            <text className={styles['glyph']} x={x} y={y} dy="0.35em">
              {item.glyph}
            </text>
            <text className={styles['label']} x={x} y={y + BUTTON + 14}>
              {item.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
