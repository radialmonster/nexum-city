// Measures the cost of a no-event step() on a lived-in world (the end of a scripted season:
// full books, crews, memory). Needs `npm run build` first. Run: npm run sim:bench
// Timing lives here because the sim reads no clock.
import { performance } from 'node:perf_hooks';
import { hashState, runSeason, step } from '../packages/sim/dist/index.js';

let state = runSeason({ seed: 1, days: 7 }).final;
console.log(
  `districts=${Object.keys(state.districts).length} players=${Object.keys(state.players).length} json=${JSON.stringify(state).length}B`,
);

const N = 20_000;
let quiet = 0;
let busy = 0;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const to = state.nowMs + 2_000;
  if ((state.queue[0]?.at ?? Infinity) <= to) busy++;
  else quiet++;
  state = step(state, [], to).state;
}
const ms = performance.now() - t0;
console.log(
  `steps=${N} (quiet ${quiet}, with events ${busy}) total=${ms.toFixed(0)}ms avg=${(ms / N).toFixed(4)}ms/step`,
);
console.log(`hash=${hashState(state)}`);
