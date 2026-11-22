import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, MS_PER_MINUTE, balance, toAtoms } from './balance.js';
import { BOTS } from './bots.js';
import { pickClearCrews, pickClearCrewsOrWhy } from './clear.js';
import { clone, crewsOf, scenario, vanOf } from './fixtures.js';
import { sightOf, viewFor } from './fog.js';
import { validateOrder } from './orders.js';
import { siegeDefence } from './siege.js';
import { step } from './step.js';
import type { GameState, Id, Input, SimEvent } from './types.js';
import { addPlayer, createWorld } from './world.js';

/** The playtest fixes (sim-spec, "Playtest fixes"): each test pins one finding. */

const of = (events: SimEvent[], kind: SimEvent['kind']): SimEvent[] =>
  events.filter((e) => e.kind === kind);

describe('siege against the neutral guard', () => {
  it('reports the real defence, and says why a worn-down crew gave up', () => {
    const s = scenario();
    const crew = crewsOf(s, 'p1')[0] as Id;
    // One tired crew: the guard never loses strength, so the crew is the one that wears down.
    const c = s.crews[crew];
    if (c) c.strength = 4;
    const input: Input = {
      actorId: 'p1',
      order: { type: 'siege', carrierId: vanOf(s, 'p1'), crewIds: [crew], target: 'd2_0' },
    };
    expect(siegeDefence(s, s.districts['d2_0'] as never)).toBe(balance.siege.neutralGuard);
    let state = s;
    const events: SimEvent[] = [];
    let pending = [input];
    for (let t = 1; t <= 60; t++) {
      const r = step(state, pending, s.nowMs + t * 30 * MS_PER_MINUTE);
      pending = [];
      state = r.state;
      events.push(...r.events);
    }
    const round = of(events, 'combat.round')[0];
    expect(round?.data['defence']).toBe(balance.siege.neutralGuard);
    const broken = of(events, 'siege.broken')[0];
    expect(broken?.data['reason']).toBe('routed');
    expect(String(broken?.data['note'])).toMatch(/guard/i);
    expect(state.districts['d2_0']?.owner).toBe('neutral');
  });
});

describe('open frontier plots are public', () => {
  it('shows a newcomer every open plot, and the settle order is valid to it', () => {
    let s = createWorld(5);
    s = addPlayer(s, { id: 'n1' });
    const sight = sightOf(s, 'n1');
    const far = Object.values(s.districts).find(
      (d) => d.owner === 'neutral' && d.frontier === 'open' && !sight.has(d.id),
    );
    expect(far).toBeDefined();
    const view = viewFor(s, 'n1');
    const seen = view.districts[(far as { id: Id }).id];
    expect(seen).toMatchObject({ relation: 'visible', open: true });
    expect((seen as { siege?: unknown } | undefined)?.siege ?? null).toBeNull();
    const crew = crewsOf(s, 'n1')[0] as Id;
    const ok = validateOrder(s, {
      actorId: 'n1',
      order: {
        type: 'settle',
        carrierId: vanOf(s, 'n1'),
        crewIds: [crew],
        target: (far as { id: Id }).id,
      },
    });
    expect(ok.ok).toBe(true);
  });
});

describe('the starter contract', () => {
  const world = (): GameState => addPlayer(createWorld(11), { id: 'n1', protectedHours: 0 });
  const starters = (s: GameState) =>
    Object.values(s.contracts).filter((c) => c.reservedFor === 'n1');

  it('has a window of the van trip plus three hours', () => {
    const s = world();
    const c = starters(s)[0];
    expect(balance.rush.starter.graceMinutes).toBe(180);
    expect(c?.windowMs).toBeGreaterThanOrEqual(180 * MS_PER_MINUTE);
  });

  it('is offered once more when nobody takes it, then not again', () => {
    const s = world();
    const first = starters(s)[0];
    const end = first?.offerEndsMs ?? 0;
    const r1 = step(s, [], end + 1);
    const expired = of(r1.events, 'contract.expired')[0];
    expect(expired?.data['starter']).toBe(true);
    expect(expired?.data['reoffered']).toBe(true);
    const second = starters(r1.state).find((c) => c.status === 'open');
    expect(second?.starterOffer).toBe(2);
    expect(second?.offerEndsMs).toBeGreaterThan(end);
    const r2 = step(r1.state, [], (second?.offerEndsMs ?? 0) + 1);
    const again = of(r2.events, 'contract.expired')[0];
    expect(again?.data['reoffered']).toBe(false);
    expect(starters(r2.state).filter((c) => c.status === 'open')).toHaveLength(0);
  });
});

describe('Break it up never takes crews from a threatened district', () => {
  it('returns no_crew with a reason while the home is under siege', () => {
    const s = scenario();
    const edge = { a: 'd2_1', b: 'd3_1' };
    const calm = pickClearCrewsOrWhy(s, 'p1', edge);
    expect('crewIds' in calm).toBe(true);
    const sieged = clone(s);
    // p2 besieges every district p1 holds.
    for (const d of Object.values(sieged.districts)) {
      if (d.owner === 'p1') {
        sieged.sieges[d.id] = {
          districtId: d.id,
          attacker: 'p2',
          crewIds: [],
          progress: 0,
        } as never;
      }
    }
    const none = pickClearCrewsOrWhy(sieged, 'p1', edge);
    expect(none).toEqual({ error: 'no_crew', reason: 'under_siege' });
    expect(pickClearCrews(sieged, 'p1', edge)).toBeNull();
  });
});

describe('salvage street jobs', () => {
  it('pay about a fifth of a Watchtower over three jobs', () => {
    const { minParts, maxParts } = balance.jobs.salvage;
    const three = (3 * (minParts + maxParts)) / 2;
    const share = three / balance.buildings.specs.watchtower.cost.parts;
    expect(share).toBeGreaterThanOrEqual(0.15);
    expect(share).toBeLessThanOrEqual(0.25);
  });
});

describe('a full warehouse says what it wastes', () => {
  it('carries the loss per hour and the capacity in the ongoing event', () => {
    const s = scenario();
    const d = s.districts['d2_1'];
    if (d) d.warehouse.parts = toAtoms(balance.warehouse.baseCapacity - 5);
    const r = step(s, [], s.nowMs + 3 * MS_PER_HOUR);
    const ev = r.events.find(
      (e) =>
        e.kind === 'production.wasted' && e.data['ongoing'] === true && e.districts[0] === 'd2_1',
    );
    expect(ev?.data['perHour']).toBeGreaterThan(0);
    expect(ev?.data['capacity']).toBe(balance.warehouse.baseCapacity);
  });
});

describe('raiders probe a newcomer', () => {
  it('meets the raiding game within a day of its protection ending, in most worlds', () => {
    const H = MS_PER_HOUR;
    let touched = 0;
    const seeds = [1, 2, 3, 4];
    for (const seed of seeds) {
      let state = createWorld(seed, { seasonHours: 240 });
      const bots = [
        { id: 'b1', bot: 'raider' as const },
        { id: 'b2', bot: 'turtle' as const },
        { id: 'b3', bot: 'merchant' as const },
        { id: 'b4', bot: 'merchant' as const },
      ];
      for (const b of bots) state = addPlayer(state, { id: b.id });
      let joined = false;
      let joinedAt = 0;
      let hit = false;
      while (state.nowMs < 7 * 24 * H) {
        if (!joined && state.nowMs >= 3 * 24 * H) {
          state = addPlayer(state, { id: 'n1' });
          bots.push({ id: 'n1', bot: 'merchant' });
          joined = true;
          joinedAt = state.nowMs;
        }
        const batch: Input[] = [];
        for (const b of bots) {
          for (const order of BOTS[b.bot](state, b.id)) {
            const input = { actorId: b.id, order, atMs: state.nowMs };
            if (validateOrder(state, input).ok) batch.push(input);
          }
        }
        const r = step(state, batch, state.nowMs + H);
        state = r.state;
        if (
          joined &&
          state.nowMs <= joinedAt + 48 * H + 24 * H &&
          r.events.some(
            (e) =>
              ['raid.hit', 'raid.repelled', 'raid.evaded', 'siege.started'].includes(e.kind) &&
              e.actors.includes('n1') &&
              e.actors[0] !== 'n1',
          )
        )
          hit = true;
      }
      if (hit) touched += 1;
    }
    expect(touched).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
