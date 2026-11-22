import { useEffect, useMemo, useState } from 'react';
import type { ContractView, GoodName } from '@nexum/contracts';
import { remainingUnits } from './contracts';
import type { PlayerView as SimView } from '@nexum/sim';
import { Tabs } from '../ui';
import { MapScreen } from '../map/MapScreen';
import { BattleReport } from './BattleReport';
import { buildDossier } from './rivalDossier';
import { buildReport } from './report';
import { buildRaidReport } from './raidReport';
import { RaidReport } from './RaidReportCard';
import { goodsText } from './feed';
import { Dossier } from './Dossier';
import { MarketPanel } from './MarketPanel';
import { DistrictPanel } from './DistrictPanel';
import { FeedPanel } from './FeedPanel';
import styles from './GameScreen.module.css';
import { OrderCard } from './OrderCard';
import { useCompact, useSession, useWallClock } from './sessionContext';
import { gameNow, useGame, useStore } from './store';
import { Timeline } from './Timeline';
import { RushBanner } from './RushBanner';
import { TopBar } from './TopBar';
import type { JobOffer } from './streetJobs';
import { finaleClock, isOwn, ownDistricts, readyNodes } from './derive';
import { SeasonEnd } from './SeasonEnd';
import { FirstSteps } from './FirstSteps';
import { loadFirstSteps, saveFirstSteps, type FirstStepsState } from './stepsStore';

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
    | { kind: 'market'; hub: string; good?: GoodName; tab?: 'contracts' }
    | { kind: 'report'; seq: number }
    | { kind: 'dossier'; playerId: string }
    | null
  >(null);
  const [steps, setSteps] = useState<FirstStepsState>(() => loadFirstSteps());
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

  // Any way of landing on your own plot (click, jump list, fly, auto-select) completes step one.
  const selectedIsOwn = !!view && state.selected !== null && isOwn(view.districts[state.selected]);
  const homeDone = steps.selectedHome || selectedIsOwn;
  useEffect(() => {
    if (selectedIsOwn && !steps.selectedHome) saveFirstSteps({ ...steps, selectedHome: true });
  }, [selectedIsOwn, steps]);

  const updateSteps = (patch: Partial<FirstStepsState>) => {
    const next = { ...steps, selectedHome: homeDone, ...patch };
    setSteps(next);
    saveFirstSteps(next);
  };

  const playerId = view?.playerId;
  // Raid hits that arrive while the screen is open flash on the map; older history does not.
  const [flashFrom] = useState(() => Math.max(0, ...state.feed.map((f) => f.seq)));
  const flashes = useMemo(
    () =>
      state.feed
        .filter(
          (f) =>
            (f.event.kind === 'raid.hit' || f.event.kind === 'raid.evaded') && f.seq > flashFrom,
        )
        .flatMap((f) => {
          const [a, b] = f.event.districts;
          if (!a || !b) return [];
          const mine = f.event.actors[0] === playerId;
          if (f.event.kind === 'raid.evaded') {
            return [
              {
                key: String(f.seq),
                a,
                b,
                text: mine ? 'Runner slipped past' : 'Your Runner slipped past',
                tone: mine ? ('warn' as const) : ('ok' as const),
              },
            ];
          }
          const lost = goodsText(f.event.data, 'stolen') ?? 'nothing';
          return [
            {
              key: String(f.seq),
              a,
              b,
              text: mine ? `Ambush hit: +${lost}` : `Raid hit: -${lost}`,
            },
          ];
        }),
    [state.feed, flashFrom, playerId],
  );
  if (!view || !account) return null;
  const nowMs = gameNow(state, wall);
  const alerts = Object.values(view.districts).filter((d) => isOwn(d) && d.siege !== null).length;
  const select = (id: string | null) => {
    store.dispatch({ type: 'select', id });
  };
  const fly = (id: string) => {
    store.dispatch({ type: 'fly', id });
    setDrawer('map');
  };
  /** From inside the district panel: select and recentre, but stay on the panel (phone drawer). */
  const flyInPanel = (id: string) => {
    store.dispatch({ type: 'fly', id });
  };

  /** The first hub you can see: the resource chips open its market. */
  const firstHub = Object.values(view.districts).find((d) => d.relation === 'hub')?.id;
  const openPlots = Object.values(view.districts).filter((d) => 'open' in d && d.open).length;
  const openMarket = (hub: string, good?: GoodName) => {
    if (!steps.openedMarket) updateSteps({ openedMarket: true });
    setPanel({ kind: 'market', hub, ...(good ? { good } : {}) });
  };
  /** Opens a haul card for a contract you took: its hub, its good, and what is still owed. */
  const deliver = (c: ContractView) => {
    setPanel(null);
    store.dispatch({
      type: 'draft',
      draft: {
        kind: 'haul',
        districtId: c.hub,
        contractId: c.id,
        cargo: { [c.good]: remainingUnits(c) },
      },
    });
  };
  /** Opens the order card for a street job, starting from the selected own plot if it has a ready crew. */
  const takeJob = (job: JobOffer) => {
    const sel = state.selected;
    const from =
      sel && readyNodes(view, nowMs).includes(sel) && isOwn(view.districts[sel])
        ? sel
        : readyNodes(view, nowMs).find((n) => isOwn(view.districts[n]));
    session.openDraft({
      kind: 'job',
      jobId: job.id,
      districtId: from ?? sel ?? Object.values(view.districts).find(isOwn)?.id ?? '',
      ...(from ? { from } : {}),
    });
  };
  const closePanel = () => {
    setPanel(null);
  };
  const report =
    panel?.kind === 'report' ? buildReport(state.feed, view, panel.seq, state.names) : null;
  const raidReport = panel?.kind === 'report' ? buildRaidReport(state.feed, view, panel.seq) : null;
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
      onBuyRunner={(districtId) => {
        void session.placeOrder({ type: 'carrier.buy', districtId, kind: 'runner' });
      }}
      onFly={flyInPanel}
      onMarket={(hub) => {
        openMarket(hub);
      }}
      onDeliver={deliver}
      onTakeJob={takeJob}
      onBoard={(hub) => {
        setPanel({ kind: 'market', hub, tab: 'contracts' });
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
      <RushBanner view={view} nowMs={nowMs} />
      {(!compact || drawer === 'feed') && (
        <div className={styles['feed']}>
          {!steps.dismissed && (
            <div className={styles['steps']}>
              <FirstSteps
                steps={[
                  {
                    id: 'home',
                    label: 'Select your district',
                    hint: 'Click your glowing plot on the map to see its crews and goods.',
                    done: homeDone,
                  },
                  {
                    id: 'settle',
                    label: 'Settle a frontier plot',
                    hint:
                      openPlots > 0
                        ? 'Send a crew to an open plot to claim it. Keep 60 supplies in your home warehouse: settling spends them.'
                        : 'No plot is open yet: the city surveys new ones for about 4 h. Keep 60 supplies in your home warehouse for then: settling spends them.',
                    done: Object.values(view.districts).filter(isOwn).length > 1,
                  },
                  {
                    id: 'market',
                    label: 'Open a hub market',
                    hint: 'Click a hub, or a resource chip at the top, to buy and sell.',
                    done: steps.openedMarket,
                  },
                  {
                    id: 'contract',
                    label: 'Take a contract',
                    hint: Object.values(view.contracts).some(
                      (c) => c.reservedFor === view.playerId && c.taker === null,
                    )
                      ? 'A starter contract is reserved for you: open a hub market, pick CONTRACTS and take the one marked Reserved for you.'
                      : 'Open a hub market, pick the CONTRACTS tab and take a job.',
                    done: Object.values(view.contracts).some((c) => c.taker === view.playerId),
                  },
                ]}
                onDismiss={() => {
                  updateSteps({ dismissed: true });
                }}
              />
            </div>
          )}
          {feed}
        </div>
      )}
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
            flashes,
            // the radial gives way to an order card or any modal (market, report, dossier)
            menuHidden: state.draft !== null || panel !== null,
            // phone: the radial shows on the map; DETAILS opens the district tab
            ...(compact
              ? {
                  onDetails: () => {
                    setDrawer('district');
                  },
                }
              : {}),
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
                tab={panel.tab}
                names={state.names}
                onContract={(order) => session.placeOrder(order)}
                onDeliver={deliver}
                onPlace={(order) => session.placeOrder(order)}
                onCancel={(orderId) => {
                  void session.placeOrder({ type: 'market.cancel', orderId });
                }}
                onClose={closePanel}
                onHaulHome={(hub) => {
                  const home = ownDistricts(view).find((d) => d.kind !== 'hub');
                  if (!home) return;
                  closePanel();
                  store.dispatch({
                    type: 'draft',
                    draft: { kind: 'haul', districtId: home.id, from: hub },
                  });
                }}
              />
            )}
            {raidReport && (
              <RaidReport
                report={raidReport}
                names={state.names}
                me={view.playerId}
                onFly={(id) => {
                  closePanel();
                  fly(id);
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
          compact={compact}
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
