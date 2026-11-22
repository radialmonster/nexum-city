import { Button, Panel } from '../ui';
import styles from './BattleReport.module.css';
import { whoIs, type CrewNames } from './derive';
import { formatUnits } from './feed';
import type { RaidReport as Report } from './raidReport';

export interface RaidReportProps {
  readonly report: Report;
  readonly me: string;
  readonly names?: CrewNames | undefined;
  readonly onFly: (districtId: string) => void;
  readonly onClose: () => void;
}

const OUTCOME = { hit: 'RAIDED', repelled: 'REPELLED' } as const;

const list = (g: Readonly<Record<string, number>>): string => {
  const parts = Object.entries(g).map(([k, n]) => `${formatUnits(n)} ${k}`);
  return parts.length === 0 ? 'none' : parts.join(', ');
};

/** One raid, short: strength against guard, and what happened to the cargo. */
export function RaidReport({ report: r, me, names = {}, onFly, onClose }: RaidReportProps) {
  return (
    <Panel title="Raid report" tag={OUTCOME[r.outcome]} className={styles['card']}>
      <div className={styles['stack']} data-outcome={r.outcome}>
        <p className={styles['summary']}>{r.summary}</p>
        <dl className={styles['facts']}>
          <div>
            <dt>WHERE</dt>
            <dd>
              {r.districtId ? (
                <button
                  type="button"
                  className={styles['link']}
                  onClick={() => {
                    if (r.districtId) onFly(r.districtId);
                  }}
                >
                  {r.street}
                </button>
              ) : (
                r.street
              )}
            </dd>
          </div>
          <div>
            <dt>RAIDERS</dt>
            <dd>{whoIs(names, me, r.raider)}</dd>
          </div>
          <div>
            <dt>HAULER</dt>
            <dd>{whoIs(names, me, r.victim)}</dd>
          </div>
          <div>
            <dt>RAID STRENGTH</dt>
            <dd>{formatUnits(r.raiderStrength)}</dd>
          </div>
          <div>
            <dt>GUARD</dt>
            <dd>{formatUnits(r.guard)}</dd>
          </div>
          {r.outcome === 'hit' ? (
            <>
              <div>
                <dt>STOLEN</dt>
                <dd>{list(r.stolen)}</dd>
              </div>
              <div>
                <dt>DESTROYED</dt>
                <dd>{list(r.destroyed)}</dd>
              </div>
              <div>
                <dt>STILL ON THE HAUL</dt>
                <dd>{list(r.remaining)}</dd>
              </div>
              <div>
                <dt>ESCORT LOST</dt>
                <dd>{formatUnits(r.escortLost)}</dd>
              </div>
            </>
          ) : (
            <div>
              <dt>RAIDERS LOST</dt>
              <dd>{formatUnits(r.raiderLost)}</dd>
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
