/**
 * The newcomer's first minute: where the camera starts and how the first checklist step names
 * the home plot. Pure, so the logic is testable without a renderer.
 */

/** The hint for the "select your district" step, naming the plot when we know it. */
export function homeHint(name: string | null): string {
  return name
    ? `Your district is ${name}, the pulsing plot. Click it, or press RECENTRE.`
    : 'Click your pulsing plot on the map to see its crews and goods.';
}

/**
 * Should the camera fly to the player's own plots now? Once only: when they first appear in the
 * scene after the first frame was framed without them, and never after the player moved the
 * camera themselves.
 */
export function needsHomeCentre(s: {
  /** The camera has already been framed on the player's plots. */
  readonly centred: boolean;
  readonly hasMine: boolean;
  /** The camera differs from the one the renderer started with: the player has moved it. */
  readonly moved: boolean;
}): boolean {
  return !s.centred && s.hasMine && !s.moved;
}
