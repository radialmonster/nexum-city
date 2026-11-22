/**
 * Camera maths and a small controller (pan inertia, animated zoom). No Pixi and
 * no DOM, so it is unit-tested directly. Zoom is stored as screen pixels per
 * world unit; levels are defined by how many plots fit across the viewport.
 */
import type { Bounds, MapTokens } from './scene';

export type ZoomLevel = 'city' | 'tactical' | 'district';

export interface Viewport {
  w: number;
  h: number;
}

/** `x`,`y` is the world point at the centre of the viewport. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function zoomForAcross(across: number, vpW: number, t: MapTokens): number {
  return vpW / (across * t.pitchX);
}

export function acrossForZoom(zoom: number, vpW: number, t: MapTokens): number {
  return vpW / (zoom * t.pitchX);
}

export function clampZoom(zoom: number, vp: Viewport, t: MapTokens): number {
  const lo = zoomForAcross(t.acrossMax, vp.w, t);
  const hi = zoomForAcross(t.acrossMin, vp.w, t);
  return Math.min(hi, Math.max(lo, zoom));
}

/** Which level a zoom belongs to. */
export function levelForZoom(zoom: number, vp: Viewport, t: MapTokens): ZoomLevel {
  const across = acrossForZoom(zoom, vp.w, t);
  if (across >= t.levelCityAcross) return 'city';
  if (across <= t.levelDistrictAcross) return 'district';
  return 'tactical';
}

export function zoomForLevel(level: ZoomLevel, vp: Viewport, t: MapTokens): number {
  const across =
    level === 'city' ? t.acrossCity : level === 'district' ? t.acrossDistrict : t.acrossTactical;
  return zoomForAcross(across, vp.w, t);
}

/** Zoom by `factor` keeping the world point under screen point (sx, sy) fixed. */
export function zoomAbout(
  cam: Camera,
  factor: number,
  sx: number,
  sy: number,
  vp: Viewport,
  t: MapTokens,
): Camera {
  const zoom = clampZoom(cam.zoom * factor, vp, t);
  const wx = cam.x + (sx - vp.w / 2) / cam.zoom;
  const wy = cam.y + (sy - vp.h / 2) / cam.zoom;
  return { x: wx - (sx - vp.w / 2) / zoom, y: wy - (sy - vp.h / 2) / zoom, zoom };
}

export function screenToWorld(
  cam: Camera,
  vp: Viewport,
  sx: number,
  sy: number,
): { x: number; y: number } {
  return { x: cam.x + (sx - vp.w / 2) / cam.zoom, y: cam.y + (sy - vp.h / 2) / cam.zoom };
}

export function worldToScreen(
  cam: Camera,
  vp: Viewport,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom + vp.w / 2, y: (wy - cam.y) * cam.zoom + vp.h / 2 };
}

/** The world rectangle the viewport shows. */
export function visibleRect(cam: Camera, vp: Viewport): Rect {
  const w = vp.w / cam.zoom;
  const h = vp.h / cam.zoom;
  return { x: cam.x - w / 2, y: cam.y - h / 2, w, h };
}

/**
 * Keep the camera centre inside the world bounds grown by a margin. When the
 * world is smaller than the view, it is centred instead.
 */
export function clampCamera(cam: Camera, vp: Viewport, bounds: Bounds, t: MapTokens): Camera {
  const zoom = clampZoom(cam.zoom, vp, t);
  const mx = t.panMarginPlots * t.pitchX;
  const my = t.panMarginPlots * t.pitchY;
  const minX = bounds.minX - mx;
  const maxX = bounds.maxX + mx;
  const minY = bounds.minY - my;
  const maxY = bounds.maxY + my;
  const halfW = vp.w / zoom / 2;
  const halfH = vp.h / zoom / 2;
  const fit = (v: number, lo: number, hi: number, half: number): number =>
    hi - lo <= half * 2 ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, v));
  return { x: fit(cam.x, minX, maxX, halfW), y: fit(cam.y, minY, maxY, halfH), zoom };
}

/** A camera that frames a world rectangle with some padding (fraction of the view). */
export function frameBounds(b: Bounds, vp: Viewport, t: MapTokens, pad = 0.08): Camera {
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const zoom = clampZoom(Math.min(vp.w / (w * (1 + pad * 2)), vp.h / (h * (1 + pad * 2))), vp, t);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, zoom };
}

const easeOutCubic = (p: number): number => 1 - (1 - p) ** 3;

interface Tween {
  from: Camera;
  to: Camera;
  start: number;
  duration: number;
  anchor: { sx: number; sy: number } | null;
}

/**
 * Owns the live camera: drag with inertia, wheel zoom about the cursor and
 * animated moves to a target. Call `update(nowMs)` every frame; it returns true
 * while the camera is still moving (so the renderer knows to redraw).
 */
export class CameraController {
  cam: Camera;
  private vp: Viewport;
  private tween: Tween | null = null;
  private vx = 0;
  private vy = 0;
  private dragging = false;
  private lastMove = 0;
  private lastUpdate = 0;

  private readonly tokens: MapTokens;
  private bounds: Bounds;

  constructor(tokens: MapTokens, bounds: Bounds, vp: Viewport, initial?: Camera) {
    this.tokens = tokens;
    this.bounds = bounds;
    this.vp = vp;
    this.cam = initial ?? frameBounds(bounds, vp, tokens);
  }

  setViewport(vp: Viewport): void {
    // keep the same number of plots across when the window resizes
    const zoom = this.cam.zoom * (vp.w / this.vp.w);
    this.vp = vp;
    this.cam = clampCamera({ ...this.cam, zoom }, vp, this.bounds, this.tokens);
  }

  setBounds(bounds: Bounds): void {
    this.bounds = bounds;
  }

  level(): ZoomLevel {
    return levelForZoom(this.cam.zoom, this.vp, this.tokens);
  }

  get viewport(): Viewport {
    return this.vp;
  }

  get moving(): boolean {
    return (
      this.tween !== null || this.dragging || Math.hypot(this.vx, this.vy) > this.tokens.inertiaStop
    );
  }

  // --- drag
  dragStart(): void {
    this.dragging = true;
    this.tween = null;
    this.vx = 0;
    this.vy = 0;
  }

  /** Move by a screen-space delta; remembers velocity for the release. */
  dragMove(dxPx: number, dyPx: number, nowMs: number): void {
    const dt = Math.max(1, nowMs - this.lastMove);
    this.lastMove = nowMs;
    this.cam = clampCamera(
      { ...this.cam, x: this.cam.x - dxPx / this.cam.zoom, y: this.cam.y - dyPx / this.cam.zoom },
      this.vp,
      this.bounds,
      this.tokens,
    );
    // world units per ms, smoothed
    this.vx = 0.6 * (-dxPx / this.cam.zoom / dt) + 0.4 * this.vx;
    this.vy = 0.6 * (-dyPx / this.cam.zoom / dt) + 0.4 * this.vy;
  }

  dragEnd(nowMs: number): void {
    this.dragging = false;
    // a pause before release cancels the fling
    if (nowMs - this.lastMove > 90) {
      this.vx = 0;
      this.vy = 0;
    }
  }

  // --- zoom
  wheel(deltaY: number, sx: number, sy: number): void {
    this.tween = null;
    const factor = Math.exp(-deltaY * this.tokens.wheelSensitivity);
    this.cam = clampCamera(
      zoomAbout(this.cam, factor, sx, sy, this.vp, this.tokens),
      this.vp,
      this.bounds,
      this.tokens,
    );
  }

  pinch(factor: number, sx: number, sy: number): void {
    this.tween = null;
    this.cam = clampCamera(
      zoomAbout(this.cam, factor, sx, sy, this.vp, this.tokens),
      this.vp,
      this.bounds,
      this.tokens,
    );
  }

  /** Animate to a target camera over `duration` ms. */
  animateTo(target: Camera, nowMs: number, duration = 380): void {
    this.vx = 0;
    this.vy = 0;
    this.tween = {
      from: { ...this.cam },
      to: clampCamera(target, this.vp, this.bounds, this.tokens),
      start: nowMs,
      duration,
      anchor: null,
    };
  }

  /** Animate to a zoom level about the screen centre (or a screen point). */
  animateToLevel(level: ZoomLevel, nowMs: number, at?: { sx: number; sy: number }): void {
    const zoom = zoomForLevel(level, this.vp, this.tokens);
    const sx = at?.sx ?? this.vp.w / 2;
    const sy = at?.sy ?? this.vp.h / 2;
    const target = zoomAbout(this.cam, zoom / this.cam.zoom, sx, sy, this.vp, this.tokens);
    this.animateTo(target, nowMs);
  }

  /** Animate a relative zoom step (buttons). */
  animateZoomBy(factor: number, nowMs: number): void {
    const target = zoomAbout(this.cam, factor, this.vp.w / 2, this.vp.h / 2, this.vp, this.tokens);
    this.animateTo(target, nowMs, 240);
  }

  /** Animate to centre on a world point, optionally changing zoom. */
  animateCentre(wx: number, wy: number, nowMs: number, zoom?: number): void {
    this.animateTo({ x: wx, y: wy, zoom: zoom ?? this.cam.zoom }, nowMs);
  }

  /** Jump instantly. */
  set(cam: Camera): void {
    this.tween = null;
    this.vx = 0;
    this.vy = 0;
    this.cam = clampCamera(cam, this.vp, this.bounds, this.tokens);
  }

  /** Advance animation and inertia. Returns true if the camera changed. */
  update(nowMs: number): boolean {
    const dt = this.lastUpdate === 0 ? 16 : Math.min(64, nowMs - this.lastUpdate);
    this.lastUpdate = nowMs;
    if (this.tween) {
      const p = Math.min(1, (nowMs - this.tween.start) / this.tween.duration);
      const e = easeOutCubic(p);
      const { from, to } = this.tween;
      // interpolate zoom geometrically so it feels even
      const zoom = from.zoom * (to.zoom / from.zoom) ** e;
      this.cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, zoom };
      if (p >= 1) this.tween = null;
      return true;
    }
    if (this.dragging) return false;
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > this.tokens.inertiaStop / 20) {
      const before = this.cam;
      this.cam = clampCamera(
        { ...this.cam, x: this.cam.x + this.vx * dt, y: this.cam.y + this.vy * dt },
        this.vp,
        this.bounds,
        this.tokens,
      );
      const decay = this.tokens.inertiaFriction ** (dt / 16);
      this.vx *= decay;
      this.vy *= decay;
      if (this.cam.x === before.x) this.vx = 0;
      if (this.cam.y === before.y) this.vy = 0;
      if (Math.hypot(this.vx, this.vy) < this.tokens.inertiaStop / 20) {
        this.vx = 0;
        this.vy = 0;
      }
      return true;
    }
    return false;
  }
}
