import { SCALE_USER_VAR, SCALE_VIEWPORT_VAR } from '@nexum/theme';

/**
 * The HUD scale (`--s`) as a plain number: the viewport step times the player's
 * setting. `--s` itself is an unresolved `calc()`, so the two parts are read and
 * multiplied. Used to size map labels and overlay offsets in step with the HUD.
 */
export function readHudScale(doc: Document = document): number {
  const cs = getComputedStyle(doc.documentElement);
  const num = (name: string): number => {
    const v = Number.parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(v) && v > 0 ? v : 1;
  };
  return num(SCALE_VIEWPORT_VAR) * num(SCALE_USER_VAR);
}
