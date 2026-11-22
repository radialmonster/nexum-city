// Per-bot-type table over seeds 1..N: districts, credits at 48 h, score, contracts done, and
// raid success with the per-seed spread. Usage: node scripts/bot-table.mjs [seeds] [days]
import { runSeason } from '../packages/sim/dist/index.js';

const n = Number(process.argv[2] ?? 8);
const days = Number(process.argv[3] ?? 7);
const agg = {};
const rates = [];
const vic = {};
let hit = 0,
  decided = 0,
  raids = 0;
for (let seed = 1; seed <= n; seed++) {
  const r = runSeason({ seed, days });
  raids += r.raids;
  const d = r.raidHits + r.raidsRepelled + r.raidsEvaded;
  hit += r.raidHits;
  decided += d;
  if (d > 0) rates.push((100 * r.raidHits) / d);
  if (r.problems.length) console.log('PROBLEMS', seed, r.problems.slice(0, 3));
  for (const [id, t] of Object.entries(r.raidsAgainst ?? {})) {
    const bot = r.players.find((p) => p.id === id)?.bot ?? 'other';
    const v = (vic[bot] ??= { hit: 0, n: 0 });
    v.hit += t.hit;
    v.n += t.hit + t.repelled + t.evaded;
  }
  for (const s of r.standings) {
    const bot = r.players.find((p) => p.id === s.playerId).bot;
    const a = (agg[bot] ??= { n: 0, d: 0, c: 0, s: 0, k: 0 });
    a.n++;
    a.d += s.districts;
    a.c += r.creditsAt48h[s.playerId] ?? 0;
    a.s += s.score;
    a.k += r.contractsBy[s.playerId]?.done ?? 0;
  }
}
console.log(`seeds 1-${n}: type districts credits48 score contracts`);
for (const [bot, a] of Object.entries(agg)) {
  console.log(
    `  ${bot.padEnd(9)} ${(a.d / a.n).toFixed(2)} ${(a.c / a.n).toFixed(0)} ${(a.s / a.n).toFixed(0)} ${(a.k / a.n).toFixed(2)}`,
  );
}
console.log('raid success against each type:');
for (const [bot, v] of Object.entries(vic)) {
  console.log(
    `  ${bot.padEnd(9)} ${((100 * v.hit) / Math.max(1, v.n)).toFixed(0)}% (${v.hit}/${v.n})`,
  );
}
const best = Math.max(
  ...Object.entries(agg)
    .filter(([b]) => b !== 'raider')
    .map(([, a]) => a.s / a.n),
);
console.log(`raider lead ${(agg.raider.s / agg.raider.n / best).toFixed(2)}x`);
rates.sort((a, b) => a - b);
const mean = rates.reduce((x, y) => x + y, 0) / rates.length;
const sd = Math.sqrt(rates.reduce((x, y) => x + (y - mean) ** 2, 0) / rates.length);
console.log(
  `raids ${raids}, success ${((100 * hit) / decided).toFixed(0)}% (${hit}/${decided}); per-seed min ${rates[0].toFixed(0)} max ${rates.at(-1).toFixed(0)} sd ${sd.toFixed(0)}`,
);
