// Plays seeds 1 to 8 (or the seeds given) and sums districts, trade and score per bot type,
// plus raid numbers. Used for the balance check in docs/rewrite/sim-spec.md.
// Usage: node scripts/sim-seeds.mjs [firstSeed [lastSeed]]. Needs `npm run build` first.
import { runSeason } from '../packages/sim/dist/index.js';

const first = Number(process.argv[2] ?? 1);
const last = Number(process.argv[3] ?? 8);
const types = {};
let raids = 0;
let hits = 0;
let repelled = 0;
let stolen = 0;
let destroyed = 0;
let problems = 0;
let n = 0;
const posted = { civic: 0, player: 0 };
let expired = 0;
for (let seed = first; seed <= last; seed++) {
  const r = runSeason({ seed });
  n += 1;
  raids += r.raids;
  hits += r.raidHits;
  repelled += r.raidsRepelled;
  stolen += r.stolenUnits;
  destroyed += r.destroyedUnits;
  problems += r.problems.length;
  posted.civic += r.contractsPosted.civic;
  posted.player += r.contractsPosted.player;
  expired += r.contractsExpired;
  for (const s of r.standings) {
    const bot = r.players.find((p) => p.id === s.playerId)?.bot ?? '?';
    const t = (types[bot] ??= {
      players: 0,
      districts: 0,
      trade: 0,
      score: 0,
      credits48: 0,
      taken: 0,
      done: 0,
      failed: 0,
    });
    const c = r.contractsBy[s.playerId];
    if (c) {
      t.taken += c.taken;
      t.done += c.done;
      t.failed += c.failed;
    }
    t.credits48 += r.creditsAt48h?.[s.playerId] ?? 0;
    t.players += 1;
    t.districts += s.districts;
    t.trade += s.tradeScore ?? 0;
    t.score += s.score;
  }
}
console.log(`seeds ${first}-${last}`);
for (const [bot, t] of Object.entries(types)) {
  console.log(
    `${bot.padEnd(9)} districts/player=${(t.districts / t.players).toFixed(2)} trade/player=${(t.trade / t.players).toFixed(1)} credits@48h=${(t.credits48 / t.players).toFixed(0)} score/player=${(t.score / t.players).toFixed(1)} contracts/player taken=${(t.taken / t.players).toFixed(2)} done=${(t.done / t.players).toFixed(2)} failed=${(t.failed / t.players).toFixed(2)}`,
  );
}
const scores = Object.values(types)
  .map((t) => t.score / t.players)
  .sort((a, b) => b - a);
console.log(`top / next score ratio: ${(scores[0] / scores[1]).toFixed(2)}`);
const raiderScore = types.raider ? types.raider.score / types.raider.players : 0;
const others = Object.entries(types)
  .filter(([k]) => k !== 'raider')
  .map(([, t]) => t.score / t.players);
console.log(`raider lead over best other type: ${(raiderScore / Math.max(...others)).toFixed(2)}x`);
console.log(
  `raids/season=${(raids / n).toFixed(1)} hits/season=${(hits / n).toFixed(1)} repelled/season=${(repelled / n).toFixed(1)} success=${raids ? ((hits / Math.max(1, hits + repelled)) * 100).toFixed(0) : 0}% stolen/season=${(stolen / n).toFixed(0)} destroyed/season=${(destroyed / n).toFixed(0)}`,
);
console.log(
  `contracts/season posted civic=${(posted.civic / n).toFixed(1)} player=${(posted.player / n).toFixed(1)} expired untaken/cancelled=${(expired / n).toFixed(1)}`,
);
console.log(`invariant problems=${problems}`);
if (problems > 0) process.exitCode = 1;
