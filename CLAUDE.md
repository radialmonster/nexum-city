# Nexum City: agent rules

Nexum City is being rewritten. The source of truth is:

- design: `docs/design/rewrite-design.md`
- visual target: `docs/design/rewrite-mockup.html`
- plan: `docs/rewrite/plan.md`
- progress: `docs/rewrite/tracker.md`
- decisions: `docs/decisions/`, starting with ADR 0030

**This repository is public.** The prototype, its history, and the private docs (product notes, ADRs 0001–0029, research) are in the private `radialmonster/nexum-city-prototype` repo (local clone: `../nexum-city-prototype`). Read them there for reference, and never copy private material into this repo.

## Rules

1. **Theme system: no hard-coded styles.** Colours, fonts, sizes, spacing, glows, borders and timings come from `packages/theme` tokens. This applies to React components (CSS variables) and to the PixiJS map (palette export) alike. Build screens from the UI kit; do not style things ad hoc.
2. **The server is authoritative.** Validate every input against the `packages/contracts` schemas.
3. **`packages/sim` is pure and deterministic.** It does no I/O, never reads the wall clock and uses only the seeded RNG.
4. **The game is asynchronous.** Never design something that needs players online at the same time.
5. **UI is fluid and large-screen first.** Check screenshots at 2560×1440, 1920×1080 and on a phone.
6. **Update docs in the same change:** the design doc, plan, tracker, ADRs and comments.
7. **Run `npm run check` green before every push.** Use small conventional commits.
8. **Never commit secrets** (`.env`, `.dev.vars`, credentials). Do not put server names, IPs, emails or private business details in the repo; everything here is public.
9. **Leave the owner's local files alone:** `loop.*`, `steer-loop.ps1`, `nextsessionprompt.md*`.
