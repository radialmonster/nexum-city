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

| Order | Kind | Effect |
| --- | --- | --- |
| `move` | timed | Crews and/or cargo travel along a route to a district you own or a hub |
| `haul` | timed | Move cargo. It can chain hub actions: sell, then buy, then return |
| `siege` | timed | Travel to the target, then start or join its capture bar |
| `reinforce` | timed | Move crews into your own district's garrison |
| `scout` | timed | A crew travels to the target and reveals it for 4 h after arriving |
| `build` | timed | Spend goods from that district's warehouse; it completes after a set time |
| `stance` | instant | `hold` or `pullback` |
| `recall` | instant | An order in transit turns around and returns along the same path |
| `market.*` | instant | Place or cancel a limit order at a hub where the actor has goods or credits |
| `recruit` | instant, plus 30 min to be ready | See Units |

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
