# Rewrite tracker

Live status for [`plan.md`](plan.md). Update this file in the same commit as the work.

**Status keys:**

- `todo`
- `doing`
- `done`: add the date and the short commit hash
- `blocked`: add the reason
- `owner`: needs the owner's decision

**Current phase:** 2 (server and persistence). A5 is still open.

## Phase A: Fresh public repository

| ID  | Task                                                                                                                                             | Status | Notes                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------- |
| A1  | Write plan, tracker, ADR 0030, root `CLAUDE.md` agent rules                                                                                      | done   | 2026-11-22                                                                                            |
| A2  | Archive the prototype: tag `prototype-final`, branch `legacy/prototype`                                                                          | done   | 2026-11-22                                                                                            |
| A3  | Rename the old repo to the private `nexum-city-prototype` and keep a local clone at `../nexum-city-prototype`                                    | done   | 2026-11-22                                                                                            |
| A4  | Create the new public `nexum-city` with only the rewrite docs; README; `.gitignore`                                                              | done   | 2026-11-22                                                                                            |
| A5  | Cloudflare teardown: delete the cron worker and the Pages project, then drop the D1 databases. There are no users. Check `wrangler whoami` first | done   | 2026-11-22: cron worker, Pages project (~750 deployments cleared first) and both D1 databases deleted |

## Phase 0: Skeleton, theme and UI kit

| ID  | Task                                                                                                                                      | Status | Notes                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------- |
| 01  | Lean CI workflow (`npm run check`, cached); root npm workspaces, TypeScript project references, ESLint, Prettier, Vitest, `npm run check` | done   | 2026-11-22, `1b88308`                         |
| 02  | `packages/theme`: tokens, CSS variable generator, Pixi palette, `--s` scale rules, high-contrast set                                      | done   | 2026-11-22, `1b88308`; rule #1                |
| 03  | Lint rule: no raw colour literals or px font sizes outside `packages/theme`                                                               | done   | 2026-11-22, `1b88308`; rule #1                |
| 04  | `apps/client` (Vite and React), with tokens injected at boot and live theme switching                                                     | done   | 2026-11-22 2637f15                            |
| 05  | UI kit components from the mockup, plus the `/kit` gallery page                                                                           | done   | 2026-11-22 2637f15, screenshot at 2560×1440   |
| 06  | `apps/server`: minimal Node server that serves the client, plus `/health`                                                                 | done   | 2026-11-22 743baf2; Hono, `/api/health`       |
| 07  | Dockerfile (multi-stage, small image) and `docker-compose.yml` (memory limit, SQLite volume); `docker compose up` works locally           | done   | 2026-11-22 743baf2; image 254 MB, ~20 MiB RAM |

## Phase 1: Simulation core

| ID  | Task                                                                                  | Status | Notes                  |
| --- | ------------------------------------------------------------------------------------- | ------ | ---------------------- |
| 11  | World model: district grid, street graph, hubs, frontier, ownership                   | done   | 2026-11-22, `59b7800`  |
| 12  | Seeded RNG and a deterministic step function, `(state, inputs, dt) -> state + events` | done   | 2026-11-22, `59b7800`  |
| 13  | Orders: move, haul, build, scout, stance; asset-limited                               | done   | 2026-11-22, `59b7800`  |
| 14  | Travel: carriers (on foot, van, hauler), routing, ETAs                                | done   | 2026-11-22, `59b7800`  |
| 15  | Production and warehouses                                                             | done   | 2026-11-22, `59b7800`  |
| 16  | Siege: a single capture bar with modifiers; garrison, walls and stance                | done   | 2026-11-22 (`45c2bed`) |
| 17  | Markets: a hub order book with civic baseline traders                                 | done   | 2026-11-22 (b365d99)   |
| 18  | Fog and sight                                                                         | done   | 2026-11-22 (`45c2bed`) |
| 19  | Season clock and district-hour scoring                                                | done   | 2026-11-22 (`45c2bed`) |
| 1A  | New-player placement on the frontier, with protection; city growth                    | done   | 2026-11-22 (`c7f9516`) |
| 1B  | Fast-forward harness: simulate N days, determinism test                               | done   | 2026-11-22 (`039e74d`) |

## Phase 2: Server and persistence

| ID  | Task                                                 | Status | Notes                                                                                  |
| --- | ---------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| 21  | SQLite schema and migrations                         | done   | 2026-11-22 `7d50fa8`                                                                   |
| 22  | Accounts and sessions                                | done   | 2026-11-22 `7d50fa8`                                                                   |
| 23  | Tick loop, with catch-up after downtime              | done   | 2026-11-22 `7d50fa8`                                                                   |
| 24  | Order API validated against `packages/contracts`     | done   | 2026-11-22 `7d50fa8`                                                                   |
| 25  | Per-player view (fog) and "while you were away" feed | done   | 2026-11-22 `7d50fa8`; view is an adapter until `viewFor` exists in the sim, no fog yet |
| 26  | Server-sent events, with a polling fallback          | done   | 2026-11-22 `7d50fa8`                                                                   |
| 27  | SQLite backups                                       | done   | 2026-11-22 `7d50fa8`                                                                   |

## Phase 3: The map

| ID  | Task                                                         | Status | Notes      |
| --- | ------------------------------------------------------------ | ------ | ---------- |
| 31  | Pixi renderer: districts, streets, hubs, fog (theme palette) | done   | 2026-11-22 |
| 32  | Pan, zoom, inertia; city, tactical and district zoom levels  | done   | 2026-11-22 |
| 33  | Minimap, recentre and jump-to, off-screen arrows             | done   | 2026-11-22 |
| 34  | Moving carriers, capture rings, price bars                   | done   | 2026-11-22 |
| 35  | District selection, radial menu, route preview with ETA      | done   | 2026-11-22 |

## Phase 4: HUD and first playable loop

| ID  | Task                                             | Status | Notes                |
| --- | ------------------------------------------------ | ------ | -------------------- |
| 41  | Top bar and season race                          | done   | 2026-11-22 (b7c350b) |
| 42  | "While you were away" feed                       | done   | 2026-11-22 (b7c350b) |
| 43  | District panel                                   | done   | 2026-11-22 (b7c350b) |
| 44  | Order confirm card, with carrier picker and odds | done   | 2026-11-22 (b7c350b) |
| 45  | Active orders timeline                           | done   | 2026-11-22 (adfd491) |
| 46  | Market panel                                     | done   | 2026-11-22 (adfd491) |
| 47  | Battle report and rival dossier                  | done   | 2026-11-22 (adfd491) |

## Phase 5: Bots and a living city

| ID  | Task                                                  | Status | Notes                |
| --- | ----------------------------------------------------- | ------ | -------------------- |
| 51  | Bot framework that uses the same order API as players | done   | 2026-11-22 (821095d) |
| 52  | Raider, Turtle and Merchant personalities             | done   | 2026-11-22 (821095d) |
| 53  | Frontier growth and arrival events                    | done   | 2026-11-22 (821095d) |
| 54  | Balance pass using the fast-forward harness           | done   | 2026-11-22 31f0c3e   |

## Phase 6: Test season and deploy

| ID  | Task                                                                                                                                                                                                                                                                                                    | Status | Notes                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------- |
| 61  | 7-day season, leaderboard, end and reset                                                                                                                                                                                                                                                                | done   | 2026-11-22 (d36b69c, 15cf709) |
| 62  | FlyWP "Docker Compose App → From GitHub" (repo `radialmonster/nexum-city`, branch `main`, `docker-compose.yml` at root), behind FlyWP Nginx. First verify whether FlyWP builds the repo (`build:`) or only pulls images; if it only pulls, publish the image to GHCR (needs owner OK to enable Actions) | todo   | domain is open decision #1    |
| 63  | Health check, restarts, logs, nightly backups                                                                                                                                                                                                                                                           | done   | 2026-11-22 (a03eb4a)          |
| 64  | Phone layout pass                                                                                                                                                                                                                                                                                       | done   | 2026-11-22 (c0212e8)          |

## Playtest findings

QA playthrough of the production build as a new player (2026-11-22). Fixed in the same pass: build blocker text names the shortfall, order cards pre-pick the first crew, a first-steps checklist, no favicon 404.

| ID  | Task                                                                                                                                       | Status | Notes                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ | --------------------------------------------- |
| P1  | Settle has no UI. The radial menu offers only siege and scout on a neutral plot, and the fogged view hides the frontier flag on seen plots | done   | Needs sim fog, contracts, menu, card, store   |
| P2  | Crews show as raw ids like c13 on order cards; use the friendly names                                                                      | done   |                                               |
| P3  | Siege odds line reads "About - to capture" when the enemy is fogged                                                                        | done   | Show an unknown marker instead of a bare dash |
| P4  | The HUD sector card overlaps the home plot at tactical zoom                                                                                | done   |                                               |
| P5  | Login screen has no one-line game blurb                                                                                                    | done   |                                               |
| P6  | Market inputs lack placeholders; no hint that bought goods land in the hub stash and must be hauled home                                   | done   |                                               |
| P7  | The radial menu stays open behind an order card                                                                                            | done   |                                               |
| P8  | The neutral tag style is inconsistent with other tags                                                                                      | done   |                                               |

## Log

- 2026-11-22: Playtest findings P1 to P8 fixed. Siege root cause: a crew was pre-ticked on the order card, so ticking "a crew" unticked it and LAY SIEGE went grey with only a small blocker line; the API and engine accepted the same order (202), so no request was sent. The card now outlines ticked crews, says "N crew picked" or "No crew picked: tick one above", and a test covers the card to API to engine path (server tests settle and siege through `/api/orders`). Settle now has a UI: `viewFor` exposes `open` and `settling` (owner and completion time only, no crew ids or start time) on seen plots, the map draws open plots (dashed accent) and settlements (dashed in the settler colour), the radial menu offers SETTLE, the card shows 60 supplies and 10 h from the balance, the timeline shows SETTLING, the feed words `settle.*` and the district panel says OPEN PLOT or BEING SETTLED. Also: crews read as "Crew N", "Odds unknown: scout first" under fog, the camera offsets for the HUD sector card, a login blurb, market placeholders, a hub-stash note and a HAUL HOME shortcut, the radial menu closes behind an order card, and an unclaimed plot gets the neutral tag.
- 2026-11-22: Playtest pass (new player, 2560/1920/390). Register, login, reload, logout/in, market, build, scout, feed events after a dev clock advance and /hall all work; no console errors beyond the expected logged-out 401. Added the dismissible first-steps checklist (localStorage), clearer build shortfall text, crew pre-pick on order cards and a favicon; the rest is under Playtest findings.

- 2026-11-22: Old repo renamed to the private `nexum-city-prototype`. This public repo was started fresh so Actions minutes are unlimited and the private docs stay private.
- 2026-11-22: Plan and tracker created. Owner approved: rewrite in this repo, keep docs and ADRs, archive the prototype under a tag, tear down Cloudflare (it has no users), host with Docker Compose on the FlyWP server. FlyWP can deploy a compose app straight from the GitHub repo, so `docker-compose.yml` lives at the repo root.
- 2026-11-22: Phase 0 tasks 01–03 done (`1b88308`). Root npm workspace with strict TypeScript project references, ESLint, Prettier, Vitest and `npm run check`; CI runs it on Node 22. `packages/theme` has the `neon` and `highContrast` token sets, the CSS variable and `--s` scale generators and the Pixi palette. The `nexum/no-raw-colors` ESLint rule (`tools/eslint-plugin-nexum`) and stylelint reject raw colours and px font sizes outside the theme. TypeScript is pinned to 6.0.x because typescript-eslint does not support TypeScript 7 yet.
- 2026-11-22: Phase 0 tasks 04–05 done (2637f15). `apps/client` is a Vite and React 19 app that injects the theme into a `<style>` element at boot, switches between `neon` and `highContrast` live, and has a user scale setting driving `--s-user`. The 13 UI kit components live in `apps/client/src/ui/` (CSS Modules, tokens only) and the `/kit` gallery shows every variant. `packages/theme` gained a `size` group (fixed component dimensions) and the `dangerSurface`, `track` and `trackLine` colours. Vitest now runs a `node` project and the jsdom `apps/client` project.
- 2026-11-22: Phase 0 tasks 06–07 done (743baf2). `apps/server` (`@nexum/server`) is a Hono server on `@hono/node-server`: zod-validated `PORT`/`DATA_DIR` config, `GET /api/health`, JSON 404 for unknown `/api` routes, the built client with an SPA fallback, one JSON log line per request and graceful SIGTERM/SIGINT shutdown. `src/game/` is the placeholder for the tick loop and SQLite. `npm run dev` runs the server and the Vite dev server (with an `/api` proxy) together. The multi-stage `Dockerfile` (node:22-alpine, production deps only, non-root `node` user, healthcheck) and `docker-compose.yml` (256 MB limit, `nexum-data` volume at `/app/data`) work locally: image 254 MB, about 20 MiB RAM idle, container healthy. `package-lock.json` was regenerated because the Alpine image's npm 10 rejected the old one.
- 2026-11-22: Phase 1 tasks 11–15 done (`59b7800`). `packages/sim` has the world model, a seeded RNG, an exact integer `step` (2 s ticks and one jump hash the same), the seven orders with typed validation, Dijkstra travel with ETAs, and production with warehouses. Siege, markets, fog, scoring and the frontier are left as extension points. Decisions are in `sim-spec.md`.
- 2026-11-22: Phase 2 tasks 21–27 done (`7d50fa8`). `apps/server/src/game/` persists the authoritative in-memory sim to SQLite (`node:sqlite`, WAL): numbered migrations, JSON snapshots every 5 minutes and on shutdown, an append-only `inputs` log replayed on boot, then a catch-up `step` to the wall clock. Accounts use scrypt with per-user salts and hashed httpOnly session cookies; auth routes are rate limited. New `packages/contracts` holds the zod schemas for every request, response and order. API: register/login/logout, `/me`, `/orders`, `/eta`, `/feed`, `/stream` (SSE with heartbeat and `Last-Event-ID` replay). Nightly `VACUUM INTO` backups keep 7. Restart recovery hashes identically to an uninterrupted run (tested). Docker: state and in-flight movements survive a container restart, about 25 MiB RAM idle.
- 2026-11-22: Phase A task A5 done. Cloudflare teardown complete: the cron worker, the Pages project and both D1 databases are deleted, and nothing named `nexum` remains on the account.
- 2026-11-22: Phase 1 tasks 16, 18, 19 done (`45c2bed`). Siege (one capture bar per district, walls, stance, attrition rounds, loot, building damage, retreat, `reinforce`, battle report), fog (`viewFor`, `sightOf`, last-known owners) and season scoring (exact district-hours, hourly `score.tick`, catch-up modifiers, `standings`). An even fight captures in about 10 h. 134 tests pass.
- 2026-11-22: sim-core merged into main (siege, fog and scoring). `packages/contracts` now mirrors the sim exactly (siege and reinforce orders, the `protected` error code, the new movement kinds, the fogged `PlayerView` and `Standing`; the compat test checks orders, events, movements, views and standings at compile time). The server uses the sim's `viewFor` for `/api/me` (the `viewForPlayer` adapter is gone, and a test proves a rival's warehouse and credits never appear), and `GET /api/standings` returns `standings(state)`. A new world now starts its season and first score tick at the wall-clock start time.
- 2026-11-22: Phase 3 tasks 31–35 done. `apps/client/src/map/` has the PixiJS v8 map at `/map`: a pure model-to-scene layer (`scene.ts`), camera maths with inertia, cursor-anchored wheel and pinch zoom and three animated levels (`camera.ts`), edge arrows (`offscreen.ts`), a demo world (`demo.ts`, `?large&reveal&zoom=city|tactical|district`) and the renderer, with the minimap, jump list, recentre, radial menu and route ETA built from the UI kit. Map geometry and thresholds are the new `map` token group in `packages/theme`. Logged in, it draws the fogged `PlayerView` from `/api/me` (remembered districts dimmed, convoys moving); route ETA needs the street graph, which only the demo has.
- 2026-11-22: Phase 1 task 17 done (b365d99). Hub order books with price-time priority, escrow, instant crossing and virtual civic traders at reference ±8% with hourly depth refill; `trade.filled` events; `viewFor` carries public books and your own orders. Tick and jump hash the same.
- 2026-11-22: Phase 1 task 1A done (`c7f9516`). Frontier plots along the city edge (surveyed 4 h, then opened with streets), reserve of `max(4, players/3)`, newcomers placed next to 2+ neutral districts far from rivals, relocation after losing the last district, `createWorld(seed, { startMs })` (server `genesis()` removed), `frontier.opened` and `player.joined` events, and the public street graph in `PlayerView`.
- 2026-11-22: Phase 1 task 1B done (`039e74d`). Scripted raider, turtle and merchant bots, `runSeason` and `replay`, `checkInvariants`, `npm run sim:season`. A 7-day season with 6 actors runs in about 170 ms with 12 captures, 84 fills and no invariant problems; the hash matches as one jump and in 60 s ticks (2 s ticks for the first 6 h). Balance findings (raiders dominate, no peaceful growth) are in sim-spec.
- 2026-11-22: sim perf. The deep JSON clone was about 95% of a no-event `step`. Quiet steps now copy only the districts and players that settle changes and share the rest, taking a no-event step on a 38-district, 6-player world from 0.055 ms to 0.004 ms with identical hashes (season `120411304821eb`, bench `034db79abb0362`). The siege determinism test is back on the default timeout. `npm run sim:bench`.
- 2026-11-22: Map polish toward the mockup. Tactical zoom frames about 35 plots at 1920 wide (minimum on-screen plot width tokens); the demo has six rival crews, neutral plots and is revealed by default; plots get faction borders and tints, chamfered corners, an inner glow, per-kind detail patterns (`detail.ts`) and an owner sub-label; the city level draws territory blobs with the Sound; labels follow on-screen size; phones get a compact layout with a districts drawer and a minimap toggle; the jump list scrollbar is themed and labels scale with `--s`.
- 2026-11-22: Phase 2 tasks 41 to 44 done (`b7c350b`). `/` is now the playable game: sign-in and register, typed API client parsed with the contract schemas, a game store, live updates over SSE with polling fallback, the top bar with the season race, the "While you were away" feed (fly to place, last-seen stored), the district panel (own detail, reduced view for others, stance, build) and the order confirm card (carrier and crew pickers, ETA, siege odds, plain-language rejections). Checked end to end with two players, a move and a siege, and at 2560, 1920 and 390 wide. The bottom timeline is still an empty slot.
- 2026-11-22: Phase 2 tasks 45 to 47 done (adfd491). Bottom orders timeline (one row per busy asset, axis from now to +4 h, recall), market panel (order book depth, civic price, fills sparkline, stash, open orders with cancel, limit order form with plain-language rejections, escrow line), battle report (feed events siege.captured and siege.broken) and rival dossier (from the district panel). Also: full-height framed feed and district columns, softer fog (name and kind of known plots stay visible, dimmed; ownership, garrison and stock stay hidden), per-player race bar segments, a tighter pan margin so the Sound is a strip. Checked end to end through the env-gated `DEV_SEED` routes (`/api/dev/seed`, `/api/dev/advance`). (The `combat.round` gap was closed in task 64.)
- 2026-11-22: Phase 4 tasks 51 to 53 done (821095d). Server bots (`apps/server/src/game/bots/`): a `bots` table, a check-in scheduler (a few seeded visits a day), the sim `BOTS` fed a fogged view through an adapter, orders through the normal order path and inputs log, personalities with crew names, roster of `BOT_COUNT` retiring to `BOT_MIN` as humans join (retired bots keep their districts), and public `player.joined` and `frontier.opened` events with crew, district and side in everyone's feed and the client feed text. A 3-day fake-clock game with 6 bots had 3 captures, 12 fills and no invariant problems. Gap: the sim bots do not check affordability, so about two thirds of their proposals are rejected `insufficient_goods`.
- 2026-11-22: Task 64 done (c0212e8). Fixed the stray straight red line (a PixiJS `arc()` joined from the previous path; now `moveTo` first), crew names via a validated `names` map on `/me` and `/standings`, a running siege card in the feed that opens the battle report, an empire summary when no district is selected, and the phone pass at 390 and 360 (ORDERS tab, solid control backing, panels over the map, 44 px `size.touch`). Checked at 2560, 1920, 390 and 360 against a seeded game. Gap: the order confirm card was not re-screenshotted on a phone.
- 2026-11-22: Phase 4 task 54 done (31f0c3e). Balance pass A+B+C from `balance-proposals.md`: a `settle` order (60 supplies, 10 h timer, first settler holds the plot, a siege can break it), neutral guard 10 to 20 and neutral loot 30% to 10%, and trade score (1 point per 100 credits of civic or player fills, 24 points per player per day, self-trades excluded). Bots check affordability (under 1% refused), turtles and merchants settle, raiders favour weaker players. Seeds 1 to 5: every bot type averages 3 or more districts (raider 4.4, turtle 4.4, merchant 3.4), raiders lead by about 1.17x, 5 player-vs-player captures, 0 invariant problems, a season runs in about 0.2 s. The season hash changed (seed 1: `1226f545`). Gaps: a turtle with no supplies never settles, `fog.ts` does not show `settling`, and the server's saved snapshots from before this change lack the new player trade fields. Owner can still review the numbers (open decision 7).
- 2026-11-22: Tasks 61 and 63 done (d36b69c, a03eb4a, 15cf709). Season end and reset (archive, new seed, accounts kept, season-end screen, `/hall`, finale chip), versioned snapshots with a rules-version policy (a rules change closes the season; old inputs are never replayed under new rules), `/api/health`, JSON tick summary and error logs with a tick loop that survives exceptions, `npm run backup` and a Restore section, and Docker restart, healthcheck, log rotation and a 256 MB limit. Verified with `docker compose up`: healthy, a restart kept the state, the backup ran, about 22 MiB used. Docker caught a crash on a very old volume (no `season` in the stored world), now logged and skipped. Gaps: registration is closed during the finale and the break, accounts with no free plot become `pending`, and screenshots at 2560, 1920 and a phone of the season-end screen were not taken.
- 2026-11-22: Polish pass from a 1920x1080 playtest screenshot (`3f1b077`, `203a572`, `c17818d`). Radial menu items spread wider with a panel-coloured backdrop behind each label (`neonSize.radial` 300 to 380); the "Select your district" step now completes whenever the player's own plot is selected (click, jump list, fly) and persists in localStorage; the Sound band is slimmer through map tokens `soundCity`, `soundPan` and `soundLabel`; rich-LOD plots get seeded per-plot footprints and lot lines (`lotDetail`, token-driven, at most 20 primitives, only drawn at the closest zoom). Turtle and merchant bots now buy and haul supplies before settling (strategy only; seeds 1 to 8 turtle average 3.13 to 3.31 districts, stuck turtles 11/16 to 4/16; raiders lead the best other type by about 1.1x; seed 1 hash `15b04693b956e0`). Gap: a radial on a top-row plot can overlap the sector panel.
