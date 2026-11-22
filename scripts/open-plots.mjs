// Open and surveying plots over time as players join (docs/rewrite/sim-spec.md, "Frontier"):
// one player joins every `gap` hours (default 2) up to `n` (default 24); no one plays, so no
// plot is settled. Prints the counts every 6 hours. Usage: node scripts/open-plots.mjs [n [gap]].
// Needs `npm run build` first.
import { addPlayer, createWorld, step, wantedOpenPlots } from '../packages/sim/dist/index.js';

const n = Number(process.argv[2] ?? 24);
const gap = Number(process.argv[3] ?? 2);
const H = 3_600_000;
let s = createWorld(1, { seasonHours: 7 * 24 });
const t0 = s.nowMs;
const count = () => {
  const ds = Object.values(s.districts).filter((d) => d.owner === 'neutral' && d.kind !== 'hub');
  return `open ${ds.filter((d) => d.frontier === 'open').length}, surveying ${ds.filter((d) => d.frontier === 'surveying').length}`;
};
let joined = 0;
for (let h = 0; h <= n * gap + 12; h++) {
  if (h % gap === 0 && joined < n) s = addPlayer(s, { id: `p${++joined}` });
  if (h % 6 === 0 || h === 0)
    console.log(
      `h${h} players ${joined} want ${wantedOpenPlots(s)}: ${count()}, districts ${Object.keys(s.districts).length}`,
    );
  s = step(s, [], t0 + (h + 1) * H).state;
}
