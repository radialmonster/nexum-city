import type { KeyboardEvent, ReactNode } from 'react';
import styles from './RadialMenu.module.css';
import { cx } from './util';

export type RadialFacing = 'around' | 'down' | 'up';

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
  /** Where the items go: all round the hub, or fanned out below / above it (near an edge). */
  readonly facing?: RadialFacing;
}

// geometry, in viewBox units (the SVG is drawn at about 1 unit per CSS px at --s: 1)
const VIEW = 380;
const CENTRE = VIEW / 2;
const RING = 138;
const BUTTON = 30;
const HUB = 44;
// opaque backdrop around each button, so map detail never shows beside it
const BACKDROP = 10;
// label backdrop: about this many viewBox units per letter, plus padding
const LABEL_GAP = 18;
const LABEL_CHAR = 10;
const LABEL_PAD = 16;
const LABEL_H = 22;

/** Circular action menu around a point, such as around a district on the map. */
export function RadialMenu({
  items,
  selected,
  onSelect,
  title,
  className,
  facing = 'around',
}: RadialMenuProps) {
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
        // a half ring puts the items at the middle of equal slices of 180 degrees
        const angle =
          facing === 'around'
            ? (i / items.length) * 2 * Math.PI - Math.PI / 2
            : ((i + 0.5) / items.length) * Math.PI * (facing === 'down' ? 1 : -1);
        const x = CENTRE + RING * Math.cos(angle);
        const y = CENTRE + RING * Math.sin(angle);
        const on = item.id === selected;
        // labels of the upper items sit above their button, so they never run into a lower neighbour
        // On a half ring the two end items sit level with the hub and their neighbour is further out,
        // so their labels go on the hub side (above when fanned down, below when fanned up): on the
        // outer side a label would run under the next button along the arc.
        const s = Math.sin(angle);
        const above = facing === 'down' ? s < 0.4 : facing === 'up' ? s < -0.4 : s < -0.25;
        const labelY = above ? y - BUTTON - LABEL_GAP : y + BUTTON + LABEL_GAP;
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
            <circle className={styles['button-bg']} cx={x} cy={y} r={BUTTON + BACKDROP} />
            <circle className={styles['button']} cx={x} cy={y} r={BUTTON} />
            <text className={styles['glyph']} x={x} y={y} dy="0.35em">
              {item.glyph}
            </text>
            <rect
              className={styles['label-bg']}
              x={x - (item.label.length * LABEL_CHAR + LABEL_PAD) / 2}
              y={labelY - LABEL_H / 2}
              width={item.label.length * LABEL_CHAR + LABEL_PAD}
              height={LABEL_H}
            />
            <text className={styles['label']} x={x} y={labelY} dy="0.35em">
              {item.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
