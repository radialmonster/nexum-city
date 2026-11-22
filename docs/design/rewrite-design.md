# Nexum City rewrite: game design draft

Status: approved direction, 2026-11-22. This is the design for the rewrite (see ADR 0030 and `docs/rewrite/plan.md`). The prototype's docs live in the private archive repo and are history only.

## Why a rewrite

The concept works:

- rival crews fighting over districts of a cyberpunk city;
- an economy that creates conflict;
- logistics that take real time;
- a season race.

The prototype is not fun to play:

- Almost everything is text and lists, so the map never shows the war.
- About 20 systems each sit on their own screen and rarely visibly affect each other.
- A visit spends 3 actions in 10 minutes, then there are 12 hours of nothing.
- A capture takes about 8 days and runs on autopilot.
- Bots stood still for months.

The rewrite keeps the concept and its deliberate depth: troops and goods take time to move, and markets are real. It rebuilds everything around a visual city map.

## Pillars (kept from the prototype's game vision)

1. **Meaningful short sessions.** A visit is a few high-consequence choices. You come back later to see their effects.
2. **Economy creates conflict.** Production, prices and supply lines give everyone reasons to fight, trade and raid.
3. **A visible persistent world.** Ownership, routes, convoys, sieges and prices are all on the map.
4. **Strategy over reflexes.** The game is asynchronous. Nothing requires being online at the same moment as anyone else.
5. **Fairness.** Being online more often lets you react sooner and see more. It must not let you do more per day.

## The shape of play

**Who plays:** a player logs in 2–4 times a day for about 15 minutes. Each visit they:

- catch up on what happened;
- make their decisions: build, defend, trade, attack;
- issue orders and leave.

The world, including the other players and the bots, keeps running while they're away.

### Two kinds of action

|                | Orders                                                                                          | Instant actions                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What they are  | Commitments that take time and can be seen or interrupted                                       | Immediate changes with no travel and no waiting                                                                                                                                    |
| Typical length | 15 minutes to 8 hours                                                                           | Instant                                                                                                                                                                            |
| Examples       | Move a crew, send a convoy, haul goods, siege a district, build or upgrade, scout, raid a route | Buy or sell at a market where you have goods present, set a district's stance, set prices on your listings, recall an order, assign a crew to guard, read reports, message a rival |
| Risk           | Can be intercepted, raided, defended against, or arrive too late                                | None. Their effects play out through orders                                                                                                                                        |

**What limits a day.** There's no "3 actions per 12 hours" budget. Your assets are the limit:

- Each crew and each carrier can do one order at a time.
- Each district builds one thing at a time.
- Orders take real time.

A player who checks in twice a day and queues sensible orders gets about as much done as one who checks in eight times. The frequent visitor can react faster, for example by rerouting a convoy, but has no extra capacity. This replaces the old action budget with something that's visible and makes sense.

### A typical 15-minute visit

1. **Catch up (1–2 minutes).** The "While you were away" panel plays back the last few hours on the map:
   - your hauler reached the Docks market;
   - Rival 3's convoy was spotted heading for Glass Ward;
   - your siege on Relay East is at 70%;
   - the price of parts in the Docks rose 30%.
2. **Respond (5 minutes).**
   - Glass Ward is threatened, so you move a crew from Civic Core to reinforce it (an order, 25 minutes).
   - You set Glass Ward's stance to Hold (instant).
3. **Economy (5 minutes).**
   - Sell the parts your hauler delivered to the Docks while the price is high (instant).
   - Send the empty hauler home with power cells bought cheaply there (an order, 40 minutes).
   - Choose the longer route that avoids Rival 3's streets.
4. **Grow (3 minutes).**
   - Queue a Workshop upgrade in Ember Market (an order, 3 hours).
   - Send a scout to look at Halide Docks before attacking it next visit (an order, 30 minutes).
5. **Leave.** Every order shows an ETA on the map, and you'll be notified about anything urgent.

**The very first visit.** A new player gets a newcomer rush: for the first 24 game hours, builds and settles run 10 times faster, so the first Workshop is finished within minutes. One civic contract on the nearest hub is reserved for them, and a personal list of three street jobs (courier, salvage, patrol; 3 to 10 minutes each, small pay, almost no score) gives something to do while bigger orders run. A new job turns up every 30 minutes up to three, so logging off costs nothing (salvage pays 2 parts; the starter contract has van time plus 3 hours and is offered once more if it fails; open frontier plots are always visible as open for claim and offer SETTLE in the panel and radial; a siege on a neutral plot faces the neutral guard (20), not militia (10), and the order card's odds say so; bots probe a newcomer lightly within about a day of its protection ending). While a rush is running a replacement plot is surveyed in 5 minutes (not 4 h), and the kit carries 30 supplies, so the newcomer can settle a second district within about 5 to 15 minutes. The starter contract is a deliberate "come back in about an hour" hook: the hub is a 50 minute van ride away. Scripted, this gives about 8 actions and 3 completions in the first 15 minutes and a settle accepted inside it (3 and 1, and no settle, before). Siege, travel and raids are not sped up. **As built (task 77b):** a green rush banner under the top bar ("Newcomer rush: builds and settling 10x faster for 23h 50m", with WHY? for the explanation) disappears when the rush ends and leaves a `rush.ended` feed card. The district panel's STREET JOBS list shows each job's kind, description, time (and the carrier time), pay and risk, with TAKE opening an order card (crew, carrier, "the crew rests when the errand ends"); "Next job in 24m" shows while fewer than three are on offer. Finished and failed jobs are folded feed cards (`job.done`, `job.failed`) and a JOB tag on the orders timeline; a patrol reveals ambushes on the streets it walked for 60 minutes. The reserved starter contract is marked "Reserved for you" on the hub board with no deposit, the first-steps checklist points at it, and its haul card defaults to the quickest carrier. A hurt crew shows "7/10, mending +1 every 1.5 h" in the district and crew details (no feed entries). When no plot is open the settle step says so (the city surveys new plots for about 4 h) and asks the player to keep 60 supplies at home. On phones the same panels sit in the FEED, MAP, ORDERS and DISTRICT tabs, with the banner above them.

## Look and feel: a cyberpunk command interface

**The rule:** graphics first, text second. The map is the game screen, and every action starts there. Text is only for short labels, numbers and reports. If something can be shown as a shape, colour, bar, icon or animation, it should be.

**The city map**

- A dark, top-down tactical city. Districts are neon-outlined zones in the owner's colour, and neutral districts are a dim grey.
- Districts have their own silhouettes, building textures and landmarks, so the city reads as a place and not a grid of identical tiles. The Sound (water), a waterfront maglev line and a bridge give it edges and texture.
- Streets glow faintly, and traffic pulses along routes that are in use.
- Convoys are small glowing icons moving along the streets, each showing an ETA tag. Each carrier type has its own silhouette, coloured by owner: a cluster of dots for On foot, a short wedge for a Van, a cab and trailer for a Hauler, a chevron with speed streaks for a Runner.
- An incoming enemy convoy shows its remaining route as a red dotted line ending in an ETA tag on the district it is heading for. The threatened district's outline pulses red.
- Ambushes show as red dashed streets (your own in your faction colour with a countdown tag); when a raid resolves the street flashes with a short callout naming both sides, and the feed card opens a battle report.
- A siege is a ring around the district that fills clockwise, with a spark at its leading end.
- Production shows as small particles flowing into each district's warehouse gauge. A full warehouse blinks amber.
- Fog of war has three levels:
  - **In sight:** full detail. The edge of your sight is drawn as a dashed line.
  - **Out of sight:** dimmed under scan-line static. You still see the last known owner. Rival convoys fade as they cross the edge.
  - **No signal:** never seen. Static only, until you scout it. Scouting "decrypts" an area with a sweep effect.
- Markets are hubs with a holographic price panel on them. Each good has a bar that rises green or falls red against the city average, so price pressure is readable at a glance. A hub with a shortage pulses outward.
- **Shortages, fuel and the daily levy.** About every 6 hours one hub runs short of one good for 4 to 8 hours: its price is 40% up and the city bids deep, so a trader who arrives in time is paid well (news goes to everyone; the view lists the active shortages). Vans, haulers and runners burn power per km of street, drawn when the trip is ordered; with too little power anywhere the order is refused (`no_fuel`), and the fuel's cost joins the cargo's cost basis. To stop money piling up, each player pays a daily levy on credits held above 300 plus a small upkeep for each district beyond the first. Credits are not score, so hoarding costs points only by what it could have bought.
- City broadcasts are public and always visible, even in fog: a new crew arriving on the frontier, and the plots that are opening.

**Moving around the map**

The city is bigger than one screen (see "The world"), so the map is a window you pan and zoom. Districts carry on past every edge of the window.

- **Three zoom levels:**
  1. **City:** every district is a coloured territory blob. It shows who holds what, where the frontier is, and pings for your alerts and the newest arrival.
  2. **Tactical (the default):** streets, convoys, siege rings, prices and fog. Orders are given here.
  3. **District:** a close view of one district, showing building slots, walls under construction, the warehouse level, crews at the gates and parked carriers.
- **Level of detail follows on-screen size, not zoom level.** Each plot is measured in screen pixels. Below a minimum the name is hidden; above it the name, the owner sub-label, the inner pattern (dock cranes, grid lines, archive rows, farm rows, residential windows) and the hub price bars appear in steps, with a richer layer at district zoom. Tactical frames about 25-35 plots on a 1920-wide screen and fewer on a phone. All thresholds are `map` theme tokens.
- **On phones (narrower than `compactBelowPx`)** the jump list and minimap collapse into buttons that open one drawer at a time, and the controls sit at the bottom within thumb reach, so panels never overlap.
- **Selecting a plot pans the camera** (all sizes). The map measures the HUD cards (sector card, minimap, controls, drawers) and, when the selected plot's radial ring would not fit in the clear area, eases the camera just far enough to fit it. It uses the `--duration-slow` timing token, jumps instantly under `prefers-reduced-motion`, and may temporarily go past the normal pan limit so edge plots can be fitted; the limit is restored on deselect. The clamped half ring remains only as a fallback for a truly tiny viewport.
- **Navigation cluster** in the bottom-left corner of the map:
  - a minimap of the whole city with coloured territories, your viewport rectangle and alert pings;
  - zoom + and − buttons and the three level buttons;
  - a "recentre on my districts" button;
  - a jump-to list of your districts and current alerts;
  - a sector and coordinate readout.
- **Off-screen indicators:** anything that needs you outside the window gets an arrow tab on the nearest edge of the map, with what it is and how far away, for example "Cold Harbor under siege, 4 blocks west". Tapping it jumps there.

**The interface (the HUD)**

- Translucent glass panels with thin cyan and magenta edges, angled corners and a slight glow. Panels slide in over the map instead of replacing it.
- Panels stay off the districts. Cards sit over the water at the bottom of the map, alerts are a thin ribbon under the legend, and the HUD scale steps down on short or narrow windows.
- A monospace "terminal" font for numbers and a clean condensed font for labels. HUD text scales up with the screen so it stays readable on a large monitor.
- Tap a district for a radial menu: Attack, Reinforce, Build, Haul, Scout. Choosing one draws the route on the map with the ETA and risk before you confirm. The confirm card lets you pick the carrier and shows each one's ETA.
- Orders in progress sit in a timeline strip along the bottom: one bar per crew, carrier or building, filling until it completes. It also shows incoming threats as red bars and an unconfirmed order as a dashed preview bar. A bar whose label does not fit keeps its label beside the bar, and on a phone stacks it above the track, so labels stay readable. The season-end modal hides the radial menu like every other modal.
- **As built (tasks 41 to 44):** `/` is the playable game (`/map` and `/kit` stay as the demo and the kit). A sign-in and register screen comes first. The frame is the top bar (season and day, race bar, resource chips, alerts, clock), the "While you were away" feed on the left, the map in the centre and the district panel on the right, with the bottom timeline slot left empty for now. The feed is a list of event cards that fly the map to the place on click, rather than the replay described below, and the time of the last visit is kept in the browser. Below the compact width the side columns become a FEED / MAP / DISTRICT tab bar. Live updates use server-sent events and fall back to polling `/feed`. The confirm card shows the ETA and, for sieges, an odds estimate: a rival's garrison is fogged, so it counts the crews seen at their starting strength with no walls. Server rejections show as plain-language toasts.
- **As built (task 64 and follow-ups):** The server adds a `names` map (player id to crew name) to `/me` and `/standings`, validated by the contracts schemas, and every screen shows crew names (race bar, district owner, dossier, battle report); reports say "you" and "your crews" for the player. In the feed, `siege.started` opens a running siege card that folds in each `combat.round` ("Round N: attack X against defence Y") and closes on `siege.captured` or `siege.broken`; clicking it opens the battle report with every round so far. With no district selected the district panel shows an empire summary (districts, crews, carriers, income per hour, besieged count, a fly-to button per district). On phones the tab bar is FEED / MAP / ORDERS / DISTRICT, the map controls sit on a solid backing, tapping a plot keeps the Map tab and shows its radial (an order is plot, order, then one confirm tap on the confirm card, whose crew is pre-picked; the radial has a DETAILS item that opens the District tab), panels (market, report, dossier, confirm card) pull the Map tab forward and cover the map, and every button and tab is at least the `size.touch` token (44 px). Capture rings on the map are drawn with a `moveTo` before the arc so no stray line is drawn.
- "While you were away" plays as a short map replay with event cards, like a security-camera feed. A scrubber shows the whole time away with a coloured tick per event. During replay the map turns amber, live units are hidden and past movements are drawn as ghost trails.
- The season race is always in the top bar as a bar split by each crew's share of district-hours, with your rank beside it.
- The district panel shows production flowing into the warehouse, the warehouse split by good, building slots with level pips, and the crews and carriers stationed there.
- Notifications come in five styles by colour: urgent (red), warning (amber), information (cyan), success (lime) and city news (blue).
- Small effects make it feel alive: glitch transitions, scanning sweeps, a soft chime when a convoy arrives, a warning pulse when you're under attack. Effects must be readable and can be turned down. Nothing flashes for no reason.
- Phone first: big touch targets, with the map always visible behind panels. On the phone the first tap on a plot shows the radial on the map and the DETAILS item opens the district panel, a tab bar (Map, Orders, Market, Feed, Rank), a small minimap, zoom buttons, and the same edge arrows for off-screen alerts.

**Art approach:** most of this is drawn by code (shapes, glows, particles, shaders), so the first version needs very little hand-made art. District icons, faction emblems and bot portraits can be added as image assets later, either commissioned or generated, without changing the code.

## The world

- **City:** Meridian, a city of districts joined by streets. The streets are an actual network: travel follows them, and districts block or protect them.
- **The city grows as players join.** It isn't a fixed board:
  - A season starts with about 20–30 districts. It can reach dozens or hundreds, and a player only ever sees part of it at once.
  - The city's outer edge is a **frontier** of plots that are surveyed, then opened. To the south the city ends at the Sound.
  - **Settling:** a seen open plot is marked in the fogged view (`open`, and `settling` with the settler and finish time only). Players settle it from the radial menu: 60 supplies from the starting warehouse and a 10 hour timer; the map, timeline and feed show it.
  - **Placing new players:** each new player gets one protected first district on a newly opened frontier plot, with unclaimed plots and neutral districts nearby to expand into. Protection lasts about 48 hours.
  - There's no permanent privileged home district. After protection ends, a first district can be besieged like any other.
  - A new arrival is announced to the whole city and marked on the map.
  - The mockup shows a city of 123 districts and 11 crews with 35 open frontier plots.
- **District types:** each district produces one main good and has its own character, for example the Docks make parts, the Grid makes power and the Archive makes data. Holding a type gives you that production and a reason to trade.
- **Hubs:** 2–3 public market hubs nobody owns. Prices differ between them.
- **Neutral districts:** held by a weak faction garrison (for example the Helix Combine). New players expand into them first.
- **Public geography under fog (as built):** the name and kind of every plot you have ever seen stay visible, dimmed. Ownership, garrison, stock and units outside your sight stay hidden. This is client-only, from the remembered districts.
- **Fog of war:** you see your districts, your crews, and what they can see. Public hubs are always visible. Rival convoys are visible while inside your sight range. Outside it you see only a district's last known owner. Scouting reveals the rest for a while.

## Districts

Each district you own has:

- **Production:** goods per hour into the district's warehouse. Goods are physically there and must be hauled to be sold or used elsewhere.
- **Warehouse:** a capacity limit. When it's full, production is wasted, which gives you a reason to haul and trade.
- **3 building slots** to start, for example:
  - Workshop: more production.
  - Walls: siege progress against this district is slower.
  - Depot: bigger warehouse, and hauls from here load faster.
  - Watchtower: sees 2 or 3 street hops instead of 1 and warns when an enemy ambush is set within range, so you and your bots can route around it, or break the ambush up (see "Break it up" below).
  - Garage: carriers wear a little on every trip (a struck convoy wears more) and slow down past a threshold; a Garage repairs parked carriers much faster and makes Runners bought there cheaper. Without one, carriers still heal slowly.
    Each takes 1–8 hours and costs goods that must be in that district's warehouse.
- **Garrison:** crews stationed there defend automatically.
- **Stance:** an instant setting.
  - **Hold:** fight sieges, slower capture progress.
  - **Pull back:** your crews leave before capture and the goods are evacuated.

Losing a district hurts but isn't the end. Its goods may be looted, buildings are damaged, and you keep your score. You can win it back. A player who loses everything gets a new protected district elsewhere.

## Units

**Crews** fight and capture. Each one has:

- strength;
- a home district;
- one order at a time.

You recruit them with credits and supplies.

**Carriers** move crews and goods. They are visible on the map while moving.

| Carrier | Speed  | Cargo  | Toughness | Notes                                                       |
| ------- | ------ | ------ | --------- | ----------------------------------------------------------- |
| On foot | Slow   | Tiny   | —         | Always available, very hard to spot                         |
| Van     | Medium | Medium | Medium    | All-rounder                                                 |
| Hauler  | Slow   | Large  | High      | The trade workhorse; a juicy raid target                    |
| Runner  | Fast   | Small  | Low       | Hard to catch (about 1 ambush in 3 misses it); urgent goods |

The Runner is bought with credits (300, up to 2 per player) and appears at once. It is about 1.6 times a van's speed with 40 percent of its cargo and low toughness. When an ambush strikes it, there is a 35 percent chance it slips away (`raid.evaded`) and the ambush stays set; if it is caught, the raiders win easily. See [sim-spec](../rewrite/sim-spec.md#runner-carrier-m2).

Carriers take wear and need repair at a Garage. Upgrades come later, kept simple: one upgrade slot per carrier, such as armour or a bigger engine.

## Orders in detail

- **Move:** take crews and/or goods from A to B along a route you choose or accept. Shows the ETA and the risk along the route, for example "passes Rival 3's Glass Ward".
- **Haul and trade:** move goods to a hub to sell, or buy at a hub and bring them home. An order can be a round trip: go, sell, buy, return.
- **Siege:** a convoy with crews arrives at a target district and starts filling its capture bar. The speed depends on attacking strength against garrison, walls and stance. A capture takes about 6–12 hours of sustained siege, so it plays out over 2–3 visits by both sides. Either side can send reinforcements, which arrive by order with travel time. When the bar is full, the district changes hands, and both players get a readable battle report.
- **Raid:** send crews to wait on a street for up to 8 hours. An enemy haul crossing that street is struck once: the raiders' strength is weighed against the carrier's toughness plus the escort, with a little luck. A win steals 40 percent of the cargo and destroys some more, and the convoy carries on; a loss costs the raiders strength and ends the ambush. Escorts are just extra crews on the haul. Ambushes are hidden unless you can see the street, and the target only learns when hit. Settle supply carriers can be struck like hauls, a recalled haul walking home can be struck too, and a player under new-player protection is exempt from being struck but also cannot set ambushes (immunity and raiding together would be unfair). A defender who can currently see an enemy ambush can "Break it up": a crew walks there and the usual fight decides it (win: the ambush is gone and the raiders lose strength; lose: your crew loses strength; if the ambush has gone, the crew just walks home). The UI shows a plain estimate such as "your strength 9 vs about 12, risky", and only spotted ambushes can be targeted, so raiders keep their blind spots. In the UI a BREAK IT UP button sits on the spotted-ambush feed card and in the district panel's SPOTTED AMBUSHES list; it opens a confirm card showing the crew that would go, their arrival time against the ambush's remaining time, and the estimate (label coloured by theme tokens). The clear shows on the timeline and map as "Break up ambush", and results arrive as feed cards for the clearer and for the raider ("Your ambush between A and B was broken up"). A raider's own countdown tag on the map keeps clear of the HUD cards. A successful raid on a route into a hub nudges that hub's price up. See [sim-spec](../rewrite/sim-spec.md#raids-and-escorts-m2).
- **Scout:** reveals a district or area for a few hours: garrison, warehouse, buildings, incoming convoys.
- **Build:** start a building or upgrade in a district (described above).

All combat resolves automatically from strengths plus some randomness, and produces a short report. Nobody has to be online for a fight.

## Markets

- Every hub has a real order book. Players and bots post buy and sell offers, and the city's civic traders (the old market custodians) provide a baseline so the market is never empty.
- Prices move with supply and demand, and with events: raids on routes into the Docks make parts scarce there, so the price rises. Each hub has its own base price: the cheapest delivered cost (the source price plus street distance times a transport rate, plus a premium from recent raids on those streets), pushed up a little by neutral residential districts that consume supplies and power. It is recalculated hourly and the price drifts toward it. You can see your own average cost per pile, and each hub keeps a trade-price history for the season.
- To use a market you must have goods physically at that hub. Hauling them there is the order; trading once there is instant.
- Player listings sit in escrow at the hub. A buyer collects them at the hub and hauls them home.
- **Contracts** (built in tasks 73a and 73b): each hub board holds up to 4 delivery jobs, for example "bring 30 power to Ember Market within 12 hours for 500 credits". The city posts jobs on a cadence, which gives new players early income, and players and merchant bots post their own by escrowing the reward. Taking a job costs a small deposit (10 percent) that is lost if you are late. One taker per job, and partial deliveries count. Contract hauls are raidable like any other. Completed jobs give score, capped per day. Boards and takers are public, but the progress of someone else's job is hidden. UI: each hub panel has a MARKET / CONTRACTS tab (take, post with the escrow cost shown, cancel); the empire panel lists your jobs with a DELIVER button that pre-fills a haul card; feed cards fold into one per contract. Contract score is not in the in-game view standings, so SeasonEnd does not show it. Details and numbers are in `docs/rewrite/sim-spec.md`.

## Bots

Bots play by exactly the same rules and on the same clock. They also visit periodically and issue orders. Each bot has a personality:

| Bot      | Style                                                                           |
| -------- | ------------------------------------------------------------------------------- |
| Raider   | Fast strikes on weak targets; raids trade routes                                |
| Turtle   | Builds walls, defends, expands slowly into neutral land                         |
| Merchant | Trades and hauls; takes high-production districts; posts contracts              |
| Hunter   | Watches the streets: towers everywhere, escorted hauls, never attacks (task 76) |

Bots build what their personality wants (turtle: walls, towers and a depot; merchant: depot, garage, workshop; hunter: watchtowers; raider: a workshop), shopping for parts at the hub markets when their own districts do not make them. Raiders skip shopping because their one van is their raiding engine. Details and numbers are in the "Bot building" and "Hunter bot" sections of `docs/rewrite/sim-spec.md`.

Bots announce their intentions in readable language ("Rival 4 is moving on the city leader"), they avoid piling onto the same target, and they defend their own districts. When real players join, they take empty bot slots or join alongside them.

How the server runs them (tasks 51 to 53): bots are real players with a row in `bots` instead of an account. They act only at a few seeded, jittered check-ins a day, decide from the same fogged view a player gets, and send orders through the normal order path, so they are validated and logged like anyone's. `BOT_COUNT` (default 6) bots start; each human who joins retires one, at most one per game hour, down to `BOT_MIN` (default 2). A retired bot stops acting but keeps its districts as a dormant crew that players can raid. New crews and new frontier plots are announced to everyone's feed.

## Seasons and winning

- A season lasts 4 weeks.
- **Score:** district-hours (each district you hold earns points every hour), plus a smaller score for trade volume and completed contracts. Merchants can compete without being the biggest army.
- **Catch-up:** players below the median get faster recruitment, and the leader's districts are slightly cheaper to besiege.
- **Final 48 hours:** this is announced; no new players join mid-finale.
- At season end there's a final leaderboard, then the city resets. Accounts, cosmetics and history carry over.
- **As built (tasks 61 and 63):** the test season is 7 days (`SEASON_DAYS`). At the end the server freezes the standings into a `seasons` archive and starts a new world with a new seed, re-adding every account (`SEASON_BREAK_HOURS`, default 0, sets a pause). The client shows a season-end screen, a `/hall` hall-of-fame route and a finale countdown in the top bar. Snapshots are versioned; a sim rules change closes the running season and starts a new one rather than replaying old inputs under new rules. `/api/health`, JSON logs, `npm run backup` and the Docker limits are described in `apps/server/src/game/README.md`.

### Playtest fixes (client)

- A haul for a contract warns on the card when the trip outlasts the deadline, naming the deposit only when there is one.
- The first-steps checklist is sticky and saved per player; a step seen done never returns to TODO.
- A full warehouse offers a prefilled haul to the nearest hub, and the district panel shows how long until it is full.
- The clock shows the season day with the time (`D3 23:46`). The order bar and the order card share one siege estimate.
- The radial menu closes once an order is launched; clicking the plot again reopens it.
- An open frontier plot (nothing owned there) offers only SETTLE (the highlighted primary item), SCOUT, DETAILS and CLOSE in the radial; RAID and SIEGE appear only on neutral plots that are not open. The ACTIVE ORDERS band is a fixed token-sized height (about 3 rows, then it scrolls) so the map never resizes.

## Away from the game

- The **"While you were away" replay** is the heart of each visit: a short animated playback on the map plus a list of events.
- **Notifications** (browser push, and later on Android) only for things that matter:
  - your district is under siege;
  - your convoy was raided;
  - a contract is due;
  - a siege bar has passed 75%.

## What we cut from the prototype

- The action budget, replaced by asset-limited orders.
- Five concentric rings, ring holding windows and assault caps, replaced by one capture bar per siege with clear modifiers.
- Influence percentage gates, alertness, signal and public-front pressure.
- Separate delivery, scouting and faction job boards, replaced by one contracts board.
- Per-item container and ledger accounting, backpacks and caches, replaced by district warehouses and carrier cargo.
- Multi-step blueprint, fabrication, fragment and socket chains. Crafting can return later as one building type.
- Text-first screens. Every action starts from the map.

## First playable version (milestone 1, roughly 2 weeks)

- **Map:** Meridian starts with about 20 districts and 2 hubs and grows at the frontier as players join; streets; fog of war; pan, zoom (city, tactical and district levels), minimap and off-screen alerts.
- **Districts:** production, warehouses, 3 building types (Workshop, Walls, Depot).
- **Units:** crews, plus three carriers (On foot, Van, Hauler).
- **Orders:** move, haul and trade, siege, build, scout.
- **Markets:** one market per hub with civic baseline traders and player listings.
- **Bots:** 3 bots with 3 personalities.
- **Season:** a 7-day test season with a leaderboard.
- **Catching up:** the "While you were away" event list (the animated replay comes in milestone 2).
- **Accounts:** username and password, like today.

**Milestone 2:**

- Raids and escorts.
- Runner carrier (sim and UI done). The own-district panel has a BUY RUNNER action with a plain pitch and a disabled reason. Haul and contract cards show a carrier comparison (speed, ETA, cargo, trade-off) and start on an idle Runner when the load is 16 or less and the deadline is tight. The feed shows `raid.evaded` for both sides and your own purchases; the map shows a slim Runner marker and a short evade flash (map tokens `runnerScale`, `runnerSlim`, `evadeFlashMs`).
- Contracts.
- Watchtower and Garage (sim and UI done). The build list offers both with plain-language pitches and the per-building max level. Own towered districts draw a range ring on the map and ambushes the tower spots appear in the hostile style with a "spotted by your tower" marker (tokens `towerRingAlpha`, `towerReachAlpha`, `spottedRingAlpha`). The feed has a `raid.spotted` card; `carrier.worn` and `carrier.repaired` fold quietly. Carrier wear shows as a bar with "+N% slower" in the district panel, the empire panel (WORN CARRIERS) and the haul card, and the haul ETA includes the slowdown. The Runner price follows the district's Garage. A haul order card warns "Known ambush on this route" when a spotted ambush lies on the path (no new sim rule).
- The animated replay.
- Push notifications.
- The fourth bot.

**Milestone 3:**

- Carrier upgrades.
- Catch-up rules tuned on replays.
- A diplomacy and messaging layer.
- Then clans and cartels (still future scope, as in the original vision).

## Engineering rules (owner-set)

1. **Theme system, no hard-coded styles.**
   - Every colour, font, size step, spacing value, glow, border and animation timing is a named design token, defined in one theme module.
   - The token source is a TypeScript object. It generates the CSS custom properties for the HUD and supplies the colour and number values for the canvas map renderer, so the panels and the map can never drift apart.
   - Components never contain raw hex colours or pixel values. A lint rule fails the build on raw colour literals outside the theme module.
   - Faction colours are theme tokens keyed by faction role, not by a specific bot, so a new rival or a recoloured faction is a one-line change.
   - Text and panel scale is a single token (the mockup's `--s`), driven by viewport size and a user setting.
   - Alternate themes, such as high contrast, colour-blind-safe faction colours and reduced motion, are just different token sets.
   - A UI kit is built once from the mockup (Panel, Chip, Bar, Button, Tag, Toast, TimelineRow, RadialMenu, and so on). Screens are composed from the kit, not styled ad hoc.

## Technology plan

- **Language:** TypeScript on both the server and the browser. One language means rules can be shared between client previews (ETAs, odds) and the server.
- **Client:**
  - React for panels and menus.
  - PixiJS (or Phaser) for the map: districts, streets, moving convoys, capture bars, fog.
  - Works on mobile browsers; an Android wrapper later.
- **Server:**
  - A Node service holds the authoritative game state and runs a simulation tick every few seconds. The tick resolves arrivals, sieges, production, markets and bot decisions.
  - The browser uses a normal HTTP API.
  - Live map updates use server-sent events or polling while the page is open. There are no permanent sockets, consistent with the vision.
- **Database:** SQLite (see Hosting); Postgres only if we outgrow one process.
- **Simulation:** a deterministic core that can run at any speed. This lets us replay a whole season in seconds to test balance and bots, which is what the old replay harness tried to do.
- **Hosting:** the owner's own server, which has spare disk space but limited RAM. That means keeping the footprint small:
  - **One Node process** (Fastify or Hono) serves the built static client, the HTTP API and the simulation tick together. There's no separate web container and no SSR framework. Nuxt, Astro and NestJS add memory and solve problems this game doesn't have: the game screen is a client-side canvas app, and public pages can be static files.
  - **Database:** SQLite (one file, no extra process, about 0 MB extra RAM) is the default for a single-server game at this scale. Postgres is the upgrade path if we ever need more than one server process; it adds about 100–200 MB.
  - **Docker Compose:** one `app` service plus a volume for the SQLite file and backups. The target server is managed by FlyWP, which supports a "Docker Compose App" site type. FlyWP's Nginx proxy provides the domain and HTTPS, so we don't add our own proxy. The server is small and shared with other sites, so keep the container small and set a memory limit.
  - **Rough memory budget:** about 100–200 MB for the app. Rust could bring that down to about 20 MB, but asynchronous ticks don't need the speed.
  - Identical on a development PC and on the server. Moves off Cloudflare.
- **Visual mockup:** `docs/design/rewrite-mockup.html` is a static, plain HTML/CSS/SVG mockup of the map screen and UI pieces. Open it in a browser. It has no JavaScript, but the zoom buttons, the replay button, the stance toggle, the market tabs and the build picker respond to clicks.
- **Repository:** this public repo, as npm workspaces (`packages/theme`, `packages/sim`, `packages/contracts`, `apps/server`, `apps/client`). The prototype lives in a separate private archive repo. See `docs/rewrite/plan.md` and ADR 0030.

## Open questions for the owner

1. Do the timer lengths look right? Travel 15–90 minutes, captures 6–12 hours, builds 1–8 hours.
2. Are the goods right? Parts, power, data and supplies, plus credits.
3. Should trade volume count toward season score, or only territory?
4. Do the bot names and personalities need flavour (real rival gang names and faces)?
5. ~~Should this live in this repo or a new one?~~ Decided 2026-11-22: this repo (ADR 0030).

- **As built (tasks 45 to 47):** the bottom band lists active orders on a 4 h axis with recall. The market panel opens from a hub or a resource chip. Clicking a `siege.captured` or `siege.broken` feed entry opens a battle report, and a rival's name in the district panel opens a dossier. For local testing, the server routes `POST /api/dev/seed` and `POST /api/dev/advance {hours}` exist only when `DEV_SEED=true` (never in production).
