import type { OrderBody, PlayerView } from '@nexum/contracts';
import { balance, buildCost, buildDurationMs, eta, toUnits, type CarrierKind } from '@nexum/sim';
import { useEffect, useMemo, useState } from 'react';
import { Bar, Button, Panel } from '../ui';
import {
  carriersAt,
  crewsAt,
  formatEta,
  formatHours,
  GOOD_KEYS,
  isOwn,
  readyNodes,
  seatsFor,
} from './derive';
import { formatUnits } from './feed';
import { siegeOdds } from './odds';
import type { OrderDraft } from './store';
import styles from './OrderCard.module.css';

const TITLES: Record<OrderDraft['kind'], string> = {
  move: 'Move crews',
  haul: 'Haul goods',
  siege: 'Start a siege',
  reinforce: 'Reinforce',
  scout: 'Send a scout',
  build: 'Build',
};

const CONFIRM: Record<OrderDraft['kind'], string> = {
  move: 'MOVE',
  haul: 'HAUL',
  siege: 'LAY SIEGE',
  reinforce: 'REINFORCE',
  scout: 'SCOUT',
  build: 'BUILD',
};

/** What the player has picked in the card. */
export interface Pick {
  readonly from: string | null;
  readonly crewIds: readonly string[];
  /** A carrier id, or null to go on foot. */
  readonly carrierId: string | null;
  readonly cargo: Readonly<Record<string, number>>;
  readonly building: 'workshop' | 'depot' | 'walls';
}

/** Turns a draft and the picks into the order the server takes, or null while it is incomplete. */
export function buildOrder(draft: OrderDraft, pick: Pick): OrderBody | null {
  switch (draft.kind) {
    case 'build':
      return { type: 'build', districtId: draft.districtId, building: pick.building };
    case 'scout': {
      const crewId = pick.crewIds[0];
      return crewId
        ? { type: 'scout', crewId, carrierId: pick.carrierId, target: draft.districtId }
        : null;
    }
    case 'siege':
      return pick.crewIds.length > 0
        ? {
            type: 'siege',
            carrierId: pick.carrierId,
            crewIds: [...pick.crewIds],
            target: draft.districtId,
          }
        : null;
    case 'move':
    case 'reinforce':
      return pick.crewIds.length > 0
        ? {
            type: draft.kind,
            carrierId: pick.carrierId,
            crewIds: [...pick.crewIds],
            to: draft.districtId,
          }
        : null;
    case 'haul': {
      const cargo: Record<string, number> = {};
      for (const g of GOOD_KEYS) {
        const n = Math.floor(pick.cargo[g] ?? 0);
        if (n > 0) cargo[g] = n;
      }
      return pick.crewIds.length > 0 && Object.keys(cargo).length > 0
        ? {
            type: 'haul',
            carrierId: pick.carrierId,
            crewIds: [...pick.crewIds],
            to: draft.districtId,
            cargo,
          }
        : null;
    }
  }
}

export interface OrderCardProps {
  readonly view: PlayerView;
  readonly draft: OrderDraft;
  readonly nowMs: number;
  readonly onConfirm: (order: OrderBody) => Promise<boolean>;
  readonly onClose: () => void;
  /** The route to draw on the map while the card is open. */
  readonly onRoute: (route: readonly string[] | null) => void;
}

export function carrierKindOf(view: PlayerView, id: string | null): CarrierKind | 'foot' {
  return id === null ? 'foot' : (view.carriers[id]?.kind ?? 'foot');
}

/** The confirm card for an order opened from the map's radial menu. */
export function OrderCard({ view, draft, nowMs, onConfirm, onClose, onRoute }: OrderCardProps) {
  const target = view.districts[draft.districtId];
  const nodes = useMemo(
    () =>
      draft.kind === 'build' ? [] : readyNodes(view, nowMs).filter((n) => n !== draft.districtId),
    [view, nowMs, draft],
  );
  const [from, setFrom] = useState<string | null>(nodes[0] ?? null);
  const [picked, setPicked] = useState<readonly string[] | null>(null);
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [cargo, setCargo] = useState<Record<string, number>>({});
  const [building, setBuilding] = useState<Pick['building']>('workshop');
  const [busy, setBusy] = useState(false);

  const source = from && nodes.includes(from) ? from : (nodes[0] ?? null);
  const crews = source ? crewsAt(view, source).filter((c) => c.readyAtMs <= nowMs) : [];
  const carriers = source
    ? carriersAt(view, source).filter((c) => !balance.carriers[c.kind].locked)
    : [];
  // Until the player picks, the first ready crew is chosen so a new player can confirm at once.
  const crewIds = picked ?? crews.slice(0, 1).map((c) => c.id);
  const chosenCrews = crews.filter((c) => crewIds.includes(c.id));
  const kind = carrierKindOf(view, carrierId);
  const seats = seatsFor(kind);
  const maxCrews = draft.kind === 'scout' ? 1 : seats;
  const tooMany = chosenCrews.length > maxCrews;

  const route = useMemo(() => {
    if (!source || draft.kind === 'build') return null;
    return eta(view.graph, source, draft.districtId, kind === 'foot' ? 'foot' : kind);
  }, [view.graph, source, draft, kind]);

  useEffect(() => {
    onRoute(route ? route.route : null);
    return () => {
      onRoute(null);
    };
  }, [route, onRoute]);

  const pick: Pick = { from: source, crewIds, carrierId, cargo, building };
  const order = buildOrder(draft, pick);

  const own = target && isOwn(target) ? target : null;
  const sourceDistrict = source ? view.districts[source] : undefined;
  const stock = sourceDistrict && isOwn(sourceDistrict) ? sourceDistrict.warehouse : null;
  const carry = balance.carriers[kind].cargo;
  const cargoTotal = GOOD_KEYS.reduce((n, g) => n + Math.floor(cargo[g] ?? 0), 0);

  let blocker: string | null = null;
  if (draft.kind === 'build') {
    const level = (own?.buildings.find((b) => b.type === building)?.level ?? 0) + 1;
    const cost = buildCost(building, level);
    if (!own) blocker = 'You can only build in your own districts.';
    else if (level > balance.buildings.maxLevel) blocker = 'That building is at its top level.';
    else if (own.construction) blocker = 'Something is already being built here.';
    else if (own.buildings.length >= own.slots && !own.buildings.some((b) => b.type === building))
      blocker = 'No free slot. Upgrade a building you have.';
    else if (GOOD_KEYS.some((g) => own.warehouse[g] < cost[g])) {
      const short = GOOD_KEYS.filter((g) => own.warehouse[g] < cost[g]).map(
        (g) => `${String(Math.ceil(cost[g] - own.warehouse[g]))} ${g}`,
      );
      blocker = `This warehouse is short ${short.join(' and ')}. Buy it at a hub market or haul it in.`;
    }
  } else if (nodes.length === 0) {
    blocker = 'No crew is ready to go. Crews rest for a while after an order.';
  } else if (chosenCrews.length === 0) {
    blocker = 'Pick at least one crew.';
  } else if (tooMany) {
    blocker = `That carrier seats ${String(seats)}. Pick fewer crews or a bigger carrier.`;
  } else if (!route) {
    blocker = 'There is no street route there.';
  } else if (draft.kind === 'haul') {
    if (cargoTotal === 0) blocker = 'Choose something to carry.';
    else if (cargoTotal > carry) blocker = `This carrier holds ${String(carry)} units.`;
    else if (stock && GOOD_KEYS.some((g) => toUnits(stock[g]) < (cargo[g] ?? 0)))
      blocker = 'The source warehouse does not hold that much.';
  }

  const odds = (() => {
    if (draft.kind !== 'siege' || !target || target.relation === 'remembered') return null;
    const defenderCount =
      target.relation === 'visible' || target.relation === 'hub'
        ? Object.values(target.presence).reduce((n, v) => n + v, 0)
        : 0;
    const owner = 'owner' in target ? target.owner : '';
    const leader = view.standings.find((s) => s.rank === 1)?.playerId === owner;
    return siegeOdds({ attackers: chosenCrews.map((c) => c.strength), defenderCount, leader });
  })();

  const toggle = (id: string) => {
    setPicked(crewIds.includes(id) ? crewIds.filter((x) => x !== id) : [...crewIds, id]);
  };

  const confirm = async () => {
    if (!order || blocker) return;
    setBusy(true);
    try {
      if (await onConfirm(order)) onClose();
    } finally {
      setBusy(false);
    }
  };

  const level = (own?.buildings.find((b) => b.type === building)?.level ?? 0) + 1;
  const cost = buildCost(building, level);

  return (
    <Panel
      title={TITLES[draft.kind]}
      tag={(target?.name ?? draft.districtId).toUpperCase()}
      className={styles['card']}
    >
      <div className={styles['stack']}>
        {draft.kind === 'build' ? (
          <>
            <fieldset className={styles['field']}>
              <legend>BUILDING</legend>
              {(['workshop', 'depot', 'walls'] as const).map((b) => (
                <label key={b} className={styles['opt']}>
                  <input
                    type="radio"
                    name="building"
                    checked={building === b}
                    onChange={() => {
                      setBuilding(b);
                    }}
                  />
                  <span>{b.toUpperCase()}</span>
                  <small>{BUILDING_HELP[b]}</small>
                </label>
              ))}
            </fieldset>
            <p className={styles['line']}>
              Level {level} costs{' '}
              {GOOD_KEYS.filter((g) => cost[g] > 0)
                .map((g) => `${formatUnits(toUnits(cost[g]))} ${g}`)
                .join(', ')}{' '}
              from this warehouse, and takes {formatEta(buildDurationMs(building, level))}.
            </p>
          </>
        ) : (
          <>
            {nodes.length > 1 && (
              <label className={styles['field']}>
                <span className={styles['cap']}>FROM</span>
                <select
                  value={source ?? ''}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setCarrierId(null);
                  }}
                >
                  {nodes.map((n) => (
                    <option key={n} value={n}>
                      {view.districts[n]?.name ?? n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {source && nodes.length === 1 && (
              <p className={styles['line']}>From {view.districts[source]?.name ?? source}.</p>
            )}
            <fieldset className={styles['field']}>
              <legend>CREWS</legend>
              {crews.length === 0 && <small>No crews ready here.</small>}
              {crews.map((c) => (
                <label key={c.id} className={styles['opt']}>
                  <input
                    type="checkbox"
                    checked={crewIds.includes(c.id)}
                    onChange={() => {
                      toggle(c.id);
                    }}
                  />
                  <span>{c.id}</span>
                  <small>strength {c.strength}</small>
                </label>
              ))}
            </fieldset>
            <label className={styles['field']}>
              <span className={styles['cap']}>CARRIER</span>
              <select
                value={carrierId ?? ''}
                onChange={(e) => {
                  setCarrierId(e.target.value === '' ? null : e.target.value);
                }}
              >
                <option value="">On foot (1 seat)</option>
                {carriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.kind} {c.id} ({seatsFor(c.kind)} seats)
                  </option>
                ))}
              </select>
            </label>
            {draft.kind === 'haul' && (
              <fieldset className={styles['field']}>
                <legend>
                  CARGO ({cargoTotal}/{carry})
                </legend>
                <div className={styles['cargo']}>
                  {GOOD_KEYS.map((g) => (
                    <label key={g}>
                      <span>{g.toUpperCase()}</span>
                      <input
                        type="number"
                        min={0}
                        max={carry}
                        value={cargo[g] ?? 0}
                        onChange={(e) => {
                          setCargo({
                            ...cargo,
                            [g]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                          });
                        }}
                      />
                      {stock && <small>of {formatUnits(toUnits(stock[g]))}</small>}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <p className={styles['line']} data-testid="eta">
              {route
                ? `ETA ${formatEta(route.durationMs)} over ${String(Math.round(route.lengthM))} m`
                : 'No route'}
            </p>
            {odds && (
              <div className={styles['field']}>
                <span className={styles['cap']}>
                  ODDS {odds.estimated ? '(ESTIMATE: THE ENEMY IS HIDDEN BY FOG)' : ''}
                </span>
                <Bar value={odds.edge} faction="raider" label="Attacker edge" />
                <span className={styles['line']}>
                  {Math.round(odds.edge * 100)}% edge. About {formatHours(odds.hoursToCapture)} to
                  capture if it holds.
                </span>
              </div>
            )}
          </>
        )}
        {blocker && (
          <p className={styles['blocker']} role="alert">
            {blocker}
          </p>
        )}
        <div className={styles['actions']}>
          <Button onClick={onClose}>CANCEL</Button>
          <Button
            variant={draft.kind === 'siege' ? 'danger' : 'primary'}
            disabled={busy || order === null || blocker !== null}
            onClick={() => {
              void confirm();
            }}
          >
            {CONFIRM[draft.kind]}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

const BUILDING_HELP: Record<Pick['building'], string> = {
  workshop: `+${String(balance.production.workshopBonusPercent)}% output per level`,
  depot: `+${String(balance.warehouse.depotBonusPerLevel)} storage per level`,
  walls: `+${String(balance.siege.wallsPercentPerLevel)}% defence per level`,
};
