import { themes, toPixiPalette } from '@nexum/theme';
import { describe, expect, it } from 'vitest';
import { glowRings, insetPoints, kindDetail, lodFor, lotDetail, type Prim } from './detail';

const t = toPixiPalette(themes.neon).map;
const KINDS = ['docks', 'grid', 'archive', 'farms', 'stacks', 'residential'] as const;

const extent = (p: Prim): [number, number, number, number] =>
  p.k === 'line'
    ? [Math.min(p.x1, p.x2), Math.min(p.y1, p.y2), Math.max(p.x1, p.x2), Math.max(p.y1, p.y2)]
    : p.k === 'rect'
      ? [p.x, p.y, p.x + p.w, p.y + p.h]
      : [p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r];

describe('kindDetail', () => {
  it.each(KINDS)('%s draws texture inside its box, and more when rich', (kind) => {
    const w = 190;
    const h = 200;
    const plain = kindDetail(kind, w, h, false);
    const rich = kindDetail(kind, w, h, true);
    expect(plain.length).toBeGreaterThan(2);
    expect(rich.length).toBeGreaterThan(plain.length);
    for (const p of rich) {
      const [x0, y0, x1, y1] = extent(p);
      expect(x0).toBeGreaterThanOrEqual(-w / 2);
      expect(x1).toBeLessThanOrEqual(w / 2);
      expect(y0).toBeGreaterThanOrEqual(-h / 2);
      expect(y1).toBeLessThanOrEqual(h / 2);
      expect(p.a).toBeGreaterThan(0);
      expect(p.a).toBeLessThanOrEqual(1);
    }
  });

  it('gives each kind its own texture and leaves hubs to the renderer', () => {
    const sig = KINDS.map((k) => JSON.stringify(kindDetail(k, 190, 200, false)));
    expect(new Set(sig).size).toBe(KINDS.length);
    expect(kindDetail('hub', 190, 200, true)).toEqual([]);
  });
});

describe('lodFor', () => {
  it('hides labels and texture on small blocks and adds them as blocks grow', () => {
    expect(lodFor(t.lodNameMinPx - 1, t)).toEqual({
      name: false,
      sub: false,
      detail: false,
      rich: false,
    });
    const mid = lodFor(t.lodSubMinPx, t);
    expect(mid.name && mid.sub && mid.detail).toBe(true);
    expect(mid.rich).toBe(false);
    expect(lodFor(t.lodRichMinPx, t).rich).toBe(true);
  });
});

describe('inner glow', () => {
  it('has fading rings that step inwards', () => {
    const rings = glowRings(t);
    expect(rings).toHaveLength(t.innerGlowSteps);
    rings.forEach((r, i) => {
      expect(r.k).toBeLessThan(1);
      if (i > 0) {
        expect(r.k).toBeLessThan((rings[i - 1] as { k: number }).k);
        expect(r.a).toBeLessThan((rings[i - 1] as { a: number }).a);
      }
    });
    expect(insetPoints([10, -10, 4, 6], 0.5)).toEqual([5, -5, 2, 3]);
  });
});

describe('lotDetail', () => {
  it('is deterministic per plot and differs between plots', () => {
    expect(lotDetail('d-1', 200, 220)).toEqual(lotDetail('d-1', 200, 220));
    expect(lotDetail('d-1', 200, 220)).not.toEqual(lotDetail('d-2', 200, 220));
  });
  it('stays cheap and inside the plot', () => {
    const prims = lotDetail('d-9', 200, 220);
    expect(prims.length).toBeLessThanOrEqual(20);
    for (const p of prims) {
      if (p.k === 'rect') expect(Math.abs(p.x) + Math.abs(p.y)).toBeLessThan(200 + 220);
    }
  });
});
