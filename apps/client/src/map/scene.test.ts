import { themes, toPixiPalette } from '@nexum/theme';
import { describe, expect, it } from 'vitest';
import { demoView } from './demo';
import {
  cityBounds,
  layoutWorld,
  moverPose,
  ownerLabel,
  pickDistrict,
  pointAlong,
  pointInPolygon,
  silhouette,
  territories,
} from './scene';

const t = toPixiPalette(themes.neon).map;

describe('silhouette', () => {
  it('gives a closed polygon of x,y pairs inside the box', () => {
    const pts = silhouette('grid', 100, 80, t.chamfer);
    expect(pts.length % 2).toBe(0);
    expect(pts.length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < pts.length; i += 2) {
      expect(Math.abs(pts[i] ?? 0)).toBeLessThanOrEqual(50.001);
      expect(Math.abs(pts[i + 1] ?? 0)).toBeLessThanOrEqual(40.001);
    }
  });
});

describe('geometry helpers', () => {
  it('point in polygon', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInPolygon(sq, 5, 5)).toBe(true);
    expect(pointInPolygon(sq, 15, 5)).toBe(false);
  });

  it('walks along a path', () => {
    const p = pointAlong([0, 0, 100, 0], 0.5);
    expect(p.x).toBeCloseTo(50);
    expect(p.angle).toBeCloseTo(0);
  });

  it('moverPose clamps progress and can loop', () => {
    const m = { path: [0, 0, 100, 0], departMs: 0, arriveMs: 1000, fixed: null };
    expect(moverPose(m, -5).x).toBeCloseTo(0);
    expect(moverPose(m, 5000).x).toBeCloseTo(100);
    expect(moverPose(m, 1250, true).x).toBeCloseTo(25);
  });
});

describe('layoutWorld', () => {
  const view = demoView({ large: true, reveal: true });
  const scene = layoutWorld(view, t);

  it('lays out 120+ districts with unique ids and valid bounds', () => {
    expect(scene.districts.length).toBeGreaterThanOrEqual(120);
    expect(new Set(scene.districts.map((d) => d.id)).size).toBe(scene.districts.length);
    expect(scene.bounds.maxX).toBeGreaterThan(scene.bounds.minX);
    expect(scene.bounds.maxY).toBeGreaterThan(scene.bounds.minY);
  });

  it('marks own districts and gives them the self role', () => {
    expect(scene.mine.length).toBeGreaterThan(0);
    for (const id of scene.mine) {
      const d = scene.byId[id];
      expect(d?.mine).toBe(true);
      expect(d?.role).toBe('self');
    }
  });

  it('puts the Sound south of the districts', () => {
    expect(scene.waterTop).toBeGreaterThan(scene.bounds.maxY - t.pitchY);
  });

  it('is deterministic', () => {
    const again = layoutWorld(demoView({ large: true, reveal: true }), t);
    expect(again.districts.map((d) => [d.id, d.cx, d.cy, d.role])).toEqual(
      scene.districts.map((d) => [d.id, d.cx, d.cy, d.role]),
    );
  });

  it('picks the district under a world point', () => {
    const d = scene.districts.find((x) => !x.isHub);
    expect(d).toBeDefined();
    if (!d) return;
    expect(pickDistrict(scene, d.cx, d.cy)?.id).toBe(d.id);
    expect(pickDistrict(scene, scene.bounds.minX - 5000, 0)).toBeNull();
  });

  it('fogs remembered districts in the default demo', () => {
    const fogged = layoutWorld(demoView({ large: true }), t);
    expect(fogged.districts.some((d) => d.remembered)).toBe(true);
  });
});

describe('territories and ownership labels', () => {
  const view = demoView({ large: true, reveal: true });
  const scene = layoutWorld(view, t);

  it('labels self, neutral and named rivals', () => {
    expect(ownerLabel('x', true, 'turtle')).toBe('YOU');
    expect(ownerLabel('neutral', false, 'turtle')).toBe('NEUTRAL');
    expect(ownerLabel('r', false, 'raider', { r: 'Vex Syndicate' })).toBe('VEX SYNDICATE');
    expect(ownerLabel('r', false, 'raider')).toBe('RAIDER');
  });

  it('groups claimed plots per crew, several rivals with distinct roles', () => {
    const list = territories(scene);
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(new Set(list.map((x) => x.role)).size).toBeGreaterThanOrEqual(4);
    expect(list.reduce((n, x) => n + x.count, 0)).toBeGreaterThan(scene.mine.length);
    expect(scene.districts.some((d) => d.owner === 'neutral' && !d.isHub)).toBe(true);
  });

  it('frames the city including the Sound', () => {
    const b = cityBounds(scene, t);
    expect(b.maxY).toBeGreaterThan(scene.waterTop);
    expect(b.minX).toBe(scene.bounds.minX);
  });
});

describe('open and settling plots', () => {
  it('carries the open flag and the settler role into the scene', () => {
    const base = demoView({ reveal: true });
    const target = Object.values(base.player.districts).find(
      (d) => d.relation === 'visible' || d.relation === 'hub',
    );
    if (target?.relation !== 'visible') throw new Error('fixture');
    const districts = {
      ...base.player.districts,
      [target.id]: {
        ...target,
        owner: 'neutral',
        open: true,
        settling: { owner: base.player.playerId, completesAtMs: base.player.nowMs + 1 },
      },
    };
    const scene = layoutWorld({ ...base, player: { ...base.player, districts } }, t);
    const d = scene.districts.find((x) => x.id === target.id);
    expect(d?.open).toBe(false);
    expect(d?.settling).toEqual({ role: 'self' });
    expect(scene.districts.filter((x) => x.id !== target.id).every((x) => !x.settling)).toBe(true);
  });
});

describe('ambushes', () => {
  it('lays out a visible ambush as a street between two districts', () => {
    const base = demoView({ large: true, reveal: true });
    const [a = '', b = ''] = Object.keys(base.player.districts);
    const player = {
      ...base.player,
      ambushes: [
        { id: 'z1', owner: base.player.playerId, edge: [a, b] as [string, string], untilMs: 5 },
      ],
    };
    const scene = layoutWorld({ ...base, player }, t);
    expect(scene.ambushes).toHaveLength(1);
    expect(scene.ambushes[0]).toMatchObject({ id: 'z1', mine: true, untilMs: 5 });
  });
});
