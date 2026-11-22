# Rewrite tracker

Live status for [`plan.md`](plan.md). Update this file in the same commit as the work.

**Status keys:**

- `todo`
- `doing`
- `done`: add the date and the short commit hash
- `blocked`: add the reason
- `owner`: needs the owner's decision

**Current phase:** 0 (skeleton, theme and UI kit). A5 is still open.

## Phase A: Fresh public repository

| ID  | Task                                                                                                                                             | Status | Notes      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- |
| A1  | Write plan, tracker, ADR 0030, root `CLAUDE.md` agent rules                                                                                      | done   | 2026-11-22 |
| A2  | Archive the prototype: tag `prototype-final`, branch `legacy/prototype`                                                                          | done   | 2026-11-22 |
| A3  | Rename the old repo to the private `nexum-city-prototype` and keep a local clone at `../nexum-city-prototype`                                    | done   | 2026-11-22 |
| A4  | Create the new public `nexum-city` with only the rewrite docs; README; `.gitignore`                                                              | done   | 2026-11-22 |
| A5  | Cloudflare teardown: delete the cron worker and the Pages project, then drop the D1 databases. There are no users. Check `wrangler whoami` first | todo   |            |

## Phase 0: Skeleton, theme and UI kit

| ID  | Task                                                                                                                                      | Status | Notes                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------ |
| 01  | Lean CI workflow (`npm run check`, cached); root npm workspaces, TypeScript project references, ESLint, Prettier, Vitest, `npm run check` | done   | 2026-11-22, `1b88308`          |
| 02  | `packages/theme`: tokens, CSS variable generator, Pixi palette, `--s` scale rules, high-contrast set                                      | done   | 2026-11-22, `1b88308`; rule #1 |
| 03  | Lint rule: no raw colour literals or px font sizes outside `packages/theme`                                                               | done   | 2026-11-22, `1b88308`; rule #1 |
| 04  | `apps/client` (Vite and React), with tokens injected at boot and live theme switching                                                     | todo   |                                |
| 05  | UI kit components from the mockup, plus the `/kit` gallery page                                                                           | todo   | screenshot at 2560×1440        |
| 06  | `apps/server`: minimal Node server that serves the client, plus `/health`                                                                 | todo   | Hono by default                |
| 07  | Dockerfile (multi-stage, small image) and `docker-compose.yml` (memory limit, SQLite volume); `docker compose up` works locally           | todo   |                                |

## Phase 1: Simulation core

| ID  | Task                                                                                  | Status | Notes                  |
| --- | ------------------------------------------------------------------------------------- | ------ | ---------------------- |
| 11  | World model: district grid, street graph, hubs, frontier, ownership                   | done   | 2026-11-22, `59b7800`  |
| 12  | Seeded RNG and a deterministic step function, `(state, inputs, dt) -> state + events` | done   | 2026-11-22, `59b7800`  |
| 13  | Orders: move, haul, build, scout, stance; asset-limited                               | done   | 2026-11-22, `59b7800`  |
| 14  | Travel: carriers (on foot, van, hauler), routing, ETAs                                | done   | 2026-11-22, `59b7800`  |
| 15  | Production and warehouses                                                             | done   | 2026-11-22, `59b7800`  |
| 16  | Siege: a single capture bar with modifiers; garrison, walls and stance                | done   | 2026-11-22 (`45c2bed`) |
| 17  | Markets: a hub order book with civic baseline traders                                 | todo   |                        |
| 18  | Fog and sight                                                                         | done   | 2026-11-22 (`45c2bed`) |
| 19  | Season clock and district-hour scoring                                                | done   | 2026-11-22 (`45c2bed`) |
| 1A  | New-player placement on the frontier, with protection; city growth                    | todo   | ADR 0028               |
| 1B  | Fast-forward harness: simulate N days, determinism test                               | todo   |                        |

## Phase 2: Server and persistence

| ID  | Task                                                 | Status | Notes |
| --- | ---------------------------------------------------- | ------ | ----- |
| 21  | SQLite schema and migrations                         | todo   |       |
| 22  | Accounts and sessions                                | todo   |       |
| 23  | Tick loop, with catch-up after downtime              | todo   |       |
| 24  | Order API validated against `packages/contracts`     | todo   |       |
| 25  | Per-player view (fog) and "while you were away" feed | todo   |       |
| 26  | Server-sent events, with a polling fallback          | todo   |       |
| 27  | SQLite backups                                       | todo   |       |

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
- 2026-11-22: Phase 1 tasks 11–15 done (`59b7800`). `packages/sim` has the world model, a seeded RNG, an exact integer `step` (2 s ticks and one jump hash the same), the seven orders with typed validation, Dijkstra travel with ETAs, and production with warehouses. Siege, markets, fog, scoring and the frontier are left as extension points. Decisions are in `sim-spec.md`.
- 2026-11-22: Phase 1 tasks 16, 18, 19 done (`45c2bed`). Siege (one capture bar per district, walls, stance, attrition rounds, loot, building damage, retreat, `reinforce`, battle report), fog (`viewFor`, `sightOf`, last-known owners) and season scoring (exact district-hours, hourly `score.tick`, catch-up modifiers, `standings`). An even fight captures in about 10 h. 134 tests pass.
