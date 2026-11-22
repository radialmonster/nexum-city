# @nexum/sim

The Nexum City rules engine. Pure and deterministic: no `Date`, no `Math.random`, no I/O (an ESLint override enforces this). The spec is `docs/rewrite/sim-spec.md`; every balance number is in `src/balance.ts`.

## State

`GameState` is plain JSON: districts and hubs, the street graph, players, crews, carriers, in-flight movements, scout reveals, the seeded RNG (`state.rng`) and an event queue ordered by `(at, seq)`. Build one with `createWorld(seed)`; add players with `addPlayer`. `hashState(state)` gives a stable hash (sorted keys) for tests and desync checks.

Stock and credits are integers ("atoms", `ATOMS_PER_UNIT` = 360 000 000 per unit). One unit per hour is exactly 100 atoms per millisecond, so rates integrate with no rounding drift.

## step

```ts
const { state, events } = step(prev, inputs, toMs);
```

`step` never mutates `prev`. It walks from `prev.nowMs` to `toMs`, processing queued events (arrivals, build completions, warehouse-full) and inputs in time order (scheduled events first at equal times; inputs in array order). Between them, every system's `settle(ctx, from, to)` integrates its continuous rates. Because of that, 2-second ticks and one 6-hour jump give the same hash and the same events. An input's optional `atMs` places it in time; later than `toMs` means it is ignored for this call.

## Systems

`src/systems.ts` holds the registry: `System = { name, settle?, handlers? }`. Today: `travel`, `production`, `construction`. Siege, markets, fog and scoring are systems; the frontier (task 1A) plugs in by adding a system and extending the `QueuedEvent` union.

## Events

`SimEvent = { id, at, kind, actors, districts, data }`. Kinds follow the spec (`arrived`, `build.done`, `production.wasted`, `siege.*`, ...) plus `order.rejected`. Only the kinds for tasks 11-15 are emitted so far.

## Orders

`Input = { actorId, order, atMs? }` with `order` one of `move`, `haul`, `build`, `scout`, `stance`, `recall`, `recruit`. `validateOrder(state, input)` returns `{ ok: true }` or `{ ok: false, error }` with a typed `OrderError`. Invalid orders in `step` become an `order.rejected` event and change nothing.

## Travel

`eta(graph, from, to, carrier)` returns `{ route, lengthM, durationMs }` using Dijkstra with id tie-breaks. Carriers are in `balance.carriers` (Runner is locked). A unit is either `{ at }` a node or `{ movement }`, never both; `checkInvariants(state)` verifies that and no-negative-stock.

## Siege, fog and season

- `siege` and `reinforce` orders; one capture bar per district (`state.sieges`), exact and lazy. `progressAt`, `siegeFraction` and `isProtected` read it. Events: `siege.started`, `siege.progress` (every 10%), `siege.captured` (with a battle `report`), `siege.broken`, `combat.round`. Tuning lives in `balance.siege`.
- `viewFor(state, playerId)` gives a JSON-safe, player-specific `PlayerView` (own districts in full, districts in sight, remembered owners elsewhere, convoys in sight). `sightOf` is the underlying set.
- `state.season` holds the clock (`startMs`, `endMs`, `finaleStartMs`, `finale`). Score is exact district-milliseconds; `standings(state)` ranks players; `score.tick` fires hourly. Below-median players recruit faster and captures against the leader are faster.

## Markets

`market.place { hub, side, good, price, qty }` and `market.cancel { orderId }`. One book per hub and good in `state.markets`; orders fill instantly when they cross, at the resting price, with price-time priority. Escrow is held by the order (goods from the hub stash, or credits). Virtual civic traders quote the reference plus and minus 8% with limited hourly depth (`civicBid`, `civicAsk`); an hourly `market.tick` refills depth, pulls the reference back and sweeps. `viewFor` includes `markets` (public) and `orders` (yours). Tuning is in `balance.market`; decisions are in `docs/rewrite/sim-spec.md`.
