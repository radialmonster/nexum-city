# Nexum City

An asynchronous cyberpunk city-war strategy game for the browser. Players check in a few times a day, catch up on what happened while they were away, and issue orders that play out over minutes and hours:

- move crews;
- haul goods across the city;
- trade on hub markets;
- build up districts;
- lay siege to rivals.

The city grows as new players arrive.

**Status:** early rewrite. Nothing playable yet.

- Design: [`docs/design/rewrite-design.md`](docs/design/rewrite-design.md)
- Visual mockup: [`docs/design/rewrite-mockup.html`](docs/design/rewrite-mockup.html). Download it and open it in a browser.
- Plan and progress: [`docs/rewrite/plan.md`](docs/rewrite/plan.md) and [`docs/rewrite/tracker.md`](docs/rewrite/tracker.md)
- Decisions: [`docs/decisions/`](docs/decisions/)

## Stack

- **Language:** TypeScript throughout.
- **Server:** one Node process with SQLite, which serves the client, the API and the game tick.
- **Client:** React for the HUD and PixiJS for the map, both styled from a single theme token package.
- **Hosting:** self-hosted with Docker Compose.

## Licence

Copyright © 2026 radialmonster. All rights reserved. The source is visible for reference, but no licence to use, copy or redistribute it is granted.
