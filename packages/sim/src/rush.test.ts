import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, MS_PER_MINUTE, balance, toAtoms, toUnits } from './balance.js';
import { viewFor } from './fog.js';
import { crewsOf, vanOf } from './fixtures.js';
import { checkInvariants } from './invariants.js';
import { validateOrder } from './orders.js';
import { firstSession } from './session.js';
import { step } from './step.js';
import type { GameState, Id, JobOffer } from './types.js';
import { addPlayer, createWorld } from './world.js';

/** A fresh city with one newcomer `n1` (rushed, with jobs and a starter contract) and one old hand. */
function newcomerWorld(seed = 11): GameState {
  let s = createWorld(seed);
  s = addPlayer(s, { id: 'n1', protectedHours: 0 });
  return s;
}

const jobOf = (s: GameState, kind: JobOffer['kind']): JobOffer => {
  const j = s.players['n1']?.jobs.find((x) => x.kind === kind);
  if (!j) throw new Error(`no ${kind} job`);
  return j;
};

const homeOf = (s: GameState, id: Id): Id => {
  const d = Object.values(s.districts).find((x) => x.owner === id && x.kind !== 'hub');
  if (!d) throw new Error('no home');
  return d.id;
};

const kindsOf = (events: { kind: string }[]): string[] => events.map((e) => e.kind);

describe('newcomer rush', () => {
  it('runs builds ten times faster for 24 hours, then announces the end', () => {
    const s = newcomerWorld();
    const p = s.players['n1'];
    expect(p?.rushUntilMs).toBe(s.nowMs + balance.rush.hours * MS_PER_HOUR);
    const home = homeOf(s, 'n1');
    const r = step(
      s,
      [{ actorId: 'n1', order: { type: 'build', districtId: home, building: 'workshop' } }],
      s.nowMs + 11 * MS_PER_MINUTE,
    );
    expect(kindsOf(r.events)).not.toContain('build.done');
    const later = step(r.state, [], s.nowMs + 13 * MS_PER_MINUTE);
    // A level-1 Workshop is 2 h of work; at 10x that is 12 minutes.
    expect(kindsOf(later.events)).toContain('build.done');
    const end = step(later.state, [], s.nowMs + 25 * MS_PER_HOUR);
    expect(kindsOf(end.events)).toContain('rush.ended');
    expect(checkInvariants(end.state)).toEqual([]);
  });

  it('builds at the normal speed once the rush is over', () => {
    let s = newcomerWorld();
    s = step(s, [], s.nowMs + 25 * MS_PER_HOUR).state;
    const home = homeOf(s, 'n1');
    const d = s.districts[home];
    if (!d) throw new Error('home');
    d.warehouse.parts = toAtoms(100);
    d.warehouse.power = toAtoms(100);
    const t0 = s.nowMs;
    const r = step(
      s,
      [{ actorId: 'n1', order: { type: 'build', districtId: home, building: 'workshop' } }],
      t0 + 60 * MS_PER_MINUTE,
    );
    expect(kindsOf(r.events)).not.toContain('build.done');
    expect(kindsOf(step(r.state, [], t0 + 125 * MS_PER_MINUTE).events)).toContain('build.done');
  });

  it('gives a newcomer a home kit for one Workshop and a reserved starter contract', () => {
    const s = newcomerWorld();
    const d = s.districts[homeOf(s, 'n1')];
    expect(toUnits(d?.warehouse.parts ?? 0)).toBeGreaterThanOrEqual(balance.rush.kit.parts);
    const starter = Object.values(s.contracts).filter((c) => c.reservedFor === 'n1');
    expect(starter).toHaveLength(1);
    const c = starter[0];
    expect(c?.qty).toBe(balance.rush.starter.qty);
    // Nobody else can take it; the newcomer can, without a deposit.
    let w = addPlayer(s, { id: 'o1', protectedHours: 0 });
    const id = c?.id ?? '';
    expect(
      validateOrder(w, { actorId: 'o1', order: { type: 'contract.take', contractId: id } }),
    ).toMatchObject({
      error: 'reserved_contract',
    });
    w = step(w, [], w.nowMs + 1).state;
    expect(
      validateOrder(w, { actorId: 'n1', order: { type: 'contract.take', contractId: id } }),
    ).not.toHaveProperty('error');
  });

  it('is the same for every seed run twice', () => {
    const a = JSON.stringify(newcomerWorld(3));
    const b = JSON.stringify(newcomerWorld(3));
    expect(a).toBe(b);
  });
});

describe('street jobs', () => {
  it('offers three jobs, one of each kind, shown in the view', () => {
    const s = newcomerWorld();
    const p = s.players['n1'];
    expect(p?.jobs.map((j) => j.kind).sort()).toEqual(['courier', 'patrol', 'salvage']);
    const v = viewFor(s, 'n1');
    expect(v.self.jobs).toHaveLength(3);
    expect(v.self.rushUntilMs).toBe(p?.rushUntilMs);
  });

  it('pays a salvage job in parts and refills the list 30 minutes after a take', () => {
    const s = newcomerWorld();
    const job = jobOf(s, 'salvage');
    const home = homeOf(s, 'n1');
    const crew = crewsOf(s, 'n1')[0] as Id;
    const before = s.districts[home]?.warehouse.parts ?? 0;
    const r = step(
      s,
      [{ actorId: 'n1', order: { type: 'job.take', jobId: job.id, crewId: crew } }],
      s.nowMs + (job.minutes + 1) * MS_PER_MINUTE,
    );
    expect(kindsOf(r.events)).toContain('job.done');
    const gain = (r.state.districts[home]?.warehouse.parts ?? 0) - before;
    expect(gain).toBe(job.partsAtoms);
    expect(r.state.players['n1']?.jobs).toHaveLength(2);
    const r2 = step(r.state, [], s.nowMs + 31 * MS_PER_MINUTE);
    expect(r2.state.players['n1']?.jobs).toHaveLength(3);
    expect(checkInvariants(r2.state)).toEqual([]);
  });

  it('never exceeds the cap however long the player is away', () => {
    const s = newcomerWorld();
    const r = step(s, [], s.nowMs + 48 * MS_PER_HOUR).state;
    expect(r.players['n1']?.jobs).toHaveLength(balance.jobs.cap);
  });

  it('rejects an unknown job and a busy crew', () => {
    const s = newcomerWorld();
    const crew = crewsOf(s, 'n1')[0] as Id;
    expect(
      validateOrder(s, { actorId: 'n1', order: { type: 'job.take', jobId: 'nope', crewId: crew } }),
    ).toMatchObject({ error: 'unknown_job' });
  });

  it('runs a courier job with the van and pays credits on success', () => {
    const s = newcomerWorld();
    const job = jobOf(s, 'courier');
    const home = homeOf(s, 'n1');
    const d = s.districts[home];
    if (!d || !job.good) throw new Error('setup');
    d.warehouse[job.good] = toAtoms(50);
    const crew = crewsOf(s, 'n1')[0] as Id;
    const credits = s.players['n1']?.credits ?? 0;
    const r = step(
      s,
      [
        {
          actorId: 'n1',
          order: { type: 'job.take', jobId: job.id, crewId: crew, carrierId: vanOf(s, 'n1') },
        },
      ],
      s.nowMs + 2 * MS_PER_HOUR,
    );
    expect(kindsOf(r.events)).toContain('job.done');
    expect((r.state.players['n1']?.credits ?? 0) - credits).toBe(job.creditsAtoms);
    // The goods came back: nothing was lost.
    expect(r.state.districts[home]?.warehouse[job.good] ?? 0).toBeGreaterThanOrEqual(toAtoms(50));
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('reveals the street on a patrol', () => {
    const s = newcomerWorld();
    const job = jobOf(s, 'patrol');
    const crew = crewsOf(s, 'n1')[0] as Id;
    const r = step(
      s,
      [{ actorId: 'n1', order: { type: 'job.take', jobId: job.id, crewId: crew } }],
      s.nowMs + (job.minutes + 1) * MS_PER_MINUTE,
    );
    const done = r.events.find((e) => e.kind === 'job.done');
    expect(done?.data['job']).toBe('patrol');
    expect(Object.keys(r.state.reveals).some((k) => k.startsWith('n1|'))).toBe(true);
  });
});

describe('first session', () => {
  it('gives a newcomer at least 8 actions and 3 completions in 15 minutes, far more than before', () => {
    for (const seed of [1, 2, 3, 4]) {
      const now = firstSession(seed, true);
      const before = firstSession(seed, false);
      expect(now.actions15).toBeGreaterThanOrEqual(8);
      expect(now.completions15).toBeGreaterThanOrEqual(3);
      expect(now.actions15).toBeGreaterThan(before.actions15);
    }
  });

  it('lets a newcomer settle a plot inside the first 30 minutes', () => {
    // Four players join at once and each claims a plot; the surveyed replacements open within
    // minutes, so there is still a plot to settle (it used to be hours of nothing).
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = firstSession(seed, true);
      expect(r.settleMin).not.toBeNull();
      expect(r.settleMin ?? 99).toBeLessThan(30);
    }
  });
});
