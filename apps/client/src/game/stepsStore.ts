/** First-time-player checklist: which steps are done and whether it was dismissed. */

export const FIRST_STEPS_KEY = 'nexum.firstSteps';

export interface FirstStepsState {
  readonly dismissed: boolean;
  /** Steps the game cannot see from the world view, remembered once they happen. */
  readonly selectedHome: boolean;
  readonly openedMarket: boolean;
}

export const FRESH_STEPS: FirstStepsState = {
  dismissed: false,
  selectedHome: false,
  openedMarket: false,
};

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Read the saved state; any storage failure or bad data gives the fresh state. */
export function loadFirstSteps(store: Store | null = defaultStore()): FirstStepsState {
  try {
    const raw = store?.getItem(FIRST_STEPS_KEY);
    if (!raw) return FRESH_STEPS;
    const v = JSON.parse(raw) as Partial<Record<keyof FirstStepsState, unknown>>;
    return {
      dismissed: v.dismissed === true,
      selectedHome: v.selectedHome === true,
      openedMarket: v.openedMarket === true,
    };
  } catch {
    return FRESH_STEPS;
  }
}

export function saveFirstSteps(s: FirstStepsState, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(FIRST_STEPS_KEY, JSON.stringify(s));
  } catch {
    // Storage can be blocked; the checklist just comes back next visit.
  }
}
