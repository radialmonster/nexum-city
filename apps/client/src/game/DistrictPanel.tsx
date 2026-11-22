import type { DistrictView, PlayerView } from '@nexum/contracts';
import { balance, toUnits } from '@nexum/sim';
import { Bar, Button, Chip, Gauge, Panel, StanceSwitch, Tag, type Tone } from '../ui';
import { cx } from '../ui/util';
import {
  carriersAt,
  crewsAt,
  fromKitStance,
  GOOD_KEYS,
  ownDistricts,
  isOwn,
  KIND_GOOD,
  nearby,
  productionPerHour,
  toKitStance,
  warehouseCapacity,
  type OwnDistrict,
} from './derive';
import { crewName, empireSummary, formatEta, type CrewNames } from './derive';
import { formatUnits } from './feed';
import styles from './DistrictPanel.module.css';

export const GOOD_TONE: Readonly<Record<(typeof GOOD_KEYS)[number], Tone>> = {
  parts: 'accentAlt',
  power: 'warn',
  data: 'special',
  supplies: 'ok',
};

export interface DistrictPanelProps {
  readonly view: PlayerView;
  readonly districtId: string | null;
  readonly names?: CrewNames | undefined;
  readonly nowMs: number;
  readonly onStance: (districtId: string, stance: 'hold' | 'pullback') => void;
  readonly onBuild: (districtId: string) => void;
  readonly onFly: (districtId: string) => void;
  /** Opens the market for a hub district. */
  readonly onMarket?: ((hubId: string) => void) | undefined;
  /** Opens the dossier of a rival. */
  readonly onRival?: ((playerId: string) => void) | undefined;
}

const relationLabel = (d: DistrictView, me: string): string => {
  if (d.relation === 'own') return 'YOURS';
  if (d.relation === 'hub') return 'HUB';
  if (d.relation === 'remembered') return 'REMEMBERED';
  return d.owner === '' || d.owner === 'neutral' ? 'FREE' : d.owner === me ? 'YOURS' : 'RIVAL';
};

/** The right column: the selected district, what is in it, and what you can do there. */
export function DistrictPanel({
  view,
  names = {},
  districtId,
  nowMs,
  onStance,
  onBuild,
  onFly,
  onMarket,
  onRival,
}: DistrictPanelProps) {
  const d = districtId ? view.districts[districtId] : undefined;
  if (!d) return <Empire view={view} onFly={onFly} />;
  return (
    <Panel
      title={d.name}
      tag={`${d.kind.toUpperCase()} / ${relationLabel(d, view.playerId)}`}
      className={styles['panel']}
    >
      {isOwn(d) ? (
        <Own d={d} view={view} nowMs={nowMs} onStance={onStance} onBuild={onBuild} />
      ) : d.relation === 'remembered' ? (
        <p className={styles['empty']}>
          Last seen under{' '}
          {d.lastKnownOwner && onRival ? (
            <RivalLink id={d.lastKnownOwner} me={view.playerId} names={names} onRival={onRival} />
          ) : d.lastKnownOwner ? (
            crewName(names, d.lastKnownOwner)
          ) : (
            'nobody'
          )}
          . Send a scout to see it now.
        </p>
      ) : (
        <Seen d={d} me={view.playerId} names={names} onMarket={onMarket} onRival={onRival} />
      )}
      <Nearby view={view} id={d.id} onFly={onFly} />
    </Panel>
  );
}

function status(d: OwnDistrict, nowMs: number): { label: string; tone: Tone }[] {
  const out: { label: string; tone: Tone }[] = [];
  if (d.siege) out.push({ label: 'UNDER SIEGE', tone: 'danger' });
  if (d.protectedUntilMs !== undefined && d.protectedUntilMs > nowMs)
    out.push({ label: 'PROTECTED', tone: 'ok' });
  if (d.construction) out.push({ label: 'BUILDING', tone: 'accentAlt' });
  if (d.overflowing) out.push({ label: 'FULL', tone: 'warn' });
  if (d.frontier !== 'built') out.push({ label: d.frontier.toUpperCase(), tone: 'special' });
  if (out.length === 0) out.push({ label: 'QUIET', tone: 'accent' });
  return out;
}

function Own({
  d,
  view,
  nowMs,
  onStance,
  onBuild,
}: Pick<DistrictPanelProps, 'view' | 'nowMs' | 'onStance' | 'onBuild'> & { d: OwnDistrict }) {
  const crews = crewsAt(view, d.id);
  const carriers = carriersAt(view, d.id);
  const cap = warehouseCapacity(d);
  const rate = productionPerHour(d);
  const good = KIND_GOOD[d.kind];
  const maxed =
    d.buildings.length >= d.slots &&
    d.buildings.every((b) => b.level >= balance.buildings.maxLevel);
  const empty = Math.max(0, d.slots - d.buildings.length);
  return (
    <div className={styles['stack']}>
      <div className={styles['chips']}>
        {status(d, nowMs).map((s) => (
          <span key={s.label} className={styles['status']} data-tone={s.tone}>
            {s.label}
          </span>
        ))}
      </div>
      {d.siege && (
        <div className={styles['block']}>
          <span className={styles['cap']}>CAPTURE BAR</span>
          <Bar value={d.siege.progress} faction="raider" segmented label="Capture progress" />
        </div>
      )}
      <div className={styles['block']}>
        <span className={styles['cap']}>PRODUCTION</span>
        <span className={styles['line']}>
          {rate > 0 && good ? `${formatUnits(rate)} ${good} / hour` : 'Nothing made here'}
        </span>
      </div>
      <Gauge
        label="WAREHOUSE"
        capacity={cap}
        segments={GOOD_KEYS.map((g) => ({
          id: g,
          units: Math.floor(toUnits(d.warehouse[g])),
          tone: GOOD_TONE[g],
        }))}
      />
      <div className={styles['goods']}>
        {GOOD_KEYS.map((g) => (
          <Chip key={g} label={g.toUpperCase()} value={formatUnits(toUnits(d.warehouse[g]))} />
        ))}
      </div>
      <div className={styles['block']}>
        <span className={styles['cap']}>BUILDINGS</span>
        <ul className={styles['slots']}>
          {d.buildings.map((b) => (
            <li key={b.type} className={styles['slot']}>
              <span>{b.type.toUpperCase()}</span>
              <b>LV {b.level}</b>
            </li>
          ))}
          {d.construction && (
            <li className={cx(styles['slot'], styles['building'])}>
              <span>{d.construction.building.toUpperCase()}</span>
              <b>
                LV {d.construction.level} in{' '}
                {formatEta(Math.max(0, d.construction.completesAtMs - nowMs))}
              </b>
            </li>
          )}
          {Array.from({ length: Math.max(0, empty - (d.construction ? 1 : 0)) }, (_, i) => (
            <li key={i} className={cx(styles['slot'], styles['free'])}>
              <span>EMPTY SLOT</span>
            </li>
          ))}
        </ul>
        <Button
          variant="primary"
          disabled={d.construction !== null || maxed}
          onClick={() => {
            onBuild(d.id);
          }}
        >
          BUILD
        </Button>
      </div>
      <div className={styles['block']}>
        <span className={styles['cap']}>HERE</span>
        <span className={styles['line']}>
          {crews.length} crew{crews.length === 1 ? '' : 's'}
          {crews.length > 0 &&
            ` (strength ${String(crews.reduce((n, c) => n + c.strength, 0))})`} / {carriers.length}{' '}
          carrier{carriers.length === 1 ? '' : 's'}
          {carriers.length > 0 && `: ${carriers.map((c) => c.kind).join(', ')}`}
        </span>
      </div>
      <div className={styles['block']}>
        <span className={styles['cap']}>STANCE</span>
        <StanceSwitch
          value={toKitStance(d.stance)}
          onChange={(s) => {
            onStance(d.id, fromKitStance(s));
          }}
        />
        <small className={styles['hint']}>
          Pull back halves your defence here but loses fewer crews if it falls. It takes effect at
          once.
        </small>
      </div>
    </div>
  );
}

/** A rival's name that opens their dossier; your own id is plain text. */
function RivalLink({
  id,
  me,
  names,
  onRival,
}: {
  id: string;
  me: string;
  names: CrewNames;
  onRival: (playerId: string) => void;
}) {
  if (id === me) return <>you</>;
  return (
    <button
      type="button"
      className={styles['rival']}
      onClick={() => {
        onRival(id);
      }}
    >
      {crewName(names, id)}
    </button>
  );
}

function Seen({
  d,
  me,
  names,
  onMarket,
  onRival,
}: {
  names: CrewNames;
  d: Exclude<DistrictView, { relation: 'own' | 'remembered' }>;
  me: string;
  onMarket: DistrictPanelProps['onMarket'];
  onRival: DistrictPanelProps['onRival'];
}) {
  const presence = Object.entries(d.presence);
  const unclaimed = d.owner === '' || d.owner === 'neutral';
  return (
    <div className={styles['stack']}>
      <div className={styles['chips']}>
        <Tag faction={unclaimed ? 'neutral' : 'rival'}>
          {unclaimed ? (
            d.open ? (
              'OPEN PLOT'
            ) : (
              'UNCLAIMED'
            )
          ) : d.owner && onRival ? (
            <RivalLink id={d.owner} me={me} names={names} onRival={onRival} />
          ) : d.owner ? (
            crewName(names, d.owner)
          ) : (
            'NO OWNER'
          )}
        </Tag>
        {d.relation === 'hub' && onMarket && (
          <Button
            variant="primary"
            onClick={() => {
              onMarket(d.id);
            }}
          >
            OPEN MARKET
          </Button>
        )}
        {d.settling && (
          <span className={styles['status']} data-tone="special">
            {d.settling.owner === me ? 'YOU ARE SETTLING' : 'BEING SETTLED'}
          </span>
        )}
        {d.protected && (
          <span className={styles['status']} data-tone="ok">
            PROTECTED
          </span>
        )}
        {d.siege && (
          <span className={styles['status']} data-tone="danger">
            UNDER SIEGE
          </span>
        )}
      </div>
      {d.siege && (
        <div className={styles['block']}>
          <span className={styles['cap']}>CAPTURE BAR - {crewName(names, d.siege.attacker)}</span>
          <Bar value={d.siege.progress} faction="raider" segmented label="Capture progress" />
        </div>
      )}
      <div className={styles['block']}>
        <span className={styles['cap']}>SEEN HERE</span>
        {presence.length === 0 ? (
          <span className={styles['line']}>No crews in sight.</span>
        ) : (
          presence.map(([who, n]) => (
            <span key={who} className={styles['line']}>
              {crewName(names, who)}: {n} crew{n === 1 ? '' : 's'}
            </span>
          ))
        )}
        {d.open && !d.settling && (
          <small className={styles['hint']}>
            Open frontier. Send a crew to settle it for {balance.settle.supplies} supplies.
          </small>
        )}
        {!unclaimed && (
          <small className={styles['hint']}>Warehouse and buildings are hidden by fog.</small>
        )}
      </div>
    </div>
  );
}

function Nearby({
  view,
  id,
  onFly,
}: {
  view: PlayerView;
  id: string;
  onFly: (districtId: string) => void;
}) {
  const list = nearby(view, id);
  if (list.length === 0) return null;
  return (
    <div className={styles['block']}>
      <span className={styles['cap']}>NEARBY</span>
      <ul className={styles['nearby']}>
        {list.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className={styles['near']}
              onClick={() => {
                onFly(n.id);
              }}
            >
              <span>{n.name}</span>
              <small>{relationLabel(n, view.playerId)}</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Nothing selected: what the whole empire adds up to, and a way to jump to each district. */
function Empire({ view, onFly }: Pick<DistrictPanelProps, 'view' | 'onFly'>) {
  const e = empireSummary(view);
  const own = ownDistricts(view);
  return (
    <Panel title="Your empire" tag="NONE SELECTED" className={styles['panel']}>
      <div className={styles['stack']}>
        <div className={styles['chips']}>
          <Chip label="DISTRICTS" value={String(e.districts)} />
          <Chip label="CREWS" value={String(e.crews)} />
          <Chip label="CARRIERS" value={String(e.carriers)} />
        </div>
        <div className={styles['block']}>
          <span className={styles['cap']}>INCOME PER HOUR</span>
          {e.totalPerHour > 0 ? (
            GOOD_KEYS.filter((g) => e.perHour[g] > 0).map((g) => (
              <span key={g} className={styles['line']}>
                {formatUnits(e.perHour[g])} {g}
              </span>
            ))
          ) : (
            <span className={styles['line']}>Nothing made yet.</span>
          )}
        </div>
        {e.besieged > 0 && (
          <span className={styles['status']} data-tone="danger">
            {e.besieged} UNDER SIEGE
          </span>
        )}
        <div className={styles['block']}>
          <span className={styles['cap']}>YOUR DISTRICTS</span>
          {own.map((d) => (
            <Button
              key={d.id}
              onClick={() => {
                onFly(d.id);
              }}
            >
              {d.name}
            </Button>
          ))}
        </div>
        <small className={styles['hint']}>
          Pick a district on the map or in the feed for details.
        </small>
      </div>
    </Panel>
  );
}
