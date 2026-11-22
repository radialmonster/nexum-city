import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, balance, toAtoms } from './balance.js';
import { clone, crewsOf, scenario, vanOf } from './fixtures.js';
import { sightOf, viewFor } from './fog.js';
import { step } from './step.js';
import type { GameState, Input } from './types.js';

/** p1 holds d2_1 and d3_1, p2 holds d0_0 (far away); p2 has secrets. */
function world(): GameState {
  const s = scenario();
  const p2 = s.players['p2'];
  if (p2) {
    p2.credits = toAtoms(123_456);
    p2.stash['hubW'] = { parts: toAtoms(777), power: 0, data: 0, supplies: 0 };
  }
  const d = s.districts['d0_0'];
  if (d) d.warehouse.parts = toAtoms(4242);
  return s;
}

describe('viewFor', () => {
  it('is JSON-safe and round-trips', () => {
    const view = viewFor(world(), 'p1');
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it('shows own districts in full', () => {
    const s = world();
    const view = viewFor(s, 'p1');
    const own = view.districts['d2_1'];
    expect(own?.relation).toBe('own');
    if (own?.relation === 'own') {
      expect(own.warehouse).toEqual(s.districts['d2_1']?.warehouse);
      expect(own.garrison).toEqual(s.districts['d2_1']?.garrison);
    }
    expect(Object.keys(view.crews).sort()).toEqual([...crewsOf(s, 'p1')].sort());
    expect(view.self.credits).toBe(s.players['p1']?.credits);
  });

  it('always shows hubs', () => {
    const view = viewFor(world(), 'p2');
    expect(view.districts['hubE']?.relation).toBe('hub');
    expect(view.districts['hubW']?.relation).toBe('hub');
  });

  it('sees one street hop around own districts and no further', () => {
    const s = world();
    const sight = sightOf(s, 'p1');
    expect(sight.has('d1_1')).toBe(true);
    expect(sight.has('d2_0')).toBe(true);
    expect(sight.has('d0_0')).toBe(false);
    expect(viewFor(s, 'p1').districts['d1_1']?.relation).toBe('visible');
  });

  it('never leaks another player hidden data', () => {
    const s = world();
    const json = JSON.stringify(viewFor(s, 'p1'));
    const p2 = s.players['p2'];
    expect(json).not.toContain(String(p2?.credits));
    expect(json).not.toContain(String(toAtoms(4242)));
    expect(json).not.toContain(String(toAtoms(777)));
    for (const id of crewsOf(s, 'p2')) expect(json).not.toContain(`"${id}"`);
    expect(json).not.toContain('"rng"');
    expect(json).not.toContain('"queue"');
    const far = viewFor(s, 'p1').districts['d0_0'];
    expect(far).toEqual({
      relation: 'remembered',
      id: 'd0_0',
      name: s.districts['d0_0']?.name,
      kind: s.districts['d0_0']?.kind,
      pos: s.districts['d0_0']?.pos,
      lastKnownOwner: null,
    });
  });

  it('shows foreign units in sight only as counts', () => {
    const s = world();
    // Put p2 next to p1's docks.
    const d = s.districts['d1_1'];
    if (d) d.owner = 'p2';
    const crew = s.crews[crewsOf(s, 'p2')[0] as string];
    const home = s.districts['d0_0'];
    if (crew && home && d) {
      home.garrison = home.garrison.filter((id) => id !== crew.id);
      crew.loc = { at: 'd1_1' };
      d.garrison.push(crew.id);
    }
    const json = JSON.stringify(viewFor(s, 'p1'));
    const seen = viewFor(s, 'p1').districts['d1_1'];
    expect(seen?.relation).toBe('visible');
    if (seen?.relation === 'visible') expect(seen.presence).toEqual({ p2: 1 });
    expect(json).not.toContain(`"${crew?.id}"`);
    expect(Object.keys(viewFor(s, 'p1').crews)).not.toContain(crew?.id);
  });

  it('records what it sees at input boundaries and reports it once out of sight', () => {
    const s = world();
    const d = s.districts['d1_1'];
    if (d) d.owner = 'p2';
    const stance: Input = {
      actorId: 'p1',
      order: { type: 'stance', districtId: 'd2_1', stance: 'hold' },
      atMs: 1000,
    };
    const seen = step(s, [stance], 2000).state;
    expect(seen.memory['p1']?.['d1_1']).toBe('p2');
    expect(seen.memory['p1']?.['d0_0']).toBeUndefined();
    // Later the district changes hands out of sight: the view keeps the old belief.
    const later = clone(seen);
    const far = later.districts['d1_1'];
    if (far) far.owner = 'p3';
    for (const id of ['d2_1', 'd3_1']) {
      const dd = later.districts[id];
      if (dd) dd.owner = 'neutral';
    }
    for (const c of Object.values(later.crews)) if (c.owner === 'p1') c.loc = { at: 'd5_3' };
    for (const dd of Object.values(later.districts))
      dd.garrison = dd.garrison.filter((id) => later.crews[id]?.owner !== 'p1');
    const v = viewFor(later, 'p1').districts['d1_1'];
    expect(v).toMatchObject({ relation: 'remembered', lastKnownOwner: 'p2' });
  });
});

describe('convoys', () => {
  it('are visible only inside your sight', () => {
    const s = world();
    const p2crew = crewsOf(s, 'p2')[0] as string;
    const order: Input = {
      actorId: 'p2',
      order: { type: 'move', carrierId: vanOf(s, 'p2'), crewIds: [p2crew], to: 'hubW' },
    };
    const started = step(s, [order], 5).state;
    // The convoy runs hubW <-> d0_0: p1 sees neither end.
    expect(viewFor(started, 'p1').convoys).toEqual([]);
    expect(viewFor(started, 'p2').movements).not.toEqual({});
    // A p1 crew parked beside it sees it.
    const watcher = clone(started);
    const crew = watcher.crews[crewsOf(watcher, 'p1')[0] as string];
    const from = watcher.districts['d2_1'];
    const to = watcher.districts['d1_0'];
    if (crew && from && to) {
      from.garrison = from.garrison.filter((id) => id !== crew.id);
      crew.loc = { at: 'd1_0' };
      to.garrison.push(crew.id);
    }
    const convoys = viewFor(watcher, 'p1').convoys;
    expect(convoys).toHaveLength(1);
    expect(convoys[0]?.owner).toBe('p2');
    expect(JSON.stringify(convoys)).not.toContain('cargo');
  });
});

describe('scouting', () => {
  it('reveals the target for 4 hours', () => {
    const s = world();
    const order: Input = {
      actorId: 'p1',
      order: {
        type: 'scout',
        crewId: crewsOf(s, 'p1')[0] as string,
        carrierId: vanOf(s, 'p1'),
        target: 'd0_0',
      },
    };
    const sent = step(s, [order], 10).state;
    const m = Object.values(sent.movements).find((x) => x.kind === 'scout');
    expect(m).toBeDefined();
    const arrive = (m?.arriveMs ?? 0) + 1;
    const there = step(sent, [], arrive).state;
    const revealed = there.reveals['p1|d0_0'];
    expect(revealed).toBe((m?.arriveMs ?? 0) + balance.scout.revealHours * MS_PER_HOUR);
    expect(balance.scout.revealHours).toBe(4);
    const view = viewFor(there, 'p1');
    expect(view.districts['d0_0']?.relation).toBe('visible');
    expect(view.reveals['d0_0']).toBe(revealed);
    // The scout never gets to see warehouses.
    expect(JSON.stringify(view)).not.toContain(String(toAtoms(4242)));
  });
});
