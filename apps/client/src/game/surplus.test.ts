import type { DistrictView } from '@nexum/contracts';
import { ATOMS_PER_UNIT, balance } from '@nexum/sim';
import { describe, expect, it } from 'vitest';
import { isOwn } from './derive';
import { clockText } from './TopBar';
import { fullInMs, surplusHaulDraft } from './surplus';
import { makeView } from './testing';

const hub: DistrictView = {
  relation: 'hub',
  id: 'h',
  name: 'Hub',
  kind: 'hub',
  pos: { x: 30, y: 0 },
  owner: 'neutral',
  protected: true,
  open: false,
  settling: null,
  watchtower: 0,
  presence: {},
  siege: null,
} as unknown as DistrictView;

const withStock = (units: number, overflowing: boolean) => {
  const v = makeView();
  const a = v.districts['a'];
  if (!isOwn(a)) throw new Error('a is yours');
  v.districts['a'] = {
    ...a,
    overflowing,
    warehouse: { ...a.warehouse, supplies: units * ATOMS_PER_UNIT },
  };
  v.districts['h'] = hub;
  return v;
};

describe('warehouse full helpers', () => {
  it('counts the time until the warehouse fills', () => {
    const v = withStock(balance.warehouse.baseCapacity - 10, false);
    const a = v.districts['a'];
    if (!isOwn(a)) throw new Error('own');
    const ms = fullInMs(a);
    expect(ms).not.toBeNull();
    expect(ms as number).toBeGreaterThan(0);
  });
  it('has no ETA once full', () => {
    const v = withStock(balance.warehouse.baseCapacity + 5, true);
    const a = v.districts['a'];
    if (!isOwn(a)) throw new Error('own');
    expect(fullInMs(a)).toBeNull();
  });
  it('prefills a haul of the made good to the nearest hub', () => {
    const v = withStock(balance.warehouse.baseCapacity + 5, true);
    const a = v.districts['a'];
    if (!isOwn(a)) throw new Error('own');
    const draft = surplusHaulDraft(v, a);
    expect(draft).toMatchObject({ kind: 'haul', districtId: 'h', from: 'a' });
    expect(draft?.cargo?.['supplies']).toBeGreaterThan(0);
  });
  it('has no draft with no hub known', () => {
    const v = withStock(balance.warehouse.baseCapacity + 5, true);
    delete v.districts['h'];
    const a = v.districts['a'];
    if (!isOwn(a)) throw new Error('own');
    expect(surplusHaulDraft(v, a)).toBeNull();
  });
});

describe('clock chip', () => {
  it('shows the day with the time', () => {
    expect(clockText({ day: 3, hhmm: '23:46' })).toBe('D3 23:46');
  });
});
