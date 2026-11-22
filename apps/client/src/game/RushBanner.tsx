import { useState } from 'react';
import type { PlayerView } from '@nexum/contracts';
import { balance } from '@nexum/sim';
import { Tag } from '../ui';
import { longSpan, rushLeftMs } from './derive';
import styles from './RushBanner.module.css';

export interface RushBannerProps {
  readonly view: PlayerView;
  readonly nowMs: number;
}

/**
 * A slim strip under the top bar while the newcomer rush runs: builds and settling go
 * `balance.rush.factor` times faster. Click or tap it for the plain-language rules. It vanishes
 * the moment the rush ends.
 */
export function RushBanner({ view, nowMs }: RushBannerProps) {
  const [open, setOpen] = useState(false);
  const left = rushLeftMs(view, nowMs);
  if (left <= 0) return null;
  const factor = balance.rush.factor;
  const help = `For your first ${String(balance.rush.hours)} hours, buildings and settling finish ${String(factor)} times faster. A 2 hour Workshop takes about ${String(Math.round(120 / factor))} minutes. Hauling, travel and sieges run at normal speed. You also get quick street jobs and a contract only newcomers can take.`;
  return (
    <div className={styles['banner']} data-testid="rush-banner">
      <button
        type="button"
        className={styles['head']}
        aria-expanded={open}
        title={help}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <Tag faction="merchant">NEWCOMER RUSH</Tag>
        <span className={styles['text']}>
          Builds and settling {String(factor)}x faster for <b>{longSpan(left)}</b>.
        </span>
        <span className={styles['more']} aria-hidden="true">
          {open ? 'LESS' : 'WHY?'}
        </span>
      </button>
      {open && <p className={styles['help']}>{help}</p>}
    </div>
  );
}
