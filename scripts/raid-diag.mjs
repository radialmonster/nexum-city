// Raid diagnostic: who is struck, with what odds. Usage: node scripts/raid-diag.mjs [seeds] [days]
// Needs `npm run build` first.
import { runSeason } from '../packages/sim/dist/index.js';

const seeds = Number(process.argv[2] ?? 8);
const days = Number(process.argv[3] ?? 7);
const targets = {};
const fights = { raiderStrength: 0, guard: 0, n: 0 };
const per = [];
let raids = 0;
for (let seed = 1; seed <= seeds; seed++) {
  const r = runSeason({ seed, days });
  raids += r.raids;
  const done = r.raidHits + r.raidsRepelled + r.raidsEvaded;
  per.push(`${seed}:${r.raidHits}/${done}`);
  for (const [k, v] of Object.entries(r.raidTargets)) {
    const t = (targets[k] ??= { hit: 0, repelled: 0, evaded: 0 });
    t.hit += v.hit;
    t.repelled += v.repelled;
    t.evaded += v.evaded;
  }
  fights.raiderStrength += r.raidFights.raiderStrength;
  fights.guard += r.raidFights.guard;
  fights.n += r.raidFights.n;
  const crew = Object.entries(r.raidsBy).map(
    ([id, v]) => `${id}:set${v.set}/hit${v.hit}/rep${v.repelled}/lost${v.lost}`,
  );
  console.log(
    `seed ${seed} raids=${r.raids} hit/decided ${r.raidHits}/${done} raider crews at end ${crew.join(' ')}`,
  );
}
console.log('targets', targets);
console.log(
  `avg raider strength ${(fights.raiderStrength / fights.n).toFixed(1)} avg guard ${(fights.guard / fights.n).toFixed(1)} fights ${fights.n}`,
);
let h = 0,
  d = 0;
for (const t of Object.values(targets)) {
  h += t.hit;
  d += t.hit + t.repelled + t.evaded;
}
console.log(`raids set ${raids}; success ${((100 * h) / d).toFixed(0)}% (${h}/${d})`);
console.log('per-seed hit/decided', per.join(' '));
