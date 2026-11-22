# Simulation spec (`packages/sim`)

This is the rules-engine contract for Phase 1: what `packages/sim` models, how it advances, and the starting numbers. The player-facing design is in [`../design/rewrite-design.md`](../design/rewrite-design.md). This file turns it into data and rules an engineer can build and test.

Every number here is a **tunable default**, kept in one `balance.ts` config object. The fast-forward harness (task 1B) is how we tune them. If a rule changes, update this file in the same commit.

## Principles

- **A pure function.** `step(state, inputs, toMs) -> { state, events }`.
  - No I/O, no `Date.now()`, no `Math.random()`.
  - Time is integer milliseconds of game time, passed in.
  - Randomness comes from a seeded RNG (for example mulberry32 or sfc32) stored in the state, so replays are exact.
- **An event-driven core.** Arrivals, build completions and capture completions are scheduled at exact times. `step` processes due events in time order: by time, then by a stable sequence id. Continuous rates such as production and capture progress are integrated between events, not ticked. That way a 2-second tick and a 6-hour catch-up after downtime give identical results.
- **Bots and players use the same input path.** An input is `{ actorId, order }`, validated by `validateOrder(state, input)`, which returns a typed error or `ok`.
- **Fog is applied outside the core.** `viewFor(state, playerId)` derives what a player can see. The core always holds the full truth.
- **Serializable state.** Plain JSON-safe data with maps keyed by id. Ids are short strings.

## World

- **District:**
  - `id`, `name`, `kind`, `pos` (grid x and y), `owner` (player id or `neutral`);
  - `garrison` (crew ids), `stance` (`hold` or `pullback`);
  - `buildings[]`, with 3 slots to start;
  - `warehouse` (goods counts and a capacity);
  - `protectedUntil?`;
  - `frontier` state: `open`, `surveying` or `built`.
- **Kinds and what they produce:**
  - Docks: parts
  - Grid: power
  - Archive: data
  - Farms or Stacks: supplies
  - Residential: credits
  - Hub: no production, but has a market. Hubs are never owned.
- **Streets:** an undirected weighted graph. Nodes are districts and junctions. Each edge length is in metres of street.
  - Travel time = route length ÷ carrier speed.
  - **Default scale:** adjacent districts are 15–25 min apart by Van; across the starting city is about 90 min.
- **Grid layout:** districts sit on a grid of plots. The city grows by opening frontier plots along its outer edge. The Sound (water) bounds the south.

## Goods

- **Goods:** `parts`, `power`, `data`, `supplies`.
- **Credits:** a currency, not a physical good. They are held per player and spent anywhere. The design treats goods as physical and money as abstract.
- **Base production:** 10 of the main good per hour per district. A Workshop adds 25% per level.
- **Warehouse capacity:** 120 units. A Depot adds 120 per level. Anything produced above capacity is lost, and the loss is reported as an event.

## Units

- **Crew:** `id`, `owner`, `strength` (1–30, starts at 10), `location` (a district, or in transit on a carrier), `order?`.
- **Recruiting** is an instant order: it costs 150 credits and 20 supplies from the district's warehouse. The crew is ready after 30 minutes.
- **Carriers:**

  | Carrier | Speed (m/min) | Cargo | Toughness | Crew seats |
  | ------- | ------------- | ----- | --------- | ---------- |
  | On foot | 40            | 5     | 0         | 1          |
  | Van     | 100           | 40    | 10        | 2          |
  | Hauler  | 60            | 150   | 25        | 2          |
  | Runner  | 180           | 15    | 3         | 1          |
  - Runner is a milestone 2 unit; model it now but keep it locked.
  - On foot is always available, as a pseudo-carrier with unlimited count.

## Orders

All orders are **asset-limited**: a crew or carrier can do one thing at a time, and there is no action budget.

| Order       | Kind                             | Effect                                                                      |
| ----------- | -------------------------------- | --------------------------------------------------------------------------- |
| `move`      | timed                            | Crews and/or cargo travel along a route to a district you own or a hub      |
| `haul`      | timed                            | Move cargo. It can chain hub actions: sell, then buy, then return           |
| `siege`     | timed                            | Travel to the target, then start or join its capture bar                    |
| `reinforce` | timed                            | Move crews into your own district's garrison                                |
| `scout`     | timed                            | A crew travels to the target and reveals it for 4 h after arriving          |
| `build`     | timed                            | Spend goods from that district's warehouse; it completes after a set time   |
| `stance`    | instant                          | `hold` or `pullback`                                                        |
| `recall`    | instant                          | An order in transit turns around and returns along the same path            |
| `market.*`  | instant                          | Place or cancel a limit order at a hub where the actor has goods or credits |
| `recruit`   | instant, plus 30 min to be ready | See Units                                                                   |

## Siege

There is a single capture bar per district, from 0 to 1.

- **Progress rate per hour** = `base × A / (A + D)`
  - `A` = the total strength of the attacking crews present.
  - `D` = `(garrison strength + 10 (neutral guard)) × walls multiplier × stance multiplier`.
  - `base` = 1/6 per hour, so an even fight (A = D) takes 12 hours and a strongly favoured attacker about 6–7 hours.
  - The walls multiplier is `1 + 0.3 × level`.
  - The stance multiplier is 1.0 for `hold` and 0.5 for `pullback`.
- **Attrition:** while both sides are present, every 30 minutes each side loses strength in proportion to the other side's strength, plus seeded noise of ±20%. A crew at 0 strength is routed and goes home on foot.
- **No attackers present:** the bar decays at 1/12 per hour.
- **On capture:**
  - The district changes owner.
  - 30% of the warehouse is looted onto the attackers' carriers, up to their free cargo space. The rest stays.
  - Buildings lose one level.
  - The defending garrison retreats to the defender's nearest owned district.
  - A battle report is created for both sides.
- **Protected districts** cannot be sieged.

## Raids (milestone 2)

The rules are planned but not built in Phase 1. Leave a hook: a convoy that passes a street segment checks for any interceptors posted there.

## Markets

- **One order book per hub per good:** price-time priority, and orders fill instantly when they cross.
- **Escrow:** a sell order locks goods held at the hub. A buy order locks credits.
- **Bought goods** land in your **hub stash** and must be hauled away.
- **Civic traders:**
  - Each hub keeps standing bids and asks around a reference price per good, with a spread of ±8%.
  - The reference drifts toward recent trade prices and with hub-specific supply. A raid or shortage event adds a premium.
  - Civic depth is limited per hour, so markets can move.
- **Starting reference prices** (credits per unit): parts 18, power 14, data 24, supplies 10.

## Players and frontier

- **New players** get one newly opened frontier plot as a district they own:
  - protected for 48 h;
  - 2 crews of strength 10;
  - 1 Van;
  - 500 credits;
  - 40 supplies.
- **Choosing the plot:** choose a frontier plot adjacent to at least two neutral or unclaimed districts, and as far as possible from the nearest player-owned district.
- **Frontier upkeep:** keep at least `max(4, players / 3)` open frontier plots. Survey new plots along the edge, preferring plots that keep the city roughly compact.
- **Neutral districts** have a guard strength of 10 plus an optional neutral garrison.
- **Losing your last district** gives you a new protected frontier plot, keeping your credits and surviving units (ADR 0028).

## Season and scoring

- **Season length:** 7 days for the milestone 1 test season; 4 weeks normally.
- **Score:** 1 point per owned district per hour, integrated continuously. Trade volume and contracts add a smaller amount from milestone 2; this is open decision #4.
- **Catch-up:** players below the median get 25% faster recruiting. The leader's districts get a 10% bonus to capture rate against them.
- **Finale:** in the last 48 hours, no new players join.

## Events (output)

`step` returns typed events. They drive the "while you were away" feed, the replay and the notifications. Every event has `{ id, at, kind, actors[], districts[], data }`.

**Kinds:**

- `arrived`
- `siege.started`, `siege.progress` (one milestone every 10%), `siege.captured`, `siege.broken`
- `combat.round`
- `production.wasted`
- `build.done`
- `trade.filled`
- `player.joined`
- `frontier.opened`
- `protection.ended`
- `score.tick` (hourly)

## Tests the harness must pass (task 1B)

- **Determinism:** the same seed and the same inputs produce the same state hash, whether stepped in 2-second ticks or one 24-hour jump.
- **A week with scripted actors:**
  - at least one capture;
  - working market fills;
  - no negative stock or credits;
  - no unit in two places at once.
- **Speed:** simulating a 7-day season with 30 districts and 6 actors finishes in under 5 seconds.

## Decisions made while implementing tasks 11-15

Where the spec was silent, these simple choices were made. Code: `packages/sim`.

- **Exact integer arithmetic.** Stock and credits are integer "atoms" (`ATOMS_PER_UNIT` = 360 000 000). One unit per hour is exactly 100 atoms per millisecond, so any time split integrates to the same total. This is what makes 2 s ticks and one jump hash-identical.
- **Capacity applies to total goods** in a district warehouse (parts + power + data + supplies), not per good. Base 120 plus 120 per Depot level.
- **Residential credits** go straight to the owner's `credits`, not the warehouse, so they never overflow.
- **`production.wasted`** is emitted once when a full warehouse starts losing output (`ongoing: true`, `amount: 0`) and once when it stops (`ongoing: false`, `amount` = total wasted), or at the moment a delivery overflows. Exact fill times come from a scheduled `production.full` queue event, so they do not depend on step size.
- **Hubs** hold no district production. Cargo delivered to a hub goes to the owner's per-hub stash (`player.stash`).
- **Crews drive.** Any move or haul needs at least one crew; crews must not exceed the carrier's seats, must be at the same node as the carrier, and must be ready (recruits take 30 minutes).
- **Haul is a plain move that carries goods.** Cargo is deducted from the source warehouse at departure and deposited on arrival. Undeliverable cargo (e.g. the destination was lost) is lost.
- **Recall** turns a movement around; the return takes as long as the outbound part already travelled. Cargo is deposited back at the origin.
- **Scout** reveals the target district for 4 hours after the scouting crew arrives (not on recall).
- **Inputs carry an optional `atMs`**, clamped to the current time; inputs later than `toMs` are ignored by that `step` call. Scheduled events run before inputs at the same millisecond.
- **`order.rejected`** is an extra event kind emitted when `step` receives an invalid order.
- **World layout.** `createWorld` makes a 6x4 grid (24 districts); the south row is Docks, other kinds are shuffled from the seed. Two hubs sit on the west and east edges, each joined to two edge districts. Street lengths are 1500-2300 m, giving 15-25 minutes by van between neighbours; crossing the city takes well over 90 minutes. The Sound is the line `y = rows`.
- **Walls** add 30% defence per level in sieges (see the siege decisions below).
- **`addPlayer`** is a minimal bootstrap (district, crews, vans, credits, supplies, protection). Frontier placement (task 1A) will replace it.

## Decisions made while implementing tasks 16, 18 and 19

- **One attacker per district.** A second player's crews cannot join or start a siege while the first still has crews present; the order is rejected (`invalid_target`). Protected districts reject with `protected`. A bar left by an attacker with no crews present decays (12 h from full) and is replaced if someone else arrives (`siege.broken`, reason `replaced`) or ends at zero (`abandoned`).
- **Rate.** `base x A/(A+D)` with `base` = a full bar in 4 h (`balance.siege.baseHoursToFill`). `A` is the present attackers' total strength; `D` is garrison strength plus 10 militia (neutral districts are militia alone), times walls (+30% per level) and stance (pullback x50%). Attack is scaled by 10000 so integers compare directly. The bar is an exact BigInt in 1/1 000 000ths, folded lazily at event or input times, so slicing time never changes it. Against the season leader the rate is 10% higher.
- **Pace.** Even fights (20 vs 20 + 10 militia) capture in about 10 h after arrival; favoured fights are faster.
- **Attrition.** Every 30 minutes both sides lose about 1.5% of strength with +/-20% seeded noise (`combat.round`). Crew strength floors at 1. An attacking crew at 3 or less is routed and walks home on foot (it leaves the bar).
- **Capture.** The district changes owner; the attackers become its garrison (stance hold); buildings lose one level (level 1 is removed); construction there is cancelled. 30% of the warehouse is looted onto the attackers' carriers, up to their free space, and hauled home as a movement with no crews. The defender's garrison walks to their nearest owned district; their carriers there teleport to it. `siege.captured` carries a `report` payload (rounds, losses, survivors, loot, buildings damaged, retreat).
- **Losing the last district** relocates the player with `relocatePlayer` (farthest neutral, protected, `player.joined` with reason `relocated`). Task 1A will improve this.
- **`reinforce`** is a move to one of your own districts that also adds defence on arrival.
- **Fog.** `viewFor(state, playerId)` returns a JSON-safe `PlayerView`: own districts in full; districts in sight and hubs with owner, protected flag, crew counts per owner and siege progress; everything else as `remembered` (last known owner only). Sight is one street hop from your districts and crews, the streets your convoys are on, scout reveals, and hubs always. Foreign crews and carriers are never listed, only counted; other players' convoys appear only inside your sight (position and carrier kind, no cargo). Memory updates at event and input boundaries only, never at the end of a step, so it is tick-independent.
- **Watchtower** is not a building type yet, so it adds no sight; the code already reads its level when it appears.
- **Season.** 168 h; the last 48 h are the finale (`season.finale` is updated by the hourly tick; `addPlayer` throws from `finaleStartMs`). Score is exact integer district-milliseconds (`MS_PER_HOUR` = one point), stops at `endMs`. `score.tick` fires hourly with standings. Leader = strict top; below median = strictly below the median score (recomputed hourly); those players recruit in 75% of the usual time.

## Decisions made in tasks 17, 1A and 1B

### Markets (task 17)

- **Units.** Prices are integer centi-credits per unit (`balance.market.priceScale` = 100); quantities are whole units (1-1000). Credit atoms per centi-credit per unit: `ATOMS_PER_UNIT / 100` = 3 600 000, so every trade is an exact integer.
- **Books.** `state.markets[hub][good]`, created by `createWorld` for `hubW` and `hubE`. Bids sort best price first, asks lowest first, ties by order number (`seq`). `checkInvariants` verifies ordering, no empty or duplicate orders and non-negative civic depth.
- **Escrow.** A sell removes the goods from the hub stash. A buy locks `price x qty` credits at the limit. When a buy fills below its limit, the difference is refunded at once. Cancel returns the remaining escrow (goods to the hub stash). Trades execute at the resting order's price.
- **Limits.** 20 open orders per player. New typed errors: `unknown_good`, `bad_price`, `unknown_order`, `too_many_orders`; `bad_quantity`, `insufficient_goods`, `insufficient_credits`, `not_owner` and `invalid_target` are reused.
- **Civic traders are virtual.** They are not orders; each book holds `refCents`, `bidDepth` and `askDepth`. The standing bid is `ref x 92%` (rounded down) and the ask `ref x 108%` (rounded up). A player order trades with the best price, and a player order wins a tie with civic. A civic fill takes `min(qty, depth)` in one trade.
- **Reference.** After each fill it moves 1/8 of the way to the trade price. Each hour it moves 5% of the way back to its base, and is clamped to 50%-200% of base. Starting references are as in the spec.
- **Depth.** 60 units per side per good per hub, refilled 20 per hour up to the cap. The refill, reversion and a sweep (resting orders that now cross the civic price trade with civic) run in a `market.tick` queue event each hour, so tick and jump agree exactly.
- **View.** `PlayerView.markets` lists every hub book by price level (all quantities summed), the civic quote and depth, `refCents` and `lastCents`. `PlayerView.orders` lists only your own open orders. Books are public: hubs are always in sight.
- **Events.** `trade.filled` (actors: buyer and seller, civic omitted) with `hub, good, price, qty, buyer, seller, taker, buyOrder, sellOrder`.
- **Gap.** Snapshots written before this change have no `markets`; there are no live players, so the server does not migrate them.
