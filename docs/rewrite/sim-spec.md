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
