// Plays a scripted 7-day season through the sim and prints what happened.
// Usage: npm run sim:season [-- seed [days]]. Needs `npm run build` first.
import { performance } from 'node:perf_hooks';
import { replay, runSeason } from '../packages/sim/dist/index.js';

const seed = Number(process.argv[2] ?? 1);
const days = Number(process.argv[3] ?? 7);

const t0 = performance.now();
const r = runSeason({ seed, days });
const runMs = performance.now() - t0;

const t1 = performance.now();
const jump = replay(r.start, r.inputs, 0);
const jumpMs = performance.now() - t1;
const fineMs = 6 * 3_600_000;
const fineStart = performance.now();
const fine = replay(r.start, r.inputs, 2_000, fineMs);
const fineTook = performance.now() - fineStart;
const fineRef = replay(r.start, r.inputs, 0, fineMs);
const t3 = performance.now();
const coarse = replay(r.start, r.inputs, 60_000);
const coarseMs = performance.now() - t3;

console.log(
  `season seed=${seed} days=${days} districts=${r.districts} players=${r.players.length}`,
);
console.log(`bots: ${r.players.map((p) => `${p.id}=${p.bot}`).join(' ')}`);
console.log(`orders=${r.inputs.length} rejected=${r.rejected} events=${r.events}`);
console.log(`captures=${r.captures} fills=${r.fills} filledUnits=${r.filledUnits}`);
console.log(`invariant problems=${r.problems.length}`);
console.log('standings:');
for (const s of r.standings) {
  const bot = r.players.find((p) => p.id === s.playerId)?.bot ?? '?';
  console.log(
    `  #${s.rank} ${s.playerId} (${bot}) score=${s.score.toFixed(1)} districts=${s.districts}`,
  );
}
console.log(
  `hash=${r.hash} jump=${jump === r.hash ? 'same' : 'DIFFERENT'} 60s-ticks=${coarse === r.hash ? 'same' : 'DIFFERENT'}`,
);
console.log(
  `first 6 h in 2 s ticks: ${fine === fineRef ? 'same' : 'DIFFERENT'} (${fineTook.toFixed(0)} ms)`,
);
console.log(
  `timing: run ${runMs.toFixed(0)} ms, one jump ${jumpMs.toFixed(0)} ms, 60 s ticks ${coarseMs.toFixed(0)} ms`,
);
if (r.problems.length > 0 || jump !== r.hash || coarse !== r.hash || fine !== fineRef)
  process.exitCode = 1;
