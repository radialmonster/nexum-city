import type { DistrictView, PlayerView } from '@nexum/contracts';
import { balance, toUnits } from '@nexum/sim';
import { Bar, Button, Chip, Gauge, Panel, StanceSwitch, Tag, type Tone } from '../ui';
import { cx } from '../ui/util';
import {
  carriersAt,
  crewsAt,
  fromKitStance,
  GOOD_KEYS,
  isOwn,
  KIND_GOOD,
  nearby,
  productionPerHour,
  shortName,
  toKitStance,
  warehouseCapacity,
  type OwnDistrict,
} from './derive';
import { formatEta } from './derive';
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
  readonly nowMs: number;
  readonly onStance: (districtId: string, stance: 'hold' | 'pullback') => void;
  readonly onBuild: (districtId: string) => void;
  readonly onFly: (districtId: string) => void;
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
  districtId,
  nowMs,
  onStance,
  onBuild,
  onFly,
}: DistrictPanelProps) {
  const d = districtId ? view.districts[districtId] : undefined;
  if (!d) {
    return (
      <Panel title="District" tag="NONE SELECTED" className={styles['panel']}>
        <p className={styles['empty']}>Pick a district on the map or in the feed to see it here.</p>
      </Panel>
    );
  }
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
          Last seen under {d.lastKnownOwner ? shortName(d.lastKnownOwner) : 'nobody'}. Send a scout
          to see it now.
        </p>
      ) : (
        <Seen d={d} />
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

function Seen({ d }: { d: Exclude<DistrictView, { relation: 'own' | 'remembered' }> }) {
  const presence = Object.entries(d.presence);
  return (
    <div className={styles['stack']}>
      <div className={styles['chips']}>
        <Tag faction="rival">{d.owner ? shortName(d.owner) : 'NO OWNER'}</Tag>
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
          <span className={styles['cap']}>CAPTURE BAR - {shortName(d.siege.attacker)}</span>
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
              {shortName(who)}: {n} crew{n === 1 ? '' : 's'}
            </span>
          ))
        )}
        <small className={styles['hint']}>Warehouse and buildings are hidden by fog.</small>
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
