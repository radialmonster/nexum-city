// Newcomer probe check (playtest fix, sim-spec "Bots and protection"): a newcomer joins a
// running world, and we count what the bots do to it in the first day after its protection ends.
// Usage: node scripts/newcomer-probe.mjs [firstSeed [lastSeed]] [joinDay]. Needs `npm run build` first.
import { BOTS, addPlayer, seasonStart, step, validateOrder } from '../packages/sim/dist/index.js';

const first = Number(process.argv[2] ?? 1);
const last = Number(process.argv[3] ?? 16);
const joinDay = Number(process.argv[4] ?? 3);
const H = 3_600_000;
let probed = 0;
let firstHours = [];
for (let seed = first; seed <= last; seed++) {
  const { state: s0, players } = seasonStart({ seed, days: 10 });
  let state = s0;
  const all = [...players];
  let joined = false;
  let joinedAt = 0;
  let hit = null;
  while (state.nowMs < s0.season.endMs && state.nowMs < (joinDay + 4) * 24 * H) {
    if (!joined && state.nowMs >= joinDay * 24 * H) {
      state = addPlayer(state, { id: 'n1' });
      all.push({ id: 'n1', bot: process.env.IDLE ? 'idle' : 'merchant' });
      joined = true;
      joinedAt = state.nowMs;
    }
    const at = state.nowMs;
    const batch = [];
    for (const p of all) {
      for (const order of p.bot === 'idle' ? [] : BOTS[p.bot](state, p.id)) {
        const input = { actorId: p.id, order, atMs: at };
        if (validateOrder(state, input).ok) batch.push(input);
      }
    }
    const r = step(state, batch, at + H);
    state = r.state;
    if (joined) {
      for (const e of r.events) {
        const protectedEnd = joinedAt + 48 * H;
        if (
          (e.kind === 'raid.set' ||
            e.kind === 'raid.hit' ||
            e.kind === 'raid.repelled' ||
            e.kind === 'siege.started' ||
            false) &&
          e.actors.includes('n1') &&
          e.actors[0] !== 'n1' &&
          hit === null
        ) {
          hit = { kind: e.kind, hoursAfterProtection: (state.nowMs - protectedEnd) / H };
        }
      }
    }
  }
  console.log(
    `seed ${seed}: ${hit ? `${hit.kind} at +${hit.hoursAfterProtection.toFixed(1)}h after protection` : 'untouched'}`,
  );
  if (hit) {
    probed += 1;
    firstHours.push(hit.hoursAfterProtection);
  }
}
console.log(
  `probed ${probed}/${last - first + 1}; median first touch ${firstHours.sort((a, b) => a - b)[Math.floor(firstHours.length / 2)]?.toFixed(1)}h`,
);
