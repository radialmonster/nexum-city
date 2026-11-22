import { themes, toPixiPalette } from '@nexum/theme';
import { describe, expect, it } from 'vitest';
import {
  CameraController,
  acrossForZoom,
  clampCamera,
  clampZoom,
  frameBounds,
  levelForZoom,
  screenToWorld,
  visibleRect,
  worldToScreen,
  zoomAbout,
  zoomForLevel,
} from './camera';

const t = toPixiPalette(themes.neon).map;
const vp = { w: 1600, h: 900 };
const bounds = { minX: 0, minY: 0, maxX: 3000, maxY: 2000 };

describe('camera maths', () => {
  it('zoom and plots-across are inverse', () => {
    const z = zoomForLevel('tactical', vp, t);
    expect(acrossForZoom(z, vp.w, t)).toBeCloseTo(t.acrossTactical);
  });

  it('maps each level back to itself', () => {
    for (const level of ['city', 'tactical', 'district'] as const) {
      expect(levelForZoom(zoomForLevel(level, vp, t), vp, t)).toBe(level);
    }
  });

  it('clamps zoom between the across limits', () => {
    expect(acrossForZoom(clampZoom(1e-6, vp, t), vp.w, t)).toBeCloseTo(t.acrossMax);
    expect(acrossForZoom(clampZoom(1e6, vp, t), vp.w, t)).toBeCloseTo(t.acrossMin);
  });

  it('zooming about the cursor keeps the world point under it', () => {
    const cam = { x: 500, y: 400, zoom: zoomForLevel('tactical', vp, t) };
    const before = screenToWorld(cam, vp, 1200, 300);
    const next = zoomAbout(cam, 1.5, 1200, 300, vp, t);
    const after = screenToWorld(next, vp, 1200, 300);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('round-trips screen and world', () => {
    const cam = { x: 120, y: -40, zoom: 0.7 };
    const s = worldToScreen(cam, vp, 300, 200);
    const w = screenToWorld(cam, vp, s.x, s.y);
    expect(w.x).toBeCloseTo(300);
    expect(w.y).toBeCloseTo(200);
  });

  it('visibleRect is centred on the camera', () => {
    const r = visibleRect({ x: 100, y: 50, zoom: 2 }, vp);
    expect(r.x + r.w / 2).toBeCloseTo(100);
    expect(r.y + r.h / 2).toBeCloseTo(50);
    expect(r.w).toBeCloseTo(vp.w / 2);
  });

  it('keeps the camera inside the bounds plus margin', () => {
    const zoom = zoomForLevel('tactical', vp, t);
    const c = clampCamera({ x: -99999, y: 99999, zoom }, vp, bounds, t);
    expect(c.x).toBeGreaterThanOrEqual(bounds.minX - t.panMarginPlots * t.pitchX);
    expect(c.y).toBeLessThanOrEqual(bounds.maxY + t.panMarginPlots * t.pitchY);
  });

  it('frames bounds inside the viewport', () => {
    const c = frameBounds(bounds, vp, t);
    const r = visibleRect(c, vp);
    expect(r.w).toBeGreaterThanOrEqual(bounds.maxX - bounds.minX);
  });
});

describe('CameraController', () => {
  it('drags and then coasts with inertia', () => {
    const c = new CameraController(t, bounds, vp, {
      x: 1500,
      y: 1000,
      zoom: zoomForLevel('tactical', vp, t),
    });
    c.dragStart();
    c.dragMove(-40, 0, 16);
    c.dragMove(-40, 0, 32);
    c.dragEnd(34);
    const x0 = c.cam.x;
    expect(x0).toBeGreaterThan(1500);
    c.update(50);
    c.update(66);
    expect(c.cam.x).toBeGreaterThan(x0);
  });

  it('animates to a target and stops', () => {
    const c = new CameraController(t, bounds, vp, { x: 1500, y: 1000, zoom: 0.5 });
    c.animateCentre(900, 700, 0, 0.8);
    let now = 0;
    for (let i = 0; i < 200 && c.moving; i++) {
      now += 16;
      c.update(now);
    }
    expect(c.moving).toBe(false);
    expect(c.cam.x).toBeCloseTo(900, 0);
    expect(c.cam.zoom).toBeCloseTo(0.8, 2);
  });

  it('keeps plots across when the viewport resizes', () => {
    const c = new CameraController(t, bounds, vp, {
      x: 1500,
      y: 1000,
      zoom: zoomForLevel('tactical', vp, t),
    });
    c.setViewport({ w: 800, h: 450 });
    expect(acrossForZoom(c.cam.zoom, 800, t)).toBeCloseTo(t.acrossTactical);
  });
});

describe('phone viewport', () => {
  const phone = { w: 390, h: 844 };
  it('keeps plots at a readable on-screen width', () => {
    for (const level of ['tactical', 'district'] as const) {
      const z = zoomForLevel(level, phone, t);
      expect(t.pitchX * z).toBeGreaterThanOrEqual(t.minPlotPxTactical * 0.99);
    }
  });
  it('shows far fewer plots across than a wide screen', () => {
    const wide = acrossForZoom(zoomForLevel('tactical', { w: 1920, h: 1080 }, t), 1920, t);
    const small = acrossForZoom(zoomForLevel('tactical', phone, t), phone.w, t);
    expect(small).toBeLessThan(wide);
    expect(levelForZoom(zoomForLevel('tactical', phone, t), phone, t)).toBe('tactical');
  });
});
