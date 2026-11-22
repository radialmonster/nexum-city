import type { GoodName, MarketHistoryResponse, PlayerView } from '@nexum/contracts';
import { useEffect, useState } from 'react';
import { Sparkline } from '../ui';
import { GOOD_TONE } from './DistrictPanel';
import {
  bestHauls,
  hubPrice,
  shortageAt,
  signedCredits,
  timeLeft,
  trendPoints,
  whyLine,
} from './economy';
import { credits } from './market';
import styles from './PriceBoard.module.css';

const VISIT_KEY = 'nexum.market.lastVisit';

/** When you last looked at the price board (game ms), or null the first time. Storage may be blocked. */
function readVisit(): number | null {
  try {
    const raw = window.localStorage.getItem(VISIT_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeVisit(ms: number): void {
  try {
    window.localStorage.setItem(VISIT_KEY, String(ms));
  } catch {
    // Private windows can refuse storage; the marker is only a convenience.
  }
}

export interface PriceBoardProps {
  readonly view: PlayerView;
  readonly good: GoodName;
  readonly hub: string;
  /** Loads the hourly price history of one good at one hub. */
  readonly loadHistory?:
    ((hub: string, good: GoodName) => Promise<MarketHistoryResponse>) | undefined;
  /** Opens the market of a hub. */
  readonly onOpenHub?: ((hub: string) => void) | undefined;
}

/** One hub's trend line, loaded when the board opens. */
function Trend({
  view,
  hub,
  good,
  loadHistory,
  lastVisit,
}: {
  view: PlayerView;
  hub: string;
  good: GoodName;
  loadHistory: NonNullable<PriceBoardProps['loadHistory']>;
  lastVisit: number | null;
}) {
  const [data, setData] = useState<MarketHistoryResponse | null>(null);
  useEffect(() => {
    let live = true;
    loadHistory(hub, good).then(
      (h) => {
        if (live) setData(h);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [hub, good, loadHistory]);
  const trend = data ? trendPoints(data, lastVisit) : null;
  if (!trend || trend.points.length < 2)
    return <small className={styles['quiet']}>No trend yet</small>;
  return (
    <Sparkline
      points={trend.points}
      tone={GOOD_TONE[good]}
      markAt={trend.markAt}
      label={`${good} price trend at ${view.districts[hub]?.name ?? hub}`}
    />
  );
}

/** Every hub's price for one good with its plain reason, plus the best hauls between hubs. */
export function PriceBoard({ view, good, hub, loadHistory, onOpenHub }: PriceBoardProps) {
  const [lastVisit] = useState(readVisit);
  const nowMs = view.nowMs;
  useEffect(() => {
    writeVisit(nowMs);
    // only the moment you opened the board counts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const nameOf = (id: string) => view.districts[id]?.name ?? id;
  const hubs = view.graph.hubs.filter((h) => hubPrice(view, h, good) !== null);
  const hauls = bestHauls(view);
  return (
    <div className={styles['board']}>
      <ul className={styles['hubs']} aria-label={`${good} prices by hub`}>
        {hubs.map((h) => {
          const short = shortageAt(view, h, good);
          return (
            <li key={h} className={styles['hub']} data-here={h === hub} data-short={short !== null}>
              <b className={styles['name']}>{nameOf(h)}</b>
              <b className={styles['price']}>{credits(hubPrice(view, h, good) ?? 0)}</b>
              {loadHistory ? (
                <Trend
                  key={`${h}-${good}`}
                  view={view}
                  hub={h}
                  good={good}
                  loadHistory={loadHistory}
                  lastVisit={lastVisit}
                />
              ) : (
                <span />
              )}
              <span className={styles['why']} data-testid="why">
                {whyLine(view, h, good, nameOf)}
              </span>
              {onOpenHub && h !== hub && (
                <button
                  type="button"
                  className={styles['open']}
                  onClick={() => {
                    onOpenHub(h);
                  }}
                >
                  OPEN
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div>
        <span className={styles['cap']}>BEST HAUL FOR EACH GOOD (GAIN PER UNIT AFTER FUEL)</span>
        {hauls.length === 0 ? (
          <p className={styles['quiet']}>No hub pair pays for the fuel right now.</p>
        ) : (
          <ul className={styles['hauls']} aria-label="Best hauls">
            {hauls.map((h) => (
              <li key={h.good} data-testid="best-haul">
                <b>{h.good.toUpperCase()}</b>
                <span>
                  Buy at {nameOf(h.from)}, sell at {nameOf(h.to)}
                </span>
                <b className={styles['gain']}>{signedCredits(h.gainCents)} each</b>
              </li>
            ))}
          </ul>
        )}
      </div>
      {view.shortages.length > 0 && (
        <p className={styles['quiet']}>
          {view.shortages
            .map(
              (s) => `${nameOf(s.hub)}: short of ${s.good}, ${timeLeft(s.endMs - view.nowMs)} left`,
            )
            .join('. ')}
          .
        </p>
      )}
    </div>
  );
}
