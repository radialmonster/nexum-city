import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App routing', () => {
  it('renders the kit page at /kit', () => {
    render(<App path="/kit" />);
    expect(screen.getByText('UI KIT')).toBeTruthy();
  });

  it('shows the sign-in screen at / when there is no session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))),
    );
    render(<App path="/" />);
    expect(await screen.findByLabelText('USERNAME')).toBeTruthy();
  });

  it('renders a not-found message elsewhere', () => {
    render(<App path="/nope" />);
    expect(screen.getByText('Not found.')).toBeTruthy();
  });
});
