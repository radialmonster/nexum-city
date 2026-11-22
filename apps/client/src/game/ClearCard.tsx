import type { OrderBody, PlayerView } from '@nexum/contracts';
import { useEffect, useMemo, useState } from 'react';
import { Button, Panel } from '../ui';
import { clearUnderway, findAmbush, planClear } from './clearAmbush';
import { crewLabel, formatEta, streetEnds } from './derive';
import styles from './ClearCard.module.css';

export interface ClearCardProps {
  readonly view: PlayerView;
  readonly ambushId: string;
  readonly nowMs: number;
  readonly onConfirm: (order: OrderBody) => Promise<boolean>;
  readonly onClose: () => void;
}

/** The confirm card for "Break it up": who would go, how long it takes and how the fight looks. */
export function ClearCard({ view, ambushId, nowMs, onConfirm, onClose }: ClearCardProps) {
  const [busy, setBusy] = useState(false);
  const ambush = findAmbush(view, ambushId, nowMs);
  const plan = useMemo(
    () => (ambush ? planClear(view, ambush, nowMs) : null),
    [view, ambush, nowMs],
  );
  const name = (id: string): string => view.districts[id]?.name ?? id;
  const underway = clearUnderway(view, ambushId);

  // The ambush ending or leaving your sight closes the card: there is nothing left to break up.
  useEffect(() => {
    if (!ambush) onClose();
  }, [ambush, onClose]);
  if (!ambush || !plan) return null;

  let blocker: string | null = null;
  if (underway) blocker = 'A crew of yours is already on its way.';
  else if (!plan.pick)
    blocker = 'No crew is free right now. Crews rest for a while after an order.';
  else if (plan.etaMs === null) blocker = 'There is no street route there.';

  const confirm = async () => {
    if (!plan.pick || blocker) return;
    setBusy(true);
    try {
      const order: OrderBody = {
        type: 'ambush.clear',
        ambushId,
        crewIds: plan.pick.crewIds,
        carrierId: plan.pick.carrierId,
      };
      if (await onConfirm(order)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Break it up" tag="CLEAR AMBUSH" className={styles['card']}>
      <div className={styles['stack']} data-testid="clear-card">
        <p className={styles['line']}>
          Ambush {`between ${streetEnds(name(ambush.edge[0]), name(ambush.edge[1]))}`}. A crew walks
          there and fights it. A win ends the ambush; a loss costs your crew some strength.
        </p>
        {plan.pick && (
          <div className={styles['field']}>
            <span className={styles['cap']}>CREWS GOING</span>
            <span className={styles['line']} data-testid="clear-crews">
              {plan.pick.crewIds.map((id) => crewLabel(view, id)).join(', ')} from{' '}
              {name(plan.pick.from)}
              {plan.pick.carrierId
                ? ` in a ${view.carriers[plan.pick.carrierId]?.kind ?? 'van'}`
                : ' on foot'}
            </span>
          </div>
        )}
        <div className={styles['field']}>
          <span className={styles['cap']}>TIME</span>
          <span className={styles['line']} data-testid="clear-eta">
            {plan.etaMs === null ? 'No route' : `They arrive in ${formatEta(plan.etaMs)}`}. The
            ambush ends in {formatEta(plan.remainingMs)}.
          </span>
          {plan.tooLate && (
            <span className={styles['soft']}>It may be over before they get there.</span>
          )}
        </div>
        {plan.estimate && (
          <div className={styles['field']}>
            <span className={styles['cap']}>ESTIMATE</span>
            <span
              className={styles['estimate']}
              data-label={plan.estimate.label}
              data-testid="clear-estimate"
            >
              {plan.estimate.text}
            </span>
          </div>
        )}
        {blocker && (
          <p className={styles['blocker']} role="alert">
            {blocker}
          </p>
        )}
        <div className={styles['actions']}>
          <Button onClick={onClose}>CANCEL</Button>
          <Button
            variant="danger"
            disabled={busy || blocker !== null}
            onClick={() => {
              void confirm();
            }}
          >
            BREAK IT UP
          </Button>
        </div>
      </div>
    </Panel>
  );
}
