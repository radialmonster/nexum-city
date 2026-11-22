import { describe, expect, it } from 'vitest';
import { MS_PER_HOUR, MS_PER_MINUTE, balance } from './balance.js';
import { hashState } from './hash.js';
import { shortestRoute } from './routing.js';
import { step } from './step.js';
import type { District, GameState } from './types.js';
import { viewFor } from './fog.js';
import { addPlayerWithEvents, createWorld } from './world.js';
import { ensureFrontier, sectorName, wantedOpenPlots } from './frontier.js';
import { stripNewcomerPerks } from './rush.js';

function join(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 1; i <= n; i++) {
    s = addPlayerWithEvents(s, { id: `q${i}` }).state;
    // Time passes between joins so surveyed plots open.
    s = step(s, [], s.nowMs + 2 * MS_PER_HOUR).state;
  }
  return s;
}

const open = (s: GameState) =>
  Object.values(s.districts).filter((d) => d.frontier === 'open' && d.owner === 'neutral');

describe('frontier', () => {
  it('names sectors without a double dash, even at negative coordinates', () => {
    expect(sectorName(0, 0)).toBe('Sector 1-1');
    expect(sectorName(2, -1)).toBe('Sector 3-N1');
    expect(sectorName(-2, 3)).toBe('Sector W2-4');
    const s = join(createWorld(11), 12);
    for (const d of Object.values(s.districts)) expect(d.name).not.toContain('--');
  });

  it('starts with open plots on the edge, with no events in history', () => {
    const s = createWorld(11);
    expect(open(s)).toHaveLength(balance.frontier.minOpen);
    expect(s.counters.event).toBe(0);
    for (const d of open(s)) expect(d.pos.y).toBeLessThan(s.world.soundY);
  });

  it('grows the city as players join and keeps the plot reserve', () => {
    const before = createWorld(11);
    const s = join(before, 12);
    expect(Object.keys(s.districts).length).toBeGreaterThan(Object.keys(before.districts).length);
    const settled = step(s, [], s.nowMs + 6 * MS_PER_HOUR).state;
    expect(open(settled).length).toBeGreaterThanOrEqual(wantedOpenPlots(settled));
  });

  it('re-opens the plot a joiner took within minutes while a rush lasts, and in hours otherwise', () => {
    // The newcomer rush speeds up surveying: the plot a joiner leaves behind is open again quickly.
    const joined = addPlayerWithEvents(createWorld(11), { id: 'a' }).state;
    expect(open(joined)).toHaveLength(wantedOpenPlots(joined) - 1);
    const soon = step(
      joined,
      [],
      joined.nowMs + (balance.frontier.rushSurveyMinutes + 1) * MS_PER_MINUTE,
    ).state;
    expect(open(soon)).toHaveLength(wantedOpenPlots(soon));
    // Without any rush the survey takes the full survey time.
    const plain = JSON.parse(JSON.stringify(joined)) as GameState;
    stripNewcomerPerks(plain);
    const taken = open(plain)[0] as District;
    taken.owner = 'a';
    taken.frontier = 'built';
    ensureFrontier({ state: plain, events: [] });
    const due = plain.queue
      .filter((e) => e.kind === 'frontier.survey')
      .map((e) => e.at - plain.nowMs);
    expect(due).toContain(balance.frontier.surveyHours * MS_PER_HOUR);
  });

  it('reports player.joined and frontier.opened', () => {
    const s = createWorld(11);
    const r = addPlayerWithEvents(s, { id: 'a' });
    expect(r.events.some((e) => e.kind === 'player.joined')).toBe(true);
    const later = step(r.state, [], r.state.nowMs + 5 * MS_PER_HOUR);
    expect(later.events.some((e) => e.kind === 'frontier.opened')).toBe(true);
  });

  it('keeps streets connected and plots unique with 40 players', () => {
    const s = join(createWorld(3), 40);
    const ids = Object.values(s.districts).map((d) => `${d.pos.x},${d.pos.y}`);
    expect(new Set(ids).size).toBe(ids.length);
    const owners = Object.values(s.districts)
      .filter((d) => d.owner !== 'neutral')
      .map((d) => d.id);
    expect(new Set(owners).size).toBe(40);
    for (const d of Object.values(s.districts)) {
      if (d.frontier === 'surveying') continue;
      expect(shortestRoute(s.graph, 'hubW', d.id)).not.toBeNull();
      expect(d.pos.y).toBeLessThan(s.world.soundY + (d.kind === 'hub' ? 1 : 0));
    }
  });

  it('is deterministic', () => {
    expect(hashState(join(createWorld(8), 15))).toBe(hashState(join(createWorld(8), 15)));
  });

  it('puts newcomers far from owned districts', () => {
    let s = createWorld(5);
    s = addPlayerWithEvents(s, { id: 'a' }).state;
    const a = Object.values(s.districts).find((d) => d.owner === 'a') as District;
    const r = addPlayerWithEvents(s, { id: 'b' });
    const b = r.state.districts[r.districtId] as District;
    const dist = Math.abs(a.pos.x - b.pos.x) + Math.abs(a.pos.y - b.pos.y);
    expect(dist).toBeGreaterThanOrEqual(2);
  });

  it('starts the season, queue and ticks at startMs', () => {
    const start = 1_700_000_000_000;
    const s = createWorld(2, { startMs: start });
    expect(s.nowMs).toBe(start);
    expect(s.season.startMs).toBe(start);
    expect(s.season.endMs).toBeGreaterThan(start);
    expect(s.queue.every((e) => e.at >= start)).toBe(true);
    const r = step(s, [], start + 3 * MS_PER_HOUR);
    expect(r.state.nowMs).toBe(start + 3 * MS_PER_HOUR);
  });
  it('shows the public street graph in a player view', () => {
    const r = addPlayerWithEvents(createWorld(4), { id: 'a' });
    const v = viewFor(r.state, 'a');
    expect(v.graph.hubs).toEqual(['hubE', 'hubW']);
    expect(v.graph.edges.length).toBe(r.state.graph.edges.length);
    expect(Object.keys(v.graph.nodes).length).toBe(Object.keys(r.state.graph.nodes).length);
  });
});
