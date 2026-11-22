import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FirstSteps } from './FirstSteps';
import { FIRST_STEPS_KEY, FRESH_STEPS, loadFirstSteps, saveFirstSteps } from './stepsStore';

const mem = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

describe('first steps storage', () => {
  it('starts fresh, round-trips and survives bad data or blocked storage', () => {
    const s = mem();
    expect(loadFirstSteps(s)).toEqual(FRESH_STEPS);
    saveFirstSteps({ dismissed: true, selectedHome: true, openedMarket: false }, s);
    expect(loadFirstSteps(s)).toEqual({ dismissed: true, selectedHome: true, openedMarket: false });
    s.setItem(FIRST_STEPS_KEY, '{nope');
    expect(loadFirstSteps(s)).toEqual(FRESH_STEPS);
    expect(loadFirstSteps(null)).toEqual(FRESH_STEPS);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadFirstSteps(broken)).toEqual(FRESH_STEPS);
    expect(() => {
      saveFirstSteps(FRESH_STEPS, broken);
    }).not.toThrow();
  });
});

describe('FirstSteps', () => {
  it('lists the steps with progress and can be dismissed', () => {
    const onDismiss = vi.fn();
    render(
      <FirstSteps
        onDismiss={onDismiss}
        steps={[
          { id: 'a', label: 'Select your district', hint: 'h', done: true },
          { id: 'b', label: 'Settle a frontier plot', hint: 'h', done: false },
          { id: 'c', label: 'Open a hub market', hint: 'h', done: false },
        ]}
      />,
    );
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getByText('Settle a frontier plot')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'HIDE THIS' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
