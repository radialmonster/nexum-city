import { Button, Panel, Sparkline } from '../ui';
import { vars } from '../ui/util';
import styles from './BattleReport.module.css';
import type { BattleReport as Report } from './report';
import { formatUnits } from './feed';
import { shortName } from './derive';

export interface BattleReportProps {
  readonly report: Report;
  readonly me: string;
  readonly nowMs: number;
  readonly onRival: (playerId: string) => void;
  readonly onFly: (districtId: string) => void;
  readonly onClose: () => void;
}

const OUTCOME = { captured: 'CAPTURED', broken: 'SIEGE BROKEN', ongoing: 'IN PROGRESS' } as const;

const clock = (ms: number | null): string =>
  ms === null ? '-' : new Date(ms).toISOString().slice(5, 16).replace('T', ' ');

/** One siege, told from the events: who fought, how the strength moved, what it cost. */
export function BattleReport({ report: r, me, onRival, onFly, onClose }: BattleReportProps) {
  const who = (id: string): string => (id === me ? 'You' : shortName(id));
  const loot = Object.entries(r.loot).filter(([, n]) => n > 0);
  const series = (pick: (p: Report['rounds'][number]) => number): number[] => {
    const xs = r.rounds.map(pick);
    return xs.length === 1 ? [xs[0] ?? 0, xs[0] ?? 0] : xs;
  };
  return (
    <Panel title="Battle report" tag={OUTCOME[r.outcome]} className={styles['card']}>
      <div className={styles['stack']} data-outcome={r.outcome}>
        <p className={styles['summary']}>{r.summary}</p>
        <dl className={styles['facts']}>
          <div>
            <dt>WHERE</dt>
            <dd>
              <button
                type="button"
                className={styles['link']}
                onClick={() => {
                  onFly(r.districtId);
                }}
              >
                {r.districtName}
              </button>
            </dd>
          </div>
          <div>
            <dt>ATTACKER</dt>
            <dd>
              <button
                type="button"
                className={styles['link']}
                disabled={r.attacker === me}
                onClick={() => {
                  onRival(r.attacker);
                }}
              >
                {who(r.attacker)}
              </button>
            </dd>
          </div>
          <div>
            <dt>DEFENDER</dt>
            <dd>
              <button
                type="button"
                className={styles['link']}
                disabled={r.defender === me}
                onClick={() => {
                  onRival(r.defender);
                }}
              >
                {who(r.defender)}
              </button>
            </dd>
          </div>
          <div>
            <dt>STARTED</dt>
            <dd>{clock(r.startedMs)}</dd>
          </div>
          <div>
            <dt>ENDED</dt>
            <dd>{r.endedMs === null ? 'still going' : clock(r.endedMs)}</dd>
          </div>
        </dl>
        <section className={styles['timeline']} aria-label="Strength timeline">
          <h3>STRENGTH PER ROUND</h3>
          {r.rounds.length === 0 ? (
            <p className={styles['none']}>No fighting recorded.</p>
          ) : (
            <>
              <div className={styles['line']} style={vars({ '--k': 'var(--color-danger)' })}>
                <span>ATTACK</span>
                <Sparkline
                  points={series((p) => p.attackerStrength)}
                  tone="danger"
                  label="Attacker strength"
                />
                <b>{formatUnits(r.rounds[r.rounds.length - 1]?.attackerStrength ?? 0)}</b>
              </div>
              <div className={styles['line']}>
                <span>DEFENCE</span>
                <Sparkline
                  points={series((p) => p.defenderStrength)}
                  tone="accent"
                  label="Defender strength"
                />
                <b>{formatUnits(r.rounds[r.rounds.length - 1]?.defenderStrength ?? 0)}</b>
              </div>
              <small className={styles['none']}>{r.rounds.length} rounds fought.</small>
            </>
          )}
        </section>
        <dl className={styles['facts']}>
          <div>
            <dt>ATTACKER LOST</dt>
            <dd>
              {formatUnits(r.attackerLost)}
              {r.attackerStart !== null && ` of ${formatUnits(r.attackerStart)}`}
            </dd>
          </div>
          <div>
            <dt>DEFENDER LOST</dt>
            <dd>{formatUnits(r.defenderLost)}</dd>
          </div>
          {r.survivors !== null && (
            <div>
              <dt>SURVIVORS</dt>
              <dd>{r.survivors} crews</dd>
            </div>
          )}
          <div>
            <dt>LOOT</dt>
            <dd>
              {loot.length === 0
                ? 'none'
                : loot.map(([g, n]) => `${formatUnits(n)} ${g}`).join(', ')}
            </dd>
          </div>
          {r.buildingsDamaged > 0 && (
            <div>
              <dt>BUILDINGS HIT</dt>
              <dd>{r.buildingsDamaged}</dd>
            </div>
          )}
        </dl>
        <Button variant="ghost" onClick={onClose}>
          CLOSE
        </Button>
      </div>
    </Panel>
  );
}
