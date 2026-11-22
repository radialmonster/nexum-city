# @nexum/theme

The one place where Nexum City's colours, fonts, sizes, spacing, glows, borders
and timings are defined (owner rule #1). Everything else reads tokens from here:

- **HUD (React, CSS):** `toCssVariables(theme)` writes every token as a custom
  property (`--color-accent`, `--font-size-md`, `--glow-panel`, …), and
  `scaleCss(theme)` writes the `--s` scale and its media queries. Components
  refer to tokens with `cssVar('color.accent')`, which is type-checked against
  the token names, or with `var(--color-accent)` in CSS.
- **Map (PixiJS):** `toPixiPalette(theme)` returns the same colours as numbers,
  `{ color: 0x19f0ff, alpha: 1 }`, plus glow layers and font stacks.

ESLint (`nexum/no-raw-colors`) and stylelint reject raw colours and px font
sizes everywhere outside this package.

## Token groups

| Group                                     | Units             | CSS name example        |
| ----------------------------------------- | ----------------- | ----------------------- |
| `color`                                   | `#rrggbb[aa]`     | `--color-text-dim`      |
| `faction`                                 | `#rrggbb[aa]`     | `--faction-raider`      |
| `font`                                    | font stack        | `--font-mono`           |
| `fontSize`, `space`, `radius`             | px at `--s: 1`    | `calc(13px * var(--s))` |
| `fontWeight`, `lineHeight`, `z`           | unitless          | `--z-modal`             |
| `letterSpacing`                           | em                | `--letter-spacing-wide` |
| `border`, `blur`                          | px (not scaled)   | `--border-thin`         |
| `glow`, `shadow`                          | box-shadow layers | `--glow-panel`          |
| `textGlow`                                | text-shadow       | `--text-glow-accent`    |
| `duration`                                | ms                | `--duration-pulse`      |
| `easing`                                  | timing function   | `--easing-standard`     |
| `scale` (not a variable group; see `--s`) | viewport steps    | `--s`, `--s-viewport`   |

Faction colours are keyed by **role** (`self`, `raider`, `turtle`, `merchant`,
`hunter`, `newcomer`, `neutral`, `rival`), never by a particular crew.

`--s` is `--s-viewport × --s-user`. The viewport part steps up on big screens
(1.2 from 1800×1150, 1.4 from 2200×1300, 1.7 from 2900×1550, 2 from 3500×1900);
`--s-user` is the player's own setting, set inline on `<html>`.

## Changing a token

Edit its value in `src/neon.ts` (the default theme). Other themes inherit it
unless they override it.

## Adding a token

1. Add the key to the right group in `src/neon.ts`. The `Theme` type is derived
   from these objects, so the new key exists everywhere at once and
   `cssVar('group.newKey')` type-checks.
2. If another theme needs a different value, override it in that theme.
3. Run `npm run check`. The tests confirm every token becomes a CSS variable and
   that all themes share the same keys.

Prefer semantic names (`danger`, `textDim`) over swatch names (`red`, `grey`).

## Adding a theme

Build it from an existing theme, overriding only what changes:

```ts
export const colorBlindSafe = createTheme(neon, "colorBlindSafe", {
  faction: { raider: "#…", merchant: "#…" },
});
```

Then add it to `themes` in `src/themes.ts`, so the tests cover it. Use
`withAlpha(color, 0.3)` for translucent colours. Colours must be lowercase
`#rrggbb` or `#rrggbbaa`.
