import { describe, expect, it } from 'vitest';
import { homeHint, needsHomeCentre } from './home';

describe('homeHint', () => {
  it('names the plot', () => {
    expect(homeHint('Sector 7-4')).toBe(
      'Your district is Sector 7-4, the pulsing plot. Click it, or press RECENTRE.',
    );
  });
  it('falls back without a name', () => {
    expect(homeHint(null)).toContain('pulsing plot');
  });
});

describe('needsHomeCentre', () => {
  it('centres once when the home appears late', () => {
    expect(needsHomeCentre({ centred: false, hasMine: true, moved: false })).toBe(true);
  });
  it('waits while there is no home in the scene', () => {
    expect(needsHomeCentre({ centred: false, hasMine: false, moved: false })).toBe(false);
  });
  it('never repeats', () => {
    expect(needsHomeCentre({ centred: true, hasMine: true, moved: false })).toBe(false);
  });
  it('never yanks a camera the player moved', () => {
    expect(needsHomeCentre({ centred: false, hasMine: true, moved: true })).toBe(false);
  });
});
