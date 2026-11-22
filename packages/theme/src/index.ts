/**
 * @nexum/theme: the single source of every colour, font, size, spacing value,
 * glow, border and timing in Nexum City (owner rule #1). The HUD reads CSS
 * custom properties from `toCssVariables`; the PixiJS map reads `toPixiPalette`.
 */
export { isColorValue, parseColor, toCssRgba, withAlpha } from './color.js';
export type { ColorValue, ParsedColor } from './color.js';
export { createTheme, highContrast, neon, themes } from './themes.js';
export type { ThemeName } from './themes.js';
export {
  SCALE_USER_VAR,
  SCALE_VAR,
  SCALE_VIEWPORT_VAR,
  TOKEN_GROUPS,
  cssVar,
  cssVarName,
  scaleCss,
  toCssVariableEntries,
  toCssVariables,
} from './css.js';
export type { TokenKey } from './css.js';
export { toPixiPalette } from './pixi.js';
export type { PixiColor, PixiGlowLayer, PixiPalette } from './pixi.js';
export type * from './types.js';
