import { useEffect, useState } from 'react';
import type { SeasonSummary, SeasonsResponse } from '@nexum/contracts';
import { Panel, Tag } from '../ui';
import { api, ApiError } from './api';
import { crewName } from './derive';
import { formatUnits } from './feed';
import styles from './HallOfFame.module.css';

type Load = () => Promise<SeasonsResponse>;

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function SeasonCard({ season }: { readonly season: SeasonSummary }) {
  const rows = [...season.standings].sort((a, b) => a.rank - b.rank);
  const top = season.stats.topTraderId;
  return (
    <Panel
      title={`Season ${String(season.number)}`}
      tag={`${day(season.startMs)} to ${day(season.endMs)}`}
      className={styles['card']}
    >
      <div className={styles['stack']}>
        {season.reason === 'rules_change' && (
          <Tag faction="rival">CLOSED EARLY FOR A RULES CHANGE</Tag>
        )}
        <ol className={styles['board']} aria-label={`Season ${String(season.number)} standings`}>
          {rows.map((r) => (
            <li key={r.playerId}>
              <span className={styles['rank']}>#{r.rank}</span>
              <span className={styles['name']}>{crewName(season.names, r.playerId)}</span>
              <span className={styles['districts']}>{r.districts} districts</span>
              <b className={styles['score']}>{formatUnits(r.score)} PTS</b>
            </li>
          ))}
        </ol>
        <p className={styles['stats']}>
          {season.stats.players} crews held {season.stats.districtsHeld} districts.
          {top !== null && (
            <>
              {' '}
              Top trader: <b>{crewName(season.names, top)}</b> (
              {formatUnits(season.stats.topTradeScore)} trade points).
            </>
          )}
        </p>
      </div>
    </Panel>
  );
}

/** Every finished season, newest first. Needs a signed-in session, like the rest of the API. */
export function HallOfFame({ load = api.seasons }: { readonly load?: Load }) {
  const [data, setData] = useState<SeasonsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    load().then(
      (r) => {
        if (live) setData(r);
      },
      (e: unknown) => {
        if (live) {
          setError(
            e instanceof ApiError && e.code === 'unauthorized'
              ? 'Sign in to see the hall of fame.'
              : 'Could not load the hall of fame.',
          );
        }
      },
    );
    return () => {
      live = false;
    };
  }, [load]);
  return (
    <main className={styles['page']}>
      <header className={styles['head']}>
        <h1 className={styles['title']}>HALL OF FAME</h1>
        <a className={styles['back']} href="/">
          BACK TO THE GAME
        </a>
      </header>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Loading...</p>}
      {data && (
        <>
          <p className={styles['now']}>
            Season {data.current.number} is {data.current.over ? 'over' : 'running'}.
          </p>
          {data.seasons.length === 0 ? (
            <p>No season has finished yet.</p>
          ) : (
            data.seasons.map((s) => <SeasonCard key={s.number} season={s} />)
          )}
        </>
      )}
    </main>
  );
}
