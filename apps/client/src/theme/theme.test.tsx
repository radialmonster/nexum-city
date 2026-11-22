import { neon, highContrast } from '@nexum/theme';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { STYLE_ELEMENT_ID, applyTheme, applyUserScale, themeCss } from './runtime';

function injectedCss(): string {
  return document.getElementById(STYLE_ELEMENT_ID)?.textContent ?? '';
}

describe('theme injection', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.getElementById(STYLE_ELEMENT_ID)?.remove();
    document.documentElement.removeAttribute('style');
  });

  it('injects every token and the scale rules into one <style> element', () => {
    applyTheme('neon');
    const css = injectedCss();
    expect(css).toContain(`--color-accent: ${neon.color.accent};`);
    expect(css).toContain('--s-user: 1;');
    expect(document.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
  });

  it('replaces the variables when the theme changes', () => {
    applyTheme('neon');
    applyTheme('highContrast');
    expect(injectedCss()).toContain(`--color-accent: ${highContrast.color.accent};`);
    expect(injectedCss()).not.toContain(`--color-panel: ${neon.color.panel};`);
    expect(document.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
    expect(document.documentElement.dataset['theme']).toBe('highContrast');
  });

  it('writes the user scale to --s-user', () => {
    applyUserScale(1.25);
    expect(document.documentElement.style.getPropertyValue('--s-user')).toBe('1.25');
    applyUserScale(99);
    expect(document.documentElement.style.getPropertyValue('--s-user')).toBe('1.5');
  });

  it('themes differ in their generated CSS', () => {
    expect(themeCss('neon')).not.toBe(themeCss('highContrast'));
  });

  it('switching theme in the kit page changes the injected CSS variables', () => {
    render(<App path="/kit" />);
    expect(injectedCss()).toContain(`--color-bg: ${neon.color.bg};`);
    expect(neon.color.bg).not.toBe(highContrast.color.bg);

    fireEvent.click(screen.getByRole('button', { name: 'highContrast' }));
    expect(injectedCss()).toContain(`--color-bg: ${highContrast.color.bg};`);
    expect(injectedCss()).not.toContain(`--color-bg: ${neon.color.bg};`);

    fireEvent.click(screen.getByRole('button', { name: 'neon' }));
    expect(injectedCss()).toContain(`--color-bg: ${neon.color.bg};`);
  });

  it('the scale slider drives --s-user', () => {
    render(<App path="/kit" />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '1.3' } });
    expect(document.documentElement.style.getPropertyValue('--s-user')).toBe('1.3');
  });
});
