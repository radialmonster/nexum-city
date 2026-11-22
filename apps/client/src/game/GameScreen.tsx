import { useEffect, useState } from 'react';
import type { PlayerView as SimView } from '@nexum/sim';
import { Tabs } from '../ui';
import { MapScreen } from '../map/MapScreen';
import { DistrictPanel } from './DistrictPanel';
import { FeedPanel } from './FeedPanel';
import styles from './GameScreen.module.css';
import { OrderCard } from './OrderCard';
import { useCompact, useSession, useWallClock } from './sessionContext';
import { gameNow, useGame, useStore } from './store';
import { TopBar } from './TopBar';
import { isOwn } from './derive';

type Drawer = 'map' | 'feed' | 'district';

/** The playing field: top bar, feed, map, district panel and an empty slot for the timeline. */
export function GameScreen() {
  const session = useSession();
  const store = useStore();
  const state = useGame((s) => s);
  const wall = useWallClock();
  const compact = useCompact();
  const [drawer, setDrawer] = useState<Drawer>('map');
  const [route, setRoute] = useState<readonly string[] | null>(null);
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

  const feed = (
    <FeedPanel
      view={view}
      feed={state.feed}
      lastSeenMs={state.lastSeenMs}
      nowMs={nowMs}
      onFly={fly}
    />
  );
  const side = (
    <DistrictPanel
      view={view}
      districtId={state.selected}
      nowMs={nowMs}
      onStance={(districtId, stance) => {
        void session.placeOrder({ type: 'stance', districtId, stance });
      }}
      onBuild={(districtId) => {
        session.openDraft({ kind: 'build', districtId });
      }}
      onFly={fly}
    />
  );

  return (
    <div className={styles['game']} data-compact={compact}>
      <TopBar
        view={view}
        nowMs={nowMs}
        username={account.username}
        alerts={alerts}
        link={state.link}
        compact={compact}
        onAlerts={() => {
          const hit = Object.values(view.districts).find((d) => isOwn(d) && d.siege !== null);
          if (hit) fly(hit.id);
        }}
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
      <div className={styles['timeline']} aria-hidden="true" />
      {compact && (
        <Tabs
          className={styles['tabs']}
          label="Screen"
          value={drawer}
          onChange={(id) => {
            setDrawer(id === 'feed' || id === 'district' ? id : 'map');
          }}
          tabs={[
            { id: 'feed', label: 'FEED' },
            { id: 'map', label: 'MAP' },
            { id: 'district', label: 'DISTRICT' },
          ]}
        />
      )}
    </div>
  );
}
