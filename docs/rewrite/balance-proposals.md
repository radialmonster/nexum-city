# Balance proposals after the first season run

The season harness (task 1B, `npm run sim:season`) plays a 7-day season with 2 raider, 2 turtle and 2 merchant bots. This page lists what went wrong and the fixes proposed. **None of these are built yet.** They are waiting for the owner to decide; the table at the end is open decision #7 in [`plan.md`](plan.md).

## What the run showed

- **Raiders win easily.** They ended with 8 and 6 districts. The turtles and merchants never left their starting district.
- **Growth means war.** The only way to gain a district is a siege. A player who doesn't want to fight stays at one district all season.
- **Trade earns nothing.** The merchants sold over 3,000 units to the markets, and their score was the same as a turtle's.
- **Neutral plots are the cheapest target.** Most captures were unowned frontier plots guarded by only 10 strength.

## Proposals

### A. A "settle" order for open frontier plots

Send a crew plus a Hauler of supplies to an open frontier plot. After a few hours it becomes yours, and nobody has to fight.

- **Pros:** builders and traders get a way to grow. It turns the city's edge into a race. New players have something to do on day one besides attacking.
- **Cons:** the city could fill up quickly with weak, spread-out players. The settle cost needs tuning so that settling stays slower than raiding a weak neighbour.

### B. Make neutral districts harder to take

Raise the neutral guard (for example 10 → 25) and give a smaller loot share for neutral captures.

- **Pros:** raiders have to fight players, not farm empty land. That gives more stories and more drama.
- **Cons:** early expansion gets slower for everyone. On its own it doesn't help peaceful players.

### C. Trade counts toward score (open decision #4)

Score gets a small share of points per credit of trade, capped per day.

- **Pros:** a merchant can compete for the season without fighting, and markets matter.
- **Cons:** it can be farmed by trading back and forth with a friend. The cap and "only trades with civic traders or other players count" rules guard against that.

### D. Contracts at hubs

Hubs post delivery jobs ("50 power to Ember Market in 6 h") that pay credits plus score.

- **Pros:** they give haulers a reason to drive across the map, and convoys become targets for raids. The mockup already shows them.
- **Cons:** it's a new system to build. It probably belongs in milestone 2.

## Recommendation

Do **A + B** now. They are small rule changes, and the harness can confirm them in minutes. Add **C** with a daily cap. Leave **D** for milestone 2.

**Success target** for the next harness run: every bot type ends with at least 3 districts, and raiders still lead, but by less than 2×.
