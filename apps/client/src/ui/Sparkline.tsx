import styles from './Sparkline.module.css';
import { cx, toneColor, vars, type Tone } from './util';

export interface SparklineProps {
  readonly points: readonly number[];
  readonly tone?: Tone;
  readonly label: string;
  readonly className?: string | undefined;
  /** Index of a point to mark with a thin vertical line (for example, your last visit). */
  readonly markAt?: number | null | undefined;
}

const WIDTH = 90;
const HEIGHT = 24;
const PAD = 3;

/** Inline price trend. The line and end dot use `currentColor`, set from the tone. */
export function Sparkline({
  points,
  tone = 'accent',
  label,
  className,
  markAt = null,
}: SparklineProps) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = points.length > 1 ? WIDTH / (points.length - 1) : 0;
  const coords = points.map((p, i): [number, number] => [
    i * step,
    HEIGHT - PAD - ((p - min) / span) * (HEIGHT - 2 * PAD),
  ]);
  const last = coords[coords.length - 1];
  const mark = markAt === null ? undefined : coords[markAt];
  return (
    <svg
      className={cx(styles['spark'], className)}
      style={vars({ '--k': toneColor(tone) })}
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      role="img"
      aria-label={label}
    >
      {mark !== undefined && (
        <line
          className={styles['mark']}
          x1={mark[0]}
          x2={mark[0]}
          y1={0}
          y2={HEIGHT}
          stroke="currentColor"
        />
      )}
      <polyline
        className={styles['line']}
        points={coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
        fill="none"
        stroke="currentColor"
      />
      {last !== undefined && (
        <circle className={styles['dot']} cx={last[0]} cy={last[1]} r="2.5" fill="currentColor" />
      )}
    </svg>
  );
}
