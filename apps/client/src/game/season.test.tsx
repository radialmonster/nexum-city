import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SeasonsResponse } from '@nexum/contracts';
import { finaleClock } from './derive';
import { HallOfFame } from './HallOfFame';
import { SeasonEnd } from './SeasonEnd';
import { makeView } from './testing';

const HOUR = 3_600_000;

describe('finaleClock', () => {
  const view = makeView({
    season: { startMs: 0, endMs: 100 * HOUR, finaleStartMs: 50 * HOUR, finale: false },
  });
  it('runs, then counts down through the finale, then is over', () => {
    expect(finaleClock(view, 10 * HOUR).phase).toBe('running');
    const f = finaleClock(view, 98 * HOUR + 59 * 60_000 + 30_000);
    expect(f.phase).toBe('finale');
    expect(f.text).toBe('01:00:30');
    const over = finaleClock(view, 100 * HOUR);
    expect(over.phase).toBe('over');
    expect(over.text).toBe('00:00:00');
  });
  it('shows hours past 24 during a long finale', () => {
    expect(finaleClock(view, 52 * HOUR).text).toBe('48:00:00');
  });
});

describe('SeasonEnd', () => {
  it('lists the final standings, marks you, and links to the hall of fame', () => {
    const onClose = vi.fn();
    render(<SeasonEnd view={makeView()} names={{ rival: 'Night Owls' }} onClose={onClose} />);
    const board = screen.getByLabelText('Final standings');
    const rows = board.querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Night Owls');
    expect(rows[1]?.textContent).toContain('You');
    expect(screen.getByRole('link', { name: /hall of fame/i }).getAttribute('href')).toBe('/hall');
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

const seasons: SeasonsResponse = {
  ok: true,
  nowMs: 5,
  current: { number: 2, startMs: 0, endMs: 10, finaleStartMs: 5, over: false, nextStartMs: null },
  seasons: [
    {
      number: 1,
      startMs: 0,
      endMs: 7 * 86_400_000,
      reason: 'ended',
      standings: [
        {
          rank: 1,
          playerId: 'a',
          score: 1000,
          scoreMs: 0,
          districts: 4,
          contractScore: 0,
          contractMs: 0,
          tradeScore: 3,
          tradeMs: 1,
        },
      ],
      names: { a: 'Gearheads' },
      stats: { players: 1, districtsHeld: 4, topTraderId: 'a', topTradeScore: 3 },
    },
  ],
};

describe('HallOfFame', () => {
  it('lists past seasons', async () => {
    render(<HallOfFame load={() => Promise.resolve(seasons)} />);
    expect(await screen.findByText('Season 1')).toBeTruthy();
    expect(screen.getAllByText('Gearheads').length).toBeGreaterThan(0);
    expect(screen.getByText(/Season 2 is running/)).toBeTruthy();
  });
  it('says so when nothing has finished', async () => {
    render(<HallOfFame load={() => Promise.resolve({ ...seasons, seasons: [] })} />);
    expect(await screen.findByText(/No season has finished yet/)).toBeTruthy();
  });
  it('asks to sign in on a 401 and fails soft on other errors', async () => {
    const { ApiError } = await import('./api');
    const { unmount } = render(
      <HallOfFame load={() => Promise.reject(new ApiError('unauthorized', 401))} />,
    );
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Sign in/));
    unmount();
    render(<HallOfFame load={() => Promise.reject(new ApiError('network', 0))} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not load/));
  });
});
