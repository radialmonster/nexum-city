import type { ContractView, PlayerView } from '@nexum/contracts';
import { toUnits } from '@nexum/sim';
import { Bar, Button } from '../ui';
import {
  inTransit,
  myPosted,
  myTaken,
  remainingUnits,
  timeLeft,
  creditsOf,
  unitsToSend,
} from './contracts';
import { shortDuration } from './orderTimeline';
import styles from './MyContracts.module.css';
import { formatUnits } from './feed';

export interface MyContractsProps {
  readonly view: PlayerView;
  readonly nowMs: number;
  readonly onDeliver: (contract: ContractView) => void;
  /** Opens the contracts board of a hub. */
  readonly onBoard?: ((hub: string) => void) | undefined;
}

/** Your taken and posted contracts: progress, deadline, and a DELIVER shortcut. */
export function MyContracts({ view, nowMs, onDeliver, onBoard }: MyContractsProps) {
  const taken = myTaken(view);
  const posted = myPosted(view);
  if (taken.length === 0 && posted.length === 0) return null;
  const hubName = (c: ContractView) => view.districts[c.hub]?.name ?? c.hub;
  return (
    <div className={styles['block']} data-testid="my-contracts">
      <span className={styles['cap']}>MY CONTRACTS</span>
      <ul className={styles['list']}>
        {taken.map((c) => {
          const left = remainingUnits(c);
          const toSend = unitsToSend(view, c);
          const onWay = inTransit(view, c);
          const done = c.qty - left;
          const late = nowMs >= c.dueMs;
          return (
            <li key={c.id} className={styles['item']} data-late={late}>
              <span className={styles['line']}>
                Bring {formatUnits(c.qty)} {c.good} to {hubName(c)}. Pays{' '}
                {formatUnits(creditsOf(c.reward))} cr.
              </span>
              <Bar
                value={done / c.qty}
                faction={late ? 'raider' : 'self'}
                label={`${formatUnits(done)} of ${formatUnits(c.qty)} delivered`}
              />
              <span className={styles['meta']}>
                {formatUnits(done)}/{formatUnits(c.qty)} delivered. Due in{' '}
                <b>{timeLeft(c, nowMs)}</b>. Paid so far {formatUnits(creditsOf(c.paid ?? 0))} cr.
              </span>
              {onWay && (
                <span className={styles['meta']} data-testid="contract-en-route">
                  On the way, ETA {shortDuration(Math.max(0, onWay.arriveMs - nowMs))} (
                  {onWay.units} units).
                </span>
              )}
              {toSend > 0 && left > 0 && (
                <div className={styles['actions']}>
                  <Button
                    variant="primary"
                    onClick={() => {
                      onDeliver(c);
                    }}
                  >
                    {onWay ? `DELIVER ${String(toSend)} MORE` : 'DELIVER'}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
        {posted.map((c) => (
          <li key={c.id} className={styles['item']}>
            <span className={styles['line']}>
              Your job: {formatUnits(c.qty)} {c.good} to {hubName(c)} for{' '}
              {formatUnits(creditsOf(c.reward))} cr.
            </span>
            <span className={styles['meta']}>
              {c.status === 'open'
                ? `Waiting for a taker, ${timeLeft(c, nowMs)} left.`
                : `Being delivered: ${formatUnits(Math.floor(toUnits(c.delivered ?? 0)))}/${formatUnits(c.qty)}, due in ${timeLeft(c, nowMs)}.`}
            </span>
            {onBoard && (
              <div className={styles['actions']}>
                <Button
                  onClick={() => {
                    onBoard(c.hub);
                  }}
                >
                  OPEN BOARD
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
