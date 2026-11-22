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
  - `name` is `Sector <col>-<row>` (`sectorName` in `frontier.ts`): non-negative cells count from 1, and cells at negative coordinates read `W1`, `W2`... (columns) and `N1`, `N2`... (rows), so the north frontier reads `Sector 3-N1` and never `3--1`. Names are presentational (they do not affect rules) but are part of the state hash. Names are stored as plain strings, so older snapshots keep the old text and still load;
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
  | Van     | 100           | 40    | 12        | 2          |
  | Hauler  | 60            | 150   | 25        | 2          |
  | Runner  | 160           | 16    | 3         | 1          |
  - The Runner is a milestone 2 unit, now unlocked and bought with credits (see "Runner carrier (M2)").
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
| `settle`    | timed                            | A crew carries 60 supplies to an open frontier plot and claims it (below)   |
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

## Raids and escorts (M2)

Built in task 71 (sim only: contracts, server validation and bots are done; the raids client UI is done (tracker row 72); later raid rows are 73 to 76). `RULES_VERSION` is 2. A follow-up (task 71b) changed the rules below without bumping it: nothing containing version 2 has been deployed (the old hosting was torn down and the game is local and dev only), so no live season has to be closed. Bump it on the first deploy that follows any further rule change.

### The rules

- **Order:** `{ type: 'raid', carrierId, crewIds, a, b, hours }`. `a` and `b` are the two ends of one street. The crews walk to whichever end is nearer (a `raid` movement), then lie in wait (an `ambush` movement) for `hours` (an integer, 1 to 8, so a window is capped at 8 h). Errors: `bad_edge` (not a street), `bad_window`, `too_many_raids` (at most 2 raids or ambushes at once per player).
- **Where the crews are:** inside the ambush movement. They are not garrison, not siege presence and not fog presence while waiting.
- **Interception:** an enemy convoy, meaning a haul or a settle supply carrier, whose route uses the street is struck once, at the moment it crosses the middle of the street. A given convoy is struck at most once per ambush. Your own convoys are never hit. Neutral and civic traders have no convoys, so nothing happens to them (market trades are instant).
- **Newbie protection:** a convoy whose owner is under new-player protection (any district the player owns is still protected) cannot be struck. This is checked at the moment of the crossing, so protection that ends on the way stops shielding it. A protected player also cannot set ambushes: `validateOrder` refuses the raid order with `protected_no_raid` (client text: new-player protection shields you from raids, so you cannot set ambushes until it ends). Being immune while raiding others would be unfair. Raider bots skip ambushes while they are protected, and skip protected rivals when picking a street.
- **Combat:** two seeded rolls, each 80 to 120 percent of its base. Raiders: total crew strength. Guard: carrier toughness (van 12, hauler 25, foot 0), plus the first escort crew at half strength (it is the driver), plus any other escort crews at full strength. On a settle carrier the crews are armed settlers, not drivers, so every crew counts at full strength. A haul with no crew has only the carrier toughness.
- **Raiders win:** they take 40 percent of each good in the cargo (capped by the room in the raiders' carrier, 5 units per crew on foot), 15 percent of what remains is destroyed, the escort loses at least 1 point (10 percent) of strength, and the haul carries on with what is left. If the raiders' carrier is full (1 unit or less of room left) the ambush ends early. A successful raid on a haul bound for a hub nudges that hub's reference price for the stolen goods up 4 percent.
- **Raiders lose:** they lose at least 1 point (30 percent) of strength and the ambush ends (`repelled`). The haul is untouched.
- **When it ends** (window over, full, repelled or recalled) the ambush becomes a `return` movement. The loot is deposited when the crews arrive home. A recalled ambush walks home at once.
- **Recalled convoys:** a recalled convoy still carrying cargo walks its route backwards and can be struck on the way home, at the moment it crosses the middle of the street again (only if it had got past the middle before turning). Recalling drops the strikes planned for the outbound walk and plans new ones for the way back. This closes the old loophole where a recall made a haul safe.
- **Escort:** haul orders already take `crewIds`, up to the carrier's seats. Escorts are not a new order.
- **Settle carriers:** the supplies (60 units) a settle carrier brings are cargo like any haul's, and the same fight and loss rules apply; its crews are the escort and count at full strength (no driver discount, see Combat). If the carrier arrives with fewer supplies than the settlement needs, the settlement fails with reason `raided` (`settle.failed`), the crews walk home and what is left of the supplies is returned to the nearest district of the owner. Protecting an expansion now matters: send a second crew, or settle somewhere raiders are not sitting. `arrived` reports `sent` for settle movements too, so the conservation check covers them.

### Fog

An ambush is hidden unless the street's end `a` or `b` is in sight; then the viewer gets `ambushes: [{ id, owner, edge, untilMs }]` and nothing about crews. Ambushes are never in `convoys`. The raider's own ambush is in `movements`. The target learns only when hit (`raid.hit`).

### Events

| Event           | Actors     | Data                                                                                                                 |
| --------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `raid.set`      | raider     | `movementId`, `edge`, `untilMs`, `crewIds` (on arrival)                                                              |
| `raid.hit`      | both sides | `movementId`, `haulId`, `stolen`, `destroyed`, `remaining` (goods in units), `raiderStrength`, `guard`, `escortLost` |
| `raid.repelled` | both sides | `movementId`, `haulId`, `raiderStrength`, `guard`, `raiderLost`                                                      |
| `raid.ended`    | raider     | `movementId`, `reason` (`expired`, `recalled`, `repelled`, `full`), `loot` (units), `struck`                         |

`arrived` now also carries `cargo` and `sent` (units), so a haul's goods can be checked: `sent = cargo + stolen + destroyed`.

### Bots

Raiders, while campaigning, check once an hour: with a base that has 2 idle crews and a van, and no raid out, they ambush the last street of a rival district's route to its nearest hub, the one closest to home, for 6 h. Server bots cannot see enemy convoys, so they guess the street. This is intentional and stays so: raider bots are fog-honest (they never read convoys they could not see), so they hit a convoy only when it happens to take the street they guessed. Merchants send a second crew as escort on hauls of 30 units or more. Both use the normal order path.

### Pros and cons, in plain words

- Raiding: cheap, no siege needed, and a hit pays in goods. But two crews sit idle for hours, and a good escort beats them and costs them strength.
- Escorting: roughly halves what raiders get (100 percent success without escorts against about 60 percent with them in the harness), but a second crew is not building, settling or garrisoning.
- Settle carriers can be raided: expanding is now a risk, so a settler wants an escort or a quiet street. A raided carrier loses the whole settlement attempt, which hurts, but the crews and the leftover supplies come home.
- Protection shields a newcomer's first trades and first settlement, but a protected player cannot set ambushes. That costs a newcomer nothing they could use early (they have little to raid with), and it stops anyone farming raids while untouchable; it ends after 48 hours and then convoys are fair game. A recall is no longer a free escape: the way home is as exposed as the way out.
- Both sides are chosen in advance and played out later, so it works with players who are never online together.

### Harness results (`npm run sim:season`, `node scripts/sim-seeds.mjs 1 8`)

| Bot type | Districts per player, before | after | Trade per player, before | after |
| -------- | ---------------------------- | ----- | ------------------------ | ----- |
| merchant | 3.75                         | 3.38  | 55.7                     | 47.5  |
| raider   | 4.38                         | 3.94  | 0                        | 0     |
| turtle   | 3.50                         | 3.13  | 74.6                     | 67.3  |

Here "before" is the first raids version (task 71), "after" is with protection, settle carriers and recalled hauls (task 71b). Score per player after: merchant 462, raider 561, turtle 486. The raider lead over the best other type is 1.15x on seeds 1 to 8 (1.17x before), under the 1.4x limit. Per season: 21.3 ambushes (27.3 before), 22.4 hits and 3.1 repelled (88 percent of strikes succeed, 59 before), 159 units stolen and 36 destroyed. The hit rate rose because settle carriers walk on foot with a weak guard, so raiders win almost every strike against them; raiders also set fewer ambushes now because protected rivals are skipped. Merchants lost about 10 percent of districts and 15 percent of trade and do not collapse; everyone is down because supplies stolen from settlers slow expansion. Invariant problems stay 0, including goods conservation per haul and per settle carrier, and for the loot. The determinism hash still matches as one jump and in 60 s ticks.

Balance notes: with the first bot cadence (an ambush every 3 hours) merchants lost about 12 percent of districts and 24 percent of trade; raising the raider cadence to hourly made the raiders pay for losses more often and left merchants at or above the earlier numbers. Merchants do not collapse. Numbers are in `balance.raid` and can be tuned freely.

## Contracts board (M2)

Built in task 73a (sim, contracts package, server snapshot upgrade and bots; the contracts UI is task 73b). This is proposal D in `balance-proposals.md` ("Contracts at hubs"). `RULES_VERSION` is 3 and `SNAPSHOT_VERSION` is 2. Why 3: the civic posting tick draws from the shared seeded RNG, which shifts every later random stream, so a season started under version 2 would not replay under the new rules. The server closes the running season on the first deploy and starts a new one; the snapshot upgrade (1 to 2) adds an empty board and schedules the first civic tick, so older snapshots still load.

### The rules

- **Boards:** each hub shows at most 4 open contracts (`balance.contracts.boardCap`). Live means open or taken. An untaken offer lapses after 24 h (`offerHours`).
- **Civic jobs:** every 3 h each hub with room (fewer than 4 live jobs and fewer than 3 civic ones, `civicCap`) may get a job drawn from the seeded RNG: 10 to 40 units (steps of 5) of a good, reward 130 percent of the good's reference value. The city pays from nowhere and consumes the goods; both are shown in the event data. These give newcomers early income.
- **Player jobs:** `{ type: 'contract.post', hub, good, qty, reward, hours }`. The reward (whole credits) is escrowed at once. Quantity 5 to 150; reward 50 to 300 percent of the reference value; the `hours` field is the delivery window (6 to 18). At most 2 posted at a time. Merchant bots post too.
- **Taking:** `{ type: 'contract.take', contractId }` locks a deposit of 10 percent of the reward. One taker per contract, at most 2 taken at a time, and not your own. The poster (or the city) sets a delivery window of 6 to 18 h, which starts running when the job is taken.
- **Delivering:** a normal haul with `contractId`, whose `to` is the contract's hub and whose cargo is only the contract's good (`wrong_cargo`). Only the taker can haul for it (`not_taker`). Partial deliveries count and pay pro rata until the quantity is met; extra goods go to the taker's hub stash. The poster's hub stash gets the accepted goods (civic goods are consumed). On completion the deposit is returned and the taker scores.
- **Late:** at the deadline the contract fails. The deposit is forfeited to the poster (burnt for civic jobs), the unpaid part of the escrow goes back to the poster, and anything already paid stays paid.
- **Cancel:** `{ type: 'contract.cancel', contractId }` by the poster while untaken refunds the escrow. Untaken contracts expire the same way.
- **Raids:** a contract haul is a haul like any other: it can be ambushed and escorted, and what is stolen or destroyed does not count towards the quantity.
- **Score:** 1 point per 50 credits of reward, on completion only, capped at 12 points per player per day. Standings carry `contractScore` and `contractMs`.
- **Fog:** every board and the taker's name are public. Progress on someone else's contract (`delivered`, `paid`) is hidden (null in the view) unless you are the poster or taker. `contract.posted` is a public event only when notable (reward of 1000 credits or more); otherwise only the poster and anyone with the hub in sight see it. The other contract events go to the poster and taker, and to anyone with the hub in sight.
- **Errors:** `unknown_contract`, `contract_taken`, `contract_closed`, `not_taker`, `own_contract`, `board_full`, `too_many_contracts`, `bad_reward`, `wrong_cargo`; `bad_window`, `bad_quantity`, `insufficient_credits` and `not_owner` are reused.

### Views and events

`PlayerView.contracts` is a map from contract id to the contract (hub, good, qty, reward, deposit, civic, poster, taker, state, due time, plus `delivered` and `paid` in atoms, or null if hidden). Events: `contract.posted`, `.taken`, `.progress`, `.done`, `.failed`, `.expired`, each with whole credits and units in its data; `arrived` gains `contractId`.

### Bots

- Merchants take contracts (up to 40 units, trips up to 60 percent of the deadline, prefer the best pay), escort contract hauls, and post a 20-unit supply contract at 110 percent of the reference value when they hold at least 4 times the reward in credits.
- Turtles take small nearby jobs (up to 20 units, trips up to 50 percent of the deadline).
- Raiders never take contracts, but prefer streets that lead to hubs with active contracts.
- All of it goes through the normal order path.

### Pros and cons, in plain words

- Taking a job: a steady income for a hauler and early money for a newcomer, but the trip is on the clock and the deposit is lost if you are late or raided short.
- Posting a job: you get goods delivered without hauling them yourself, but the reward is locked up until it ends, and a failure refunds you with only the deposit as compensation.
- Hauling for a contract is a predictable trip to a known hub, which makes it a target. An escort halves the risk, at the price of a second crew.
- The daily score cap stops contracts from becoming the only way to win; merchants get a real path to score without an army.

### Harness results (`node scripts/sim-seeds.mjs 1 8`)

The harness test now evaluates seeds 1 to 8 (it used 5), because five seeds are too noisy to judge the raider lead. Before is the raids version, after is with contracts.

| Bot type | Districts per player, before | after | Credits at 48 h, before | after | Score per player, before | after |
| -------- | ---------------------------- | ----- | ----------------------- | ----- | ------------------------ | ----- |
| merchant | 3.44                         | 3.19  | 843                     | 1716  | 461.7                    | 445.3 |
| raider   | 3.75                         | 3.94  | 430                     | 417   | 543.9                    | 562.1 |
| turtle   | 3.25                         | 3.44  | 231                     | 272   | 485.7                    | 521.9 |

Trade per player: merchant 47.7 (47.7 before), turtle 59.5 (62.5), raider 0. The raider lead over the best other type is 1.08x (1.12x before), under the 1.4x limit. Per player: merchants take 3.75 contracts, complete 3.38 and fail 0.31; turtles take 2.25, complete 1.81 and fail 0.44; raiders take none. Per season: 49.6 civic and 2.8 player contracts posted, 34.8 expired untaken or cancelled. Raids per season 21.3, success 59 percent (63 before), 14.5 hits and 10.1 repelled. Invariant problems are 0; the harness also checks that every reward is paid or refunded exactly, and that a contract haul's arrived cargo equals what was accepted plus the excess. Merchants hold double the credits at 48 h, which is the early income the design asked for. Numbers are in `balance.contracts`.

## Runner carrier (M2)

The Runner is the counter-play to raids: hard to catch rather than hard to beat. It is fast, small and fragile.

**Numbers** (all in `balance.carriers.runner` and `balance.runner`): speed 160 m/min (1.6 times a van), cargo 16 units (40 percent of a van), toughness 3 (van 12), one crew seat, cost 300 credits, at most 2 owned per player, evasion 35 percent.

**Buying.** Order `{ type: 'carrier.buy', districtId, kind: 'runner' }`. The district must be yours (not a hub). It costs 300 credits and nothing else. The Runner appears at once at that district, ready to carry. Errors: `unknown_district`, `not_owner`, `too_many_carriers` (the new code, at the cap of 2), `insufficient_credits`. Event `carrier.bought` (actors: the buyer; data `{ carrierId, kind, credits }`). Vans are still handed out at the start and not sold.

**Evasion.** When an ambush strikes a convoy that is a Runner, the sim draws once from the seeded RNG (only for Runners, before the combat draws, so the number of draws never depends on how a fight goes). Below 35 percent the Runner slips away: event `raid.evaded` (actors: raider, then the Runner's owner; streets as for `raid.hit`; data `{ movementId, haulId, chancePercent }`). Nothing is stolen or lost, the ambush stays in place with the haul marked as struck, and the raiders may catch the next convoy. Otherwise the normal fight happens, and with toughness 3 the raiders nearly always win it, so a caught Runner is easy loot (it only holds 16 units, so the loot is small). We chose a separate event over a flag on `raid.repelled`: nobody repelled anything, and the feed and the UI can tell the three outcomes apart (hit, repelled, evaded).

**Fog.** Others see the carrier kind on any convoy they can see (`carrier` on the foreign movement in the view), so a Runner shows as a Runner. No view change was needed.

**Bots.** Merchants and turtles buy one Runner once they hold the cost plus a spare (merchants 500 credits, turtles 700) and use an idle Runner for contract deliveries of 16 units or less (one crew, no escort); bigger loads still go by van. Raiders could use a Runner to ambush (1 seat, loot room 16) but do not buy one: an ambush wants two crews and a van's loot room, and the Runner's strength is not being struck, which a raider does not need. Raider bots therefore keep their vans.

**Pros and cons (player wording).** Pro: it is hard to catch (about one ambush in three misses it), and it gets small, urgent loads there 1.6 times sooner. Con: it carries only 16 units, one crew; if an ambush does catch it, the raiders win almost surely; and you can own only two.

**Rules version.** `RULES_VERSION` stays 3: nothing containing it has been deployed. The snapshot shape is unchanged (carriers already had a kind), so there is no snapshot upgrade.

**Harness, seeds 1 to 8** (before this change, then after):

| Bot type | Districts/player | Credits at 48 h | Score/player     | Contracts taken / done / failed            |
| -------- | ---------------- | --------------- | ---------------- | ------------------------------------------ |
| merchant | 3.19 then 3.31   | 1716 then 1418  | 445.3 then 457.8 | 3.75 / 3.38 / 0.31 then 3.50 / 3.13 / 0.38 |
| raider   | 3.94 then 4.06   | 417 then 417    | 562.1 then 568.9 | 0 then 0                                   |
| turtle   | 3.44 then 3.44   | 272 then 228    | 521.9 then 527.7 | 2.25 / 1.81 / 0.44 then 2.81 / 2.25 / 0.50 |

Raider lead over the best other type: 1.08x before, 1.08x after (limit 1.4x). Raids per season 21.3 then 21.0; hits 14.5 then 15.0; repelled 10.1 then 11.0; evaded 0 then 0.4; Runners bought per season 3.1; raid success (hits over hits, repelled and evaded) 59 then 57 percent, inside the 45 to 65 band. Invariant problems 0. The Runner costs the merchants some early credits but they finish a few more points ahead.

**Finding.** Evasions are rare in the harness (0.4 per season): bot Runners mostly make short civic deliveries on streets nobody is watching. Buying earlier (spare 300 or less) made Runners more common but dropped raid success to about 40 percent for reasons not yet understood, so the later buy point stays. Worth a look when the Runner UI lets players run them deliberately.

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
- **Score:** 1 point per owned district per hour, integrated continuously. Trade adds 1 point per 100 credits of fills against the civic traders or other players, at most 24 points per player per season day (task 54; self-trades never count). Contracts add a smaller amount from milestone 2.
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
- `settle.started`, `settle.done`, `settle.failed` (reason `taken`, `captured` or `abandoned`)
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

### Frontier and city growth (task 1A)

- `District.frontier` is `open | surveying | built`. Plots are laid out on the compact edge of the city (most occupied neighbours, then nearest the centre), never south of the Sound; the south row is docks.
- The city keeps `max(4, ceil(players / 3))` open or surveying plots (`balance.frontier`). A new plot is surveyed for 4 h (`frontier.survey` queue event), then opens: it joins the street graph, with streets to every finished neighbour, and `frontier.opened` fires. Surveying plots are hidden from views.
- `createWorld(seed, { startMs })` starts the season, queue and ticks at a given game time; the server's `genesis()` workaround is gone. The first open plots are created at world creation (instantly, with event ids reset to 0).
- `addPlayer` with no `districtId` claims an open plot next to at least 2 neutral districts, as far as possible from other players' districts. If none is open, one is opened at once. `addPlayerWithEvents` also returns the events (`player.joined`, reason `new`). The explicit-id path is kept for tests.
- A player who loses their last district gets a protected frontier plot chosen the same way (`relocatePlayer`), with `player.joined` reason `relocated`.
- `PlayerView.graph` carries the public street graph (nodes, edges with lengths, hub ids) so the client can preview routes and ETAs.

### Season harness and balance findings (task 1B)

`runSeason` (`harness.ts`) plays a season with three scripted bots from `bots.ts`: the **raider** sieges the nearest unprotected district it does not own, one campaign at a time; the **turtle** builds walls, a workshop and a depot and holds; the **merchant** hauls its biggest pile to the nearest hub and sells it to the civic bid. Every bot also recruits and builds one building per district. Bots decide on an hourly beat; the harness keeps only orders that pass `validateOrder`, steps the state, counts `siege.captured` and `trade.filled` events, and runs `checkInvariants` after every beat. `npm run sim:season [-- seed [days]]` (after `npm run build`) prints the summary; timing lives in the script because the sim may not read a clock.

Why the full-week check uses 60 s ticks and one jump, with 2 s ticks only for the first 6 hours: `step` has no per-tick state (it advances to the next scheduled event), so any slicing of time must give the same hash. A 2 s replay of 7 days is about 302,000 steps (about 20 s), which is too slow for the check; 60 s ticks are 10,080 steps (about 0.7 s) and still cut across every hourly beat and every travel, siege and survey event. The 2 s slicing is proven on the busiest part, the first 6 hours (opening orders and first marches), and is the same code path.

Reference run (seed 1, 7 days, 2 raiders, 2 turtles, 2 merchants): 38 districts, 695 orders (0 rejected), 12 captures, 84 civic fills (3,270 units), 0 invariant problems, hash identical as one jump, hourly, and in 60 s ticks; the run takes about 170 ms.

Balance findings (all acted on in task 54, see "Balance pass (task 54)" below):

- **Raiders dominate.** They finish with 8 and 6 districts, while turtles and merchants stay at 1. Most captures are of neutral frontier plots, which are unprotected once the 48 h newcomer protection has passed.
- **Non-raiders have no way to grow without attacking.** Frontier plots cannot be claimed peacefully, so a turtle or merchant can only stay put. Consider a peaceful claim (survey and settle) or merchant income that buys expansion.
- **Merchants earn credits but not an edge.** They sold 3,270 units on the civic bid, yet their score equals a turtle's; selling does not convert to districts or score yet.
- **Neutral plots are the cheapest target.** Raids on neutral plots should probably cost more or give less, so that attacking players is the better prize.

## Balance pass (task 54)

Direction from the owner: "fun first", so mechanics could change freely. Three rules were added, from [`balance-proposals.md`](balance-proposals.md) A + B + C. All numbers live in `balance.ts`.

### Rules

- **Settle (A).** `settle { carrierId, crewIds, target }` sends a crew (on foot or on any carrier) with `balance.settle.supplies` (60) supplies from the nearest owned district's warehouse to an open frontier plot (`not_open_plot` if the target is a hub, owned or not open; `already_settling` if a settle timer is already running there; `insufficient_goods` if the origin lacks the supplies). The supplies ride as cargo. On arrival they are spent and a `balance.settle.hours` (10 h) timer starts (`settle.started`); the settlers sit in the plot's garrison. When the timer ends the plot becomes the settler's district (`settle.done`) and an enemy siege, if any, carries on against it. Contests:
  - the first settler to arrive holds the plot; a second one is turned back with the supplies refunded to their nearest district (`settle.failed`, reason `taken`);
  - an enemy siege on the plot fights the settlers plus the neutral guard; if its bar fills first the settlement fails (`captured`) and the siege wins an empty plot; if the timer wins, the new owner defends normally;
  - if every settler walks away before the timer ends the claim lapses (`abandoned`); a recalled trip brings the supplies home.
- **Tougher neutrals (B).** `siege.neutralGuard` is 20 (was 10, the same as an owned district's militia) and `siege.neutralLootPercent` is 10 (was the normal 30 for every capture). The proposal suggested a guard of about 25; 20 was enough with the rest and kept early expansion from stalling.
- **Trade score (C).** Every fill against a civic trader or another player earns both sides `fill credits / 100` points (one district-hour each), floored to whole milliseconds and capped at 24 points per player per season day (the day is `floor((now - season start) / 24 h)`). A fill where a player's own orders meet (self-trade) earns nothing. `standings` gained `tradeScore` and `tradeMs` (the part of `score` that came from trade). The maths is integer-only, so the total does not depend on how time was sliced.

### Bots

Bots now check what they can afford before they build or recruit, so they stay under the 10 percent rejection ceiling (harness test; the run is at about 0.7 percent). Turtles and merchants settle the nearest open plot whenever a district has 60 spare supplies and an idle crew, and merchants keep a supplies reserve and buy a van-load from the civic traders when short. Merchants also trade toward the daily cap. Raiders treat a rival who scores less than they do as half as far away (`WEAK_RIVAL_DISCOUNT` 0.5), so a weak player is picked over a neutral plot unless the plot is less than half the distance.

### Before and after, seeds 1 to 5

Each cell is districts / score (first letter: r raider, t turtle, m merchant), 7-day season, sorted by final score.

| Seed | Before (main)                                             | After (task 54)                                          |
| ---- | --------------------------------------------------------- | -------------------------------------------------------- |
| 1    | r8/1094 r6/867 t1/168 t1/168 m1/168 m1/168 (12 captures)  | m6/864 r5/673 r5/668 m4/487 t1/168 t1/168 (8 captures)   |
| 2    | r7/996 r2/330 t1/168 t1/168 m1/168 m1/168 (7 captures)    | t8/921 t7/827 r6/804 m7/684 r2/327 m1/172 (6 captures)   |
| 3    | r8/1098 r5/748 t1/168 t1/168 m1/168 m1/168 (11 captures)  | t7/837 r6/820 m5/591 r4/581 m2/329 t1/168 (8 captures)   |
| 4    | r8/1093 r6/866 t1/168 t1/168 m1/168 m1/168 (12 captures)  | t11/1055 r5/612 r3/477 m1/172 m1/172 t1/168 (6 captures) |
| 5    | r11/1161 r6/832 t1/168 t1/168 m1/168 m1/168 (15 captures) | t6/758 m6/714 r5/690 r3/454 m1/172 t1/168 (6 captures)   |

Averages over the five seeds (each bot type, 10 bots):

| Bot      | Districts before | Districts after | Score before | Score after |
| -------- | ---------------- | --------------- | ------------ | ----------- |
| raider   | 6.70             | 4.40            | 908          | 611         |
| turtle   | 1.00             | 4.40            | 168          | 524         |
| merchant | 1.00             | 3.40            | 168          | 436         |

Raiders lead turtles by about 1.17x (target: under 2x), every type averages at least 3 districts, there are 5 player-vs-player captures over the five seeds, 0 invariant problems, 45 of about 6,300 bot orders were refused, and one season runs in about 0.2 s. Seed 1 prints `settled=10 settleFailed=2`, 3 pvp captures, and a final hash of `1226f5451258cf`.

**The season hash changed**, as expected: the bots, the neutral guard and scoring all differ. The determinism tests (same seed gives the same hash; one jump equals 60 s ticks and 2 s ticks) still pass.

### Turtle resupply (strategy only)

A turtle on a home that makes no supplies never settled: it had no way to get 60 of them. The turtle now does what a player would, with the same orders and no rule or number changes. When it wants a plot and its warehouse is short, it stops recruiting and building (those eat the supplies it is buying), sells a pile of what the district makes at the nearest hub (`haul`, then `market.place` sell) if it cannot afford the supplies, buys the shortfall plus a 10-unit margin for crew upkeep (`market.place` buy, partial when credits are short), `move`s a crew and van to the hub, and `haul`s the bought supplies home. The merchant shares the resupply code (it buys only what it needs and can afford now, so its numbers moved slightly).

Districts and score at the end of a 7-day season, average per bot, before and after:

| Seeds | Bot      | Districts before | Districts after | Score before | Score after | Stuck on 1 district (before, after) |
| ----- | -------- | ---------------- | --------------- | ------------ | ----------- | ----------------------------------- |
| 1-5   | raider   | 4.40             | 4.20            | 611          | 582         | 0 of 10, 0 of 10                    |
| 1-5   | turtle   | 4.40             | 4.00            | 524          | 569         | 5 of 10, 3 of 10                    |
| 1-5   | merchant | 3.40             | 3.40            | 436          | 413         | 4 of 10, 4 of 10                    |
| 1-8   | raider   | 4.38             | 3.94            | 605          | 554         | 0 of 16, 0 of 16                    |
| 1-8   | turtle   | 3.13             | 3.31            | 390          | 504         | 11 of 16, 4 of 16                   |
| 1-8   | merchant | 3.63             | 3.56            | 482          | 465         | 4 of 16, 4 of 16                    |

Raiders still lead on score (1.02x over the best other type, turtles, on seeds 1 to 5, and 1.10x on seeds 1 to 8; against merchants 1.41x and 1.19x), invariant problems stay 0 and the hash still matches as one jump and in 60 s ticks. Seed 1 is now `15b04693b956e0`.

### Known gaps

- A few turtles and merchants still end at 1 district (4 of 16 each over seeds 1 to 8): they buy supplies one check-in at a time and a rival siege or a lost settle race can set them back. Not a rules problem.
- `fog.ts` does not expose `settling` in player views yet, so a rival's running settle timer is invisible; the client shows a plot as open until the settle is done, and an order against it is refused with `already_settling`.

### What the server's bot adapter must supply

The sim's bots read a `GameState`. The server's `stateFromView` (`apps/server/src/game/bots/view.ts`) already fills what they use: own districts (garrison, buildings, slots, warehouse, `construction`, `frontier`), other districts' owner and protection, crews, carriers, movements, stash, credits and market reference prices. Nothing new is required for the settle logic: the bots never read `District.settling`, and for districts that are not the bot's own the adapter's `frontier: owner === 'neutral' ? 'open' : 'built'` is enough (a plot that is still being surveyed or settled looks open, and the bot's order is refused with `not_open_plot` or `already_settling`). To make that refusal rarer, the adapter could copy `frontier` and a boolean for "settling" into the fogged view in a later contract change.

### Raid tuning, round 3 (protected players cannot raid, settle guard)

Changes: a protected player cannot set ambushes (`protected_no_raid`, bots respect it); settle carrier crews count at full strength; the van's toughness rose from 10 to 12. Seeds 1 to 8, before and after:

| Bot type | Districts before | after | Trade before | after |
| -------- | ---------------- | ----- | ------------ | ----- |
| merchant | 3.38             | 3.44  | 47.5         | 47.7  |
| raider   | 3.94             | 3.75  | 0            | 0     |
| turtle   | 3.13             | 3.25  | 67.3         | 62.5  |

Strike success fell from 88 percent to 63 percent (target 55 to 70). Ambushes per season 21.3 before, 20.6 after; hits 22.4 before, 17.3 after; repelled 3.1 before, 10.1 after; stolen 159 before, 127 after. The raider lead over the best other type is 1.12x (limit 1.4x) and invariant problems are 0. Finding: in the harness the strikes land almost only on unescorted van hauls (raiders about 17 strength against a guard of about 12), not on settle carriers, so the full-strength settle crews matter little there and the van toughness is what moves the rate. The rate is steep near this value (toughness 10 gives 83 percent, 13 gives 33 percent), so tune `balance.carriers.van.toughness` in small steps.

## First-session frontier and starter hook (M2)

Two first-session problems found in the 77b playthrough, and their fixes. `RULES_VERSION` stays 3 (nothing deployed that must replay) and the snapshot is unchanged.

**Frontier.** World creation opens every plot and each joiner claims one, so a new player usually found none open, and the replacement plot surveyed for 4 h. Fix: while any player is in their newcomer rush, `ensureFrontier` surveys a new plot in `frontier.rushSurveyMinutes` (5 min) instead of `surveyHours` (4 h). A joiner who takes a plot sees its replacement open within minutes, so a recent joiner can settle inside their rush. The rush kit now also carries 30 supplies (`rush.kit.supplies`), which with the 30 bought at the hub make the 60 a settle needs, and stays under the 120 warehouse cap. Rejected: a buffer of 3 extra open plots at world creation (it shifted the bots: turtle districts 2.2, raid spread sd 23 to 30, and broke four frontier tests). The frontier tests exist to pin that the frontier stays stocked, fog is unchanged and a joiner always gets a plot; none were weakened, and one was added (a joiner's plot re-opens in minutes during a rush and in `surveyHours` otherwise).

**Open plots over time** (`node scripts/open-plots.mjs`, one joiner every 2 h; want = max(4, ceil(players / 3))): open plus surveying never exceeds want. 1 player: 3 open, 1 surveying; 13 players: 3 open, 2 surveying (want 5); 22 players: 6 open, 2 surveying (want 8); 24 players: 8 open (want 8). The map is not flooded.

**Starter contract: kept as a "come back in about an hour" hook.** The nearest hub is about 5 km away, about 50 min by van, so the contract cannot finish in a first session. Pros of the hook: the first session has a clear reason to return, the contract pays well (premium 100 percent), and no new carrier is needed in the first minutes. Cons: a player who never returns sees an unfinished order. The alternative (a Runner, 300 credits, speed 160, about 30 min) costs more than a newcomer has and still does not finish in 15 min, so it was not chosen. UI shape: the contract's `windowMs` is the van trip plus 20 min grace, so the client may say "about `windowMs` minus 20 minutes by van, come back then".

**Results** (scripted newcomer, `scripts/first-session.mjs`, seeds 1 to 8): before, no perks, 2 actions and 1 completion in 15 min and no settle; now 8 actions and 3 completions in 15 min (floor 8 and 3), the settle accepted in 8 of 8 seeds within 15 min (average minute 5.1), the starter contract paid in 0 of 8 within 30 min (the hook). Bot harness seeds 1 to 16: raider lead 1.28x, raid success 56 percent, invariants 0.

## Newcomer rush and street jobs (M2)

Goal: at least 15 minutes of active, asynchronous play for a new player, without punishing logging off. `RULES_VERSION` stays 3 (nothing deployed); the snapshot gains an upgrade step 2 to 3 (players get `rushUntilMs: 0`, `jobs: []`, `jobNextMs: 0`; `counters.job` is 0). Players already in a live season get no rush and no jobs on upgrade.

### Rules

- **Rush.** For `balance.rush.hours` (24) game hours after joining, building and settling take 1/`factor` (10x faster). Siege, travel and raids are unaffected. A new home district starts with the kit `rush.kit` (30 parts, 10 power, 20 supplies), exactly one level-1 Workshop. The view shows `self.rushUntilMs`; the event `rush.ended` fires at the end. Bots follow the same rule.
- **Starter contract.** One civic contract is reserved for the newcomer on the nearest hub: 5 supplies at 200 percent of the reference value (premium 100), window = van ETA plus 20 min (hubs are 30 to 65 min away by van, so the 20 min is a grace on top). Other players cannot take it (`reserved_contract`).
- **Street jobs.** A personal list of up to 3 (`balance.jobs.cap`), one new offer every 30 min, drawn deterministically from the seeded RNG. Each is done by one crew and an optional carrier (a carrier makes it 67 percent of the time).
  - courier: 4 to 8 min, carry 4 to 10 units, pays 6 to 12 credits; raidable like a haul.
  - salvage: 3 to 6 min, pays 1 to 2 parts.
  - patrol: 5 to 10 min, pays 4 to 8 credits and reveals ambushes on the streets walked for 60 min.
  - Jobs give little or no score. Payouts are civic sources in the invariants and the harness conservation.
- **Order and events.** `{type:'job.take', jobId, crewId, carrierId?}`; errors `unknown_job`, `reserved_contract`. Events `job.done`, `job.failed`, `rush.ended`. The view's `self.jobs` lists the offers and `self.jobNextMs` the next refill.

### Plain-language pros and cons

- Rush: a fast start and quick wins, but only for a day, so a new player who waits loses it.
- Starter contract: an easy first trade with a good price, but it is small.
- Jobs: always something to do on a visit and no pressure to log in; but low pay, and couriers can be raided.

### Results (seeds 1 to 8, invariants 0 throughout)

First 15 minutes of a scripted newcomer (target at least 8 actions and 3 completions): 3.0 to 8.1 actions, 1.0 to 4.1 completions.

| Seeds 1-8                         | Districts | Credits at 48 h | Score | Raid success |
| --------------------------------- | --------- | --------------- | ----- | ------------ |
| Merchant, before (perks stripped) | 3.63      | 1586            | 542   |              |
| Merchant, with perks              | 2.75      | 2185            | 544   |              |
| Raider, before                    | 4.25      | 401             | 606   |              |
| Raider, with perks                | 3.75      | 507             | 543   |              |
| Turtle, before                    | 3.75      | 111             | 534   |              |
| Turtle, with perks                | 3.88      | 233             | 577   |              |

Raider lead is 0.94x with perks (1.12x before; 1.03x with perks and 1.08x before on 32 seeds), inside the 1.4x limit. Raid success is 10 percent with perks (12 percent before) on seeds 1 to 8 and 19 percent (21 percent) on 32 seeds. The 10 percent was not seed luck: it was a death spiral in the raider bot and the raid rules, fixed in "Raid balance after task 77" below (the first version of this note wrongly blamed luck). Merchants have fewer districts because the rush kit and jobs shift their spending; the harness district floor was relaxed to 2.5 on the 8-seed set. Job volume per player: merchant 56 taken (268 credits), raider 32 (151), turtle 95 (454). Settling is still not accepted inside the 15-minute session even with 20 more kit supplies (60 at the start): the first build and recruit spend supplies before the settle is tried.

### Raid balance after task 77

**Cause.** Raid success fell from 57 percent to 10 percent on seeds 1 to 8 (33 hits, 310 repelled, more than twice the raids) for two reasons, found with `node scripts/raid-diag.mjs 8`:

- Every repelled raid costs the raiders 30 percent of their strength for good, and nothing gave it back. The raider bot always sent the first two idle crews, which were the weakened ones, and re-ambushed every hour. Raiders averaged 5.2 strength against a guard of 17.1 and ended each season with crews at the floor of 1. The street-job couriers (task 77) added many cheap targets, which raised the raid count, but every kind of target was being repelled (by target: job 21 hit and 94 repelled, haul 11 and 138, contract 1 and 16, escorted hauls 0 and 60). Job crews are single crews that count as half-strength drivers, so they were not the main problem.
- Bimodal seeds before task 77 (min 4 percent, max 100 percent) were the same spiral, only less severe.

**Fix** (both parts are needed; the bot rule alone makes raiders give up and results stay bimodal):

- Crews mend: a crew below its starting strength regains 1 strength every `balance.raid.mendHours` (1.5) game hours while it rests at a district (event `crew.mend`, queued after a loss, deterministic).
- The raider bot ambushes with its two strongest idle crews, and only when together they have at least 16 strength (`AMBUSH_MIN_STRENGTH`); otherwise it waits and mends.
- The merchant bot now fetches supplies it bought and left in a hub stash (as the turtle already did). The newcomer kit also has 20 supplies (60 in all).
- `raid.hit`, `raid.repelled` and `raid.evaded` carry a `target` label (job, settle, runner, contract, haul, plus `+escort`). `RULES_VERSION` stays 3.

**Numbers** (invariants 0; `node scripts/bot-table.mjs 8|16`; each cell is districts / credits at 48 h / score / contracts):

| Seeds 1-8 | Merchant                | Raider           | Turtle                 | Raider lead | Raids, success | Per-seed success spread |
| --------- | ----------------------- | ---------------- | ---------------------- | ----------- | -------------- | ----------------------- |
| Before 77 | 3.31 / 1418 / 458 / 3.1 | 4.06 / 417 / 569 | 3.44 / 228 / 528 / 2.3 | 1.08x       | 168, 57%       | 4 to 100, sd 41         |
| Task 77   | 2.75 / 2185 / 544 / 8.4 | 3.75 / 507 / 543 | 3.88 / 233 / 577 / 3.8 | 0.94x       | 333, 10%       | 0 to 33, sd 10          |
| This fix  | 2.63 / 1629 / 524 / 8.3 | 4.94 / 444 / 639 | 4.38 / 195 / 612 / 3.5 | 1.04x       | 191, 61%       | 39 to 88, sd 20         |

| Seeds 1-16 | Merchant                | Raider           | Turtle                 | Raider lead | Raids, success | Per-seed success spread |
| ---------- | ----------------------- | ---------------- | ---------------------- | ----------- | -------------- | ----------------------- |
| Before 77  | 3.69 / 1468 / 512 / 4.5 | 4.31 / 369 / 584 | 4.19 / 221 / 585 / 2.3 | 1.00x       | 411, 36%       | 2 to 100, sd 37         |
| Task 77    | 2.50 / 1998 / 494 / 7.6 | 3.84 / 477 / 555 | 3.69 / 295 / 561 / 3.9 | 0.99x       | 712, 12%       | 0 to 100, sd 24         |
| This fix   | 2.44 / 1602 / 493 / 7.2 | 4.81 / 427 / 628 | 3.63 / 223 / 566 / 3.4 | 1.11x       | 391, 58%       | 21 to 88, sd 19         |

**Merchant districts could not be restored to 3.2.** Without the newcomer perks the merchant holds 3.47 districts; with them 2.2 to 2.6. Removing the kit parts or the kit power alone brings it back (3.3), because together they pay for the early Workshop, so the merchant hauls more and its home keeps too few supplies for a settlement (upkeep eats them). That is a trade of the rush design, not of raids, so the honest harness floor is 2.4 on seeds 1 to 8 (the test also now requires raid success between 40 and 70 percent). Raiders now capture more (16 plots on seeds 1 to 8, 6 on task 77 and 8 before).

First 15 minutes of the scripted newcomer with 60 supplies: 8 to 9 actions, 4 to 5 completions (before the rush: 3 and 1). A settle is still not accepted in the session (fixed afterwards, see "First-session frontier and starter hook").

**Plain-language pros and cons**

- Mending: a beaten crew is useful again after a few hours, so raiding stays a real choice and not a one-way slide. But repeated raiding is cheaper, so victims will be hit more often than with permanent losses.
- Strong crews only: raids are fewer and more likely to win. But a weak raider has to wait before it can act, which is slower.
- The kit supplies: a new player can reach a first settlement sooner. But it is a small gift that a late joiner does not get.

### Market movement (measure only, no rule changes)

Hub reference price change per good, percent (mean / p95 / max):

| Good     | 15 min             | 1 h                | 6 h                 |
| -------- | ------------------ | ------------------ | ------------------- |
| parts    | 0.01 / 0.00 / 4.04 | 0.02 / 0.06 / 4.04 | 0.10 / 0.69 / 7.97  |
| power    | 0.05 / 0.23 / 4.07 | 0.16 / 0.81 / 7.57 | 0.50 / 1.86 / 13.74 |
| data     | 0.05 / 0.26 / 4.10 | 0.16 / 0.78 / 4.12 | 0.37 / 1.52 / 8.08  |
| supplies | 0.19 / 0.95 / 5.10 | 0.49 / 0.89 / 8.50 | 0.96 / 2.82 / 11.06 |

Hub-to-hub civic arbitrage needs a price ratio of 1.174 (bid and ask are 8 percent either side). The best ratio between hubs was 1.030 on average (p95 1.106, max 1.231); a window was open in 2.5 percent of samples, in 13 runs, the longest 420 min. So within one 15-minute session a price window almost never opens by itself; trade profit comes from contracts and player orders, not from chasing civic spreads. Scripts: `scripts/market-movement.mjs`, `scripts/sim-seeds.mjs`, `scripts/first-session.mjs`.

## Watchtower and Garage (M2)

Two new district buildings (task 75, sim only; the UI is task 75b). `RULES_VERSION` stays 3 (nothing deployed under 3 needs to replay). `SNAPSHOT_VERSION` stays 3: a carrier's `wear` is optional (missing means 0) and the seen-district view's `watchtower` is derived, so no upgrade step is needed.

### Rules

- **Watchtower** (40 parts, 3 hours, max level 2). Sight from the district reaches `1 + level` street hops instead of 1, including the streets between districts. It is fog-honest: it shows what is in range and nothing more.
  - **Warning.** When an enemy ambush is set and either end of its street is inside the owner's tower reach, the owner gets `raid.spotted` (`{movementId, edge, untilMs, owner}`). The view then lists the ambush like any other seen movement, so players and bots can route around it.
  - **No convoy rule.** Convoys are not rerouted by the sim. The client warns and the player re-plans; bots hold hauls that cross a seen ambush and retry next check-in.
  - The seen-district view carries `watchtower` (level, 0 when none) so the map can draw it.
- **Wear** (all carriers). Each finished `haul` or `settle` trip adds `wear.perTrip` (2). An ambush strike adds `wear.perStrike` (6). Wear is an integer 0..100 (invariant). Up to `slowFrom` (40) there is no effect; above it the carrier is slower, in a straight line to 20 percent slower at 100 (`wornMs`, whole milliseconds, rounded up). The owner gets `carrier.worn` once, when wear first passes 40.
- **Repair.** A parked carrier (at any district) heals 1 point every `repairMinutes` (90 min). With the owner's Garage in that district it is `garageRepairMinutes` (25 min at level 1, 12 at level 2). `carrier.repaired` fires when wear falls back to 40 or below. Repair never runs on the road.
- **Garage** (50 parts, 3 hours, max level 2). Faster repair as above, and Runners bought in that district cost 15 percent less per level (255 credits at level 1, 210 at level 2; `runnerPrice`).
- **Orders and events.** `build` accepts `watchtower` and `garage`; `carrier.buy` charges `runnerPrice(district)`. Events: `carrier.worn`, `carrier.repaired`, `raid.spotted`. Carrier views carry optional `wear`.

### Why a bonus and not a penalty

The Garage is a bonus on top of a baseline that already heals (wear is slow, gentle and self-repairing), so skipping the building never traps a player and a newcomer is never punished for not knowing about it. The only cost of wear is up to 20 percent slower trips, which makes the Garage an optional speed-up for players who run many hauls, not a tax.

### Plain-language pros and cons

- Watchtower: you see ambushes and raids coming and can route around them, and you see further. But it costs 40 parts and a slot, it only helps the district it stands in, and it does not stop an ambush; it only shows it.
- Garage: your carriers heal fast and Runners are cheaper. But it costs 50 parts and a slot, and without it carriers still heal, only slowly.
- Wear: a carrier that works hard slows down, a gentle reminder to rotate or repair. But a convoy that is struck wears more, so a raided haul route gets slower to run.

### Bots

- **Turtle:** puts a Watchtower in each outer district when it can pay (parts only pile up in docks districts), and holds hauls that cross an ambush it can see.
- **Merchant:** builds a Garage at home once it runs at least two carriers.
- **Raider:** unchanged, and still fog-honest. It skips streets that sit inside a rival's tower reach (the tower owner would see the ambush).
- Bots build rarely at all (two-good costs are not payable from single-good district warehouses), so the new buildings show up in about one turtle in ten and one merchant in sixteen.

### Results (seeds 1 to 16, invariants 0 throughout)

| Seeds 1-16 | Districts, before | after | Credits at 48 h, before | after | Score, before | after | Contracts, before | after |
| ---------- | ----------------- | ----- | ----------------------- | ----- | ------------- | ----- | ----------------- | ----- |
| Merchant   | 2.44              | 2.47  | 1602                    | 1602  | 493           | 486   | 7.19              | 7.22  |
| Raider     | 4.81              | 5.03  | 427                     | 427   | 628           | 640   | 0                 | 0     |
| Turtle     | 3.63              | 3.75  | 223                     | 223   | 566           | 561   | 3.38              | 2.94  |

Raider lead 1.14x (1.11x before), limit 1.4x. Raid success 58 percent (411 of 713) against 58 percent (428 of 739) before; per seed min 26, max 91, sd 21 (before 21, 88, 19). 393 raids (391 before). Wear per player: about 0.9 `carrier.worn` and 0.1 to 0.2 `carrier.repaired`; carriers end at an average wear of 43 (turtle) and 38 (merchant), so the slowdown matters at the margin only. Towers built per turtle 0.09, garages per merchant 0.06; `raid.spotted` did not fire in the harness (an ambush rarely lands inside a tower owner's reach), so the warning is covered by unit tests only. First tuning (perTrip 3, repair 120 min) cost the merchant and turtle about 2 percent of score and was softened to the numbers above.

### For the UI (task 75b, done)

Done in task 75b: the client reads the global `maxLevel` of 3 and shows the Runner price from `balance.runner.credits`; it now uses the per-building `maxLevel` and `runnerPrice(district)`, shows `watchtower` on seen districts and `wear` on carriers (a bar, with the slowdown from `slowPercentAt`), and handles the three new events in the feed.

The client still reads the global `maxLevel` of 3 and shows the Runner price from `balance.runner.credits`; both must use the per-building `maxLevel` and `runnerPrice(district)`. Show `watchtower` on seen districts, `wear` on carriers (a bar, with the slowdown from `slowPercentAt`) and toast the three new events.

## Bot building (task 76)

### Why bots barely built

Parts only come from docks districts, and bots never bought parts at the hub markets. Where they did, the goods went to the hub stash and a crew with a van had to haul them home. Four bugs sat on that path: the shopping check counted supplies as a good the build needed, which blocked every purchase; `fetchOrders` used `mine()[0]` as home, and that index shifts as districts are added, so the van waited in the wrong place; goods that reached a full warehouse were discarded (producer districts refill to the cap, 120 units plus 120 per depot level); and merchant street jobs took the crews the fetch needed.

### Rules

- A bot picks its next wanted building per district from a list by personality, buys the short good at the nearest hub (capped by the room in the target warehouse), fetches it home and builds with the normal `build` order. Raiders: a Watchtower, Garage and Workshop at home and a Workshop elsewhere, but they never run building errands. Every errand took their single van off raiding (419 raids without errands, 26 to 120 with any), so they build from what their own districts make and sell the rest.
- Turtle: walls, watchtower, workshop and depot. Merchant: workshop, depot, and a garage once it runs two carriers.
- Bots only read their own fog-honest view and send ordinary orders, so rejections stay under 10 percent.

### Results (seeds 1 to 16, invariants 0)

Buildings per player (seeds 1 to 16, with the hunter in the mix): raider workshop 1.00; turtle workshop 0.34, watchtower 0.53; merchant workshop 0.97, garage 0.03; hunter workshop 1.00, watchtower 0.06. Before (see "Bots" under Watchtower and Garage): turtle towers 0.09, merchant garage 0.06, no walls or depots at all, so turtles now build about six times as many towers. Walls and depots still do not appear: they need power or data on top of parts, and a district warehouse holds one good. Building stays rare because production fills warehouses with one good and a single van is shared between hauling, raiding and shopping. The parts price stayed between 18.0 and 19.6 (base 18). `scripts/building-diag.mjs [seeds] [days]` prints these numbers.

## Hunter bot (task 76)

A new bot personality, `hunter`. It never attacks. It builds a Watchtower in every district it can pay for (raiders skip streets under a rival tower they can see), takes street jobs, runs escorted contract hauls with two crews in the van, and holds a haul while its own sight shows an ambush on the route. Server roster: raider, turtle, merchant, hunter, merchant, turtle; the theme already had a hunter faction colour.

### Harness mix

The default mix is now 1 raider, 2 turtles, 2 merchants, 1 hunter (six players, as before: one raider slot became the hunter). Other mixes were measured on the same code: a seventh or eighth player crowded the map and pushed merchants under the 2.4 floor on seeds 1 to 8 (2.31); 2 raiders with 1 turtle left merchants at 1.81; two hunters gave no drop in raid success. Fewer raiders also means less raiding, so the raider is now the weakest scorer but stays above 0.85 of the best (0.91 on seeds 1 to 8).

### Results (seeds 1 to 16, invariants 0)

| Seeds 1-16 | Districts, before | after | Credits at 48 h, before | after | Score, before | after | Contracts, before | after |
| ---------- | ----------------- | ----- | ----------------------- | ----- | ------------- | ----- | ----------------- | ----- |
| Merchant   | 2.53              | 3.06  | n/a                     | 863   | 500           | 563   | n/a               | 5.13  |
| Raider     | 4.66              | 4.31  | n/a                     | 509   | 629           | 596   | 0                 | 0     |
| Turtle     | 5.06              | 5.41  | n/a                     | 809   | 680           | 700   | n/a               | 3.81  |
| Hunter     | none              | 2.88  | none                    | 889   | none          | 531   | none              | 6.88  |

Before is the old mix (2 raiders, 2 turtles, 2 merchants) on the same code. Raider lead 0.85x (0.93x before), limit 1.4x. Raid success 47 percent (242 of 514), per seed min 23, max 83, sd 16 (48 percent before). Success against hunters 37 percent (84 of 228), merchants 53 percent, turtles 66 percent, so a hunter is struck about a fifth less often than the field: its towers hold raiders off some streets and its two-crew escorts win more fights. The hunter is viable (score 531 against 563 for the merchant). Raid success stays in the 40 to 70 percent band.

### Break it up (clear ambush, task 78)

A defender's active answer to a street ambush. Order `ambush.clear {ambushId, crewIds?, carrierId?}`.

- **Spotted only.** The ambush must belong to someone else and be visible to you right now: an end of its street inside your tower sight, or revealed by a patrol. A blind or unknown id is refused with `unknown_movement` (no information leak); no free crew gives `no_crew`. Raiders keep their blind spots.
- **Crews.** With no `crewIds`, the strongest free crews at the owned district with the shortest walk to either end go: one crew on foot, or two in an idle van or hauler. They travel with normal movement and ETA (movement kind `clear`).
- **On arrival.** If the ambush is gone, the crew walks home (`ambush.gone`). Otherwise the existing fight maths run, with no new combat rules: your strength against the ambushers' strength, each with the usual plus or minus 20 percent roll. A win removes the ambush (`ambush.cleared`), and the ambushing crews take the normal loser loss (30 percent, at least 1) and mend as usual. A loss (`ambush.held`) costs your crew the same loss. Either way the crew then walks home as a `return`.
- **Events.** `ambush.cleared`, `ambush.held`, `ambush.gone`. Both sides get feed events and the raider learns their ambush was broken up.
- **Estimate for the UI.** `SeenAmbushView.strength` is a fogged range (75 to 125 percent of the true strength). The pure helper `estimateClear(yours, {strength: [low, high]})` returns `{label, text}`, for example "your strength 9 vs about 12, risky". The label is `likely` when yours is at least the top of the range, `risky` when below the middle, otherwise `even`. It uses only what the view shows.
- **Bots.** The Hunter clears spotted ambushes it does not rate as risky; Turtles do the same only on ambushes touching their own districts; Merchants and Raiders never clear.

#### Results (seeds 1 to 16, invariants 0)

Before (no clear) and after are within noise: merchant 3.06 districts, score 563; turtle 5.41, 700; raider 4.31, 596; hunter 2.88, 531 (529 after). Raider lead 0.85x, limit 1.4x and floor 0.85x. Raid success 47 percent (241 of 511), per seed min 16, max 83. Success against hunters 37 percent, merchants 53 percent, turtles 66 percent. Only 4 clears were attempted in 16 seasons (hunter: 2 won, 1 held, 1 gone) because bots rarely have a spare crew and a visible ambush at the same moment. No raider hold reward was added: the raider did not drop, so the balance floor is not threatened. If players start clearing often, add a small credit or score reward for an ambush that lasts its full duration (see the balance notes above), and watch the raider lead. `RULES_VERSION` stays 3; `SNAPSHOT_VERSION` is unchanged (the view is not persisted).
