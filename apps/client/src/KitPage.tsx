import { themes, type ThemeName } from '@nexum/theme';
import { useState } from 'react';
import styles from './KitPage.module.css';
import { SCALE_MAX, SCALE_MIN } from './theme/runtime';
import { useTheme } from './theme/ThemeProvider';
import {
  Bar,
  Button,
  Chip,
  Gauge,
  Panel,
  RadialMenu,
  Ribbon,
  Sparkline,
  StanceSwitch,
  Tabs,
  Tag,
  TimelineRow,
  Toast,
  type Faction,
  type Stance,
} from './ui';

const FACTIONS: readonly Faction[] = [
  'self',
  'raider',
  'turtle',
  'merchant',
  'hunter',
  'newcomer',
  'neutral',
  'rival',
];

const THEME_NAMES = Object.keys(themes) as ThemeName[];

const MARKET_TABS = [
  { id: 'sell', label: 'SELL' },
  { id: 'buy', label: 'BUY' },
  { id: 'listings', label: 'LISTINGS' },
  { id: 'contracts', label: 'CONTRACTS' },
];

const RADIAL_ITEMS = [
  { id: 'move', glyph: '➤', label: 'MOVE' },
  { id: 'haul', glyph: '▣', label: 'HAUL' },
  { id: 'build', glyph: '⚒', label: 'BUILD' },
  { id: 'scout', glyph: '◎', label: 'SCOUT' },
  { id: 'stance', glyph: '⛨', label: 'STANCE' },
];

/** The UI kit gallery: every component in its variants, with a theme switcher and scale slider. */
export function KitPage() {
  const { theme, setTheme, scale, setScale } = useTheme();
  const [tab, setTab] = useState('sell');
  const [stance, setStance] = useState<Stance>('hold');
  const [radial, setRadial] = useState<string | undefined>('haul');
  const [toastOpen, setToastOpen] = useState(true);

  return (
    <main className={styles['page']}>
      <header className={styles['head']}>
        <h1 className={styles['title']}>
          NEXUM<span className={styles['accent']}>CITY</span>
          <small className={styles['sub']}>UI KIT</small>
        </h1>
        <div className={styles['controls']}>
          <div className={styles['control']} role="group" aria-label="Theme">
            <span className={styles['control-label']}>THEME</span>
            {THEME_NAMES.map((name) => (
              <Button
                key={name}
                variant={name === theme ? 'primary' : 'ghost'}
                aria-pressed={name === theme}
                onClick={() => {
                  setTheme(name);
                }}
              >
                {name}
              </Button>
            ))}
          </div>
          <label className={styles['control']}>
            <span className={styles['control-label']}>SCALE</span>
            <input
              className={styles['slider']}
              type="range"
              min={SCALE_MIN}
              max={SCALE_MAX}
              step={0.05}
              value={scale}
              onChange={(e) => {
                setScale(e.currentTarget.valueAsNumber);
              }}
            />
            <output className={styles['readout']}>{scale.toFixed(2)}×</output>
          </label>
        </div>
      </header>

      <Ribbon icon="⚠" title="RAID INCOMING" badge="02:14">
        Lowline road, convoy H-2
      </Ribbon>

      <div className={styles['grid']}>
        <Panel title="Panel" tag="HEADER + TAG">
          <p className={styles['note']}>
            Glass panel with corner brackets and chamfered corners. Build every screen from these.
          </p>
          <Chip icon="⚙" label="PARTS" value="1,240" faction="raider" />
        </Panel>

        <Panel title="Chips" tag="RESOURCES">
          <div className={styles['wrap']}>
            <Chip icon="⚙" label="PARTS" value="1,240" faction="raider" />
            <Chip icon="⚡" label="POWER" value="86" faction="turtle" />
            <Chip icon="✚" label="SUPPLY" value="312" faction="merchant" />
            <Chip icon="◈" label="DATA" value="40" faction="hunter" />
            <Chip icon="¤" value="9,415" />
          </div>
        </Panel>

        <Panel title="Faction colours" tag="BY ROLE">
          <div className={styles['stack']}>
            {FACTIONS.map((f, i) => (
              <div key={f} className={styles['faction-row']}>
                <Tag faction={f}>{f.toUpperCase()}</Tag>
                <Bar faction={f} value={0.15 + ((i * 11) % 9) / 10} label={`${f} capture`} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Bars" tag="CAPTURE · PROGRESS">
          <div className={styles['stack']}>
            <Bar label="Continuous" value={0.62} />
            <Bar label="Segmented" value={0.45} faction="raider" segmented />
            <Bar label="Nearly full" value={0.93} faction="turtle" />
            <Bar label="Empty" value={0} faction="merchant" />
          </div>
        </Panel>

        <Panel title="Buttons" tag="PRIMARY · GHOST · DANGER">
          <div className={styles['wrap']}>
            <Button variant="primary">SELL 40 @ 142 ▸</Button>
            <Button>SET PRICE…</Button>
            <Button variant="danger">ABANDON</Button>
            <Button variant="primary" disabled>
              DISABLED
            </Button>
          </div>
        </Panel>

        <Panel title="Tags" tag="OUTLINED LABELS">
          <div className={styles['wrap']}>
            {FACTIONS.map((f) => (
              <Tag key={f} faction={f}>
                {f.toUpperCase()}
              </Tag>
            ))}
          </div>
        </Panel>

        <Panel title="Ribbons" tag="ALERT BANNERS">
          <div className={styles['stack']}>
            <Ribbon icon="⚠" title="RAID INCOMING" badge="02:14">
              Lowline road
            </Ribbon>
            <Ribbon tone="warn" icon="◔" title="WAREHOUSE 90%" badge="FULL SOON">
              Docks
            </Ribbon>
            <Ribbon tone="ok" icon="✓" title="HAUL DELIVERED" badge="VIEW">
              40 ⚙ parts at the Docks
            </Ribbon>
          </div>
        </Panel>

        <Panel title="Toasts" tag="MESSAGES">
          <div className={styles['stack']}>
            {toastOpen && (
              <Toast
                title="ORDER QUEUED"
                onDismiss={() => {
                  setToastOpen(false);
                }}
              >
                Hauler H-2 will leave in 4 minutes.
              </Toast>
            )}
            <Toast tone="ok" title="BUILD DONE">
              Wall level 2 is up.
            </Toast>
            <Toast tone="warn" title="LOW SUPPLY">
              Garrison supply lasts 6 hours.
            </Toast>
            <Toast tone="danger" title="DISTRICT LOST">
              Vex took Lowline.
            </Toast>
            {!toastOpen && (
              <Button
                onClick={() => {
                  setToastOpen(true);
                }}
              >
                SHOW TOAST AGAIN
              </Button>
            )}
          </div>
        </Panel>

        <Panel title="Order timeline" tag="NEXT 8 HOURS">
          <div className={styles['timeline']} role="list">
            <TimelineRow
              label="Hauler H-2"
              glyph="▣"
              faction="self"
              start={0}
              end={0.45}
              progress={0.6}
              previews={[{ start: 0.45, end: 0.7 }]}
            >
              HAUL 40 ⚙
            </TimelineRow>
            <TimelineRow
              label="Crew A"
              glyph="➤"
              faction="raider"
              start={0.1}
              end={0.55}
              progress={0.3}
              state="hot"
            >
              RAID LOWLINE
            </TimelineRow>
            <TimelineRow
              label="Builders"
              glyph="⚒"
              faction="turtle"
              start={0.3}
              end={0.8}
              state="pending"
            >
              WALL L3
            </TimelineRow>
            <TimelineRow
              label="Scout"
              glyph="◎"
              faction="hunter"
              start={0.05}
              end={0.25}
              progress={1}
            >
              SCOUT
            </TimelineRow>
          </div>
        </Panel>

        <Panel title="Warehouse gauge" tag="DOCKS">
          <div className={styles['stack']}>
            <Gauge
              label="Docks warehouse"
              capacity={24}
              segments={[
                { id: 'parts', units: 9, tone: 'accentAlt' },
                { id: 'power', units: 5, tone: 'warn' },
                { id: 'supply', units: 4, tone: 'ok' },
              ]}
            />
            <Gauge
              label="Almost full"
              capacity={12}
              segments={[
                { id: 'data', units: 7, tone: 'special' },
                { id: 'supply', units: 4, tone: 'ok' },
              ]}
            />
          </div>
        </Panel>

        <Panel title="Sparklines" tag="24H PRICE">
          <table className={styles['table']}>
            <tbody>
              <tr>
                <td>⚙ Parts</td>
                <td>
                  <Sparkline label="Parts price" tone="ok" points={[18, 17, 19, 15, 12, 6, 3]} />
                </td>
                <td className={styles['num']}>142 ¤</td>
              </tr>
              <tr>
                <td>⚡ Power</td>
                <td>
                  <Sparkline label="Power price" tone="danger" points={[8, 9, 7, 10, 12, 13, 14]} />
                </td>
                <td className={styles['num']}>66 ¤</td>
              </tr>
              <tr>
                <td>◈ Data</td>
                <td>
                  <Sparkline
                    label="Data price"
                    tone="disabled"
                    points={[12, 11, 13, 12, 12, 11, 12]}
                  />
                </td>
                <td className={styles['num']}>198 ¤</td>
              </tr>
            </tbody>
          </table>
        </Panel>

        <Panel title="Tabs" tag="MARKET">
          <Tabs label="Market" tabs={MARKET_TABS} value={tab} onChange={setTab} />
          <p className={styles['note']}>Selected tab: {tab}</p>
        </Panel>

        <Panel title="Stance" tag="HOLD / PULL BACK">
          <StanceSwitch value={stance} onChange={setStance} />
          <p className={styles['note']}>
            {stance === 'hold'
              ? 'Hold: the garrison defends the walls and fights to keep the district.'
              : 'Pull back: the garrison leaves, the district is lost but your people survive.'}
          </p>
        </Panel>

        <Panel title="Radial menu" tag="ORDERS">
          <div className={styles['center']}>
            <RadialMenu
              title="DOCKS"
              items={RADIAL_ITEMS}
              selected={radial}
              onSelect={(id) => {
                setRadial(id);
              }}
            />
          </div>
        </Panel>
      </div>
    </main>
  );
}
