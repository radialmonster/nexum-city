import { themes, toPixiPalette, type PixiPalette } from '@nexum/theme';
import { eta, type CarrierKind, type Id, type PlayerView } from '@nexum/sim';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Panel, RadialMenu, Tag, type RadialItem } from '../ui';
import { cx, vars } from '../ui/util';
import { frameBounds, zoomForLevel, type Camera, type ZoomLevel } from './camera';
import { demoView, DEMO_SELF } from './demo';
import { edgeArrows, type ArrowTarget } from './offscreen';
import { readHudScale } from './hudScale';
import styles from './MapScreen.module.css';
import { Minimap } from './Minimap';
import type { MapRenderer } from './renderer';
import { layoutWorld, routePath, type MapView, type Scene } from './scene';

const LEVELS: readonly { id: ZoomLevel; label: string }[] = [
  { id: 'city', label: 'CITY' },
  { id: 'tactical', label: 'TACTICAL' },
  { id: 'district', label: 'DISTRICT' },
];

const MENU: readonly RadialItem[] = [
  { id: 'inspect', glyph: 'i', label: 'INSPECT' },
  { id: 'route', glyph: 'R', label: 'ROUTE' },
  { id: 'centre', glyph: '+', label: 'CENTRE' },
  { id: 'close', glyph: 'x', label: 'CLOSE' },
];

const ZOOM_STEP = 1.6;
const ROUTE_CARRIER: CarrierKind = 'van';

export interface MapOptions {
  readonly zoom: ZoomLevel;
  readonly large: boolean;
  readonly reveal: boolean;
  /** Force the demo world even when logged in. */
  readonly demo: boolean;
}

/** Read `?zoom=city|tactical|district`, `?large`, `?reveal` and `?demo` from a query string. */
export function parseMapOptions(search: string): MapOptions {
  const q = new URLSearchParams(search);
  const z = q.get('zoom');
  const zoom: ZoomLevel = z === 'city' || z === 'district' ? z : 'tactical';
  const flag = (k: string) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';
  return { zoom, large: flag('large'), reveal: flag('reveal'), demo: flag('demo') };
}

async function fetchMe(): Promise<MapView | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; view?: PlayerView };
    return body.ok === true && body.view ? { player: body.view } : null;
  } catch {
    return null;
  }
}

const nowFn = (): number => performance.now();

export function formatEta(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${String(h)}h ${String(m).padStart(2, '0')}m`;
  return m > 0 ? `${String(m)}m ${String(sec).padStart(2, '0')}s` : `${String(sec)}s`;
}

/** Full-viewport map: the PixiJS canvas plus the navigation HUD. */
export function MapScreen({ search = window.location.search }: { search?: string }) {
  const opts = useMemo(() => parseMapOptions(search), [search]);
  const { theme } = useTheme();
  const palette: PixiPalette = useMemo(() => toPixiPalette(themes[theme]), [theme]);
  const [view, setView] = useState<MapView | null>(null);
  const [source, setSource] = useState<'demo' | 'live'>('demo');
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const noWebGl = typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom');
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [level, setLevel] = useState<ZoomLevel>(opts.zoom);
  const [vp, setVp] = useState({ w: 1, h: 1 });
  const [selected, setSelected] = useState<Id | null>(null);
  const [panel, setPanel] = useState<'inspect' | 'route' | null>(null);
  const [scale, setScale] = useState(1);

  // data: the logged-in view when there is one, otherwise the demo world
  useEffect(() => {
    let live = true;
    const demo = () => demoView({ large: opts.large, reveal: opts.reveal });
    void (async () => {
      const me = opts.demo ? null : await fetchMe();
      if (!live) return;
      setSource(me ? 'live' : 'demo');
      setView(me ?? demo());
    })();
    return () => {
      live = false;
    };
  }, [opts]);

  const scene: Scene | null = useMemo(
    () => (view ? layoutWorld(view, palette.map) : null),
    [view, palette],
  );
  const sceneRef = useRef<Scene | null>(null);
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  const mineBounds = useCallback((s: Scene) => {
    const mine = s.districts.filter((d) => d.mine);
    if (mine.length === 0) return s.bounds;
    return {
      minX: Math.min(...mine.map((d) => d.cx - d.w / 2)),
      maxX: Math.max(...mine.map((d) => d.cx + d.w / 2)),
      minY: Math.min(...mine.map((d) => d.cy - d.h / 2)),
      maxY: Math.max(...mine.map((d) => d.cy + d.h / 2)),
    };
  }, []);

  // the renderer: created once per theme, lazily, and never under jsdom
  const hasScene = scene !== null;
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !hasScene || navigator.userAgent.includes('jsdom')) {
      return;
    }
    let cancelled = false;
    let made: MapRenderer | null = null;
    void (async () => {
      try {
        const { MapRenderer } = await import('./renderer');
        const first = sceneRef.current;
        if (!first || cancelled) return;
        made = await MapRenderer.create(host, palette, first, performance.now(), {
          onFrame: (c, l) => {
            setCam(c);
            setLevel(l);
          },
          onPick: (id) => {
            setSelected(id);
            setPanel(null);
          },
        });
        if (cancelled) {
          made.destroy();
          return;
        }
        rendererRef.current = made;
        const c = made.controller;
        const b = mineBounds(first);
        const framed = frameBounds(b, c.viewport, palette.map);
        c.set({
          x: (b.minX + b.maxX) / 2,
          y: (b.minY + b.maxY) / 2,
          zoom: zoomForLevel(opts.zoom, c.viewport, palette.map) || framed.zoom,
        });
        setVp({ ...c.viewport });
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      rendererRef.current = null;
      setReady(false);
      made?.destroy();
    };
    // the scene is pushed in by the effect below; only the palette and options rebuild the renderer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasScene, palette, opts.zoom]);

  useEffect(() => {
    if (scene) rendererRef.current?.setScene(scene, view?.player.nowMs ?? 0);
  }, [scene, view, ready]);

  useEffect(() => {
    rendererRef.current?.setSelection(selected);
  }, [selected, ready]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    const resize = () => {
      setVp({ ...r.controller.viewport });
      setScale(readHudScale());
    };
    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
    };
  }, [ready]);

  const sel = selected && scene ? scene.byId[selected] : undefined;

  // route preview with ETA from the first own district, using the sim's own eta()
  const routeInfo = useMemo(() => {
    if (panel !== 'route' || !sel || !scene || !view?.graph) return null;
    const from = scene.mine[0];
    if (!from || from === sel.id) return null;
    const result = eta(view.graph, from, sel.id, ROUTE_CARRIER);
    return result ? { from, result, path: routePath(scene, result.route) } : null;
  }, [panel, sel, scene, view]);

  useEffect(() => {
    rendererRef.current?.setRoutePreview(routeInfo?.path ?? null);
  }, [routeInfo, ready]);

  const act = (fn: (r: MapRenderer, now: number) => void) => {
    const r = rendererRef.current;
    if (r) fn(r, nowFn());
  };

  const centreOn = (wx: number, wy: number, lvl: ZoomLevel = 'tactical') => {
    act((r, now) => {
      r.controller.animateCentre(
        wx,
        wy,
        now,
        zoomForLevel(lvl, r.controller.viewport, palette.map),
      );
    });
  };

  const recentre = () => {
    if (!scene) return;
    const b = mineBounds(scene);
    act((r, now) => {
      r.controller.animateTo(frameBounds(b, r.controller.viewport, palette.map, 0.25), now);
    });
  };

  const menuAction = (id: string) => {
    if (id === 'close') {
      setSelected(null);
      setPanel(null);
    } else if (id === 'centre' && sel) centreOn(sel.cx, sel.cy, 'district');
    else if (id === 'inspect' || id === 'route') setPanel(id);
  };

  // off-screen arrows for owned districts and alerts
  const arrows = useMemo(() => {
    if (!scene || !ready) return [];
    const targets: ArrowTarget[] = [
      ...scene.alerts.map<ArrowTarget>((a) => ({
        id: `a:${a.districtId}`,
        wx: a.x,
        wy: a.y,
        kind: 'alert',
        label: a.label,
      })),
      ...scene.districts
        .filter((d) => d.mine)
        .map<ArrowTarget>((d) => ({ id: d.id, wx: d.cx, wy: d.cy, kind: 'owned', label: d.name })),
    ];
    return edgeArrows(targets, cam, vp, palette.map.arrowInset * scale);
  }, [scene, ready, cam, vp, palette, scale]);

  const col = Math.round(cam.x / palette.map.pitchX);
  const row = Math.round(cam.y / palette.map.pitchY);
  const across = vp.w / cam.zoom / palette.map.pitchX;
  const menuAt = sel && ready ? worldToHud(sel, cam, vp) : null;

  return (
    <div className={styles['screen']} data-source={source}>
      <div ref={hostRef} className={styles['canvas']} data-testid="map-canvas" />
      {(failed || (hasScene && noWebGl)) && (
        <p className={styles['notice']}>The map needs WebGL.</p>
      )}
      {scene && (
        <>
          <Panel
            className={cx(styles['readout'])}
            title="SECTOR"
            tag={source === 'demo' ? 'DEMO' : 'LIVE'}
          >
            <div className={styles['coords']}>
              {String(col).padStart(2, '0')}-{String(row).padStart(2, '0')}
            </div>
            <div className={styles['sub']}>
              {level.toUpperCase()} / {across.toFixed(1)} PLOTS / {String(scene.districts.length)}{' '}
              DISTRICTS
            </div>
          </Panel>

          <Panel
            className={cx(styles['jump'])}
            title="MY DISTRICTS"
            tag={String(scene.mine.length)}
          >
            <ul className={styles['jump-list']}>
              {scene.mine.map((id) => {
                const d = scene.byId[id];
                if (!d) return null;
                return (
                  <li key={id}>
                    <Button
                      onClick={() => {
                        setSelected(id);
                        centreOn(d.cx, d.cy);
                      }}
                    >
                      {d.name.toUpperCase()}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <div className={styles['minimap']}>
            <Minimap
              scene={scene}
              camera={cam}
              viewport={vp}
              pitch={palette.map.pitchX}
              onJump={(x, y) => {
                centreOn(x, y, level);
              }}
            />
          </div>

          <div className={styles['controls']}>
            <div className={styles['row']}>
              {LEVELS.map((l) => (
                <Button
                  key={l.id}
                  variant={l.id === level ? 'primary' : 'ghost'}
                  onClick={() => {
                    act((r, now) => {
                      r.controller.animateToLevel(l.id, now);
                    });
                  }}
                >
                  {l.label}
                </Button>
              ))}
            </div>
            <div className={styles['row']}>
              <Button
                aria-label="Zoom out"
                onClick={() => {
                  act((r, now) => {
                    r.controller.animateZoomBy(1 / ZOOM_STEP, now);
                  });
                }}
              >
                -
              </Button>
              <Button
                aria-label="Zoom in"
                onClick={() => {
                  act((r, now) => {
                    r.controller.animateZoomBy(ZOOM_STEP, now);
                  });
                }}
              >
                +
              </Button>
              <Button onClick={recentre}>RECENTRE</Button>
            </div>
          </div>

          {arrows.map((a) => (
            <button
              key={a.id}
              type="button"
              className={styles['arrow']}
              data-kind={a.kind}
              aria-label={`${a.kind === 'alert' ? 'Alert' : 'District'}: ${a.label}`}
              style={vars({
                '--x': `${String(a.x)}px`,
                '--y': `${String(a.y)}px`,
                '--a': `${String(a.angle)}rad`,
              })}
              onClick={() => {
                const id = a.id.startsWith('a:') ? a.id.slice(2) : a.id;
                const d = scene.byId[id];
                if (d) centreOn(d.cx, d.cy);
              }}
            >
              <svg viewBox="0 0 10 10" className={styles['arrow-icon']} aria-hidden="true">
                <path d="M1 1 L9 5 L1 9 L3 5 Z" />
              </svg>
            </button>
          ))}

          {menuAt && sel && (
            <div
              className={styles['menu']}
              style={vars({ '--x': `${String(menuAt.x)}px`, '--y': `${String(menuAt.y)}px` })}
            >
              <RadialMenu items={MENU} title={sel.name.toUpperCase()} onSelect={menuAction} />
            </div>
          )}

          {sel && panel === 'inspect' && (
            <Panel
              className={cx(styles['info'])}
              title={sel.name.toUpperCase()}
              tag={sel.kind.toUpperCase()}
            >
              <div className={styles['sub']}>
                {sel.remembered
                  ? 'REMEMBERED / LAST KNOWN'
                  : sel.mine
                    ? 'YOURS'
                    : sel.owner === 'neutral'
                      ? 'UNCLAIMED'
                      : 'RIVAL'}
              </div>
              {!sel.remembered && (
                <div>
                  GARRISON {String(sel.garrison)} / STOCK {String(Math.round(sel.stock * 100))}%
                </div>
              )}
              {sel.siege !== null && (
                <Tag faction="raider">UNDER SIEGE {String(Math.round(sel.siege * 100))}%</Tag>
              )}
            </Panel>
          )}
          {sel && panel === 'route' && (
            <Panel className={cx(styles['info'])} title="ROUTE" tag={ROUTE_CARRIER.toUpperCase()}>
              {routeInfo ? (
                <>
                  <div>
                    {(scene.byId[routeInfo.from]?.name ?? '').toUpperCase()} TO{' '}
                    {sel.name.toUpperCase()}
                  </div>
                  <div className={styles['sub']}>
                    {String(routeInfo.result.route.length - 1)} HOPS /{' '}
                    {(routeInfo.result.lengthM / 1000).toFixed(1)} KM
                  </div>
                  <div className={styles['coords']}>
                    ETA {formatEta(routeInfo.result.durationMs)}
                  </div>
                </>
              ) : (
                <div className={styles['sub']}>NO ROUTE DATA FOR THIS DISTRICT</div>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function worldToHud(d: { cx: number; cy: number }, cam: Camera, vp: { w: number; h: number }) {
  return { x: (d.cx - cam.x) * cam.zoom + vp.w / 2, y: (d.cy - cam.y) * cam.zoom + vp.h / 2 };
}

export { DEMO_SELF };
