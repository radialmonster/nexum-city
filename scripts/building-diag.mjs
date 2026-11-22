// Per-bot-type building and wear diagnostics over seeds 1..N (task 75): towers, garages, warnings,
// carriers worn past the slow line and healed, and carriers still worn at the end.
// Usage: node scripts/building-diag.mjs [seeds] [days]
import { runSeason } from '../packages/sim/dist/index.js';

const n = Number(process.argv[2] ?? 8);
const days = Number(process.argv[3] ?? 7);
const agg = {};
for (let seed = 1; seed <= n; seed++) {
  const r = runSeason({ seed, days });
  for (const p of r.players) {
    const a = (agg[p.bot] ??= {
      n: 0,
      watchtower: 0,
      garage: 0,
      spotted: 0,
      worn: 0,
      repaired: 0,
      wear: 0,
      carriers: 0,
    });
    a.n++;
    for (const d of Object.values(r.final.districts)) {
      if (d.owner !== p.id) continue;
      for (const b of d.buildings)
        if (b.type === 'watchtower' || b.type === 'garage') a[b.type] += 1;
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
console.log('type per player: towers garages spotted worn repaired avgWear(end)');
for (const [bot, a] of Object.entries(agg)) {
  const f = (v) => (v / a.n).toFixed(2);
  console.log(
    `  ${bot.padEnd(9)} ${f(a.watchtower)} ${f(a.garage)} ${f(a.spotted)} ${f(a.worn)} ${f(a.repaired)} ${(a.wear / Math.max(1, a.carriers)).toFixed(1)}`,
  );
}
