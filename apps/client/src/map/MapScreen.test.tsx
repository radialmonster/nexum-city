import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { formatEta, parseMapOptions } from './MapScreen';

describe('parseMapOptions', () => {
  it('reads the query flags', () => {
    expect(parseMapOptions('?zoom=city&large&reveal')).toEqual({
      zoom: 'city',
      large: true,
      reveal: true,
      demo: false,
    });
    expect(parseMapOptions('').zoom).toBe('tactical');
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
