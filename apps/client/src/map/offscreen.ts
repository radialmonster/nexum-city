/**
 * Off-screen edge arrows: for districts and alerts outside the viewport, find
 * where to draw an arrow on the viewport edge and which way it points.
 */
import { worldToScreen, type Camera, type Viewport } from './camera';

export interface ArrowTarget {
  id: string;
  wx: number;
  wy: number;
  kind: 'owned' | 'alert';
  label?: string;
}

export interface EdgeArrow {
  id: string;
  kind: 'owned' | 'alert';
  label: string;
  /** Position on the viewport edge, in screen px. */
  x: number;
  y: number;
  /** Direction towards the target, radians. */
  angle: number;
  /** Distance to the target in screen px (for sorting and labels). */
  distance: number;
}

/**
 * Clip the ray from the viewport centre towards a screen point to a rectangle
 * inset from the edges. Returns null when the point is inside the rectangle.
 */
export function edgePoint(
  sx: number,
  sy: number,
  vp: Viewport,
  inset: number,
): { x: number; y: number; angle: number } | null {
  const cx = vp.w / 2;
  const cy = vp.h / 2;
  const dx = sx - cx;
  const dy = sy - cy;
  const hw = Math.max(1, cx - inset);
  const hh = Math.max(1, cy - inset);
  if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) return null;
  const k = Math.min(
    dx === 0 ? Infinity : hw / Math.abs(dx),
    dy === 0 ? Infinity : hh / Math.abs(dy),
  );
  return { x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dy, dx) };
}

/** Arrows for every target that is outside the view; alerts first, then nearest. */
export function edgeArrows(
  targets: readonly ArrowTarget[],
  cam: Camera,
  vp: Viewport,
  inset: number,
  max = 12,
): EdgeArrow[] {
  const out: EdgeArrow[] = [];
  for (const t of targets) {
    const s = worldToScreen(cam, vp, t.wx, t.wy);
    const e = edgePoint(s.x, s.y, vp, inset);
    if (!e) continue;
    out.push({
      id: t.id,
      kind: t.kind,
      label: t.label ?? '',
      x: e.x,
      y: e.y,
      angle: e.angle,
      distance: Math.hypot(s.x - vp.w / 2, s.y - vp.h / 2),
    });
  }
  out.sort((a, b) => (a.kind === b.kind ? a.distance - b.distance : a.kind === 'alert' ? -1 : 1));
  return out.slice(0, max);
}
