/**
 * Pure model-to-scene mapping for the map. Nothing here touches Pixi or the DOM,
 * so it runs (and is tested) without WebGL. Sizes come from the theme's `map`
 * tokens, which the caller passes in as `MapTokens`.
 */
import type { FactionRole, MapKey } from '@nexum/theme';
import {
  ATOMS_PER_UNIT,
  balance,
  totalGoods,
  type DistrictKind,
  type DistrictView,
  type FrontierState,
  type Good,
  type Graph,
  type Id,
  type Movement,
  type Owner,
  type PlayerView,
} from '@nexum/sim';

export type MapTokens = Readonly<Record<MapKey, number>>;

/**
 * What the map needs to draw: the player's fogged view (from `GET /api/me`, or
 * from `viewFor` on a client-side world in demo mode) plus optional extras.
 */
export interface MapView {
  player: PlayerView;
  /** The street graph. Absent for real players; streets are then derived from positions. */
  graph?: Graph;
  /** Relative price per good at each hub, 0 to 1. */
  prices?: Readonly<Record<Id, Partial<Record<Good, number>>>>;
  /** Things that need the player, shown as pings and off-screen arrows. */
  alerts?: readonly MapAlert[];
  /** Display names of the crews, by player id. */
  crewNames?: Readonly<Record<Id, string>>;
  /** Replay a movement forever (the demo has no server clock). */
  loopMovements?: boolean;
}

export interface MapAlert {
  districtId: Id;
  label: string;
}

/** The colour roles other crews are cycled through, in order. */
export const RIVAL_ROLES = [
  'raider',
  'turtle',
  'merchant',
  'hunter',
  'rival',
  'newcomer',
] as const satisfies readonly FactionRole[];

export interface SceneSlot {
  /** 0 for an empty slot. */
  level: number;
}

export interface SceneDistrict {
  id: Id;
  name: string;
  kind: DistrictKind;
  isHub: boolean;
  /** Centre in world units. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Outline as flat x,y pairs, relative to the centre. */
  points: number[];
  owner: Owner;
  role: FactionRole;
  /** Short owner name for the sub-label: YOU, a crew name, or NEUTRAL. */
  ownerLabel: string;
  mine: boolean;
  /** In sight right now. False for remembered districts (drawn as dimmed fog). */
  visible: boolean;
  remembered: boolean;
  frontier: FrontierState;
  /** An unclaimed plot anyone can settle (drawn with a dashed outline). */
  open: boolean;
  /** Who is settling this plot, as a faction role, or null. */
  settling: { role: FactionRole } | null;
  slots: SceneSlot[];
  /** Warehouse fill, 0 to 1. */
  stock: number;
  garrison: number;
  /** Capture progress 0 to 1, or null when not under siege. */
  siege: number | null;
  /** Relative prices for a hub, one 0 to 1 value per good, or null. */
  prices: number[] | null;
}

export interface SceneStreet {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** A planned street on the frontier, drawn dotted. */
  planned: boolean;
}

export interface SceneMover {
  id: Id;
  carrierKind: string;
  role: FactionRole;
  mine: boolean;
  /** Route polyline as flat x,y pairs in world units. */
  path: number[];
  departMs: number;
  arriveMs: number;
  /** A convoy seen in sight: a fixed pose instead of a timed route. */
  fixed: { x: number; y: number; angle: number } | null;
  movement: Movement | null;
}

export interface SceneAlert {
  districtId: Id;
  label: string;
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Scene {
  districts: SceneDistrict[];
  byId: Record<Id, SceneDistrict>;
  streets: SceneStreet[];
  movers: SceneMover[];
  alerts: SceneAlert[];
  /** The extent of all districts in world units. */
  bounds: Bounds;
  /** World y where the Sound (water) starts. */
  waterTop: number;
  /** Ids of the viewer's districts, in id order. */
  mine: Id[];
  loopMovements: boolean;
}

export const GOOD_ORDER: readonly Good[] = ['parts', 'power', 'data', 'supplies'];

/** World centre of a grid position. */
export function worldPoint(pos: { x: number; y: number }, t: MapTokens): { x: number; y: number } {
  return { x: pos.x * t.pitchX, y: pos.y * t.pitchY };
}

/**
 * The outline of a district kind, relative to its centre, as flat x,y pairs.
 * Each kind clips different corners (and the stacks get a stepped top) so the
 * silhouettes read apart at a glance, as in the mockup.
 */
export function silhouette(kind: DistrictKind, w: number, h: number, chamfer: number): number[] {
  const hw = w / 2;
  const hh = h / 2;
  const c = Math.min(chamfer, hw * 0.9, hh * 0.9);
  const big = Math.min(c * 2, hw * 0.9, hh * 0.9);
  const small = c * 0.45;
  // corner cuts in order: top-left, top-right, bottom-right, bottom-left
  let cuts: [number, number, number, number];
  switch (kind) {
    case 'docks':
      cuts = [small, small, big, big];
      break;
    case 'grid':
      cuts = [c, c, c, c];
      break;
    case 'archive':
      cuts = [big, 0, big, 0];
      break;
    case 'farms':
      cuts = [0, big, 0, big];
      break;
    case 'residential':
      cuts = [c, 0, c, 0];
      break;
    case 'stacks':
      cuts = [0, c, 0, c];
      break;
    case 'hub':
      cuts = [hw * 0.55, hw * 0.55, hw * 0.55, hw * 0.55];
      break;
  }
  const [tl, tr, br, bl] = cuts;
  const pts: number[] = [];
  const push = (x: number, y: number): void => {
    pts.push(x, y);
  };
  // top-left corner, then clockwise
  if (tl > 0) {
    push(-hw, -hh + tl);
    push(-hw + tl, -hh);
  } else push(-hw, -hh);
  if (kind === 'stacks') {
    // stepped skyline along the top edge
    const step = hh * 0.22;
    push(-hw * 0.2, -hh);
    push(-hw * 0.2, -hh + step);
    push(hw * 0.25, -hh + step);
    push(hw * 0.25, -hh);
  }
  if (tr > 0) {
    push(hw - tr, -hh);
    push(hw, -hh + tr);
  } else push(hw, -hh);
  if (br > 0) {
    push(hw, hh - br);
    push(hw - br, hh);
  } else push(hw, hh);
  if (bl > 0) {
    push(-hw + bl, hh);
    push(-hw, hh - bl);
  } else push(-hw, hh);
  return pts;
}

/** Point-in-polygon for a flat x,y outline. */
export function pointInPolygon(points: readonly number[], px: number, py: number): boolean {
  let inside = false;
  const n = points.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i * 2] as number;
    const yi = points[i * 2 + 1] as number;
    const xj = points[j * 2] as number;
    const yj = points[j * 2 + 1] as number;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The district under a world point, or null. Later districts win, so hubs sit on top. */
export function pickDistrict(scene: Scene, wx: number, wy: number, pad = 0): SceneDistrict | null {
  for (let i = scene.districts.length - 1; i >= 0; i--) {
    const d = scene.districts[i] as SceneDistrict;
    const lx = wx - d.cx;
    const ly = wy - d.cy;
    if (Math.abs(lx) > d.w / 2 + pad || Math.abs(ly) > d.h / 2 + pad) continue;
    if (pad > 0 || pointInPolygon(d.points, lx, ly)) return d;
  }
  return null;
}

/** Who owns (or last owned) a district, as far as the player knows. */
export function viewOwner(dv: DistrictView): Owner {
  if (dv.relation === 'remembered') return dv.lastKnownOwner ?? 'neutral';
  return dv.owner;
}

const KINDS: readonly string[] = [
  'docks',
  'grid',
  'archive',
  'farms',
  'stacks',
  'residential',
  'hub',
];
const asKind = (k: string): DistrictKind =>
  KINDS.includes(k) ? (k as DistrictKind) : 'residential';

/** Assign each crew a faction role: the viewer is `self`, others cycle through the rival roles. */
export function assignRoles(player: PlayerView): Map<Owner, FactionRole> {
  const roles = new Map<Owner, FactionRole>([['neutral', 'neutral']]);
  const others = new Set<Id>();
  for (const dv of Object.values(player.districts)) {
    const o = viewOwner(dv);
    if (o !== 'neutral' && o !== player.playerId) others.add(o);
  }
  for (const c of player.convoys) if (c.owner !== player.playerId) others.add(c.owner);
  roles.set(player.playerId, 'self');
  [...others].sort().forEach((id, i) => {
    roles.set(id, RIVAL_ROLES[i % RIVAL_ROLES.length] as FactionRole);
  });
  return roles;
}

/** The name shown under a district: YOU, a crew name (or its colour role), or NEUTRAL. */
export function ownerLabel(
  owner: Owner,
  mine: boolean,
  role: FactionRole,
  names?: Readonly<Record<Id, string>>,
): string {
  if (mine) return 'YOU';
  if (owner === 'neutral') return 'NEUTRAL';
  return (names?.[owner] ?? role).toUpperCase();
}

/** One crew's territory, for the CITY-level label: where its plots centre and how many. */
export interface Territory {
  owner: Id;
  role: FactionRole;
  label: string;
  cx: number;
  cy: number;
  count: number;
}

/** Group claimed plots by owner. Sorted by owner id so the result is stable. */
export function territories(scene: Scene): Territory[] {
  const by = new Map<Id, { t: Territory; sx: number; sy: number }>();
  for (const d of scene.districts) {
    if (d.owner === 'neutral' || d.isHub) continue;
    let e = by.get(d.owner);
    if (!e) {
      e = {
        t: { owner: d.owner, role: d.role, label: d.ownerLabel, cx: 0, cy: 0, count: 0 },
        sx: 0,
        sy: 0,
      };
      by.set(d.owner, e);
    }
    e.sx += d.cx;
    e.sy += d.cy;
    e.t.count++;
  }
  return [...by.values()]
    .map(({ t, sx, sy }) => ({ ...t, cx: sx / t.count, cy: sy / t.count }))
    .sort((a, b) => a.owner.localeCompare(b.owner));
}

/** World bounds of the whole city including the Sound, for framing the CITY level. */
export function cityBounds(scene: Scene, t: MapTokens): Bounds {
  return { ...scene.bounds, maxY: scene.waterTop + t.pitchY * t.soundCity };
}

/** What the camera may pan over: the plots plus only a strip of the Sound below them. */
export function panBounds(scene: Scene, t: MapTokens): Bounds {
  return { ...scene.bounds, maxY: scene.waterTop + t.pitchY * t.soundPan };
}

/** Streets from the graph, or derived from plot positions when the view has no graph. */
function layoutStreets(view: MapView, t: MapTokens, by: Record<Id, SceneDistrict>): SceneStreet[] {
  const streets: SceneStreet[] = [];
  const line = (a: SceneDistrict, b: SceneDistrict, planned: boolean): void => {
    streets.push({ id: `${a.id}|${b.id}`, x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy, planned });
  };
  const seen = new Set<string>();
  const graph = view.graph;
  if (graph) {
    for (const e of graph.edges) {
      const a = by[e.a];
      const b = by[e.b];
      if (a && b) {
        line(a, b, false);
        seen.add(`${e.a}|${e.b}`).add(`${e.b}|${e.a}`);
      }
    }
  }
  const list = Object.values(by);
  const gx = (d: SceneDistrict): number => Math.round(d.cx / t.pitchX);
  const gy = (d: SceneDistrict): number => Math.round(d.cy / t.pitchY);
  for (let i = 0; i < list.length; i++) {
    const a = list[i] as SceneDistrict;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j] as SceneDistrict;
      if (seen.has(`${a.id}|${b.id}`)) continue;
      const dx = Math.abs(gx(a) - gx(b));
      const dy = Math.abs(gy(a) - gy(b));
      const adjacent = dx + dy === 1;
      const planned = a.frontier !== 'built' || b.frontier !== 'built';
      if (planned && adjacent) line(a, b, true);
      else if (!graph && (adjacent || ((a.isHub || b.isHub) && Math.max(dx, dy) === 1))) {
        line(a, b, false);
      }
    }
  }
  return streets;
}

/** Turn a view into everything the renderer and HUD need. Deterministic and pure. */
export function layoutWorld(view: MapView, t: MapTokens): Scene {
  const p = view.player;
  const roles = assignRoles(p);
  const w = t.pitchX - t.street;
  const h = t.pitchY - t.street;
  const districts: SceneDistrict[] = [];
  const byId: Record<Id, SceneDistrict> = {};
  const ids = Object.keys(p.districts).sort();
  // hubs last so they draw (and pick) on top
  ids.sort(
    (a, b) => Number(p.districts[a]?.kind === 'hub') - Number(p.districts[b]?.kind === 'hub'),
  );
  let maxY = 0;
  for (const dv of Object.values(p.districts)) maxY = Math.max(maxY, dv.pos.y);
  for (const id of ids) {
    const dv = p.districts[id] as DistrictView;
    const kind = asKind(dv.kind);
    const isHub = kind === 'hub';
    const { x, y } = worldPoint(dv.pos, t);
    const dw = isHub ? t.hubRadius * 2 : w;
    const dh = isHub ? t.hubRadius * 2 : h;
    const owner = viewOwner(dv);
    const mine = dv.relation === 'own';
    const remembered = dv.relation === 'remembered';
    const prices = view.prices?.[id];
    let slots: SceneSlot[] = [];
    let stock = 0;
    let garrison = 0;
    let frontier: FrontierState = 'built';
    let open = false;
    let settling: SceneDistrict['settling'] = null;
    if (dv.relation === 'own') {
      slots = Array.from({ length: dv.slots }, (_, i) => ({ level: dv.buildings[i]?.level ?? 0 }));
      const depot = dv.buildings.find((b) => b.type === 'depot')?.level ?? 0;
      const cap =
        (balance.warehouse.baseCapacity + balance.warehouse.depotBonusPerLevel * depot) *
        ATOMS_PER_UNIT;
      stock = cap > 0 ? Math.min(1, totalGoods(dv.warehouse) / cap) : 0;
      garrison = dv.garrison.length;
      frontier = dv.frontier;
    } else if (dv.relation !== 'remembered') {
      garrison = Object.values(dv.presence).reduce((a, b) => a + b, 0);
      open = dv.open && !dv.settling;
      if (dv.settling) settling = { role: roles.get(dv.settling.owner) ?? 'rival' };
    }
    const siege = dv.relation === 'remembered' ? null : (dv.siege?.progress ?? null);
    const sd: SceneDistrict = {
      id,
      name: dv.name,
      kind,
      isHub,
      cx: x,
      cy: y,
      w: dw,
      h: dh,
      points: silhouette(kind, dw, dh, t.chamfer),
      owner,
      ownerLabel: ownerLabel(owner, mine, roles.get(owner) ?? 'neutral', view.crewNames),
      role: isHub ? 'neutral' : (roles.get(owner) ?? 'neutral'),
      mine,
      visible: !remembered,
      remembered,
      frontier,
      open,
      settling,
      slots,
      stock,
      garrison,
      siege,
      prices: prices ? GOOD_ORDER.map((g) => Math.min(1, Math.max(0, prices[g] ?? 0))) : null,
    };
    districts.push(sd);
    byId[id] = sd;
  }

  const movers: SceneMover[] = [];
  for (const m of Object.values(p.movements)) {
    const path: number[] = [];
    for (const nodeId of m.route) {
      const n = byId[nodeId];
      if (n) path.push(n.cx, n.cy);
    }
    if (path.length < 4) continue;
    movers.push({
      id: m.id,
      carrierKind: m.carrierKind,
      role: 'self',
      mine: true,
      path,
      departMs: m.departMs,
      arriveMs: m.arriveMs,
      fixed: null,
      movement: m,
    });
  }
  for (const c of p.convoys) {
    const a = byId[c.segment[0]];
    const b = byId[c.segment[1]];
    const pos = worldPoint(c.position, t);
    movers.push({
      id: c.id,
      carrierKind: c.carrier,
      role: roles.get(c.owner) ?? 'rival',
      mine: false,
      path: [],
      departMs: 0,
      arriveMs: 0,
      fixed: { ...pos, angle: a && b ? Math.atan2(b.cy - a.cy, b.cx - a.cx) : 0 },
      movement: null,
    });
  }

  const alerts: SceneAlert[] = [];
  for (const a of view.alerts ?? []) {
    const d = byId[a.districtId];
    if (d) alerts.push({ districtId: a.districtId, label: a.label, x: d.cx, y: d.cy });
  }
  // a siege on one of my districts is always an alert
  for (const d of districts) {
    if (d.mine && d.siege !== null && !alerts.some((a) => a.districtId === d.id)) {
      alerts.push({ districtId: d.id, label: 'Under siege', x: d.cx, y: d.cy });
    }
  }

  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const d of districts) {
    bounds.minX = Math.min(bounds.minX, d.cx - d.w / 2);
    bounds.maxX = Math.max(bounds.maxX, d.cx + d.w / 2);
    bounds.minY = Math.min(bounds.minY, d.cy - d.h / 2);
    bounds.maxY = Math.max(bounds.maxY, d.cy + d.h / 2);
  }
  if (districts.length === 0) {
    Object.assign(bounds, { minX: 0, minY: 0, maxX: t.pitchX, maxY: t.pitchY });
  }

  return {
    districts,
    byId,
    streets: layoutStreets(view, t, byId),
    movers,
    alerts,
    bounds,
    waterTop: (maxY + 0.5) * t.pitchY,
    mine: districts
      .filter((d) => d.mine)
      .map((d) => d.id)
      .sort(),
    loopMovements: view.loopMovements === true,
  };
}

// ------------------------------------------------------------------ carriers

/** A point `t` (0 to 1) along a flat x,y polyline, with the heading in radians. */
export function pointAlong(
  path: readonly number[],
  t: number,
): { x: number; y: number; angle: number } {
  const n = path.length / 2;
  let total = 0;
  for (let i = 0; i + 1 < n; i++) {
    total += Math.hypot(
      (path[i * 2 + 2] as number) - (path[i * 2] as number),
      (path[i * 2 + 3] as number) - (path[i * 2 + 1] as number),
    );
  }
  let target = Math.min(1, Math.max(0, t)) * total;
  let last = { x: path[0] as number, y: path[1] as number, angle: 0 };
  for (let i = 0; i + 1 < n; i++) {
    const x1 = path[i * 2] as number;
    const y1 = path[i * 2 + 1] as number;
    const x2 = path[i * 2 + 2] as number;
    const y2 = path[i * 2 + 3] as number;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    last = { x: x2, y: y2, angle };
    if (target <= len || i + 2 === n) {
      const f = len === 0 ? 1 : Math.min(1, target / len);
      return { x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f, angle };
    }
    target -= len;
  }
  return last;
}

/**
 * Where a carrier is at game time `nowMs`, interpolated along its route. With
 * `loop` the trip repeats (demo mode); otherwise it is clamped to the ends.
 */
export function moverPose(
  mover: Pick<SceneMover, 'path' | 'departMs' | 'arriveMs' | 'fixed'>,
  nowMs: number,
  loop = false,
): { x: number; y: number; angle: number; progress: number } {
  if (mover.fixed) return { ...mover.fixed, progress: 0.5 };
  const span = mover.arriveMs - mover.departMs;
  let progress = span <= 0 ? 1 : (nowMs - mover.departMs) / span;
  if (loop && span > 0) progress = ((progress % 1) + 1) % 1;
  progress = Math.min(1, Math.max(0, progress));
  return { ...pointAlong(mover.path, progress), progress };
}

/** Flat x,y polyline through the nodes of a route, skipping unknown nodes. */
export function routePath(scene: Scene, route: readonly Id[]): number[] {
  const out: number[] = [];
  for (const id of route) {
    const d = scene.byId[id];
    if (d) out.push(d.cx, d.cy);
  }
  return out;
}
