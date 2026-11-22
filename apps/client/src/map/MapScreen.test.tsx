import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { clampMenu, formatEta, formatSector, parseMapOptions } from './MapScreen';

describe('parseMapOptions', () => {
  it('reads the query flags', () => {
    expect(parseMapOptions('?zoom=city&large')).toEqual({
      zoom: 'city',
      large: true,
      reveal: true,
      demo: false,
    });
    expect(parseMapOptions('').zoom).toBe('tactical');
    expect(parseMapOptions('?fog').reveal).toBe(false);
    expect(parseMapOptions('?zoom=district&large=0').large).toBe(false);
  });
});

describe('formatEta', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatEta(42_000)).toBe('42s');
    expect(formatEta(125_000)).toBe('2m 05s');
    expect(formatEta(3_900_000)).toBe('1h 05m');
  });
});

describe('/map', () => {
  it('renders the HUD without WebGL', async () => {
    render(<App path="/map" />);
    expect((await screen.findAllByText(/DISTRICTS/i)).length).toBeGreaterThan(0);
  });
});

describe('formatSector', () => {
  it('keeps the sign in front of each padded part', () => {
    expect(formatSector(0, -1)).toBe('00,-01');
    expect(formatSector(12, 3)).toBe('12,03');
  });
});

describe('clampMenu', () => {
  const vp = { w: 1000, h: 800 };
  it('keeps the menu inside the viewport', () => {
    expect(clampMenu({ x: 10, y: 790 }, vp, 150, { x: 0, y: 0 })).toEqual({ x: 150, y: 650 });
  });
  it('slides below the HUD card when they overlap', () => {
    expect(clampMenu({ x: 400, y: 100 }, vp, 150, { x: 200, y: 60 })).toEqual({ x: 400, y: 270 });
  });
  it('leaves the position alone when unmeasured', () => {
    expect(clampMenu({ x: 5, y: 5 }, vp, 0, { x: 0, y: 0 })).toEqual({ x: 5, y: 5 });
  });
});
