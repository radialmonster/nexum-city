import { ATOMS_PER_UNIT, MS_PER_HOUR, balance, toUnits } from './balance.js';
import { emit, schedule, unschedule, type Ctx } from './ctx.js';
import {
  GOODS,
  type BuildingType,
  type District,
  type DistrictKind,
  type Good,
  type Goods,
  type Id,
} from './types.js';
import type { System } from './systems.js';

/** Atoms per millisecond produced by 1 unit per hour. */
const ATOMS_PER_MS_PER_UNIT_HOUR = ATOMS_PER_UNIT / MS_PER_HOUR;

const MAIN_GOOD: Record<DistrictKind, Good | 'credits' | null> = {
  docks: 'parts',
  grid: 'power',
  archive: 'data',
  farms: 'supplies',
  stacks: 'supplies',
  residential: 'credits',
  hub: null,
};

export function mainGood(kind: DistrictKind): Good | 'credits' | null {
  return MAIN_GOOD[kind];
}

export function emptyGoods(): Goods {
  return { parts: 0, power: 0, data: 0, supplies: 0 };
}

export function totalGoods(g: Goods): number {
  let sum = 0;
  for (const good of GOODS) sum += g[good];
  return sum;
}

export function buildingLevel(d: District, type: BuildingType): number {
  return d.buildings.find((b) => b.type === type)?.level ?? 0;
}

/** Warehouse capacity in atoms: 120 units plus 120 per Depot level. */
export function warehouseCapacity(d: District): number {
  const units =
    balance.warehouse.baseCapacity +
    balance.warehouse.depotBonusPerLevel * buildingLevel(d, 'depot');
  return units * ATOMS_PER_UNIT;
}

/** Units per hour of the district's main good, with the Workshop bonus. 0 if unowned. */
export function productionPerHour(d: District): number {
  if (d.owner === 'neutral' || MAIN_GOOD[d.kind] === null) return 0;
  const pct = 100 + balance.production.workshopBonusPercent * buildingLevel(d, 'workshop');
  return (balance.production.baseUnitsPerHour * pct) / 100;
}

/** Integer atoms per millisecond, so integration is exact for any time split. */
export function productionAtomsPerMs(d: District): number {
  return Math.round(productionPerHour(d) * ATOMS_PER_MS_PER_UNIT_HOUR);
}

/** Integrates every district's output over [fromMs, toMs]. Credits go to the owner. */
export function settleProduction(ctx: Ctx, fromMs: number, toMs: number): void {
  const dt = toMs - fromMs;
  if (dt <= 0) return;
  const { districts, players } = ctx.state;
  for (const id of Object.keys(districts)) {
    const d = districts[id] as District;
    const rate = productionAtomsPerMs(d);
    const good = MAIN_GOOD[d.kind];
    if (rate === 0 || good === null) continue;
    const made = rate * dt;
    if (good === 'credits') {
      const owner = players[d.owner];
      if (owner) owner.credits += made;
      continue;
    }
    const room = Math.max(0, warehouseCapacity(d) - totalGoods(d.warehouse));
    const kept = Math.min(room, made);
    d.warehouse[good] += kept;
    d.wasted += made - kept;
  }
}

/**
 * Call after anything changes a district's stock, capacity, owner or rate. It
 * reports and clears overflow, and reschedules the moment the warehouse fills.
 */
export function afterWarehouseChange(ctx: Ctx, d: District): void {
  unschedule(ctx.state, (e) => e.kind === 'production.full' && e.districtId === d.id);
  const rate = productionAtomsPerMs(d);
  const good = MAIN_GOOD[d.kind];
  const total = totalGoods(d.warehouse);
  const cap = warehouseCapacity(d);
  const owner = d.owner === 'neutral' ? [] : [d.owner];
  const goodName = good ?? 'none';
  if (d.overflowing && (total < cap || rate === 0)) {
    emit(ctx, 'production.wasted', owner, [d.id], {
      good: goodName,
      amount: toUnits(d.wasted),
      cause: 'overflow',
      ongoing: false,
    });
    d.overflowing = false;
    d.wasted = 0;
  }
  if (rate === 0 || good === 'credits') return;
  if (total < cap) {
    schedule(ctx, ctx.state.nowMs + Math.ceil((cap - total) / rate), {
      kind: 'production.full',
      districtId: d.id,
    });
  } else if (!d.overflowing) {
    d.overflowing = true;
    emit(ctx, 'production.wasted', owner, [d.id], {
      good: goodName,
      amount: 0,
      cause: 'overflow',
      ongoing: true,
    });
  }
}

/** Where an owner's goods sit at a node: a district warehouse they own, or their hub stash. */
export function storeAt(ctx: Ctx, owner: Id, nodeId: Id, create = false): Goods | null {
  const d = ctx.state.districts[nodeId];
  if (!d) return null;
  if (d.kind === 'hub') {
    const player = ctx.state.players[owner];
    if (!player) return null;
    if (!create) return player.stash[nodeId] ?? emptyGoods();
    return (player.stash[nodeId] ??= emptyGoods());
  }
  return d.owner === owner ? d.warehouse : null;
}

/**
 * Puts goods into an owner's store at a node. Anything beyond a district
 * warehouse's capacity is lost and reported as `production.wasted`.
 */
export function deposit(ctx: Ctx, owner: Id, nodeId: Id, goods: Goods): void {
  const d = ctx.state.districts[nodeId];
  const store = storeAt(ctx, owner, nodeId, true);
  if (!d || !store) {
    // Not ours any more (siege, a later task): the cargo is lost.
    const lost = totalGoods(goods);
    if (lost > 0) {
      emit(ctx, 'production.wasted', [owner], d ? [d.id] : [], {
        good: 'cargo',
        amount: toUnits(lost),
        cause: 'undeliverable',
        ongoing: false,
      });
    }
    return;
  }
  if (d.kind === 'hub') {
    for (const g of GOODS) store[g] += goods[g];
    return;
  }
  let room = Math.max(0, warehouseCapacity(d) - totalGoods(store));
  let lost = 0;
  for (const g of GOODS) {
    const kept = Math.min(room, goods[g]);
    store[g] += kept;
    room -= kept;
    lost += goods[g] - kept;
  }
  if (lost > 0) {
    emit(ctx, 'production.wasted', [owner], [d.id], {
      good: 'cargo',
      amount: toUnits(lost),
      cause: 'delivery',
      ongoing: false,
    });
  }
  afterWarehouseChange(ctx, d);
}

export const productionSystem: System = {
  name: 'production',
  settle: settleProduction,
  handlers: {
    'production.full': (ctx, ev) => {
      const d = ctx.state.districts[ev.districtId];
      if (d) afterWarehouseChange(ctx, d);
    },
  },
};
