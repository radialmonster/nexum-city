# Plan: regional hub prices (tasks 79 and 79b)

Status: planned, not built. The owner agreed on 2026-11-22 to plan this.

## Why

- Every hub prices every good almost the same. Prices move under 1% over 6 hours (sim-spec, "Market movement").
- The civic spread is 8% either side, so a hub-to-hub trade needs a price ratio of about 1.17 just to break even. Today that window is open in only 2.5% of samples.
- So "merchant" really means "contractor". The game's core idea of transport and markets has no reason to carry goods from one place to another except contracts.

## Goal

- A player who checks in should usually see at least one good that is worth carrying from one hub to another.
- The comparison is readable at a glance: "Parts: West 15, East 21 (+40%)".
- A trade run should pay about as much as a contract of similar length, not more. Trading becomes a real choice, not the only sensible move.

## Proposed rules

### 1. Each hub has a character, from what's made near it

- Each non-hub district counts toward its nearest hub, by street distance.
- A hub's base reference price for a good depends on how many producing districts of that good it serves, compared with the city average:
  - a surplus makes the good cheaper there;
  - a shortage makes it dearer;
  - the shift is capped at ±30% of the global base.
- The base is recalculated in the hourly `market.tick`, so prices follow the city: newly settled plots and Workshops (which add output) shift them.
- The existing drift (1/8 toward each fill) and the hourly 5% reversion now pull toward the hub's own base instead of the global one.

### 2. Shortages make news

- Every 6 hours or so, the seeded RNG picks one hub and one good for a shortage lasting 4 to 8 hours.
- During it, the reference is 40% higher and the civic bid depth is doubled.
- A `market.shortage` event goes to every player: "East Hub needs power: paying 40% more until 18:00."
- It lasts hours, not minutes, so check-in players can act on it. It's not a race.
- A shortage also fits raiding: raiders know where the valuable hauls will be heading.

### 3. No money machine

- Civic depth (60 per side, refilled 20 per hour) and the 1/8 drift already shrink a gap as players trade into it.
- The harness checks that no bot type earns a runaway share of its credits from trade runs.

### 4. A third hub later (optional, task 79c)

- When the city grows past a set size, a North Hub opens on the frontier.
- It gives a fresh market and new routes.
- This is only worth building if two hubs feel too few after 79 and 79b.

## Harness targets (seeds 1–16, invariants 0)

- **Trade gap:** in at least 60% of sampled hours, the best cross-hub ratio for some good is 1.25 or more.
- **Payout:** a van trade run earns 0.7× to 1.3× a contract of similar length, after the spread.
- **Unchanged limits:** raid success 40–70%, raider lead at most 1.4×, merchant floor 2.4, raider viability floor. No floor is lowered.
- **No runaway:** no bot type ends with more than 1.5× the credits it had before this change.

## Bots

- **Merchants:** run trades when the gap beats the spread plus a margin, and chase shortages.
- **Hunters:** may chase shortages too.
- **Raiders:** lean toward streets that lead to a shortage hub.

## UI (task 79b)

- **Price board:** a compare view with each good's price at every hub, the best route and the percentage gain.
- **Resource chips:** each chip at the top shows "best price at West Hub".
- **Haul card:** when you carry goods to a hub, it shows "Sell at East Hub: about +86 cr more than West".
- **Shortage alerts:** a feed card, plus a tag on the hub on the map ("SHORTAGE: POWER +40%, 3h left").

## Plain-language pros and cons

- **Pros:**
  - Real trade routes appear, so merchants get an identity.
  - Raiders get juicier targets, and the map has places worth fighting over.
  - Newcomers get another quick thing to do.
  - Shortage news gives players a reason to check in.
- **Cons:**
  - There's more to read: you compare prices across hubs, so the board must make it obvious.
  - It needs another balance round.
  - It adds a little more state and a new event.

## Versioning

- `RULES_VERSION` stays 3 until deploy. Nothing is live yet.
- Use the `SNAPSHOT_VERSION` upgrade pattern if new market state, such as shortages, is added to the snapshot.
