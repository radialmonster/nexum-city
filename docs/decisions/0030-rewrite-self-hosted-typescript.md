# 0030: Rewrite as a graphical, self-hosted TypeScript game

## Context

The prototype (React, Cloudflare Pages Functions, D1 and a cron worker) proved the concept: an asynchronous city war with travel times, physical goods transport and real markets. But it plays as a set of text screens, and its mechanics grew layered and hard to read: rings, influence gates, containers and fabrication chains. The owner judged it "not a good game" and chose to rewrite it from scratch. Nobody uses the Cloudflare deployment.

## Decision

1. **Rewrite in a fresh public repository.**
   - The original repository was renamed to the private `nexum-city-prototype`. It keeps the prototype code, the full history (tag `prototype-final`, branch `legacy/prototype`), the product notes and ADRs 0001–0029.
   - This public `nexum-city` repository starts with only the rewrite design and plan. Going public gives unlimited GitHub Actions minutes without drawing on the owner's shared private-repo allowance. All rights are reserved.
   - ADR 0028 (no privileged home district) carries over, as does the expanding-city direction.
2. **The design target** is `docs/design/rewrite-design.md` and `docs/design/rewrite-mockup.html`:
   - a map-first cyberpunk command interface;
   - orders that resolve over minutes or hours, alongside instant actions;
   - one capture bar per siege;
   - district warehouses and carriers;
   - hub markets;
   - bot personalities;
   - a growing city with pan and zoom.
3. **The stack is TypeScript everywhere:**
   - a pure, deterministic simulation package;
   - shared Zod contracts;
   - one Node server (Hono by default) that serves the static client, the API, server-sent events and the tick loop;
   - SQLite;
   - a client built with React (HUD) and PixiJS (map).
4. **Hosting:** self-hosted as a Docker Compose app on the owner's FlyWP-managed server, behind FlyWP's Nginx, with a container memory limit of about 256 MB. The Cloudflare Pages project, the cron worker and the D1 databases are torn down.
5. **The theme system is mandatory (owner rule #1).** All visual values are tokens in `packages/theme`. Both the HUD and the map renderer consume them, and a lint rule enforces this.

## Consequences and trade-offs

- **Gains:**
  - one language, one process and one database file;
  - deterministic replays for balance testing;
  - no vendor platform limits.
- **Costs:**
  - we run our own server: backups, restarts and TLS (FlyWP handles TLS);
  - SQLite allows only a single writer, which is fine at this scale. Postgres is the upgrade path.
- **Lost:** the prototype's D1 data, which held no real players. ADRs 0001 (Cloudflare and D1) and prototype-specific mechanics ADRs are superseded where they conflict.
- **Plan and progress:** `docs/rewrite/plan.md` and `docs/rewrite/tracker.md`.

## Date and owner

2026-11-22, radialmonster.
