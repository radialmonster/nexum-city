/**
 * The PixiJS v8 map renderer. It owns the `Application`, draws the scene from
 * `layoutWorld` and forwards pointer input to the `CameraController`. All sizes
 * and colours come from the theme palette; nothing is hard-coded here. This
 * module is imported lazily by the React screen so jsdom tests never load Pixi.
 */
import type { PixiColor, PixiPalette } from '@nexum/theme';
import type { Id } from '@nexum/sim';
import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  CameraController,
  frameBounds,
  levelForZoom,
  screenToWorld,
  visibleRect,
  worldToScreen,
  zoomForLevel,
  type Camera,
  type ZoomLevel,
} from './camera';
import { readHudScale } from './hudScale';
import { glowRings, insetPoints, kindDetail, lodFor, type Lod } from './detail';
import {
  moverPose,
  panBounds,
  pickDistrict,
  territories,
  type Scene,
  type SceneDistrict,
} from './scene';

export interface RendererCallbacks {
  /** The camera or its level changed (called at most once per frame). */
  onFrame: (cam: Camera, level: ZoomLevel) => void;
  /** A click that was not a drag. `id` is null for empty ground. */
  onPick: (id: Id | null, sx: number, sy: number) => void;
}

function dashedLine(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash: number,
  gap: number,
): void {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len === 0) return;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    g.moveTo(x1 + ux * d, y1 + uy * d).lineTo(x1 + ux * e, y1 + uy * e);
  }
}

function dashedPolygon(
  g: Graphics,
  pts: readonly number[],
  ox: number,
  oy: number,
  dash: number,
  gap: number,
): void {
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    dashedLine(
      g,
      ox + (pts[i * 2] as number),
      oy + (pts[i * 2 + 1] as number),
      ox + (pts[j * 2] as number),
      oy + (pts[j * 2 + 1] as number),
      dash,
      gap,
    );
  }
}

const withA = (c: PixiColor, a: number): { color: number; alpha: number } => ({
  color: c.color,
  alpha: c.alpha * a,
});

export class MapRenderer {
  readonly controller: CameraController;
  private readonly app: Application;
  private readonly world = new Container();
  private readonly base = new Graphics();
  private readonly dyn = new Graphics();
  private readonly labelLayer = new Container();
  private readonly labels = new Map<string, Text>();
  private readonly pal: PixiPalette;
  private readonly host: HTMLElement;
  private readonly cb: RendererCallbacks;
  private scene: Scene;
  private selected: Id | null = null;
  private preview: number[] | null = null;
  private hudScale = 1;
  private dirty = true;
  private baseDirty = true;
  private builtZoom = 0;
  private builtLevel: ZoomLevel = 'tactical';
  private builtLod = '';
  private lastCam: Camera | null = null;
  private lastLevel: ZoomLevel | null = null;
  private raf = 0;
  private baseNow: number;
  private t0 = performance.now();
  private readonly observer: ResizeObserver;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private downAt: { x: number; y: number } | null = null;
  private dragging = false;
  private disposed = false;
  private readonly cleanup: (() => void)[] = [];
  /** Frames drawn, for performance checks. */
  frames = 0;

  private constructor(
    app: Application,
    host: HTMLElement,
    pal: PixiPalette,
    scene: Scene,
    nowMs: number,
    cb: RendererCallbacks,
  ) {
    this.app = app;
    this.host = host;
    this.pal = pal;
    this.scene = scene;
    this.baseNow = nowMs;
    this.cb = cb;
    const vp = { w: host.clientWidth || 1, h: host.clientHeight || 1 };
    this.controller = new CameraController(pal.map, panBounds(scene, pal.map), vp);
    this.observer = new ResizeObserver(() => {
      this.resize();
    });
  }

  static async create(
    host: HTMLElement,
    pal: PixiPalette,
    scene: Scene,
    nowMs: number,
    cb: RendererCallbacks,
  ): Promise<MapRenderer> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoStart: false,
      preference: 'webgl',
    });
    const r = new MapRenderer(app, host, pal, scene, nowMs, cb);
    r.mount();
    return r;
  }

  private mount(): void {
    this.hudScale = readHudScale();
    this.host.appendChild(this.app.canvas);
    this.world.addChild(this.base, this.dyn);
    this.app.stage.addChild(this.world, this.labelLayer);
    this.observer.observe(this.host);
    this.attachInput(this.app.canvas);
    this.resize();
    this.raf = requestAnimationFrame(this.tick);
  }

  // ------------------------------------------------------------- public API

  setScene(scene: Scene, nowMs: number): void {
    this.scene = scene;
    this.baseNow = nowMs;
    this.t0 = performance.now();
    this.controller.setBounds(panBounds(scene, this.pal.map));
    this.baseDirty = true;
    this.dirty = true;
  }

  setSelection(id: Id | null): void {
    this.selected = id;
    this.baseDirty = true;
    this.dirty = true;
  }

  setRoutePreview(path: number[] | null): void {
    this.preview = path;
    this.dirty = true;
  }

  /** The HUD scale changed (window moved to another screen, or the setting changed). */
  refreshScale(): void {
    this.hudScale = readHudScale();
    for (const t of this.labels.values()) t.destroy();
    this.labels.clear();
    this.dirty = true;
  }

  setLevel(level: ZoomLevel): void {
    this.controller.set({
      ...this.controller.cam,
      zoom: zoomForLevel(level, this.controller.viewport, this.pal.map),
    });
  }

  frameAll(): void {
    this.controller.set(frameBounds(this.scene.bounds, this.controller.viewport, this.pal.map));
  }

  /** Force a frame now (used by screenshot tooling). */
  renderNow(): void {
    this.draw(performance.now());
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    for (const fn of this.cleanup) fn();
    this.app.destroy(true, { children: true });
  }

  // ------------------------------------------------------------------ input

  private attachInput(el: HTMLCanvasElement): void {
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      el.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => {
        el.removeEventListener(type, fn as EventListener);
      });
    };
    const local = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    el.style.touchAction = 'none';
    on('pointerdown', (e) => {
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      el.setPointerCapture(e.pointerId);
      if (this.pointers.size === 1) {
        this.downAt = p;
        this.dragging = false;
      } else if (this.pointers.size === 2) {
        this.pinchDist = this.pointerSpan();
        this.dragging = true;
      }
    });
    on('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size >= 2) {
        const span = this.pointerSpan();
        if (this.pinchDist > 0 && span > 0) {
          const mid = this.pointerMid();
          this.controller.pinch(span / this.pinchDist, mid.x, mid.y);
        }
        this.pinchDist = span;
        this.dirty = true;
        return;
      }
      if (!this.dragging && this.downAt) {
        if (Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) < this.pal.map.dragSlop) return;
        this.dragging = true;
        this.controller.dragStart();
      }
      if (this.dragging) {
        this.controller.dragMove(p.x - prev.x, p.y - prev.y, performance.now());
        this.dirty = true;
      }
    });
    const up = (e: PointerEvent): void => {
      const p = local(e);
      const had = this.pointers.delete(e.pointerId);
      if (!had) return;
      if (this.pointers.size === 0) {
        if (this.dragging) this.controller.dragEnd(performance.now());
        else if (e.type === 'pointerup') this.pick(p.x, p.y);
        this.dragging = false;
        this.downAt = null;
      } else {
        this.pinchDist = 0;
      }
    };
    on('pointerup', up);
    on('pointercancel', up);
    on(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = local(e);
        const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        this.controller.wheel(dy, p.x, p.y);
        this.dirty = true;
      },
      { passive: false },
    );
  }

  private pointerSpan(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private pointerMid(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
  }

  private pick(sx: number, sy: number): void {
    const w = screenToWorld(this.controller.cam, this.controller.viewport, sx, sy);
    const d = pickDistrict(
      this.scene,
      w.x,
      w.y,
      this.pal.map.pickRadiusPx / this.controller.cam.zoom,
    );
    this.cb.onPick(d?.id ?? null, sx, sy);
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w < 1 || h < 1) return;
    this.app.renderer.resize(w, h);
    this.controller.setViewport({ w, h });
    this.hudScale = readHudScale();
    this.baseDirty = true;
    this.dirty = true;
  }

  // ----------------------------------------------------------------- frames

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const moved = this.controller.update(now);
    const animated =
      this.scene.movers.length > 0 ||
      this.scene.alerts.length > 0 ||
      this.scene.districts.some((d) => d.siege !== null);
    if (moved || this.dirty || animated) this.draw(now);
  };

  private draw(now: number): void {
    const cam = this.controller.cam;
    const vp = this.controller.viewport;
    const level = this.controller.level();
    if (
      this.lodKey(cam.zoom) !== this.builtLod ||
      level !== this.builtLevel ||
      this.builtZoom === 0 ||
      Math.abs(Math.log(cam.zoom / this.builtZoom)) > 0.25
    ) {
      this.baseDirty = true;
    }
    this.world.position.set(vp.w / 2 - cam.x * cam.zoom, vp.h / 2 - cam.y * cam.zoom);
    this.world.scale.set(cam.zoom);
    if (this.baseDirty) this.drawBase(level, cam.zoom);
    this.drawDynamic(now, level, cam.zoom);
    this.drawLabels(level, cam);
    this.app.render();
    this.dirty = false;
    this.frames++;
    const last = this.lastCam;
    if (
      !last ||
      last.x !== cam.x ||
      last.y !== cam.y ||
      last.zoom !== cam.zoom ||
      this.lastLevel !== level
    ) {
      this.lastCam = { ...cam };
      this.lastLevel = level;
      this.cb.onFrame({ ...cam }, level);
    }
  }

  /** The level-of-detail flags for a zoom, as a string so changes are cheap to spot. */
  private lodKey(zoom: number): string {
    const l = this.lodAt(zoom);
    return `${l.name ? 'n' : '-'}${l.sub ? 's' : '-'}${l.detail ? 'd' : '-'}${l.rich ? 'r' : '-'}`;
  }

  private lodAt(zoom: number): Lod {
    return lodFor(this.pal.map.pitchX * zoom, this.pal.map);
  }

  private drawBase(level: ZoomLevel, zoom: number): void {
    const { pal, scene, base: g } = this;
    const m = pal.map;
    const px = 1 / zoom;
    const lod = this.lodAt(zoom);
    g.clear();
    this.builtLod = this.lodKey(zoom);
    this.builtZoom = zoom;
    this.builtLevel = level;
    this.baseDirty = false;

    // the Sound
    const b = scene.bounds;
    const padX = m.pitchX * 8;
    const left = b.minX - padX;
    const wide = b.maxX - b.minX + padX * 2;
    g.rect(left, scene.waterTop, wide, m.pitchY * 5).fill(pal.color.waterDeep);
    g.rect(left, scene.waterTop, wide, m.pitchY * 1.2).fill(withA(pal.color.water, 1));
    g.moveTo(left, scene.waterTop)
      .lineTo(left + wide, scene.waterTop)
      .stroke({ width: m.edgeWidth * px, ...pal.color.waterEdge });

    const city = level === 'city';

    // streets
    if (!city) {
      for (const s of scene.streets) {
        if (s.planned) {
          g.stroke({ width: m.streetCoreWidth * px, ...pal.color.streetPlanned });
          dashedLine(g, s.x1, s.y1, s.x2, s.y2, m.streetDash * px * 2, m.streetDashGap * px * 2);
        }
      }
      g.stroke({ width: m.streetCoreWidth * px, ...pal.color.streetPlanned });
      for (const s of scene.streets) {
        if (!s.planned) g.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2);
      }
      g.stroke({ width: m.streetCoreWidth * 5 * px, ...pal.color.streetGlow });
      for (const s of scene.streets) {
        if (!s.planned) g.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2);
      }
      g.stroke({ width: m.streetCoreWidth * 2 * px, ...pal.color.street });
    }

    // districts
    for (const d of scene.districts) this.drawDistrict(g, d, level, px, lod);
    if (city) this.drawTerritoryEdges(g, px);
  }

  /** CITY level: a bold outline in the faction colour where one crew's land meets anything else. */
  private drawTerritoryEdges(g: Graphics, px: number): void {
    const { scene, pal } = this;
    const m = pal.map;
    const key = (gx: number, gy: number): string => `${gx},${gy}`;
    const grid = new Map<string, SceneDistrict>();
    for (const d of scene.districts) {
      if (d.isHub) continue;
      grid.set(key(Math.round(d.cx / m.pitchX), Math.round(d.cy / m.pitchY)), d);
    }
    const hw = m.pitchX / 2;
    const hh = m.pitchY / 2;
    const sides: [number, number, number, number, number, number][] = [
      [0, -1, -hw, -hh, hw, -hh],
      [1, 0, hw, -hh, hw, hh],
      [0, 1, -hw, hh, hw, hh],
      [-1, 0, -hw, -hh, -hw, hh],
    ];
    for (const d of scene.districts) {
      if (d.isHub || d.owner === 'neutral' || d.remembered) continue;
      const gx = Math.round(d.cx / m.pitchX);
      const gy = Math.round(d.cy / m.pitchY);
      for (const [dx, dy, x1, y1, x2, y2] of sides) {
        const n = grid.get(key(gx + dx, gy + dy));
        if (n && n.owner === d.owner) continue;
        g.moveTo(d.cx + x1, d.cy + y1).lineTo(d.cx + x2, d.cy + y2);
        g.stroke({ width: m.edgeWidthSelected * 1.5 * px, ...pal.faction[d.role] });
      }
    }
  }

  private drawDistrict(
    g: Graphics,
    d: SceneDistrict,
    level: ZoomLevel,
    px: number,
    lod: Lod,
  ): void {
    const { pal } = this;
    const m = pal.map;
    const role = pal.faction[d.role];
    const city = level === 'city';
    const unclaimed = d.owner === 'neutral' && !d.isHub;
    const sel = this.selected === d.id;
    const pts = city && !d.isHub ? this.cityPoints() : d.points;
    const flat = Array.from(pts, (v, i) => v + (i % 2 === 0 ? d.cx : d.cy));
    if (d.remembered) {
      g.poly(flat, true).fill(withA(pal.color.fog, m.fogCover));
      g.stroke({ width: m.fogLine * px * 0.5, ...pal.color.fogStatic });
      dashedPolygon(g, pts, d.cx, d.cy, m.frontierDash * px, m.frontierDashGap * px);
      if (d.owner !== 'neutral' && city) g.poly(flat, true).fill(withA(role, m.fogDim * 0.5));
      return;
    }
    if (d.isHub) {
      g.poly(flat, true).fill(withA(pal.color.accent, m.fillAlphaNeutral));
      g.poly(flat, true).stroke({ width: m.edgeWidth * 1.5 * px, ...pal.color.accent });
      if (city) {
        g.circle(d.cx, d.cy, m.hubRadius * 0.14).fill(pal.color.accent);
        return;
      }
      this.glow(g, d, pal.color.accent);
      // the market face: a header rule under the label and a baseline for the price bars
      const R = m.hubRadius;
      const rule = (y: number, a: number): void => {
        g.moveTo(d.cx - R * 0.55, d.cy + y)
          .lineTo(d.cx + R * 0.55, d.cy + y)
          .stroke({ width: m.detailLine * px, ...withA(pal.color.accent, a) });
      };
      if (lod.detail) {
        rule(-R * 0.08, m.detailAlpha);
        rule(R * 0.66, m.detailAlpha * 1.5);
      }
      return;
    }
    const alpha = unclaimed ? m.fillAlphaNeutral : city ? m.fillAlphaCity : m.fillAlpha;
    // an opaque base so the streets drawn underneath do not show through the tint
    if (!city) g.poly(flat, true).fill(pal.color.bg);
    g.poly(flat, true).fill(withA(role, alpha));
    if (!city) {
      this.glow(g, d, role);
      if (lod.detail) this.texture(g, d, role, lod.rich, px, unclaimed ? 0.6 : 1);
    }
    if (city) {
      // a hairline per plot keeps the territory readable as a grid of plots
      g.poly(flat, true).stroke({
        width: m.streetCoreWidth * px,
        ...pal.color.bg,
        alpha: unclaimed ? 0.5 : 0.8,
      });
      return;
    }
    const lw = (sel ? m.edgeWidthSelected : m.edgeWidth) * px;
    if (unclaimed) {
      g.poly(flat, true).stroke({ width: lw, ...pal.color.plot });
    } else {
      if (sel || d.mine) g.poly(flat, true).stroke({ width: lw * 3, ...withA(role, 0.18) });
      g.poly(flat, true).stroke({ width: lw, ...role });
    }
    if (sel) g.poly(flat, true).stroke({ width: m.edgeWidthSelected * px, ...pal.color.accentAlt });
  }

  /** The faint inner glow: outline rings stepping inwards and fading. */
  private glow(g: Graphics, d: SceneDistrict, colour: PixiColor): void {
    const m = this.pal.map;
    for (const r of glowRings(m)) {
      const ring = Array.from(
        insetPoints(d.points, r.k),
        (v, i) => v + (i % 2 === 0 ? d.cx : d.cy),
      );
      g.poly(ring, true).stroke({
        width: (m.edgeWidth * 2) / this.controller.cam.zoom,
        ...withA(colour, r.a),
      });
    }
  }

  /** The per-kind inner texture (cranes, power lines, data rows, fields, windows). */
  private texture(
    g: Graphics,
    d: SceneDistrict,
    colour: PixiColor,
    rich: boolean,
    px: number,
    k: number,
  ): void {
    const m = this.pal.map;
    for (const p of kindDetail(d.kind, d.w, d.h, rich)) {
      if (p.k === 'line') {
        g.moveTo(d.cx + p.x1, d.cy + p.y1)
          .lineTo(d.cx + p.x2, d.cy + p.y2)
          .stroke({ width: m.detailLine * px, ...withA(colour, m.detailAlpha * p.a * k) });
      } else {
        if (p.k === 'rect') g.rect(d.cx + p.x, d.cy + p.y, p.w, p.h);
        else g.circle(d.cx + p.x, d.cy + p.y, p.r);
        if (p.fill) g.fill(withA(colour, m.detailFillAlpha * p.a * k));
        else g.stroke({ width: m.detailLine * px, ...withA(colour, m.detailAlpha * p.a * k) });
      }
    }
  }

  /** In the city view districts grow to the full pitch so territories read as blobs. */
  private cityPoints(): number[] {
    const m = this.pal.map;
    const hw = m.pitchX / 2;
    const hh = m.pitchY / 2;
    return [-hw, -hh, hw, -hh, hw, hh, -hw, hh];
  }

  private drawDynamic(now: number, level: ZoomLevel, zoom: number): void {
    const { pal, scene, dyn: g } = this;
    const m = pal.map;
    const px = 1 / zoom;
    g.clear();

    // hub price bars
    if (level !== 'city') {
      const goodColours = [pal.color.accent, pal.color.warn, pal.color.accentAlt, pal.color.ok];
      for (const d of scene.districts) {
        if (!d.prices) continue;
        const n = d.prices.length;
        const total = n * m.priceBarWidth + (n - 1) * m.priceBarGap;
        const x0 = d.cx - total / 2;
        const floor = d.cy + m.hubRadius * 0.62;
        d.prices.forEach((p, i) => {
          const c = goodColours[i] ?? pal.color.accent;
          const x = x0 + i * (m.priceBarWidth + m.priceBarGap);
          g.rect(x, floor - m.priceBarHeight, m.priceBarWidth, m.priceBarHeight).fill(
            pal.color.track,
          );
          const hgt = m.priceBarHeight * p;
          g.rect(x, floor - hgt, m.priceBarWidth, hgt).fill(c);
        });
      }
    }

    // slots at the close-up level, and stock bars
    if (level === 'district') {
      for (const d of scene.districts) {
        if (!d.visible || d.slots.length === 0) continue;
        const sz = m.slotSize;
        const total = d.slots.length * (sz + m.priceBarGap) - m.priceBarGap;
        d.slots.forEach((s, i) => {
          const x = d.cx - total / 2 + i * (sz + m.priceBarGap);
          const y = d.cy + d.h / 2 - sz - m.ringGap;
          g.rect(x, y, sz, sz).fill(
            s.level > 0 ? withA(pal.faction[d.role], 0.55) : pal.color.track,
          );
          g.rect(x, y, sz, sz).stroke({ width: m.edgeWidth * px, ...pal.color.lineSoft });
        });
        const bw = d.w * 0.6;
        const by = d.cy + d.h / 2 - m.slotSize * 2 - m.ringGap * 2;
        g.rect(d.cx - bw / 2, by, bw, m.ringWidth).fill(pal.color.track);
        g.rect(d.cx - bw / 2, by, bw * d.stock, m.ringWidth).fill(pal.color.ok);
      }
    }

    // capture rings
    for (const d of scene.districts) {
      if (d.siege === null) continue;
      const r = Math.min(d.w, d.h) / 2 + m.ringGap;
      g.circle(d.cx, d.cy, r).stroke({ width: m.ringWidth * px * 1.5, ...pal.color.track });
      const a0 = -Math.PI / 2;
      g.arc(d.cx, d.cy, r, a0, a0 + Math.PI * 2 * d.siege).stroke({
        width: m.ringWidth * px * 1.5,
        ...pal.color.danger,
      });
    }

    // alert pings
    for (const a of scene.alerts) {
      const d = scene.byId[a.districtId];
      const base = d ? Math.min(d.w, d.h) / 2 : m.hubRadius;
      const k = (now % 1600) / 1600;
      g.circle(a.x, a.y, base + k * m.pitchX * 0.35).stroke({
        width: m.edgeWidth * px,
        ...withA(pal.color.danger, 1 - k),
      });
    }

    // route preview
    const pv = this.preview;
    if (pv && pv.length >= 4) {
      for (let i = 0; i + 3 < pv.length; i += 2) {
        dashedLine(
          g,
          pv[i] as number,
          pv[i + 1] as number,
          pv[i + 2] as number,
          pv[i + 3] as number,
          m.streetDash * px * 2.5,
          m.streetDashGap * px * 2,
        );
      }
      g.stroke({ width: m.edgeWidthSelected * px, ...pal.color.accentAlt });
    }

    // carriers
    const size = Math.max(m.slotSize * 0.5, 9 * px * this.hudScale) * m.carrierScale;
    for (const mv of scene.movers) {
      let pose: { x: number; y: number; angle: number };
      if (scene.loopMovements && !mv.fixed) {
        pose = moverPose({ ...mv, departMs: 0, arriveMs: m.demoLoopMs }, now, true);
      } else {
        const t = this.baseNow + (now - this.t0);
        pose = moverPose(mv, t, false);
      }
      const col = pal.faction[mv.role];
      const c = Math.cos(pose.angle);
      const s = Math.sin(pose.angle);
      const pt = (fx: number, fy: number): [number, number] => [
        pose.x + (fx * c - fy * s) * size,
        pose.y + (fx * s + fy * c) * size,
      ];
      const [ax, ay] = pt(1.2, 0);
      const [bx, by] = pt(-0.8, 0.7);
      const [cx, cy] = pt(-0.8, -0.7);
      g.circle(pose.x, pose.y, size * 1.6).fill(withA(col, 0.18));
      g.poly([ax, ay, bx, by, cx, cy], true).fill(col);
      g.poly([ax, ay, bx, by, cx, cy], true).stroke({
        width: m.edgeWidth * 0.5 * px,
        ...pal.color.textBright,
      });
    }
  }

  private label(key: string, text: string, size: number, fill: PixiColor, mono: boolean): Text {
    let t = this.labels.get(key);
    if (!t) {
      t = new Text({
        text,
        style: {
          fontFamily: mono ? this.pal.font.mono : this.pal.font.head,
          fontSize: size,
          fill: fill.color,
          stroke: { color: this.pal.color.labelHalo.color, width: Math.max(2, size * 0.28) },
          letterSpacing: size * 0.08,
        },
        resolution: Math.min(2, window.devicePixelRatio || 1) * 1.5,
      });
      t.anchor.set(0.5);
      this.labelLayer.addChild(t);
      this.labels.set(key, t);
    }
    if (t.text !== text) t.text = text;
    return t;
  }

  /** Show a label shrunk to fit `maxPx` wide, or hide it when that would make it unreadable. */
  private place(t: Text, x: number, y: number, maxPx: number, alpha = 1): void {
    t.scale.set(1);
    const k = Math.min(1, maxPx / Math.max(1, t.width));
    t.scale.set(k);
    t.position.set(x, y);
    t.alpha = alpha;
    t.visible = k >= this.pal.map.labelMinScale;
  }

  private drawLabels(level: ZoomLevel, cam: Camera): void {
    const vp = this.controller.viewport;
    const { pal, scene } = this;
    const m = pal.map;
    const fs = pal.fontSize;
    for (const t of this.labels.values()) t.visible = false;
    const lod = this.lodAt(cam.zoom);
    if (level === 'city') {
      const size = fs.lg * this.hudScale * m.cityLabelScale;
      for (const tr of territories(scene)) {
        const s = worldToScreen(cam, vp, tr.cx, tr.cy);
        const t = this.label(`t:${tr.owner}`, tr.label, size, pal.faction[tr.role], false);
        const reach = Math.sqrt(tr.count) * m.pitchX * cam.zoom * 1.6;
        this.place(t, s.x, s.y, reach);
      }
    } else if (lod.name) {
      this.districtLabels(level, cam, lod);
    }
    // the Sound
    const w = worldToScreen(
      cam,
      vp,
      (scene.bounds.minX + scene.bounds.maxX) / 2,
      scene.waterTop + m.pitchY * 0.5,
    );
    const sound = this.label(
      'sound',
      'THE SOUND',
      fs['2xl'] * this.hudScale * (level === 'city' ? m.cityLabelScale : 1),
      pal.color.waterLabel,
      false,
    );
    sound.scale.set(1);
    sound.position.set(w.x, w.y);
    sound.alpha = 1;
    sound.visible = true;
  }

  private districtLabels(level: ZoomLevel, cam: Camera, lod: Lod): void {
    const vp = this.controller.viewport;
    const { pal, scene } = this;
    const m = pal.map;
    const fs = pal.fontSize;
    const view = visibleRect(cam, vp);
    const pad = m.pitchX;
    const nameSize = (level === 'district' ? fs.xl : fs.md) * this.hudScale;
    const subSize = (level === 'district' ? fs.md : fs.xs) * this.hudScale;
    for (const d of scene.districts) {
      if (
        d.cx < view.x - pad ||
        d.cx > view.x + view.w + pad ||
        d.cy < view.y - pad ||
        d.cy > view.y + view.h + pad
      )
        continue;
      const s = worldToScreen(cam, vp, d.cx, d.cy);
      const dim = d.remembered;
      const colour = dim ? pal.color.textDim : d.isHub ? pal.color.accent : pal.color.text;
      // hubs are octagons, so their text has less room than the box suggests
      const room = d.w * cam.zoom * (d.isHub ? 0.72 : 1) * m.labelFit;
      const nameY = d.isHub ? -d.h * 0.27 : -d.h * 0.1;
      const name = this.label(`n:${d.id}`, d.name.toUpperCase(), nameSize, colour, true);
      this.place(name, s.x, s.y + nameY * cam.zoom, room, dim ? 0.7 : 1);
      if (!lod.sub) continue;
      // fog hides who holds a plot, never what it is: remembered plots show only their kind
      const text = d.isHub
        ? 'PUBLIC MARKET'
        : dim
          ? d.kind.toUpperCase()
          : `${d.ownerLabel} · ${d.kind.toUpperCase()}`;
      const subColour =
        d.isHub || dim
          ? pal.color.textDim
          : d.owner === 'neutral'
            ? pal.color.textDim
            : pal.faction[d.role];
      const sub = this.label(`k:${d.id}`, text, subSize, subColour, true);
      this.place(sub, s.x, s.y + (d.isHub ? -d.h * 0.12 : d.h * 0.07) * cam.zoom, room);
    }
  }
}

export { levelForZoom };
