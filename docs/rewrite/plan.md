# Rewrite plan

How we turn the design (`docs/design/rewrite-design.md`) and the mockup
(`docs/design/rewrite-mockup.html`) into a playable game. Progress is tracked in
[`tracker.md`](tracker.md). The decision to rewrite is recorded in
[ADR 0030](../../docs/decisions/0030-rewrite-self-hosted-typescript.md).

- **Owner:** radialmonster
- **Started:** 2026-11-22
- **Status:** Phase 0 (skeleton, theme and UI kit); Phase A task A5 is still open

## Goal

A self-hosted, graphical, asynchronous city-war game. Players check in a few times
a day for about 15 minutes, read what happened while they were away, and issue
orders that resolve over minutes and hours: move crews, haul goods, trade,
build, siege and scout. The first public target is **milestone 1** from the
design doc: one 7-day test season on a growing city with 3 bots.

## Ground rules

These apply to every phase, and to every agent working on the rewrite.

1. **Theme system, no hard-coded styles (owner rule #1).**
   - All colours, fonts, sizes, spacing, glows, borders and timings live in `packages/theme`.
   - The HUD (CSS custom properties) and the map renderer (numeric colours) both read from that package.
   - Components use tokens only. A lint rule rejects raw colour literals outside the theme.
   - Screens are built from the shared UI kit.
2. **The server is authoritative.** The client proposes; the server validates and decides. Inputs are validated at the API boundary with shared schemas.
3. **The simulation is deterministic and pure.** `packages/sim` has no I/O, no wall clock and no randomness except a seeded RNG passed in. The same state plus the same inputs gives the same result, so a whole season can be replayed in tests.
4. **Asynchronous by design.** No feature may require two players to be online together. Timers run in minutes to hours, offline defence works, and every visit starts with "while you were away".
5. **Fluid, large-screen-first UI.** Check every screen at 2560×1440 as well as 1920×1080 and on a phone. Text scales with the `--s` scale token.
6. **Docs stay fresh.** Every change updates the design doc, this plan, the tracker or an ADR in the same commit when behaviour or a decision changes. Subagents must do the same.
7. **Small footprint.** One Node process plus SQLite, under about 256 MB of RAM in the container.
8. **`npm run check` is green before every push.** That covers lint, format, types, tests and build.

## Target layout

```
packages/
  theme/        design tokens -> CSS variables + map palette (rule #1)
  sim/          pure game rules: world, streets, orders, travel, production,
                warehouses, sieges, markets, bots, scoring; seeded RNG
  contracts/    shared Zod schemas for API requests, responses and events
apps/
  server/       Node (Hono or Fastify) + SQLite: accounts, tick loop, API,
                server-sent events, persistence, bot runner, static client
  client/       Vite + React HUD (UI kit) + PixiJS map
tools/          repo tooling: the nexum ESLint plugin (no-raw-colors), lint fixtures
docs/design/    design doc + mockup (the visual target)
docs/rewrite/   this plan + tracker
docs/decisions/ ADRs (0030 onward; 0001–0029 live in the private prototype repo)
Dockerfile, docker-compose.yml
```

There is one npm workspace at the root (`packages/*`, `apps/*`). `npm run check` runs lint (ESLint and stylelint), format check (Prettier), typecheck (`tsc -b` over the TypeScript project references), tests (Vitest) and build across all workspaces. CI (`.github/workflows/ci.yml`) runs `npm ci && npm run check` on Node 22.

## Phases

Each phase ends with something you can open, run or test. Tasks and their status are in the tracker.

### Phase A: Fresh public repository

- The old repository was renamed to the private `nexum-city-prototype`. It keeps the prototype code, the full history, the tag `prototype-final`, the branch `legacy/prototype`, the product notes and ADRs 0001–0029.
- This repository, `nexum-city`, is new and **public**, which gives unlimited GitHub Actions minutes. It starts with only the rewrite design, the mockup, the plan, the tracker, ADR 0030 and the agent rules. All rights are reserved; there is no open-source licence.
- Tear down the Cloudflare deployment, which has no users: delete the cron worker and the Pages project, then drop the D1 databases.

**Done when:** the public repo holds only the new material and nothing is still running on Cloudflare.

### Phase 0: Skeleton, theme and UI kit

- A lean CI workflow: `npm run check` on pull requests and pushes to `main`, with caching.
- Set up the npm workspaces, TypeScript project references, ESLint (including the no-raw-colour rule), Prettier, Vitest and `npm run check`.
- `packages/theme`:
  - token object with colours, faction roles, type scale, spacing, radii, glows and motion;
  - CSS variable generator;
  - Pixi palette export;
  - scale (`--s`) rules;
  - a second token set, high contrast, to prove themes can be swapped.
- `apps/client` UI kit, rebuilt from the mockup: Panel, Chip, Bar, Button, Tag, Toast, Ribbon, TimelineRow, Gauge, Sparkline, RadialMenu, Tabs and Stance switch.
- A `/kit` gallery page.
- A minimal `apps/server` that serves the client, plus `/health`.
- A Dockerfile and `docker-compose.yml` with a memory limit and a volume for the SQLite file. The container must run locally.

**Done when:** the `/kit` page looks like the mockup's lower section, the theme can be swapped live, and `docker compose up` serves it.

### Phase 1: Simulation core

- World model:
  - districts on a grid;
  - a street graph;
  - hubs and the frontier;
  - ownership;
  - fog and sight rules.
- Orders: move, haul, trade, build, siege, scout and stance. Each order is limited by the assets it uses: crews and carriers.
- Travel times by carrier and route, with arrival events.
- Production into district warehouses, plus warehouse capacity.
- One capture bar per siege, with clear modifiers (stance, walls, strength).
- A city market per hub: an order book with civic baseline traders.
- Season clock and district-hour scoring.
- New player placement on the frontier, with protection, and city growth (ADR 0028 still applies: there is no privileged home district).
- A fast-forward harness that simulates N days for the whole city in a test.

**Done when:** tests show a simulated week with scripted players producing sensible captures, trades and scores, and replays are deterministic.

### Phase 2: Server and persistence

- SQLite schema and migrations. The world state is stored in SQLite and the simulation runs on it in memory.
- Accounts: username and password, sessions.
- A tick loop that runs every few seconds and catches up after downtime.
- An order API that checks requests against `packages/contracts`.
- A per-player view: what they can see through fog, and their "while you were away" event feed.
- Server-sent events for live updates while a tab is open, with polling as a fallback.
- Backups of the SQLite file.

**Done when:** a scripted HTTP client can register, issue orders and watch them resolve on a local server.

### Phase 3: The map

- A PixiJS city renderer driven by the theme's palette:
  - district silhouettes and textures;
  - streets;
  - hubs with price bars;
  - fog levels;
  - capture rings;
  - moving carriers.
- Pan, zoom and inertia, with three zoom levels: city, tactical and district.
- Level of detail by on-screen plot size, per-kind inner patterns, rival faction territories in the demo, and a phone layout with drawers.
- Minimap with a viewport rectangle, recentre and jump-to, and off-screen alert arrows.
- Select a district. A radial menu opens. Route preview with an ETA.

**Done when:** you can fly around a live, growing city at 60 fps on the owner's monitor and select districts.

### Phase 4: The HUD and the first playable loop

- Top bar: resources and the season race.
- "While you were away" feed.
- District panel: production, warehouse, buildings, crews and carriers, stance.
- Order confirm card with a carrier picker and odds.
- Active orders timeline.
- Market panel: order book, sparkline, buy and sell.
- Battle report and rival dossier.

**Done when:** the owner can play a real 15-minute visit: catch up, attack, haul, trade and build, then come back later to the results.

### Phase 5: Bots and a living city

- Bot personalities: Raider, Turtle and Merchant, the milestone-1 set. They run inside the tick using the same order API as players.
- Frontier growth and new-player arrivals, with an event on the map.
- Balance pass with the fast-forward harness.

**Done when:** a city with only bots plays a full simulated season with readable, varied outcomes.

### Phase 7: Milestone 2 mechanics

- Raids and escorts (task 71, sim, contracts and bots done; `RULES_VERSION` 2). Then the raids UI (72), contracts board (73), Runner carrier (74), Watchtower and Garage (75) and a Hunter bot (76). Planned next: a supply-and-demand economy (79 to 82), see [economy-plan.md](economy-plan.md). Rows are in the tracker.

### Phase 6: Test season and deploy

- 7-day test season, leaderboard, season end and reset (done, task 61).
- Deploy to the owner's FlyWP server as a Docker Compose app behind FlyWP's Nginx. FlyWP's "From GitHub" option reads `docker-compose.yml` from the root of this repo on a chosen branch, so the compose file must be production-ready at the root. Check whether FlyWP builds images from the repo or needs a published image (GHCR). The domain is to be decided.
- Logs, a health check, automatic restart, nightly SQLite backups.
- Phone layout pass.

**Done when:** the owner plays a real season from any device.

### After milestone 1

These are milestones 2 and 3 in the design doc:

- raids and escorts;
- Runner carrier;
- contracts;
- Watchtower and Garage;
- animated replay;
- push notifications;
- fourth bot (Hunter);
- carrier upgrades;
- diplomacy;
- later, clans and cartels.

## Working method

- Each task in the tracker is small enough for one agent run.
- Agents run back-to-back, and each is checked before the next starts. The owner's hourly session structure still applies.
- Every task ends with:
  - `npm run check` green;
  - docs updated;
  - for UI tasks, a screenshot at 2560×1440;
  - the tracker updated with the date and the commit.
- Commits are small and conventional: `feat:`, `fix:`, `docs:`, `chore:`.

## Open decisions

| #   | Question                                                                                                                                                                                                                            | Needed by       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | Domain or subdomain for the game                                                                                                                                                                                                    | Phase 6         |
| 2   | Timer lengths (travel 15–90 min, captures 6–12 h, builds 1–8 h)                                                                                                                                                                     | Phase 1 tuning  |
| 3   | Goods list: parts, power, data and supplies, plus credits                                                                                                                                                                           | Phase 1         |
| 4   | Does trade volume count toward season score?                                                                                                                                                                                        | Phase 1 scoring |
| 5   | Bot flavour: names, faces, voice                                                                                                                                                                                                    | Phase 5         |
| 6   | Hono or Fastify. Default: Hono (smaller), unless a need for Fastify comes up                                                                                                                                                        | Phase 0         |
| 7   | Balance after the first season run: settle order, tougher neutrals, trade score. **Decided and built (task 54)** by the owner's "fun first" direction; the owner can still review. See [balance-proposals.md](balance-proposals.md) | Phase 5 (bots)  |
