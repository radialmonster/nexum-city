import type { GoodName, PlayerView } from '@nexum/contracts';
import { toUnits } from '@nexum/sim';
import { Button, Chip } from '../ui';
import { cx, factionColor, vars, type Faction } from '../ui/util';
import type { CrewNames } from './derive';
import { crewName, finaleClock, raceOf, seasonClock, warehouseTotals } from './derive';
import { formatUnits } from './feed';
import styles from './TopBar.module.css';

export interface TopBarProps {
  readonly view: PlayerView;
  readonly nowMs: number;
  readonly names?: CrewNames | undefined;
  readonly username: string;
  /** How many events need attention (sieges against you). */
  readonly alerts: number;
  readonly link: 'off' | 'live' | 'polling';
  readonly onAlerts: () => void;
  readonly onLogout: () => void;
  /** Opens the market for a good; the chips become buttons when set. */
  readonly onMarket?: ((good: GoodName) => void) | undefined;
  /** Narrow screens: the bar shows only the logo, the race, credits, alerts and the clock. */
  readonly compact?: boolean;
}

/** Rival segments cycle through these so each player reads as a distinct colour. */
const SEGMENT_ROLES: readonly Faction[] = ['merchant', 'raider', 'turtle', 'rival', 'hunter'];

/** The clock chip: the season day with the time of day, e.g. "D3 23:46". */
export const clockText = (c: { day: number; hhmm: string }): string =>
  `D${String(c.day)} ${c.hhmm}`;

/** The top bar: logo, season, race bar, resource chips, alerts, clock. */
export function TopBar({
  view,
  nowMs,
  names = {},
  username,
  alerts,
  link,
  onAlerts,
  onLogout,
  onMarket,
  compact = false,
}: TopBarProps) {
  const race = raceOf(view);
  const clock = seasonClock(view, nowMs);
  const finale = finaleClock(view, nowMs);
  const goods = warehouseTotals(view);
  const sorted = [...race.shares].sort((a, b) => b.share - a.share);
  return (
    <header className={styles['top']} data-compact={compact}>
      <div className={styles['logo']}>
        NEXUM<span>//</span>CITY
      </div>
      {finale.phase === 'running' ? (
        !compact && (
          <Chip
            label="SEASON"
            value={`DAY ${String(clock.day).padStart(2, '0')}/${String(clock.days)}`}
            className={styles['season']}
          />
        )
      ) : (
        <Chip
          label={finale.phase === 'finale' ? 'FINALE ENDS IN' : 'SEASON'}
          value={finale.phase === 'finale' ? finale.text : 'ENDED'}
          className={cx(styles['season'], styles['finale'])}
        />
      )}
      <div
        className={styles['race']}
        title="Share of the season score. Each segment is a player; yours is bright."
      >
        <div className={styles['racebar']} role="img" aria-label="Season race">
          {sorted.map((s, i) => (
            <i
              key={s.id}
              className={cx(s.me && styles['me'])}
              style={vars({
                '--k': factionColor(
                  s.me ? 'self' : (SEGMENT_ROLES[i % SEGMENT_ROLES.length] ?? 'rival'),
                ),
                '--share': Math.max(s.share, 0.01),
              })}
              title={s.me ? 'You' : crewName(names, s.id)}
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
            {(
              [
                ['parts', 'P', 'PARTS', 'turtle'],
                ['power', 'W', 'POWER', 'merchant'],
                ['data', 'D', 'DATA', 'raider'],
                ['supplies', 'S', 'SUPPLIES', 'hunter'],
              ] as const
            ).map(([good, icon, label, faction]) => {
              const chip = (
                <Chip
                  icon={icon}
                  label={label}
                  value={formatUnits(goods[good])}
                  faction={faction}
                />
              );
              return onMarket ? (
                <button
                  key={good}
                  type="button"
                  className={styles['chip-button']}
                  title={`Open the ${good} market`}
                  onClick={() => {
                    onMarket(good);
                  }}
                >
                  {chip}
                </button>
              ) : (
                <span key={good}>{chip}</span>
              );
            })}
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
      <Chip value={clockText(clock)} label="CLOCK" />
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
