# Plan: a supply-and-demand economy (tasks 79 to 82)

Status: approved by the owner on 2026-11-22 ("make a plan file and proceed all"). Built in stages: each stage is rules first, then a harness check.

## Why

- Every hub prices every good almost the same. Prices move under 1% in 6 hours (sim-spec, "Market movement").
- A trade between hubs needs a price ratio of about 1.17 to beat the civic spread, and that happens in only 2.5% of samples. So "merchant" means "contractor".
- Moving goods costs time, wear and risk, but no credits. Prices ignore distance completely.

## Principles

- **Price = cost at the source + cost of getting it there.** Goods are cheap where they're made and dearer the further they travel. Transport is a cost of goods sold.
- **Demand has a geography.** Hubs are hungry for different goods.
- **The outside world sets the band.** The civic traders are imports and exports. The civic ask is the import price (a ceiling) and the civic bid the export price (a floor). Player orders compete inside that band.
- **In normal times, the gap between two hubs is about the cost of carrying goods between them.** A trade run earns a fair wage for the trip, not free money. Big profits come from shocks: shortages, raids, players flooding a market.
- **Every price has a visible reason:** distance, demand, raids or a shortage. The UI explains why a price is high.
- **Asynchronous:** everything lasts hours, so check-in players can act on it.

## Reasons to sell high or low (the design must make each real)

- **High:**
  - scarcity, when you hold the only stock near a hungry hub;
  - convenience, when your goods are already at the hub and the buyer saves a trip;
  - urgency, when someone's build or contract needs it now;
  - a risk premium, when you ran a raided road;
  - local control, when you own the districts that make it.
- **Low, even below cost:**
  - sunk cost, since only alternatives matter;
  - a full warehouse, since output stops at the cap, so stored goods block new output;
  - cash needed now, to recruit, build or rebuild;
  - avoiding a raided road by selling at the near hub;
  - undercutting a rival, so their van arrives to a crashed price;
  - a season-end clear-out, since leftover goods don't score.

## Stages

### Stage 1 (task 79): price history and cost basis

- **Price history.** Each hub book keeps its reference price every hour for the whole season (7 days is 168 samples per hub and good, a few kilobytes), recorded in `market.tick` and cleared at season reset. Players check in rarely, so the history must cover the time since their last visit: the view exposes the full series, and the UI compares "now" with "when you were last here". The owner asked for more than 48 hours on 2026-11-22.
- **Cost basis per stack.** Every pile of a good in a warehouse, a hub stash or a carrier cargo carries an average cost per unit, in integer centi-credits.
  - **Buying:** the cost is the fill price.
  - **Producing:** the cost is the local hub reference at the moment of production, its opportunity value. This is simple and needs no new concept.
  - **Hauling:** the cost moves with the goods. Stage 4's fuel adds its cost on arrival.
  - **Merging:** two piles merge into a weighted average, rounded deterministically.
  - **Losses:** goods lost in a raid are lost at their cost, and the event carries the value.
- **View:** the player's own piles show their average cost.
- **Not tracked:** individual units. Stacks are enough for ordinary goods.

### Stage 2 (task 80): regional prices from delivered cost and local demand

- **Delivered cost.** For each hub and good, the base price is the cheapest delivered cost:
  - the source value (the global base) at the nearest producing districts;
  - plus street distance × a transport rate per km;
  - plus a raid premium on streets with recent ambushes or hits.
- **Local demand.** Neutral residential districts consume supplies and power, and each counts toward its nearest hub. More demand pushes that hub's base up, capped.
- **No player upkeep.** Players' districts don't consume goods.
- **Movement.** The existing drift toward fills and the hourly reversion now pull toward the hub's own base. The base is recalculated hourly, so it follows settles, captures, Workshops and raids.
- **Civic depth** becomes import and export capacity: limited stock per hour, so floods and shortages really move the price.

### Stage 3 (task 81): shortages

- Every 6 hours or so, the seeded RNG picks one hub and one good for a shortage lasting 4 to 8 hours.
- During it, the reference is 40% higher and the civic bid depth is doubled.
- Event `market.shortage {hub, good, percent, untilMs}`, sent to everyone. A `market.shortage.ended` event follows.
- Raids on a route into a hub can also trigger a small premium, as already noted in the spec.

### Stage 4 (task 82): carrier fuel

- Carriers burn power per km driven. Foot crews burn nothing.
- The fuel cost is added to the cargo's cost basis on arrival.
- The fuel is drawn from the warehouse where the trip starts.
- **No power:** the order is refused with a plain error. A carrier never stalls mid-trip.
- **Starter kit:** it carries enough power for the first trips. The tutorial warns early.
- Power gains demand everywhere vans run, which ties the grid districts into the whole economy.

### Stage 5 (tasks 79b to 82b): UI

- **Price board.** Each good's price at every hub, with:
  - a season-long trend line, with your last visit marked;
  - the best route and its gain after fuel;
  - a "why" line, such as "far from the docks", "raids on route" or "shortage".
- **Resource chips:** show "best price at …".
- **Your piles:** show "your cost 16.4". The sell form shows profit or loss against cost.
- **Haul card:** fuel cost and "sell at East Hub: about +86 cr".
- **Shortages:** a feed card, plus a tag on the hub on the map.
- **Full warehouse:** a "storage full, output stopped" warning that makes a cheap sale a real choice.

### Later (optional)

- A third hub (North Hub) when the city grows big enough.
- A small trade fee at hubs as a money sink, if the harness shows credits piling up.

## Harness targets (seeds 1 to 16, invariants 0, no floor lowered)

- **Distance gradient:** for parts, the hub nearest the docks is cheaper than the far hub on average.
- **Normal times:** the median gap between hubs is within ±50% of the transport cost (fuel plus the transport rate) between them.
- **Trade gap:** in at least 50% of sampled hours, some good is worth carrying, with a ratio of at least 1.25 after fuel.
- **Payout:** a van trade run earns 0.7× to 1.3× a contract of similar length.
- **Money supply:** total credits held by all players is reported over the season. Flag if it grows more than 3× from day 1 to day 7.
- **Unchanged limits:** raid success 40 to 70%, raider lead at most 1.4×, the raider viability floor and the merchant floor of 2.4. No bot type ends with more than 1.5× its previous credits.

## Bots

- **Merchants:** compare the delivered profit across hubs, run trades and chase shortages. They sell low when their warehouse is full or cash is short.
- **Raiders:** lean toward routes into shortage hubs.
- **Every bot:** keeps power for fuel.

## Pros and cons in plain words

- **Pros:**
  - Prices make sense: far from the docks, parts cost more.
  - Merchants get a real identity, and raids and trade feed each other.
  - Selling cheap, selling dear and undercutting become real decisions.
  - Shortage news gives players a reason to check in.
- **Cons:**
  - It's a bigger build, with more state (cost per pile, price history).
  - Fuel adds a resource to manage, and a newcomer can run dry, so the warnings must be clear.
  - The price board must explain why a price is high, or prices feel random.

## Versioning

- `RULES_VERSION` stays 3 until deploy. Nothing is live.
- New persisted state (cost per pile, price history, shortages) goes through the `SNAPSHOT_VERSION` upgrade pattern, with defaults for older snapshots.
