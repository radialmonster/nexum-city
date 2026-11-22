// Plays the scripted newcomer opening (docs/rewrite/sim-spec.md, "Newcomer rush and street jobs")
// on seeds 1 to 8 (or the seeds given) and reports the distinct accepted actions and finished
// things within 15 and 30 minutes, with and without the rush, starter contract and street jobs.
// Usage: node scripts/first-session.mjs [firstSeed [lastSeed]]. Needs `npm run build` first.
import { firstSession } from '../packages/sim/dist/index.js';

const first = Number(process.argv[2] ?? 1);
const last = Number(process.argv[3] ?? 8);
for (const perks of [false, true]) {
  const rows = [];
  for (let seed = first; seed <= last; seed++) rows.push(firstSession(seed, perks));
  const avg = (f) => (rows.reduce((n, r) => n + f(r), 0) / rows.length).toFixed(1);
  const min = (f) => Math.min(...rows.map(f));
  console.log(perks ? 'with rush, starter contract and street jobs' : 'before (no perks)');
  console.log(
    `  actions in 15 min avg=${avg((r) => r.actions15)} min=${min((r) => r.actions15)}; in 30 min avg=${avg((r) => r.actions30)}`,
  );
  console.log(
    `  completions in 15 min avg=${avg((r) => r.completions15)} min=${min((r) => r.completions15)}; in 30 min avg=${avg((r) => r.completions30)}`,
  );
  const first1 = rows.map((r) => r.firstCompletionMin).filter((m) => m !== null);
  console.log(
    `  first completion at minute avg=${first1.length ? (first1.reduce((a, b) => a + b, 0) / first1.length).toFixed(1) : 'never'} (${first1.length}/${rows.length} seeds)`,
  );
  const kinds = {};
  for (const r of rows)
    for (const [k, n] of Object.entries(r.kinds)) kinds[k] = (kinds[k] ?? 0) + n;
  console.log(
    '  accepted per seed: ' +
      Object.entries(kinds)
        .map(([k, n]) => `${k}=${(n / rows.length).toFixed(1)}`)
        .join(' '),
  );
}
