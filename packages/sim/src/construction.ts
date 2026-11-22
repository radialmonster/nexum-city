import { MS_PER_HOUR, balance, toAtoms } from './balance.js';
import { take } from './cost.js';
import { rushDuration } from './rush.js';
import { emit, schedule, type Ctx } from './ctx.js';
import { afterWarehouseChange, buildingLevel } from './production.js';
import { refreshSiege } from './siege.js';
import type { System } from './systems.js';
import { GOODS, type BuildingType, type District, type Goods } from './types.js';

/** Goods needed to take a building to `level`, in atoms. */
export function buildCost(building: BuildingType, level: number): Goods {
  const spec = balance.buildings.specs[building];
  const cost: Goods = { parts: 0, power: 0, data: 0, supplies: 0 };
  for (const g of GOODS) {
    const units: number = (spec.cost as Partial<Record<string, number>>)[g] ?? 0;
    cost[g] = toAtoms(units * level);
  }
  return cost;
}

export function buildDurationMs(building: BuildingType, level: number): number {
  return balance.buildings.specs[building].hours * level * MS_PER_HOUR;
}

/** Pays the cost from the district warehouse and schedules completion. Assumes a validated order. */
export function startConstruction(ctx: Ctx, d: District, building: BuildingType): void {
  const level = buildingLevel(d, building) + 1;
  const cost = buildCost(building, level);
  take(d.warehouse, d.warehouseValue, cost);
  const completesAtMs =
    ctx.state.nowMs + rushDuration(ctx.state, d.owner, buildDurationMs(building, level));
  d.construction = { building, level, completesAtMs };
  schedule(ctx, completesAtMs, { kind: 'build.done', districtId: d.id });
  afterWarehouseChange(ctx, d);
}

export const constructionSystem: System = {
  name: 'construction',
  handlers: {
    'build.done': (ctx, ev) => {
      const d = ctx.state.districts[ev.districtId];
      const job = d?.construction;
      if (!d || !job) return;
      const existing = d.buildings.find((b) => b.type === job.building);
      if (existing) existing.level = job.level;
      else d.buildings.push({ type: job.building, level: job.level });
      d.construction = null;
      emit(ctx, 'build.done', d.owner === 'neutral' ? [] : [d.owner], [d.id], {
        building: job.building,
        level: job.level,
      });
      // The new level changes the output rate and warehouse capacity.
      afterWarehouseChange(ctx, d);
      // New walls change the capture rate against this district.
      refreshSiege(ctx, d.id);
    },
  },
};
