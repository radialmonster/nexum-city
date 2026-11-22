import { themes, toPixiPalette, type PixiPalette } from '@nexum/theme';
import { eta, type CarrierKind, type Id, type PlayerView } from '@nexum/sim';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Panel, RadialMenu, Tag, type RadialFacing, type RadialItem } from '../ui';
import { cx, vars } from '../ui/util';
import {
  frameBounds,
  panToFit,
  zoomForLevel,
  type Rect,
  type Camera,
  type ZoomLevel,
} from './camera';
import { demoView, DEMO_SELF } from './demo';
import { needsHomeCentre } from './home';
import { edgeArrows, type ArrowTarget } from './offscreen';
import { readHudScale, readMotionMs } from './hudScale';
import styles from './MapScreen.module.css';
import { Minimap } from './Minimap';
import type { FlashTone, MapRenderer } from './renderer';
import { cityBounds, layoutWorld, routePath, type MapView, type Scene } from './scene';

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

/** The orders the radial menu can open a confirm card for. */
export type MapOrderKind =
  'move' | 'haul' | 'siege' | 'reinforce' | 'scout' | 'build' | 'settle' | 'raid';

const ORDER_ITEMS: Record<MapOrderKind, RadialItem> = {
  move: { id: 'move', glyph: '>', label: 'MOVE' },
  haul: { id: 'haul', glyph: 'H', label: 'HAUL' },
  siege: { id: 'siege', glyph: 'S', label: 'SIEGE' },
  reinforce: { id: 'reinforce', glyph: '+', label: 'REINFORCE' },
  scout: { id: 'scout', glyph: 'o', label: 'SCOUT' },
  build: { id: 'build', glyph: 'B', label: 'BUILD' },
  settle: { id: 'settle', glyph: 'F', label: 'SETTLE' },
  raid: { id: 'raid', glyph: '!', label: 'RAID' },
};
const DETAILS_ITEM: RadialItem = { id: 'details', glyph: 'i', label: 'DETAILS' };
const CLOSE_ITEM: RadialItem = { id: 'close', glyph: 'x', label: 'CLOSE' };

/** The radial menu for a district in the game screen: what you can order there. */
export function orderMenu(d: {
  readonly mine: boolean;
  readonly isHub: boolean;
  readonly remembered: boolean;
  /** An unclaimed open frontier plot in sight: it can be settled. */
  readonly open?: boolean;
  /** Add a DETAILS item (phone: the district panel is a separate tab). */
  readonly details?: boolean;
}): readonly RadialItem[] {
  const kinds: MapOrderKind[] = d.mine
    ? ['move', 'haul', 'reinforce', 'build', 'raid']
    : d.isHub
      ? ['move', 'haul', 'raid']
      : d.open
        ? // nothing there to raid or besiege: an open plot is only settled or scouted
          ['settle', 'scout']
        : d.remembered
          ? ['scout']
          : ['siege', 'scout', 'raid'];
  return [
    ...kinds.map((k) => ORDER_ITEMS[k]),
    ...(d.details === true ? [DETAILS_ITEM] : []),
    CLOSE_ITEM,
  ];
}

/** A transient red pulse on a street. */
export interface MapFlash {
  readonly key: string;
  readonly a: Id;
  readonly b: Id;
  readonly text: string;
  /** Palette colour of the pulse; a raid hit is `danger`, an evade `ok` or `warn`. */
  readonly tone?: FlashTone;
}

/** What the game screen hands the map: it owns the data, the selection and the orders. */
export interface MapEmbed {
  readonly view: PlayerView;
  readonly selected: Id | null;
  readonly onSelect: (id: Id | null) => void;
  /** Fly the map to a district; a new `n` repeats the request. */
  readonly flyTo: { readonly id: Id; readonly n: number } | null;
  /** A plot that pulses on the map until the player first selects it. */
  readonly beaconId?: Id | null;
  readonly onOrder: (kind: MapOrderKind, districtId: Id) => void;
  /** A route to preview while an order card is open. */
  readonly route?: readonly Id[] | null;
  /** Hide the radial menu, e.g. while an order card is open. */
  readonly menuHidden?: boolean;
  /** Raid hits to flash on the map: a street pulses red with a callout. Repeat keys are ignored. */
  readonly flashes?: readonly MapFlash[];
  /** Phone: the radial gets a DETAILS item that opens the district panel. */
  readonly onDetails?: (districtId: Id) => void;
}

const ZOOM_STEP = 1.6;
/** Rounding allowance when deciding whether the full radial ring fits. */
const FIT_SLACK_PX = 3;
const ROUTE_CARRIER: CarrierKind = 'van';

export interface MapOptions {
  readonly zoom: ZoomLevel;
  readonly large: boolean;
  /** Show everything, rivals included. On by default for the demo; `?fog` turns it off. */
  readonly reveal: boolean;
  /** Force the demo world even when logged in. */
  readonly demo: boolean;
}

/** Read `?zoom=city|tactical|district`, `?large`, `?fog` and `?demo` from a query string. */
export function parseMapOptions(search: string): MapOptions {
  const q = new URLSearchParams(search);
  const z = q.get('zoom');
  const zoom: ZoomLevel = z === 'city' || z === 'district' ? z : 'tactical';
  const flag = (k: string) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';
  return { zoom, large: flag('large'), reveal: !flag('fog'), demo: flag('demo') };
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
export function MapScreen({
  search = window.location.search,
  embed,
}: {
  search?: string;
  embed?: MapEmbed;
}) {
  const opts = useMemo(() => parseMapOptions(search), [search]);
  const { theme } = useTheme();
  const palette: PixiPalette = useMemo(() => toPixiPalette(themes[theme]), [theme]);
  const [fetched, setView] = useState<MapView | null>(null);
  const [fetchedSource, setSource] = useState<'demo' | 'live'>('demo');
  const embedView = embed?.view;
  const view: MapView | null = useMemo(
    () => (embedView ? { player: embedView, graph: embedView.graph } : fetched),
    [embedView, fetched],
  );
  const source = embedView ? 'live' : fetchedSource;
  const hostRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const noWebGl = typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom');
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [level, setLevel] = useState<ZoomLevel>(opts.zoom);
  const [vp, setVp] = useState({ w: 1, h: 1 });
  const [localSelected, setLocalSelected] = useState<Id | null>(null);
  const selected = embed ? embed.selected : localSelected;
  const embedRef = useRef(embed);
  useEffect(() => {
    embedRef.current = embed;
  }, [embed]);
  const setSelected = useCallback((id: Id | null) => {
    setLocalSelected(id);
    embedRef.current?.onSelect(id);
  }, []);
  /** The plot whose radial an order launch just closed. */
  const [menuDismissed, setMenuDismissed] = useState<Id | null>(null);
  const [panel, setPanel] = useState<'inspect' | 'route' | null>(null);
  const [scale, setScale] = useState(1);
  /** Phone layout: the districts list and the minimap sit behind buttons. */
  const [drawer, setDrawer] = useState<'districts' | 'map' | null>(null);

  // data: the logged-in view when there is one, otherwise the demo world
  useEffect(() => {
    if (embedView) return;
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
  }, [opts, embedView]);

  const scene: Scene | null = useMemo(
    () => (view ? layoutWorld(view, palette.map) : null),
    [view, palette],
  );
  const sceneRef = useRef<Scene | null>(null);
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  /**
   * How far to nudge the camera target so it sits in the free part of the map, clear of the
   * HUD sector card in the top-left corner: half the card's size, in screen pixels.
   */
  const hudInset = useCallback((): { x: number; y: number } => {
    const card = hostRef.current?.parentElement?.querySelector<HTMLElement>('[class*="readout"]');
    const host = hostRef.current?.getBoundingClientRect();
    // the phone layout hides the card, but its flag can lag the first frame: go by the width
    if (!card || !host || host.width < palette.map.compactBelowPx) return { x: 0, y: 0 };
    const r = card.getBoundingClientRect();
    return {
      x: Math.max(0, r.right - host.left) / 2,
      y: Math.max(0, r.bottom - host.top) / 2,
    };
  }, [palette]);

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
  /** The camera has been framed on the player's own plots (once; never again after a move). */
  const centredRef = useRef(false);
  const startCamRef = useRef<Camera | null>(null);
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
            const v = rendererRef.current?.controller.viewport ?? made?.controller.viewport;
            if (v) setVp((o) => (o.w === v.w && o.h === v.h ? o : { w: v.w, h: v.h }));
          },
          onPick: (id) => {
            setMenuDismissed(null);
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
        centredRef.current = first.mine.length > 0;
        if (opts.zoom === 'city') {
          c.set(frameBounds(cityBounds(first, palette.map), c.viewport, palette.map, 0.03));
        } else {
          const zoom = zoomForLevel(opts.zoom, c.viewport, palette.map);
          const inset = hudInset();
          c.set(
            {
              x: (b.minX + b.maxX) / 2 - inset.x / zoom,
              y: (b.minY + b.maxY) / 2 - inset.y / zoom,
              zoom,
            },
            true,
          );
        }
        startCamRef.current = { ...c.cam };
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

  const beaconId = embed?.beaconId ?? null;
  useEffect(() => {
    rendererRef.current?.setBeacon(beaconId);
  }, [beaconId, scene, ready]);

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

  const embedRoute = embed?.route;
  const embedPath = useMemo(
    () => (embedRoute && scene ? routePath(scene, embedRoute) : null),
    [embedRoute, scene],
  );
  useEffect(() => {
    rendererRef.current?.setRoutePreview(embedPath ?? routeInfo?.path ?? null);
  }, [routeInfo, embedPath, ready]);

  const embedFlashes = embed?.flashes;
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !embedFlashes) return;
    for (const f of embedFlashes) r.flashStreet(f.key, f.a, f.b, f.text, f.tone);
  }, [embedFlashes, scene, ready]);

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
      const to = frameBounds(b, r.controller.viewport, palette.map, 0.25);
      const inset = hudInset();
      r.controller.animateTo(
        { ...to, x: to.x - inset.x / to.zoom, y: to.y - inset.y / to.zoom },
        now,
        undefined,
        // a home on the world's edge still needs to land mid-screen, clear of the HUD card
        true,
      );
    });
  };

  // A newcomer's first scene may not hold their district yet: when it appears, frame it once,
  // unless the player has already moved the camera.
  useEffect(() => {
    const r = rendererRef.current;
    const start = startCamRef.current;
    if (!r || !scene || !start) return;
    const c = r.controller.cam;
    const moved = c.x !== start.x || c.y !== start.y || c.zoom !== start.zoom;
    if (!needsHomeCentre({ centred: centredRef.current, hasMine: scene.mine.length > 0, moved })) {
      return;
    }
    centredRef.current = true;
    recentre();
    // recentre reads the latest scene and renderer; only the scene arriving matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, ready]);

  // fly to a district when the game screen asks (a feed click, a nearby list entry)
  const fly = embed?.flyTo;
  useEffect(() => {
    if (!fly || !scene || !ready) return;
    const d = scene.byId[fly.id];
    if (d) centreOn(d.cx, d.cy);
    // only a new request (`n`) flies; the scene may change under an old one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fly?.n, ready]);

  const goLevel = (l: ZoomLevel) => {
    if (l === 'city' && scene) {
      const b = cityBounds(scene, palette.map);
      act((r, now) => {
        r.controller.animateTo(frameBounds(b, r.controller.viewport, palette.map, 0.03), now);
      });
    } else {
      act((r, now) => {
        r.controller.animateToLevel(l, now);
      });
    }
  };

  const menuAction = (id: string) => {
    if (embed && sel) {
      if (id === 'close') setSelected(null);
      else if (id === 'details') embed.onDetails?.(sel.id);
      else {
        // launching an order closes the menu; clicking the plot again brings it back
        setMenuDismissed(sel.id);
        embed.onOrder(id as MapOrderKind, sel.id);
      }
      return;
    }
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
  const [menuEl, setMenuEl] = useState<HTMLDivElement | null>(null);
  // measured after layout: the menu's half-size and the HUD card's corner, in screen pixels
  const [menuBox, setMenuBox] = useState({ half: 0, x: 0, y: 0, bottom: 0 });
  const wantMenu = sel !== null && ready && !embed?.menuHidden && menuDismissed !== sel?.id;
  useEffect(() => {
    if (!wantMenu || !menuEl) return;
    const measure = (): void => {
      const half = menuEl.offsetWidth / 2;
      const inset = hudInset();
      // phone: the dock of map buttons along the bottom edge is off limits to the menu
      const dock = screenRef.current?.querySelector<HTMLElement>('[class*="dock"]');
      const host = hostRef.current?.getBoundingClientRect();
      const dockRect = dock?.getBoundingClientRect();
      const bottom = host && dockRect && dockRect.height > 0 ? host.bottom - dockRect.top : 0;
      setMenuBox((m) =>
        m.half === half && m.x === inset.x && m.y === inset.y && m.bottom === bottom
          ? m
          : { half, ...inset, bottom },
      );
    };
    // the observer fires once on observe and again whenever the menu or the map resizes
    const ro = new ResizeObserver(measure);
    ro.observe(menuEl);
    if (menuEl.parentElement) ro.observe(menuEl.parentElement);
    return () => ro.disconnect();
  }, [wantMenu, menuEl, hudInset]);
  /** The HUD cards over the map, as rectangles in map-viewport pixels (empty boxes skipped). */
  const hudRects = useCallback((): Rect[] => {
    const host = hostRef.current?.getBoundingClientRect();
    const root = screenRef.current;
    if (!host || !root) return [];
    const out: Rect[] = [];
    root
      .querySelectorAll<HTMLElement>(
        '[class*="readout"], [class*="minimap"], [class*="controls"], [class*="jump"], [class*="toggles"], [class*="drawer"], [class*="dock"], [class*="info"]',
      )
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0)
          out.push({ x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height });
      });
    return out;
  }, []);

  // the renderer keeps its own-ambush tags clear of the HUD cards
  useEffect(() => {
    if (!ready) return;
    rendererRef.current?.setHudBox(hudRects);
  }, [ready, hudRects]);

  // Selecting a plot pans the camera, only if needed, so the plot and its whole ring sit in the
  // clear part of the map. Once per selection; waits for a running camera move to finish.
  // The key includes the measured ring size: the first measure can precede the HUD scale, and the
  // fit must use the final size or the ring ends up a few pixels short and flips to a half ring.
  const pannedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!sel) {
      if (pannedFor.current !== null) {
        pannedFor.current = null;
        // slide back inside the normal pan limits if the fit had pushed past them
        rendererRef.current?.controller.relax(nowFn(), readMotionMs('--duration-slow'));
      }
      return;
    }
    const r = rendererRef.current;
    const key = `${sel.id}:${String(Math.round(menuBox.half))}`;
    if (!wantMenu || !r || menuBox.half <= 0 || pannedFor.current === key) return;
    const c = r.controller;
    if (c.moving) return;
    pannedFor.current = key;
    const at = worldToHud(sel, c.cam, c.viewport);
    // Fit only the plot itself (not the whole radial menu ring), so picking a district that is
    // already on screen never moves the camera; the menu is clamped into view separately.
    const plotHalf = (Math.min(sel.w, sel.h) / 2) * c.cam.zoom;
    const d = panToFit(at, plotHalf, c.viewport, hudRects());
    if (!d || (d.dx === 0 && d.dy === 0)) return;
    const target = { ...c.cam, x: c.cam.x - d.dx / c.cam.zoom, y: c.cam.y - d.dy / c.cam.zoom };
    c.animateTo(target, nowFn(), readMotionMs('--duration-slow'), true);
  }, [sel, wantMenu, menuBox.half, cam, hudRects]);
  const menuAt =
    sel && wantMenu
      ? clampMenu(
          worldToHud(sel, cam, vp),
          { w: vp.w, h: vp.h - menuBox.bottom },
          menuBox.half,
          menuBox,
        )
      : null;
  const menuId = menuAt && sel ? sel.id : null;
  useEffect(() => {
    rendererRef.current?.setMenuFor(menuId);
  }, [menuId, ready]);
  const compact = ready && vp.w < palette.map.compactBelowPx;

  const districtList = scene ? (
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
                setDrawer(null);
              }}
            >
              {d.name.toUpperCase()}
            </Button>
          </li>
        );
      })}
    </ul>
  ) : null;
  const minimap = scene ? (
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
  ) : null;

  return (
    <div
      ref={screenRef}
      className={styles['screen']}
      data-source={source}
      data-compact={compact}
      data-embedded={embed !== undefined}
    >
      <div ref={hostRef} className={styles['canvas']} data-testid="map-canvas" />
      {(failed || (hasScene && noWebGl)) && (
        <p className={styles['notice']}>The map needs WebGL.</p>
      )}
      {scene && (
        <>
          <div className={styles['top']}>
            <Panel
              className={cx(styles['readout'])}
              title="SECTOR"
              tag={source === 'demo' ? 'DEMO' : 'LIVE'}
            >
              <div className={styles['coords']}>{formatSector(col, row)}</div>
              <div className={styles['sub']}>
                {level.toUpperCase()} / {String(Math.max(1, Math.round(across)))} ACROSS /{' '}
                {String(scene.districts.length)} DISTRICTS
              </div>
            </Panel>

            {compact && (
              <div className={styles['toggles']}>
                <Button
                  variant={drawer === 'districts' ? 'primary' : 'ghost'}
                  aria-expanded={drawer === 'districts'}
                  onClick={() => {
                    setDrawer(drawer === 'districts' ? null : 'districts');
                  }}
                >
                  MY DISTRICTS {String(scene.mine.length)}
                </Button>
                <Button
                  variant={drawer === 'map' ? 'primary' : 'ghost'}
                  aria-expanded={drawer === 'map'}
                  onClick={() => {
                    setDrawer(drawer === 'map' ? null : 'map');
                  }}
                >
                  MAP
                </Button>
              </div>
            )}

            {!compact && embed === undefined && (
              <Panel
                className={cx(styles['jump'])}
                title="MY DISTRICTS"
                tag={String(scene.mine.length)}
              >
                {districtList}
              </Panel>
            )}
            {compact && drawer === 'districts' && (
              <Panel
                className={cx(styles['drawer'])}
                title="MY DISTRICTS"
                tag={String(scene.mine.length)}
              >
                {districtList}
              </Panel>
            )}
            {(!compact || drawer === 'map') && minimap}
          </div>

          <div className={styles['dock']}>
            <div className={styles['controls']}>
              <div className={styles['row']}>
                {LEVELS.map((l) => (
                  <Button
                    key={l.id}
                    variant={l.id === level ? 'primary' : 'ghost'}
                    onClick={() => {
                      goLevel(l.id);
                    }}
                  >
                    {l.label}
                  </Button>
                ))}
              </div>
              <div className={styles['row']}>
                <Button
                  className={styles['step']}
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
                  className={styles['step']}
                  aria-label="Zoom in"
                  onClick={() => {
                    act((r, now) => {
                      r.controller.animateZoomBy(ZOOM_STEP, now);
                    });
                  }}
                >
                  +
                </Button>
                <Button className={styles['recentre']} onClick={recentre}>
                  RECENTRE
                </Button>
              </div>
            </div>

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
              ref={setMenuEl}
              className={styles['menu']}
              style={vars({ '--x': `${String(menuAt.x)}px`, '--y': `${String(menuAt.y)}px` })}
            >
              <RadialMenu
                items={embed ? orderMenu({ ...sel, details: embed.onDetails !== undefined }) : MENU}
                title={sel.name.toUpperCase()}
                facing={menuAt.facing}
                // SETTLE is the one sensible order on an open plot: draw the eye to it
                selected={
                  embed && sel.open === true && !sel.mine && !sel.isHub ? 'settle' : undefined
                }
                onSelect={menuAction}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Grid position as `col,row`, each padded to two digits with the sign kept in front. */
export function formatSector(col: number, row: number): string {
  const part = (n: number) => `${n < 0 ? '-' : ''}${String(Math.abs(n)).padStart(2, '0')}`;
  return `${part(col)},${part(row)}`;
}

/**
 * Place the radial menu. It sits centred on its plot, clamped by its half-size to the map
 * viewport on the sides. When there is no room above the plot (the viewport top, or the HUD
 * sector card, whose far corner is `inset * 2`) the menu stays on the plot and fans its items
 * out below it as a half ring, so the plot is never covered; likewise upward at the bottom.
 */
export function clampMenu(
  at: { x: number; y: number },
  vp: { w: number; h: number },
  half: number,
  inset: { x: number; y: number },
): { x: number; y: number; facing: RadialFacing } {
  if (half <= 0) return { ...at, facing: 'around' };
  const clamp = (v: number, lo: number, hi: number) =>
    lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
  const x = clamp(at.x, half, vp.w - half);
  // a pan that just fits lands on the edge; sub-pixel rounding must not flip it to a half ring
  const underCard = x - half < inset.x * 2 - FIT_SLACK_PX;
  const top = underCard ? inset.y * 2 : 0;
  if (at.y - half < top - FIT_SLACK_PX)
    return { x, y: clamp(at.y, 0, vp.h - half), facing: 'down' };
  if (at.y + half > vp.h + FIT_SLACK_PX) return { x, y: Math.max(at.y, half), facing: 'up' };
  return { x, y: at.y, facing: 'around' };
}

function worldToHud(d: { cx: number; cy: number }, cam: Camera, vp: { w: number; h: number }) {
  return { x: (d.cx - cam.x) * cam.zoom + vp.w / 2, y: (d.cy - cam.y) * cam.zoom + vp.h / 2 };
}

export { DEMO_SELF };
