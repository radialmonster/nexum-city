/** First-time-player checklist: which steps are done and whether it was dismissed. */

export const FIRST_STEPS_KEY = 'nexum.firstSteps';

export interface FirstStepsState {
  readonly dismissed: boolean;
  /** Steps are sticky: once seen done they stay done, even if the world view changes later. */
  readonly selectedHome: boolean;
  readonly settled: boolean;
  readonly openedMarket: boolean;
  readonly tookContract: boolean;
}

export const FRESH_STEPS: FirstStepsState = {
  dismissed: false,
  selectedHome: false,
  settled: false,
  openedMarket: false,
  tookContract: false,
};

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Saved per player, so a second account in the same browser starts its own list. */
export const stepsKey = (playerId: string | undefined): string =>
  playerId ? `${FIRST_STEPS_KEY}.${playerId}` : FIRST_STEPS_KEY;

/** Read the saved state; any storage failure or bad data gives the fresh state. */
export function loadFirstSteps(
  playerId?: string,
  store: Store | null = defaultStore(),
): FirstStepsState {
  try {
    const raw = store?.getItem(stepsKey(playerId));
    if (!raw) return FRESH_STEPS;
    const v = JSON.parse(raw) as Partial<Record<keyof FirstStepsState, unknown>>;
    return {
      dismissed: v.dismissed === true,
      selectedHome: v.selectedHome === true,
      settled: v.settled === true,
      openedMarket: v.openedMarket === true,
      tookContract: v.tookContract === true,
    };
  } catch {
    return FRESH_STEPS;
  }
}

export function saveFirstSteps(
  s: FirstStepsState,
  playerId?: string,
  store: Store | null = defaultStore(),
): void {
  try {
    store?.setItem(stepsKey(playerId), JSON.stringify(s));
  } catch {
    // Storage can be blocked; the checklist just comes back next visit.
  }
}

/** Fold what the world shows right now into the saved state; true flags never go back to false. */
export function mergeSteps(
  saved: FirstStepsState,
  live: Partial<Omit<FirstStepsState, 'dismissed'>>,
): FirstStepsState {
  return {
    ...saved,
    selectedHome: saved.selectedHome || live.selectedHome === true,
    settled: saved.settled || live.settled === true,
    openedMarket: saved.openedMarket || live.openedMarket === true,
    tookContract: saved.tookContract || live.tookContract === true,
  };
}
