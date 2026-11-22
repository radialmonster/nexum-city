import { describe, expect, it } from 'vitest';
import { edgeArrows, edgePoint } from './offscreen';

const vp = { w: 1000, h: 600 };

describe('edgePoint', () => {
  it('returns null for points inside the inset rectangle', () => {
    expect(edgePoint(500, 300, vp, 30)).toBeNull();
    expect(edgePoint(960, 300, vp, 30)).toBeNull();
  });

  it('clips to the inset edge, pointing at the target', () => {
    const e = edgePoint(2500, 300, vp, 30);
    expect(e).not.toBeNull();
    expect(e?.x).toBeCloseTo(970);
    expect(e?.y).toBeCloseTo(300);
    expect(e?.angle).toBeCloseTo(0);
    const up = edgePoint(500, -2000, vp, 30);
    expect(up?.y).toBeCloseTo(30);
    expect(up?.angle).toBeCloseTo(-Math.PI / 2);
  });

  it('handles diagonals on the corner', () => {
    const e = edgePoint(5000, 5000, vp, 30);
    expect(e?.x).toBeLessThanOrEqual(970);
    expect(e?.y).toBeLessThanOrEqual(570);
  });
});

describe('edgeArrows', () => {
  const cam = { x: 0, y: 0, zoom: 1 };
  it('skips visible targets, lists alerts first then nearest', () => {
    const out = edgeArrows(
      [
        { id: 'in', wx: 10, wy: 10, kind: 'owned' },
        { id: 'far', wx: 3000, wy: 0, kind: 'owned' },
        { id: 'near', wx: 800, wy: 0, kind: 'owned' },
        { id: 'alert', wx: -4000, wy: 0, kind: 'alert', label: 'SIEGE' },
      ],
      cam,
      vp,
      30,
    );
    expect(out.map((a) => a.id)).toEqual(['alert', 'near', 'far']);
    expect(out[0]?.label).toBe('SIEGE');
  });

  it('caps the count', () => {
    const targets = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      wx: 2000 + i,
      wy: 0,
      kind: 'owned' as const,
    }));
    expect(edgeArrows(targets, cam, vp, 30, 5)).toHaveLength(5);
  });
});
