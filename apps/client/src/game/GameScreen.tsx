import { useEffect, useState } from 'react';
import type { GoodName } from '@nexum/contracts';
import type { PlayerView as SimView } from '@nexum/sim';
import { Tabs } from '../ui';
import { MapScreen } from '../map/MapScreen';
import { BattleReport } from './BattleReport';
import { buildDossier } from './rivalDossier';
import { buildReport } from './report';
import { Dossier } from './Dossier';
import { MarketPanel } from './MarketPanel';
import { DistrictPanel } from './DistrictPanel';
import { FeedPanel } from './FeedPanel';
import styles from './GameScreen.module.css';
import { OrderCard } from './OrderCard';
import { useCompact, useSession, useWallClock } from './sessionContext';
import { gameNow, useGame, useStore } from './store';
import { Timeline } from './Timeline';
import { TopBar } from './TopBar';
import { finaleClock, isOwn } from './derive';
import { SeasonEnd } from './SeasonEnd';

type Drawer = 'map' | 'feed' | 'orders' | 'district';

/** The playing field: top bar, feed, map, district panel and an empty slot for the timeline. */
export function GameScreen() {
  const session = useSession();
  const store = useStore();
  const state = useGame((s) => s);
  const wall = useWallClock();
  const compact = useCompact();
  const [chosenDrawer, setDrawer] = useState<Drawer>('map');
  const [route, setRoute] = useState<readonly string[] | null>(null);
  const [panel, setPanel] = useState<
    | { kind: 'market'; hub: string; good?: GoodName }
    | { kind: 'report'; seq: number }
    | { kind: 'dossier'; playerId: string }
    | null
  >(null);
  const [endSeen, setEndSeen] = useState<number | null>(null);
  const { view, account } = state;

  useEffect(() => {
    const on = () => {
      session.markSeen();
    };
    window.addEventListener('pagehide', on);
    return () => {
      window.removeEventListener('pagehide', on);
    };
  }, [session]);

  if (!view || !account) return null;
  const nowMs = gameNow(state, wall);
  const alerts = Object.values(view.districts).filter((d) => isOwn(d) && d.siege !== null).length;
  const select = (id: string | null) => {
    store.dispatch({ type: 'select', id });
    if (id !== null && compact) setDrawer('district');
  };
  const fly = (id: string) => {
    store.dispatch({ type: 'fly', id });
    setDrawer('map');
  };

  /** The first hub you can see: the resource chips open its market. */
  const firstHub = Object.values(view.districts).find((d) => d.relation === 'hub')?.id;
  const openMarket = (hub: string, good?: GoodName) => {
    setPanel({ kind: 'market', hub, ...(good ? { good } : {}) });
  };
  const closePanel = () => {
    setPanel(null);
  };
  const report =
    panel?.kind === 'report' ? buildReport(state.feed, view, panel.seq, state.names) : null;
  /** Panels render over the map, so on a phone they pull the map tab to the front. */
  const drawer: Drawer = panel && compact ? 'map' : chosenDrawer;

  const feed = (
    <FeedPanel
      view={view}
      feed={state.feed}
      names={state.names}
      lastSeenMs={state.lastSeenMs}
      nowMs={nowMs}
      onFly={fly}
      onReport={(seq) => {
        setPanel({ kind: 'report', seq });
      }}
    />
  );
  const side = (
    <DistrictPanel
      view={view}
      names={state.names}
      districtId={state.selected}
      nowMs={nowMs}
      onStance={(districtId, stance) => {
        void session.placeOrder({ type: 'stance', districtId, stance });
      }}
      onBuild={(districtId) => {
        session.openDraft({ kind: 'build', districtId });
      }}
      onFly={fly}
      onMarket={(hub) => {
        openMarket(hub);
      }}
      onRival={(playerId) => {
        setPanel({ kind: 'dossier', playerId });
      }}
    />
  );

  return (
    <div className={styles['game']} data-compact={compact}>
      <TopBar
        view={view}
        names={state.names}
        nowMs={nowMs}
        username={account.username}
        alerts={alerts}
        link={state.link}
        compact={compact}
        onAlerts={() => {
          const hit = Object.values(view.districts).find((d) => isOwn(d) && d.siege !== null);
          if (hit) fly(hit.id);
        }}
        onMarket={
          firstHub
            ? (good) => {
                openMarket(
                  state.selected && view.districts[state.selected]?.relation === 'hub'
                    ? state.selected
                    : firstHub,
                  good,
                );
              }
            : undefined
        }
        onLogout={() => {
          void session.logout();
        }}
      />
      {(!compact || drawer === 'feed') && <div className={styles['feed']}>{feed}</div>}
      <div className={styles['map']} hidden={compact && drawer !== 'map'}>
        <MapScreen
          embed={{
            // The wire view and the sim view differ only in optional-property typing.
            view: view as unknown as SimView,
            selected: state.selected,
            onSelect: select,
            flyTo: state.flyTo,
            onOrder: (kind, districtId) => {
              session.openDraft({ kind, districtId });
            },
            route,
          }}
        />
        {finaleClock(view, nowMs).phase === 'over' && endSeen !== view.season.endMs && (
          <div className={styles['modal']}>
            <SeasonEnd
              view={view}
              names={state.names}
              onClose={() => {
                setEndSeen(view.season.endMs);
              }}
            />
          </div>
        )}
        {panel && !state.draft && (
          <div className={styles['modal']}>
            {panel.kind === 'market' && (
              <MarketPanel
                view={view}
                feed={state.feed}
                hub={panel.hub}
                good={panel.good}
                onPlace={(order) => session.placeOrder(order)}
                onCancel={(orderId) => {
                  void session.placeOrder({ type: 'market.cancel', orderId });
                }}
                onClose={closePanel}
              />
            )}
            {report && (
              <BattleReport
                report={report}
                names={state.names}
                me={view.playerId}
                nowMs={nowMs}
                onRival={(playerId) => {
                  setPanel({ kind: 'dossier', playerId });
                }}
                onFly={(id) => {
                  closePanel();
                  fly(id);
                }}
                onClose={closePanel}
              />
            )}
            {panel.kind === 'dossier' && (
              <Dossier
                dossier={buildDossier(view, state.feed, panel.playerId, 8, state.names)}
                nowMs={nowMs}
                onFly={(id) => {
                  closePanel();
                  fly(id);
                }}
                onClose={closePanel}
              />
            )}
          </div>
        )}
        {state.draft && (
          <div className={styles['modal']}>
            <OrderCard
              view={view}
              draft={state.draft}
              nowMs={nowMs}
              onRoute={setRoute}
              onClose={() => {
                session.openDraft(null);
                setRoute(null);
              }}
              onConfirm={async (order) => {
                const ok = await session.placeOrder(order);
                if (ok) {
                  session.openDraft(null);
                  setRoute(null);
                }
                return ok;
              }}
            />
          </div>
        )}
      </div>
      {(!compact || drawer === 'district') && <div className={styles['side']}>{side}</div>}
      <div className={styles['timeline']} hidden={compact && drawer !== 'orders'}>
        <Timeline
          view={view}
          feed={state.feed}
          nowMs={nowMs}
          onFly={fly}
          onRecall={(movementId) => {
            void session.placeOrder({ type: 'recall', movementId });
          }}
        />
      </div>
      {compact && (
        <Tabs
          className={styles['tabs']}
          label="Screen"
          value={drawer}
          onChange={(id) => {
            setDrawer(id === 'feed' || id === 'orders' || id === 'district' ? id : 'map');
          }}
          tabs={[
            { id: 'feed', label: 'FEED' },
            { id: 'map', label: 'MAP' },
            { id: 'orders', label: 'ORDERS' },
            { id: 'district', label: 'DISTRICT' },
          ]}
        />
      )}
    </div>
  );
}
