# game

The simulation tick loop and the SQLite persistence layer plug in here (Phase 2, tasks 21 and 23).
`packages/sim` stays pure; this folder owns the I/O around it: the wall clock, the database and
catch-up after downtime. Mount the game API routes in `../app.ts` and stop the tick and close the
database in `shutdown()` in `../main.ts`.
