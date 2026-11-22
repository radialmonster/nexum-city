/**
 * Pure geometry for the inner look of a district: the per-kind texture (dock
 * cranes, power lines, data rows, field rows, stacks, windows), the faint inner
 * glow rings and the level-of-detail rules. Nothing here touches Pixi; the
 * renderer draws the primitives. All coordinates are relative to the district
 * centre in world units. Sizes and alphas come from the theme `map` tokens.
 */
import type { DistrictKind } from '@nexum/sim';
import type { MapTokens } from './scene';

export type Prim =
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; a: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill: boolean; a: number }
  | { k: 'circle'; x: number; y: number; r: number; fill: boolean; a: number };

export interface Lod {
  /** Draw the district name. */
  name: boolean;
  /** Draw the owner and kind lines. */
  sub: boolean;
  /** Draw the inner texture. */
  detail: boolean;
  /** Draw the denser close-up texture. */
  rich: boolean;
}

/** What to draw for a plot that is `blockPx` wide on screen. */
export function lodFor(blockPx: number, t: MapTokens): Lod {
  return {
    name: blockPx >= t.lodNameMinPx,
    sub: blockPx >= t.lodSubMinPx,
    detail: blockPx >= t.lodDetailMinPx,
    rich: blockPx >= t.lodRichMinPx,
  };
}

/** Scale an outline about its centre, for the stacked rings of the inner glow. */
export function insetPoints(points: readonly number[], k: number): number[] {
  return points.map((v) => v * k);
}

/** The glow rings of a district: scale factors from the edge inwards, with their alphas. */
export function glowRings(t: MapTokens): { k: number; a: number }[] {
  const n = Math.max(1, Math.round(t.innerGlowSteps));
  return Array.from({ length: n }, (_, i) => ({
    k: 1 - t.innerGlowInset * (i + 1),
    a: t.innerGlowAlpha * (1 - i / n),
  }));
}

const line = (x1: number, y1: number, x2: number, y2: number, a = 1): Prim => ({
  k: 'line',
  x1,
  y1,
  x2,
  y2,
  a,
});
const rect = (x: number, y: number, w: number, h: number, fill: boolean, a = 1): Prim => ({
  k: 'rect',
  x,
  y,
  w,
  h,
  fill,
  a,
});

/**
 * The texture of a district kind for a box `w` by `h`. It sits in a band below
 * the labels (and, when `rich`, a second band above them) so it never fights
 * the text. Hubs return nothing; the renderer draws their market face.
 */
export function kindDetail(kind: DistrictKind, w: number, h: number, rich: boolean): Prim[] {
  const out: Prim[] = [];
  const bands: [number, number][] = [[0.17 * h, 0.4 * h]];
  if (rich) bands.push([-0.4 * h, -0.26 * h]);
  const hw = 0.36 * w;
  bands.forEach(([top, bottom], bi) => {
    const bh = bottom - top;
    switch (kind) {
      case 'docks': {
        out.push(
          line(-hw, bottom, hw, bottom),
          line(-hw, bottom - bh * 0.14, hw, bottom - bh * 0.14, 0.5),
        );
        for (const cx of bi === 0 ? [-0.2 * w, 0.14 * w] : [0]) {
          out.push(
            line(cx, bottom, cx, top),
            line(cx - 0.1 * w, top, cx + 0.12 * w, top),
            line(cx + 0.12 * w, top, cx + 0.12 * w, top + bh * 0.4, 0.6),
          );
        }
        if (rich) {
          for (let i = 0; i < 4; i++) {
            out.push(
              rect(0.18 * w + i * 0.045 * w, bottom - bh * 0.42, 0.035 * w, bh * 0.28, false, 0.7),
            );
          }
        }
        break;
      }
      case 'grid': {
        const xs = [-0.28 * w, 0, 0.28 * w];
        for (const x of xs) {
          out.push(
            line(x, bottom, x, top),
            line(x - 0.05 * w, top + bh * 0.2, x + 0.05 * w, top + bh * 0.2),
          );
        }
        for (let i = 0; i + 1 < xs.length; i++) {
          const a = xs[i] as number;
          const b = xs[i + 1] as number;
          out.push(line(a + 0.05 * w, top + bh * 0.2, b - 0.05 * w, top + bh * 0.2, 0.6));
          if (rich)
            out.push(line(a + 0.05 * w, top + bh * 0.45, b - 0.05 * w, top + bh * 0.45, 0.4));
        }
        break;
      }
      case 'archive': {
        const n = rich ? 5 : 4;
        const widths = [0.72, 0.46, 0.62, 0.3, 0.55];
        const rh = bh / (n * 1.8);
        for (let i = 0; i < n; i++) {
          const rw = (widths[i % widths.length] as number) * hw * 2;
          out.push(rect(-hw, top + i * rh * 1.8, rw, rh, true, 0.8));
        }
        break;
      }
      case 'farms': {
        const n = rich ? 6 : 4;
        for (let i = 0; i < n; i++) {
          const y = top + (i + 0.5) * (bh / n);
          out.push(line(-hw, y, hw, y, 0.8));
        }
        if (rich) {
          for (let i = 0; i < 6; i++)
            out.push(
              line(
                -hw + (i + 0.5) * ((hw * 2) / 6),
                top,
                -hw + (i + 0.5) * ((hw * 2) / 6),
                bottom,
                0.3,
              ),
            );
        }
        break;
      }
      case 'stacks': {
        const hs = [0.5, 0.85, 0.65, 1, 0.55, 0.78];
        const n = hs.length;
        const cw = (hw * 2) / n;
        hs.forEach((f, i) => {
          out.push(rect(-hw + i * cw + cw * 0.15, bottom - bh * f, cw * 0.7, bh * f, true, 0.8));
        });
        break;
      }
      case 'residential': {
        const rows = rich ? 4 : 3;
        const cols = 7;
        const cw = (hw * 2) / cols;
        const rh = bh / rows;
        const s = Math.min(cw, rh) * 0.5;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            out.push(
              rect(
                -hw + c * cw + (cw - s) / 2,
                top + r * rh + (rh - s) / 2,
                s,
                s,
                (r + c) % 2 === 0,
                0.8,
              ),
            );
          }
        }
        break;
      }
      case 'hub':
        break;
    }
  });
  return out;
}

/** A small deterministic generator seeded from a plot id, so a plot always looks the same. */
function seeded(id: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * Lot lines and building footprints for a plot at district zoom: a column of seeded footprints
 * down each side margin and a couple of lot lines, so every plot has some texture even when it is
 * neutral. Same plot, same pattern. About a dozen primitives, all outside the label band.
 */
export function lotDetail(id: string, w: number, h: number): Prim[] {
  const rnd = seeded(id);
  const out: Prim[] = [];
  const rows = 4 + Math.floor(rnd() * 2);
  const colW = 0.09 * w;
  for (const side of [-1, 1]) {
    const edge = side * 0.4 * w;
    for (let r = 0; r < rows; r++) {
      if (rnd() < 0.2) continue;
      const bh = (0.1 + rnd() * 0.07) * h;
      const bw = colW * (0.6 + rnd() * 0.5);
      const y = -0.36 * h + r * ((0.72 * h) / rows);
      out.push(rect(side > 0 ? edge - bw : edge, y, bw, bh, rnd() < 0.5, 0.7));
    }
  }
  // lot lines framing the label band
  for (const f of [-0.3, 0.3]) {
    out.push(line(-0.3 * w, f * h, 0.3 * w, f * h, 0.35));
  }
  return out;
}
