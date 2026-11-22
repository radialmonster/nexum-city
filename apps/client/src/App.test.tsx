import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App routing', () => {
  it('renders the kit page at /kit and /', () => {
    for (const path of ['/kit', '/']) {
      const { unmount } = render(<App path={path} />);
      expect(screen.getByText('UI KIT')).toBeTruthy();
      unmount();
    }
  });

  it('renders a not-found message elsewhere', () => {
    render(<App path="/nope" />);
    expect(screen.getByText('Not found.')).toBeTruthy();
  });
});
