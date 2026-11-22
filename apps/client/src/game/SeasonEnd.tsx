import type { PlayerView } from '@nexum/contracts';
import { Button, Panel, Tag } from '../ui';
import { whoIs, type CrewNames } from './derive';
import { formatUnits } from './feed';
import styles from './SeasonEnd.module.css';

export interface SeasonEndProps {
  readonly view: PlayerView;
  readonly names?: CrewNames | undefined;
  readonly onClose: () => void;
}

/** Shown when the clock runs out: the frozen final leaderboard until the next season starts. */
export function SeasonEnd({ view, names = {}, onClose }: SeasonEndProps) {
  const rows = [...view.standings].sort((a, b) => a.rank - b.rank);
  return (
    <Panel title="Season over" tag="FINAL STANDINGS" className={styles['card']}>
      <div className={styles['stack']}>
        <p className={styles['lead']}>
          Scoring has stopped. The next season starts soon with a fresh city; your account and crew
          name carry over.
        </p>
        <ol className={styles['board']} aria-label="Final standings">
          {rows.map((r) => (
            <li key={r.playerId} data-me={r.playerId === view.playerId}>
              <span className={styles['rank']}>#{r.rank}</span>
              <span className={styles['name']}>{whoIs(names, view.playerId, r.playerId)}</span>
              <b className={styles['score']}>{formatUnits(r.score)} PTS</b>
            </li>
          ))}
        </ol>
        <div className={styles['actions']}>
          <a className={styles['link']} href="/hall">
            <Tag>HALL OF FAME</Tag>
          </a>
          <Button variant="primary" onClick={onClose}>
            CLOSE
          </Button>
        </div>
      </div>
    </Panel>
  );
}
