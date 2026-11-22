import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FirstSteps } from './FirstSteps';
import {
  FIRST_STEPS_KEY,
  FRESH_STEPS,
  loadFirstSteps,
  mergeSteps,
  saveFirstSteps,
} from './stepsStore';

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
    expect(loadFirstSteps('p1', s)).toEqual(FRESH_STEPS);
    saveFirstSteps(
      { ...FRESH_STEPS, dismissed: true, selectedHome: true, tookContract: true },
      'p1',
      s,
    );
    expect(loadFirstSteps('p1', s)).toEqual({
      ...FRESH_STEPS,
      dismissed: true,
      selectedHome: true,
      tookContract: true,
    });
    // another player in the same browser starts fresh
    expect(loadFirstSteps('p2', s)).toEqual(FRESH_STEPS);
    s.setItem(`${FIRST_STEPS_KEY}.p1`, '{nope');
    expect(loadFirstSteps('p1', s)).toEqual(FRESH_STEPS);
    expect(loadFirstSteps('p1', null)).toEqual(FRESH_STEPS);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadFirstSteps('p1', broken)).toEqual(FRESH_STEPS);
    expect(() => {
      saveFirstSteps(FRESH_STEPS, 'p1', broken);
    }).not.toThrow();
  });
});

describe('sticky steps', () => {
  it('never un-completes a step', () => {
    const done = mergeSteps(FRESH_STEPS, { selectedHome: true, tookContract: true });
    expect(done.selectedHome && done.tookContract).toBe(true);
    const later = mergeSteps(done, { selectedHome: false, tookContract: false });
    expect(later).toEqual(done);
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
