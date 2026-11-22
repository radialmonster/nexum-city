import type { OrderBody, PlayerView } from '@nexum/contracts';
import {
  balance,
  buildCost,
  buildDurationMs,
  toUnits,
  type BuildingType,
  type CarrierKind,
} from '@nexum/sim';
import { useEffect, useMemo, useState } from 'react';
import { Bar, Button, Panel } from '../ui';
import {
  carrierLabel,
  carriersAt,
  crewLabel,
  crewsAt,
  formatEta,
  formatHours,
  GOOD_KEYS,
  isOwn,
  readyNodes,
  rushed,
  seatsFor,
} from './derive';
import { CarrierCompare } from './CarrierCompare';
import { contractSentence, lateWarning } from './contracts';
import { costOf, expectedSale, fuelCheck, nearestHub, powerText, signedCredits } from './economy';
import { credits } from './market';
import { formatUnits } from './feed';
import { messageFor } from './messages';
import { siegeOdds } from './odds';
import { JOB_NAMES, jobDuration, jobMinutes, jobPay, jobRisk, jobSentence } from './streetJobs';
import { compareCarriers, suggestRunner } from './runner';
import { AMBUSH_ROUTE_WARNING, ambushesOnRoute } from './towers';
import { maxLevelFor, slowText, wearInfo, wornRoute } from './wear';
import type { OrderDraft } from './store';
import styles from './OrderCard.module.css';

const TITLES: Record<OrderDraft['kind'], string> = {
  move: 'Move crews',
  haul: 'Haul goods',
  siege: 'Start a siege',
  reinforce: 'Reinforce',
  scout: 'Send a scout',
  build: 'Build',
  settle: 'Settle a plot',
  raid: 'Set an ambush',
  job: 'Take a street job',
};

const CONFIRM: Record<OrderDraft['kind'], string> = {
  move: 'MOVE',
  haul: 'HAUL',
  siege: 'LAY SIEGE',
  reinforce: 'REINFORCE',
  scout: 'SCOUT',
  build: 'BUILD',
  settle: 'SETTLE',
  raid: 'SET AMBUSH',
  job: 'TAKE',
};

/** What the player has picked in the card. */
export interface Pick {
  readonly from: string | null;
  readonly crewIds: readonly string[];
  /** A carrier id, or null to go on foot. */
  readonly carrierId: string | null;
  readonly cargo: Readonly<Record<string, number>>;
  readonly building: BuildingType;
  /** Raid: the street's two ends and how long the crews wait. */
  readonly street?: readonly [string, string] | null;
  readonly hours?: number;
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
    case 'settle':
      return pick.crewIds.length > 0
        ? {
            type: draft.kind,
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
    case 'raid':
      return pick.crewIds.length > 0 && pick.street
        ? {
            type: 'raid',
            carrierId: pick.carrierId,
            crewIds: [...pick.crewIds],
            a: pick.street[0],
            b: pick.street[1],
            hours: pick.hours ?? 4,
          }
        : null;
    case 'job': {
      const crewId = pick.crewIds[0];
      return draft.jobId && crewId
        ? {
            type: 'job.take',
            jobId: draft.jobId,
            crewId,
            ...(pick.carrierId ? { carrierId: pick.carrierId } : {}),
          }
        : null;
    }
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
            ...(draft.contractId ? { contractId: draft.contractId } : {}),
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
  /** Opens the power market at the nearest hub, for a trip that has no fuel. */
  readonly onBuyPower?: ((hub: string) => void) | undefined;
}

export function carrierKindOf(view: PlayerView, id: string | null): CarrierKind | 'foot' {
  return id === null ? 'foot' : (view.carriers[id]?.kind ?? 'foot');
}

/** The confirm card for an order opened from the map's radial menu. */
export function OrderCard({
  view,
  draft,
  nowMs,
  onConfirm,
  onClose,
  onRoute,
  onBuyPower,
}: OrderCardProps) {
  const target = view.districts[draft.districtId];
  const contract = draft.contractId ? view.contracts[draft.contractId] : undefined;
  const job = draft.jobId ? view.self.jobs.find((j) => j.id === draft.jobId) : undefined;
  const nodes = useMemo(
    () =>
      draft.kind === 'build'
        ? []
        : draft.kind === 'job'
          ? // street jobs start from one of your own plots (never a hub)
            readyNodes(view, nowMs).filter((n) => isOwn(view.districts[n]))
          : readyNodes(view, nowMs).filter((n) => draft.kind === 'raid' || n !== draft.districtId),
    [view, nowMs, draft],
  );
  // A contract delivery that fits a Runner and is short on time starts with the Runner picked.
  const suggestion = useMemo(
    () =>
      draft.kind === 'haul'
        ? suggestRunner(
            view,
            draft.contractId,
            nodes.filter((n) => crewsAt(view, n).some((c) => c.readyAtMs <= nowMs)),
            nowMs,
          )
        : null,
    // only the first look matters: the pick is the player's after that
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [from, setFrom] = useState<string | null>(
    suggestion
      ? suggestion.from
      : draft.from && nodes.includes(draft.from)
        ? draft.from
        : (nodes[0] ?? null),
  );
  const [picked, setPicked] = useState<readonly string[] | null>(null);
  const [carrierId, setCarrierId] = useState<string | null>(
    suggestion?.carrierId ??
      // a contract has a deadline and a crew on foot is slow: start from the quickest carrier here
      (draft.kind === 'haul' && draft.contractId && from
        ? (carriersAt(view, from)
            .filter((c) => !balance.carriers[c.kind].locked)
            .sort((x, y) => balance.carriers[y.kind].speed - balance.carriers[x.kind].speed)[0]
            ?.id ?? null)
        : null),
  );
  const [cargo, setCargo] = useState<Record<string, number>>({ ...draft.cargo });
  const [building, setBuilding] = useState<Pick['building']>('workshop');
  const [busy, setBusy] = useState(false);
  const [streetIdx, setStreetIdx] = useState(0);
  const [hours, setHours] = useState(4);

  const source = from && nodes.includes(from) ? from : (nodes[0] ?? null);
  const crews = source ? crewsAt(view, source).filter((c) => c.readyAtMs <= nowMs) : [];
  const carriers = source
    ? carriersAt(view, source).filter((c) => !balance.carriers[c.kind].locked)
    : [];
  // Until the player picks, the first ready crew is chosen so a new player can confirm at once.
  const crewIds = picked ?? crews.slice(0, 1).map((c) => c.id);
  const chosenCrews = crews.filter((c) => crewIds.includes(c.id));
  const kind = carrierKindOf(view, carrierId);
  const carrierWear = wearInfo({ wear: carrierId ? view.carriers[carrierId]?.wear : 0 });
  const seats = seatsFor(kind);
  const maxCrews = draft.kind === 'scout' || draft.kind === 'job' ? 1 : seats;
  const tooMany = chosenCrews.length > maxCrews;

  // Raid: the streets that leave the chosen plot.
  const streets = useMemo(
    () =>
      draft.kind === 'raid'
        ? view.graph.edges
            .filter((e) => e.a === draft.districtId || e.b === draft.districtId)
            .map((e) => ({
              a: e.a,
              b: e.b,
              other: e.a === draft.districtId ? e.b : e.a,
              lengthM: e.lengthM,
            }))
        : [],
    [view.graph, draft],
  );
  const street = streets[Math.min(streetIdx, streets.length - 1)] ?? null;
  const streetA = street?.a ?? null;
  const streetB = street?.b ?? null;
  const streetEnds: readonly [string, string] | null =
    streetA !== null && streetB !== null ? [streetA, streetB] : null;

  const route = useMemo(() => {
    if (!source || draft.kind === 'build' || draft.kind === 'job') return null;
    if (draft.kind === 'raid') {
      // The crews walk to the nearer end of the street (ties: the smaller id), as the sim does.
      if (streetA === null || streetB === null) return null;
      const ends = [streetA, streetB].sort();
      let best: ReturnType<typeof wornRoute> = null;
      for (const end of ends) {
        const leg = wornRoute(view, source, end, kind, carrierWear.wear);
        if (leg && (!best || leg.durationMs < best.durationMs)) best = leg;
      }
      if (!best) return null;
      const near = best.route[best.route.length - 1];
      const far = ends.find((e) => e !== near);
      return { ...best, route: far ? [...best.route, far] : best.route };
    }
    return wornRoute(view, source, draft.districtId, kind, carrierWear.wear);
  }, [view, source, draft, kind, streetA, streetB, carrierWear.wear]);
  const knownAmbush = useMemo(
    () =>
      draft.kind === 'haul' && route ? ambushesOnRoute(view, route.route, nowMs).length > 0 : false,
    [view, draft.kind, route, nowMs],
  );

  useEffect(() => {
    onRoute(route ? route.route : null);
    return () => {
      onRoute(null);
    };
  }, [route, onRoute]);

  const pick: Pick = {
    from: source,
    crewIds,
    carrierId,
    cargo,
    building,
    street: streetEnds,
    hours,
  };
  const order = buildOrder(draft, pick);

  const own = target && isOwn(target) ? target : null;
  const sourceDistrict = source ? view.districts[source] : undefined;
  const stock =
    sourceDistrict && isOwn(sourceDistrict)
      ? sourceDistrict.warehouse
      : sourceDistrict?.relation === 'hub'
        ? (view.self.stash[sourceDistrict.id] ?? null)
        : null;
  const carry = balance.carriers[kind].cargo;
  const cargoTotal = GOOD_KEYS.reduce((n, g) => n + Math.floor(cargo[g] ?? 0), 0);

  const fuel =
    route && source && draft.kind !== 'build' && draft.kind !== 'job'
      ? fuelCheck(view, source, kind, route.lengthM, Math.floor(cargo['power'] ?? 0))
      : null;
  const noFuel = fuel !== null && !fuel.enough;
  const hubDest = view.districts[draft.districtId]?.relation === 'hub' ? draft.districtId : null;
  const sale =
    draft.kind === 'haul' && fuel && hubDest
      ? expectedSale(view, hubDest, cargo, fuel.units)
      : null;
  let blocker: string | null = null;
  if (draft.kind === 'build') {
    const level = (own?.buildings.find((b) => b.type === building)?.level ?? 0) + 1;
    const cost = buildCost(building, level);
    if (!own) blocker = 'You can only build in your own districts.';
    else if (level > maxLevelFor(building)) blocker = 'That building is at its top level.';
    else if (own.construction) blocker = 'Something is already being built here.';
    else if (own.buildings.length >= own.slots && !own.buildings.some((b) => b.type === building))
      blocker = 'No free slot. Upgrade a building you have.';
    else if (GOOD_KEYS.some((g) => own.warehouse[g] < cost[g])) {
      const short = GOOD_KEYS.filter((g) => own.warehouse[g] < cost[g]).map(
        (g) => `${formatUnits(Math.ceil(toUnits(cost[g] - own.warehouse[g])))} ${g}`,
      );
      blocker = `This warehouse is short ${short.join(' and ')}. Buy it at a hub market or haul it in.`;
    }
  } else if (nodes.length === 0) {
    blocker = 'No crew is ready to go. Crews rest for a while after an order.';
  } else if (chosenCrews.length === 0) {
    blocker = 'Pick at least one crew.';
  } else if (tooMany) {
    blocker = `That carrier seats ${String(seats)}. Pick fewer crews or a bigger carrier.`;
  } else if (draft.kind === 'raid' && !street) {
    blocker = 'This plot has no street to wait on.';
  } else if (draft.kind === 'job') {
    if (!job) blocker = 'That job is gone. Pick another from the list.';
    else if (
      job.kind === 'courier' &&
      job.good &&
      stock &&
      toUnits(stock[job.good]) < (job.qty ?? 0)
    )
      blocker = `This warehouse does not hold the ${formatUnits(job.qty ?? 0)} ${job.good} to carry. Pick another plot or another job.`;
  } else if (!route) {
    blocker = 'There is no street route there.';
  } else if (draft.kind === 'settle') {
    const have = stock ? toUnits(stock.supplies) : 0;
    if (have < balance.settle.supplies)
      blocker = `Settling takes ${String(balance.settle.supplies)} supplies from this warehouse, which holds ${formatUnits(have)}. Buy more at a hub market or haul them in.`;
  } else if (draft.kind === 'haul') {
    if (cargoTotal === 0) blocker = 'Choose something to carry.';
    else if (cargoTotal > carry) blocker = `This carrier holds ${String(carry)} units.`;
    else if (contract && GOOD_KEYS.some((g) => g !== contract.good && (cargo[g] ?? 0) > 0))
      blocker = messageFor('wrong_cargo');
    else if (stock && GOOD_KEYS.some((g) => toUnits(stock[g]) < (cargo[g] ?? 0)))
      blocker = 'The source warehouse does not hold that much.';
  }
  if (blocker === null && noFuel) {
    blocker = `This trip burns ${powerText(fuel.units)} power and your warehouses do not hold it. Buy power first, or go on foot.`;
  }

  const fogged = draft.kind === 'siege' && target?.relation === 'remembered';
  const odds = (() => {
    if (draft.kind !== 'siege' || !target || target.relation === 'remembered') return null;
    const defenderCount =
      target.relation === 'visible' || target.relation === 'hub'
        ? Object.values(target.presence).reduce((n, v) => n + v, 0)
        : 0;
    const owner = 'owner' in target ? target.owner : '';
    const leader = view.standings.find((s) => s.rank === 1)?.playerId === owner;
    const neutral = owner === 'neutral' || owner === '';
    return siegeOdds({
      attackers: chosenCrews.map((c) => c.strength),
      defenderCount,
      leader,
      neutral,
    });
  })();

  const cargoCost = (g: (typeof GOOD_KEYS)[number]): number | null =>
    source
      ? costOf(view, sourceDistrict?.relation === 'own' ? 'districts' : 'stash', source, g)
      : null;

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
  const buildRush = rushed(view, nowMs, 600_000) < 600_000;

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
              {BUILD_CHOICES.map((b) => (
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
              from this warehouse, and takes{' '}
              {formatEta(rushed(view, nowMs, buildDurationMs(building, level)))}
              {buildRush ? ' (newcomer rush)' : ''}.
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
            {draft.kind === 'raid' && (
              <label className={styles['field']}>
                <span className={styles['cap']}>STREET</span>
                <select
                  value={Math.min(streetIdx, streets.length - 1)}
                  onChange={(e) => {
                    setStreetIdx(Number(e.target.value));
                  }}
                >
                  {streets.map((st, i) => (
                    <option key={`${st.a}-${st.b}`} value={i}>
                      To {view.districts[st.other]?.name ?? st.other} (
                      {String(Math.round(st.lengthM))} m)
                    </option>
                  ))}
                </select>
              </label>
            )}
            <fieldset className={styles['field']}>
              <legend>{draft.kind === 'haul' ? 'CREWS (EXTRA CREWS ESCORT)' : 'CREWS'}</legend>
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
                  <span>{crewLabel(view, c.id)}</span>
                  <small>strength {c.strength}</small>
                </label>
              ))}
            </fieldset>
            <p className={styles['line']} data-testid="crew-count">
              {chosenCrews.length === 0
                ? 'No crew picked: tick one above.'
                : `${String(chosenCrews.length)} crew picked: ${chosenCrews.map((c) => crewLabel(view, c.id)).join(', ')}.`}
            </p>
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
                    {carrierLabel(view, c.id)} ({seatsFor(c.kind)} seats)
                  </option>
                ))}
              </select>
            </label>
            {draft.kind === 'haul' && source && (
              <CarrierCompare
                options={compareCarriers(view, source, draft.districtId, cargoTotal)}
                chosen={kind}
                suggestion={carrierId === suggestion?.carrierId ? (suggestion?.text ?? null) : null}
              />
            )}
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
                      {cargoCost(g) !== null && (
                        <small data-testid="cargo-cost">
                          your cost {credits(cargoCost(g) ?? 0)}
                        </small>
                      )}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {contract && (
              <p className={styles['line']} data-testid="contract-line">
                For contract: {contractSentence(view, contract)}
              </p>
            )}
            {fuel && fuel.units > 0 && (
              <p className={styles['line']} data-testid="fuel-line">
                Fuel: <b>{powerText(fuel.units)} power</b> from your warehouses.
              </p>
            )}
            {draft.kind === 'haul' && sale && hubDest && (
              <p className={styles['line']} data-testid="sale-line">
                Sell at {view.districts[hubDest]?.name ?? hubDest}: about{' '}
                <b>{signedCredits(sale.netCents)} cr</b> after fuel.
              </p>
            )}
            {draft.kind === 'haul' && (
              <p className={styles['line']} data-testid="escort-hint">
                Escorts make your haul harder to raid.
              </p>
            )}
            {draft.kind === 'raid' && (
              <>
                <div className={styles['field']}>
                  <span className={styles['cap']}>WAIT</span>
                  <div className={styles['stepper']}>
                    <Button
                      aria-label="Wait one hour less"
                      disabled={hours <= 1}
                      onClick={() => {
                        setHours(Math.max(1, hours - 1));
                      }}
                    >
                      -
                    </Button>
                    <span data-testid="raid-hours">{String(hours)} h</span>
                    <Button
                      aria-label="Wait one hour more"
                      disabled={hours >= 8}
                      onClick={() => {
                        setHours(Math.min(8, hours + 1));
                      }}
                    >
                      +
                    </Button>
                  </div>
                </div>
                <p className={styles['line']} data-testid="raid-help">
                  Crews wait between the two plots and strike the first enemy haul that passes.
                  Raiders steal up to 40% of its cargo.
                </p>
              </>
            )}
            {job && (
              <div className={styles['field']} data-testid="job-card">
                <span className={styles['cap']}>{JOB_NAMES[job.kind].toUpperCase()}</span>
                <span className={styles['line']}>{jobSentence(job)}</span>
                <span className={styles['line']}>
                  Pays {jobPay(job)}. Takes{' '}
                  {carrierId ? `${String(jobMinutes(job, true))} min` : jobDuration(job)}.
                </span>
                <span className={styles['line']}>{jobRisk(job)}</span>
              </div>
            )}
            <p className={styles['line']} data-testid="eta">
              {draft.kind === 'job'
                ? 'The crew rests when the errand ends.'
                : route
                  ? draft.kind === 'raid' && route.lengthM < 1
                    ? 'Crews are in place at once.'
                    : `ETA ${formatEta(route.durationMs)} over ${String(Math.round(route.lengthM))} m${slowText(carrierWear.slowPercent) ? ` (${slowText(carrierWear.slowPercent) ?? ''}, worn)` : ''}`
                  : 'No route'}
            </p>
            {draft.kind === 'haul' && contract && route && (
              <LateWarning text={lateWarning(contract, route.durationMs, nowMs)} />
            )}
            {knownAmbush && (
              <p className={styles['warn']} role="alert" data-testid="ambush-warning">
                {AMBUSH_ROUTE_WARNING}
              </p>
            )}
            {draft.kind === 'settle' && (
              <p className={styles['line']} data-testid="settle-cost">
                Costs {balance.settle.supplies} supplies from this warehouse. The plot is yours{' '}
                {formatEta(rushed(view, nowMs, balance.settle.hours * 3_600_000))} after the crew
                arrives, if it holds.
              </p>
            )}
            {fogged && (
              <div className={styles['field']}>
                <span className={styles['cap']}>ODDS</span>
                <span className={styles['line']}>Odds unknown: scout first.</span>
              </div>
            )}
            {odds && (
              <div className={styles['field']}>
                <span className={styles['cap']}>
                  ODDS {odds.estimated ? '(ESTIMATE: THE ENEMY IS HIDDEN BY FOG)' : ''}
                </span>
                {Number.isFinite(odds.hoursToCapture) ? (
                  <>
                    <Bar value={odds.edge} faction="raider" label="Attacker edge" />
                    <span className={styles['line']}>
                      {Math.round(odds.edge * 100)}% edge. About {formatHours(odds.hoursToCapture)}{' '}
                      to capture if it holds.
                    </span>
                  </>
                ) : (
                  <span className={styles['line']}>Pick a crew to see the odds.</span>
                )}
              </div>
            )}
          </>
        )}
        {blocker && (
          <p className={styles['blocker']} role="alert" data-testid="blocker">
            {blocker}
          </p>
        )}
        {noFuel && onBuyPower && source && (
          <div className={styles['actions']}>
            <Button
              variant="primary"
              onClick={() => {
                const hub = nearestHub(view, source);
                if (hub) onBuyPower(hub);
              }}
            >
              BUY POWER
            </Button>
          </div>
        )}
        <div className={styles['actions']}>
          <Button onClick={onClose}>CANCEL</Button>
          <Button
            variant={draft.kind === 'siege' || draft.kind === 'raid' ? 'danger' : 'primary'}
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

function LateWarning({ text }: { readonly text: string | null }) {
  return text ? (
    <p className={styles['warn']} role="alert" data-testid="late-warning">
      {text}
    </p>
  ) : null;
}

/** What a player can build, in the order the card lists it. */
const BUILD_CHOICES = [
  'workshop',
  'depot',
  'walls',
  'watchtower',
  'garage',
] as const satisfies readonly BuildingType[];

const BUILDING_HELP: Record<(typeof BUILD_CHOICES)[number], string> = {
  workshop: `+${String(balance.production.workshopBonusPercent)}% output per level`,
  depot: `+${String(balance.warehouse.depotBonusPerLevel)} storage per level`,
  walls: `+${String(balance.siege.wallsPercentPerLevel)}% defence per level`,
  watchtower: 'See 2 streets further and get warned when someone sets an ambush nearby.',
  garage: 'Repairs your carriers 4× faster; Runners bought here are cheaper.',
};
