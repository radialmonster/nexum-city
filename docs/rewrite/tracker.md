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
| 1B  | Fast-forward harness: simulate N days, determinism test                               | done   | 2026-11-22 (`HASH1B`)  |

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

| ID  | Task                                                         | Status | Notes |
| --- | ------------------------------------------------------------ | ------ | ----- |
| 31  | Pixi renderer: districts, streets, hubs, fog (theme palette) | todo   |       |
| 32  | Pan, zoom, inertia; city, tactical and district zoom levels  | todo   |       |
| 33  | Minimap, recentre and jump-to, off-screen arrows             | todo   |       |
| 34  | Moving carriers, capture rings, price bars                   | todo   |       |
| 35  | District selection, radial menu, route preview with ETA      | todo   |       |

## Phase 4: HUD and first playable loop

| ID  | Task                                             | Status | Notes |
| --- | ------------------------------------------------ | ------ | ----- |
| 41  | Top bar and season race                          | todo   |       |
| 42  | "While you were away" feed                       | todo   |       |
| 43  | District panel                                   | todo   |       |
| 44  | Order confirm card, with carrier picker and odds | todo   |       |
| 45  | Active orders timeline                           | todo   |       |
| 46  | Market panel                                     | todo   |       |
| 47  | Battle report and rival dossier                  | todo   |       |

## Phase 5: Bots and a living city

| ID  | Task                                                  | Status | Notes |
| --- | ----------------------------------------------------- | ------ | ----- |
| 51  | Bot framework that uses the same order API as players | todo   |       |
| 52  | Raider, Turtle and Merchant personalities             | todo   |       |
| 53  | Frontier growth and arrival events                    | todo   |       |
| 54  | Balance pass using the fast-forward harness           | todo   |       |

## Phase 6: Test season and deploy

| ID  | Task                                                                                                                                                                                                                                                                                                    | Status | Notes                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------- |
| 61  | 7-day season, leaderboard, end and reset                                                                                                                                                                                                                                                                | todo   |                            |
| 62  | FlyWP "Docker Compose App → From GitHub" (repo `radialmonster/nexum-city`, branch `main`, `docker-compose.yml` at root), behind FlyWP Nginx. First verify whether FlyWP builds the repo (`build:`) or only pulls images; if it only pulls, publish the image to GHCR (needs owner OK to enable Actions) | todo   | domain is open decision #1 |
| 63  | Health check, restarts, logs, nightly backups                                                                                                                                                                                                                                                           | todo   |                            |
| 64  | Phone layout pass                                                                                                                                                                                                                                                                                       | todo   |                            |

## Log

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
- 2026-11-22: Phase 1 task 17 done (b365d99). Hub order books with price-time priority, escrow, instant crossing and virtual civic traders at reference ±8% with hourly depth refill; `trade.filled` events; `viewFor` carries public books and your own orders. Tick and jump hash the same.
- 2026-11-22: Phase 1 task 1A done (`c7f9516`). Frontier plots along the city edge (surveyed 4 h, then opened with streets), reserve of `max(4, players/3)`, newcomers placed next to 2+ neutral districts far from rivals, relocation after losing the last district, `createWorld(seed, { startMs })` (server `genesis()` removed), `frontier.opened` and `player.joined` events, and the public street graph in `PlayerView`.
- 2026-11-22: Phase 1 task 1B done (`HASH1B`). Scripted raider, turtle and merchant bots, `runSeason` and `replay`, `checkInvariants`, `npm run sim:season`. A 7-day season with 6 actors runs in about 170 ms with 12 captures, 84 fills and no invariant problems; the hash matches as one jump and in 60 s ticks (2 s ticks for the first 6 h). Balance findings (raiders dominate, no peaceful growth) are in sim-spec.
