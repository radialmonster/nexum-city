// Market movement check (task 77, measure only): how far do hub reference prices move in
// 15 min, 1 h and 6 h, and does a hub-to-hub arbitrage window exist inside one 15 min session?
// Usage: node scripts/market-movement.mjs [firstSeed] [lastSeed]   (needs `npx tsc -b packages/sim`)
import { balance, runSeason } from '../packages/sim/dist/index.js';

const first = Number(process.argv[2] ?? 1);
const last = Number(process.argv[3] ?? 8);
const GOODS = ['parts', 'power', 'data', 'supplies'];
const STEP_MIN = 15;
const spread = balance.market.civicSpreadPercent;
// A civic arbitrage (sell at hub B's bid, bought at hub A's ask) needs refB / refA above this.
const need = (100 + spread) / (100 - spread);
const horizons = { '15 min': 1, '1 h': 4, '6 h': 24 };

const moves = {}; // good -> horizon -> list of |percent change|
const ratios = []; // best cross-hub ratio per sample
let windowSamples = 0;
let windowRuns = [];
for (const g of GOODS) moves[g] = Object.fromEntries(Object.keys(horizons).map((h) => [h, []]));

for (let seed = first; seed <= last; seed++) {
  const series = []; // per sample: { hub: { good: refCents } }
  runSeason({
    seed,
    decideEveryMinutes: STEP_MIN,
    observe: (state) => {
      const snap = {};
      for (const [hub, books] of Object.entries(state.markets)) {
        snap[hub] = {};
        for (const g of GOODS) snap[hub][g] = books[g].refCents;
      }
      series.push(snap);
    },
  });
  // Skip the first hour (starting prices are all the base).
  let run = 0;
  for (let i = 4; i < series.length; i++) {
    for (const hub of Object.keys(series[i])) {
      for (const g of GOODS) {
        for (const [name, k] of Object.entries(horizons)) {
          if (i - k < 4) continue;
          const a = series[i - k][hub][g];
          const b = series[i][hub][g];
          moves[g][name].push((Math.abs(b - a) / a) * 100);
        }
      }
    }
    let open = false;
    for (const g of GOODS) {
      const refs = Object.values(series[i]).map((h) => h[g]);
      const r = Math.max(...refs) / Math.min(...refs);
      ratios.push(r);
      if (r >= need) open = true;
    }
    if (open) {
      windowSamples++;
      run++;
    } else if (run > 0) {
      windowRuns.push(run);
      run = 0;
    }
  }
  if (run > 0) windowRuns.push(run);
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
console.log(`seeds ${first}-${last}, samples every ${STEP_MIN} min, civic spread +/-${spread}%`);
console.log('hub reference price change, percent (mean / p95 / max)');
for (const g of GOODS) {
  const row = Object.keys(horizons)
    .map(
      (h) =>
        `${h}: ${mean(moves[g][h]).toFixed(2)} / ${pct(moves[g][h], 95).toFixed(2)} / ${Math.max(0, ...moves[g][h]).toFixed(2)}`,
    )
    .join('   ');
  console.log(`${g.padEnd(9)} ${row}`);
}
console.log(
  `civic arbitrage needs a hub-to-hub price ratio of ${need.toFixed(3)} (before the trip cost)`,
);
console.log(
  `best hub ratio per sample: mean ${mean(ratios).toFixed(3)} p95 ${pct(ratios, 95).toFixed(3)} max ${Math.max(...ratios).toFixed(3)}`,
);
const total = ratios.length / GOODS.length;
console.log(
  `samples with an open window: ${windowSamples}/${total} (${((windowSamples / total) * 100).toFixed(1)}%), runs: ${windowRuns.length}, longest ${Math.max(0, ...windowRuns) * STEP_MIN} min`,
);
