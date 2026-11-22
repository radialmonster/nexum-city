import { useState } from 'react';
import type { ContractView, GoodName, PlayerView } from '@nexum/contracts';
import { Button, Tabs } from '../ui';
import { crewsAt, GOOD_KEYS, type CrewNames } from './derive';
import styles from './ContractsBoard.module.css';
import {
  checkPost,
  contractSentence,
  creditsOf,
  depositFor,
  hubBoard,
  posterName,
  referenceCredits,
  takeBlocker,
  takerName,
  timeLeft,
} from './contracts';
import { formatUnits } from './feed';

export interface ContractsBoardProps {
  readonly view: PlayerView;
  readonly hub: string;
  readonly names: CrewNames;
  readonly onPost: (order: {
    type: 'contract.post';
    hub: string;
    good: GoodName;
    qty: number;
    reward: number;
    hours: number;
  }) => Promise<boolean>;
  readonly onTake: (contractId: string) => Promise<boolean>;
  readonly onCancel: (contractId: string) => Promise<boolean>;
  /** Opens the haul card prefilled for a contract you took. */
  readonly onDeliver: (contract: ContractView) => void;
}

/** The contracts board of one hub: open jobs, taking, delivering, and posting your own. */
export function ContractsBoard({
  view,
  hub,
  names,
  onPost,
  onTake,
  onCancel,
  onDeliver,
}: ContractsBoardProps) {
  const [good, setGood] = useState<GoodName>('parts');
  const [qty, setQty] = useState('');
  const [reward, setReward] = useState('');
  const [hours, setHours] = useState('12');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const board = hubBoard(view, hub);
  const me = view.playerId;
  const check = checkPost(view, { hub, good, qty, reward, hours });
  const empty = qty.trim() === '' && reward.trim() === '';
  const ref = (() => {
    const n = Number(qty);
    return Number.isInteger(n) && n > 0 ? referenceCredits(view, hub, good, n) : null;
  })();

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setShown(true);
    if (!check.ok) return;
    const ok = await run(() =>
      onPost({
        type: 'contract.post',
        hub,
        good,
        qty: check.qty,
        reward: check.reward,
        hours: check.hours,
      }),
    );
    if (ok) {
      setQty('');
      setReward('');
      setShown(false);
    }
  };

  return (
    <div className={styles['stack']} data-testid="contracts-board">
      <p className={styles['hint']}>
        Jobs to bring goods to this hub. Take one, haul the goods here before the deadline and get
        paid. A deposit comes back when you finish, and is lost if you are late.
      </p>
      <ul className={styles['list']} aria-label="Open contracts">
        {board.length === 0 && <li className={styles['none']}>No jobs posted here right now.</li>}
        {board.map((c) => {
          const mine = c.poster === me;
          const taken = c.taker === me;
          const blocker = takeBlocker(view, c);
          const crewHere = crewsAt(view, hub).length > 0;
          return (
            <li
              key={c.id}
              className={styles['item']}
              data-status={c.status}
              data-mine={mine || taken}
            >
              <p className={styles['sentence']}>{contractSentence(view, c)}</p>
              <p className={styles['meta']}>
                <span>
                  FROM <b>{posterName(names, me, c)}</b>
                </span>
                <span>
                  {c.status === 'taken' ? 'DUE IN' : 'OPEN FOR'} <b>{timeLeft(c, view.nowMs)}</b>
                </span>
                <span>
                  TAKEN BY <b>{takerName(names, me, c)}</b>
                </span>
                <span>
                  DEPOSIT <b>{formatUnits(creditsOf(depositFor(c.reward)))} cr</b>
                </span>
              </p>
              <div className={styles['actions']}>
                {c.status === 'open' && !mine && (
                  <>
                    {blocker !== null && <small>{blocker}</small>}
                    <Button
                      variant="primary"
                      disabled={busy || blocker !== null}
                      onClick={() => {
                        void run(() => onTake(c.id));
                      }}
                    >
                      TAKE
                    </Button>
                  </>
                )}
                {c.status === 'open' && mine && (
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      void run(() => onCancel(c.id));
                    }}
                  >
                    CANCEL
                  </Button>
                )}
                {c.status === 'taken' && taken && (
                  <>
                    {!crewHere && <small>Park a ready crew here, or haul from elsewhere.</small>}
                    <Button
                      variant="primary"
                      onClick={() => {
                        onDeliver(c);
                      }}
                    >
                      DELIVER
                    </Button>
                  </>
                )}
                {c.status === 'taken' && mine && <small>Your job is being delivered.</small>}
              </div>
            </li>
          );
        })}
      </ul>
      <form
        className={styles['form']}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <span className={styles['cap']}>POST A JOB</span>
        <Tabs
          label="Good to bring"
          value={good}
          onChange={(id) => {
            setGood(GOOD_KEYS.find((g) => g === id) ?? 'parts');
          }}
          tabs={GOOD_KEYS.map((g) => ({ id: g, label: g.toUpperCase() }))}
        />
        <div className={styles['fields']}>
          <label>
            <span className={styles['cap']}>UNITS</span>
            <input
              inputMode="numeric"
              placeholder="5 to 150"
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
              }}
            />
          </label>
          <label>
            <span className={styles['cap']}>REWARD (CREDITS)</span>
            <input
              inputMode="numeric"
              placeholder={ref === null ? 'e.g. 400' : `about ${formatUnits(ref)}`}
              value={reward}
              onChange={(e) => {
                setReward(e.target.value);
              }}
            />
          </label>
          <label>
            <span className={styles['cap']}>HOURS TO DELIVER</span>
            <input
              inputMode="numeric"
              placeholder="6 to 18"
              value={hours}
              onChange={(e) => {
                setHours(e.target.value);
              }}
            />
          </label>
        </div>
        {!check.ok && (shown || !empty) && (
          <p className={styles['blocker']} role="alert">
            {check.message}
          </p>
        )}
        {check.ok && (
          <p className={styles['line']}>
            Sets aside {formatUnits(check.escrow)} credits until the job ends. The goods land in
            your stash here.
          </p>
        )}
        <div className={styles['actions']}>
          <Button type="submit" variant="primary" disabled={busy || !check.ok}>
            POST JOB
          </Button>
        </div>
      </form>
    </div>
  );
}
