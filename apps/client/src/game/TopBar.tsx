import type { PlayerView } from '@nexum/contracts';
import { toUnits } from '@nexum/sim';
import { Button, Chip } from '../ui';
import { cx, factionColor, vars } from '../ui/util';
import { raceOf, seasonClock, shortName, warehouseTotals } from './derive';
import { formatUnits } from './feed';
import styles from './TopBar.module.css';

export interface TopBarProps {
  readonly view: PlayerView;
  readonly nowMs: number;
  readonly username: string;
  /** How many events need attention (sieges against you). */
  readonly alerts: number;
  readonly link: 'off' | 'live' | 'polling';
  readonly onAlerts: () => void;
  readonly onLogout: () => void;
  /** Narrow screens: the bar shows only the logo, the race, credits, alerts and the clock. */
  readonly compact?: boolean;
}

/** The top bar: logo, season, race bar, resource chips, alerts, clock. */
export function TopBar({
  view,
  nowMs,
  username,
  alerts,
  link,
  onAlerts,
  onLogout,
  compact = false,
}: TopBarProps) {
  const race = raceOf(view);
  const clock = seasonClock(view, nowMs);
  const goods = warehouseTotals(view);
  const sorted = [...race.shares].sort((a, b) => b.share - a.share);
  return (
    <header className={styles['top']} data-compact={compact}>
      <div className={styles['logo']}>
        NEXUM<span>//</span>CITY
      </div>
      {!compact && (
        <Chip
          label="SEASON"
          value={`DAY ${String(clock.day).padStart(2, '0')}/${String(clock.days)}`}
          className={styles['season']}
        />
      )}
      <div
        className={styles['race']}
        title="Share of the season score. Each segment is a player; yours is bright."
      >
        <div className={styles['racebar']} role="img" aria-label="Season race">
          {sorted.map((s) => (
            <i
              key={s.id}
              className={cx(s.me && styles['me'])}
              style={vars({
                '--k': factionColor(s.me ? 'self' : 'rival'),
                '--share': Math.max(s.share, 0.01),
              })}
              title={s.me ? 'You' : shortName(s.id)}
            />
          ))}
        </div>
        <div className={styles['racecap']}>
          <b className={styles['rank']}>#{race.rank}</b> OF {race.total} ·{' '}
          <b>{formatUnits(race.points)}</b> PTS
          {race.behind !== null && race.behind > 0 && <> · {formatUnits(race.behind)} BEHIND</>}
        </div>
      </div>
      <div
        className={styles['res']}
        title="Credits are global. Goods are the totals sitting in your district warehouses."
      >
        <Chip icon="$" label="CR" value={formatUnits(toUnits(view.self.credits))} />
        {!compact && (
          <>
            <Chip icon="P" label="PARTS" value={formatUnits(goods.parts)} faction="turtle" />
            <Chip icon="W" label="POWER" value={formatUnits(goods.power)} faction="merchant" />
            <Chip icon="D" label="DATA" value={formatUnits(goods.data)} faction="raider" />
            <Chip icon="S" label="SUPPLIES" value={formatUnits(goods.supplies)} faction="hunter" />
          </>
        )}
      </div>
      <Button
        variant={alerts > 0 ? 'danger' : 'ghost'}
        className={styles['alerts']}
        onClick={onAlerts}
        aria-label={`Alerts: ${String(alerts)}`}
      >
        ! ALERTS {alerts > 0 ? alerts : ''}
      </Button>
      <Chip value={clock.hhmm} label="CLOCK" />
      {!compact && (
        <span
          className={cx(styles['link'], styles[link])}
          title={link === 'live' ? 'Live updates' : link === 'polling' ? 'Polling' : 'Offline'}
        >
          {link === 'live' ? 'LIVE' : link === 'polling' ? 'POLL' : 'OFFLINE'}
        </span>
      )}
      <Button className={styles['user']} onClick={onLogout} title="Log out">
        {username}
      </Button>
    </header>
  );
}
