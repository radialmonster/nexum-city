// Economy check (tasks 79 and 80): regional prices, the trade window, money supply and the
// existing balance limits, over seeds 1 to 16 (or the seeds given). Run it before and after a
// change: `--save before.json` stores the numbers, `--vs before.json` compares against them.
// Usage: node scripts/economy-diag.mjs [firstSeed [lastSeed]] [--save file] [--vs file] [--set path=value,...]
// Needs `npx tsc -b packages/sim` first.
import { readFileSync, writeFileSync } from 'node:fs';
import { ATOMS_PER_UNIT, balance, runSeason } from '../packages/sim/dist/index.js';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const args = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
// `--set market.regional.transportPercentPerKm=8,market.reversionPercent=10` tries balance values.
for (const kv of (flag('--set') ?? '').split(',').filter(Boolean)) {
  const [path, v] = kv.split('=');
  const keys = path.split('.');
  let o = balance;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = Number(v);
}
const first = Number(args[0] ?? 1);
const last = Number(args[1] ?? 16);
const GOODS = ['parts', 'power', 'data', 'supplies'];
const VAN = balance.carriers.van.cargo;
const spread = balance.market.civicSpreadPercent;
const rate = balance.market.regional?.transportPercentPerKm ?? 3;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Street distance between two nodes (Dijkstra, no heap: the graph is small). */
function distancesFrom(graph, src) {
  const adj = {};
  for (const e of graph.edges) {
    (adj[e.a] ??= []).push([e.b, e.lengthM]);
    (adj[e.b] ??= []).push([e.a, e.lengthM]);
  }
  const dist = { [src]: 0 };
  const todo = new Set([src]);
  while (todo.size) {
    let u = null;
    for (const n of todo) if (u === null || dist[n] < dist[u]) u = n;
    todo.delete(u);
    for (const [v, m] of adj[u] ?? []) {
      if (dist[v] === undefined || dist[u] + m < dist[v]) {
        dist[v] = dist[u] + m;
        todo.add(v);
      }
    }
  }
  return dist;
}

const out = {
  seeds: [first, last],
  gradient: { pass: 0, n: 0 },
  gaps: [],
  baseGaps: [],
  windowHours: 0,
  hours: 0,
  tradeProfit: [],
  contractProfit: [],
  daily: Array.from({ length: 7 }, () => []),
  types: {},
  raids: { hits: 0, decided: 0 },
  problems: 0,
};

for (let seed = first; seed <= last; seed++) {
  const meanRef = {}; // hub -> parts ref sum, n
  const dockDist = {};
  let hubDist = null;
  let hubs = [];
  let startMs = 0;
  const r = runSeason({
    seed,
    decideEveryMinutes: 60,
    observe: (s) => {
      if (!hubDist) {
        startMs = s.season.startMs;
        hubs = Object.values(s.districts)
          .filter((d) => d.kind === 'hub')
          .map((d) => d.id);
        hubDist = Object.fromEntries(hubs.map((h) => [h, distancesFrom(s.graph, h)]));
        const docks = Object.values(s.districts)
          .filter((d) => d.kind === 'docks')
          .map((d) => d.id);
        for (const h of hubs)
          dockDist[h] = Math.min(...docks.map((d) => hubDist[h][d] ?? Infinity));
      }
      const day = Math.min(6, Math.floor((s.nowMs - startMs) / 86_400_000));
      if (Math.floor((s.nowMs - startMs) / 3_600_000) % 24 === 12) {
        out.daily[day].push(
          Object.values(s.players).reduce((n, p) => n + p.credits, 0) / ATOMS_PER_UNIT,
        );
      }
      for (const h of hubs) {
        const m = (meanRef[h] ??= { sum: 0, n: 0 });
        m.sum += s.markets[h].parts.refCents;
        m.n++;
      }
      let open = false;
      let hourBest = 0;
      for (const g of GOODS) {
        const refs = hubs.map((h) => s.markets[h][g].refCents);
        if (Math.max(...refs) / Math.min(...refs) >= 1.25) open = true;
        // Hub to hub gap against the transport cost between them.
        for (let i = 0; i < hubs.length; i++)
          for (let j = i + 1; j < hubs.length; j++) {
            const km = hubDist[hubs[i]][hubs[j]] / 1000;
            const transport = (balance.market.baseRefCents[g] * rate * km) / 100;
            if (transport > 0) out.gaps.push(Math.abs(refs[i] - refs[j]) / transport);
          }
        // One van run: buy at the civic ask of one hub, sell at the civic bid of another.
        let best = 0;
        for (let i = 0; i < hubs.length; i++)
          for (let j = 0; j < hubs.length; j++) {
            if (i === j) continue;
            const ask = (refs[i] * (100 + spread)) / 100;
            const bid = (refs[j] * (100 - spread)) / 100;
            best = Math.max(best, ((bid - ask) * VAN) / 100);
          }
        hourBest = Math.max(hourBest, best);
      }
      out.tradeProfit.push(hourBest);
      out.hours++;
      if (open) out.windowHours++;
      for (const c of Object.values(s.contracts)) {
        if (c.poster !== 'civic' || c.status !== 'open') continue;
        const ref = s.markets[c.hub][c.good].refCents;
        const premium = c.reward / ATOMS_PER_UNIT - (c.qty * ref) / 100;
        out.contractProfit.push((premium * VAN) / c.qty);
      }
    },
  });
  // Gradient: the hub nearest the docks should be cheaper for parts than the others on average.
  const avg = (h) => meanRef[h].sum / meanRef[h].n;
  const near = [...hubs].sort((a, b) => dockDist[a] - dockDist[b])[0];
  const rest = hubs.filter((h) => h !== near);
  out.gradient.n++;
  if (avg(near) < mean(rest.map(avg))) out.gradient.pass++;
  out.problems += r.problems.length;
  out.raids.hits += r.raidHits;
  out.raids.decided += r.raidHits + r.raidsRepelled + r.raidsEvaded;
  for (const s of r.standings) {
    const bot = r.players.find((p) => p.id === s.playerId)?.bot ?? '?';
    const t = (out.types[bot] ??= { n: 0, districts: 0, score: 0, credits: 0 });
    t.n++;
    t.districts += s.districts;
    t.score += s.score;
    t.credits += r.final.players[s.playerId].credits / ATOMS_PER_UNIT;
  }
}

const result = {
  gradientPercent: (100 * out.gradient.pass) / out.gradient.n,
  hubGapOverTransport: median(out.gaps),
  baseGapOverTransport: median(out.baseGaps),
  windowPercent: (100 * out.windowHours) / out.hours,
  tradeRun: median(out.tradeProfit),
  contractRun: median(out.contractProfit),
  payoutRatio: median(out.tradeProfit) / (median(out.contractProfit) || 1),
  creditsByDay: out.daily.map((d) => Math.round(mean(d))),
  moneyGrowth: mean(out.daily[6]) / (mean(out.daily[0]) || 1),
  raidSuccessPercent: (100 * out.raids.hits) / Math.max(1, out.raids.decided),
  problems: out.problems,
  types: Object.fromEntries(
    Object.entries(out.types).map(([k, t]) => [
      k,
      {
        districts: +(t.districts / t.n).toFixed(2),
        score: Math.round(t.score / t.n),
        credits: Math.round(t.credits / t.n),
      },
    ]),
  ),
};
const best = Math.max(result.types.turtle?.score ?? 0, result.types.merchant?.score ?? 0);
result.raiderLead = +((result.types.raider?.score ?? 0) / (best || 1)).toFixed(2);
console.log(JSON.stringify(result, null, 2));
const save = flag('--save');
if (save) writeFileSync(save, JSON.stringify(result, null, 2));
const vs = flag('--vs');
if (vs) {
  const old = JSON.parse(readFileSync(vs, 'utf8'));
  for (const [k, t] of Object.entries(result.types)) {
    const ratio = t.credits / Math.max(1, old.types[k]?.credits ?? 1);
    console.log(
      `${k} credits vs before: ${ratio.toFixed(2)}x${ratio > 1.5 ? '  FLAG (over 1.5x)' : ''}`,
    );
  }
}
