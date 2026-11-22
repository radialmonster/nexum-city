// Per-bot-type building and wear diagnostics over seeds 1..N (tasks 75 and 76): every building
// type built per player, credits left at the end, the parts price seen across hubs (lowest and
// highest reference over the season), warnings, carriers worn past the slow line and healed.
// Usage: node scripts/building-diag.mjs [seeds] [days]
import { runSeason } from '../packages/sim/dist/index.js';

const n = Number(process.argv[2] ?? 8);
const days = Number(process.argv[3] ?? 7);
const TYPES = ['walls', 'workshop', 'depot', 'watchtower', 'garage'];
const agg = {};
let lo = Infinity;
let hi = 0;
for (let seed = 1; seed <= n; seed++) {
  const r = runSeason({
    seed,
    days,
    observe: (st) => {
      for (const m of Object.values(st.markets))
        for (const g of ['parts', 'power', 'data']) {
          const c = m[g]?.refCents ?? 0;
          if (g === 'parts') {
            lo = Math.min(lo, c);
            hi = Math.max(hi, c);
          }
        }
    },
  });
  for (const p of r.players) {
    const a = (agg[p.bot] ??= {
      n: 0,
      spotted: 0,
      worn: 0,
      repaired: 0,
      wear: 0,
      carriers: 0,
      credits: 0,
      ...Object.fromEntries(TYPES.map((t) => [t, 0])),
    });
    a.n++;
    a.credits += (r.final.players[p.id]?.credits ?? 0) / 360e6;
    for (const d of Object.values(r.final.districts)) {
      if (d.owner !== p.id) continue;
      for (const b of d.buildings) a[b.type] += 1;
    }
    for (const c of Object.values(r.final.carriers)) {
      if (c.owner !== p.id) continue;
      a.carriers++;
      a.wear += c.wear ?? 0;
    }
    const w = r.wearBy[p.id] ?? { spotted: 0, worn: 0, repaired: 0 };
    a.spotted += w.spotted;
    a.worn += w.worn;
    a.repaired += w.repaired;
  }
}
console.log(`buildings per player: ${TYPES.join(' ')} | endCredits spotted worn repaired avgWear`);
for (const [bot, a] of Object.entries(agg)) {
  const f = (v) => (v / a.n).toFixed(2);
  console.log(
    `  ${bot.padEnd(9)} ${TYPES.map((t) => f(a[t])).join(' ')} | ${(a.credits / a.n).toFixed(0)} ${f(a.spotted)} ${f(a.worn)} ${f(a.repaired)} ${(a.wear / Math.max(1, a.carriers)).toFixed(1)}`,
  );
}
console.log(
  `parts reference price over the season: ${(lo / 100).toFixed(1)} to ${(hi / 100).toFixed(1)} (base 18)`,
);
