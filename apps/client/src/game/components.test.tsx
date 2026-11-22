import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DistrictPanel } from './DistrictPanel';
import { FeedPanel } from './FeedPanel';
import { LoginScreen } from './LoginScreen';
import { buildOrder, OrderCard } from './OrderCard';
import { feedItem, makeView } from './testing';

describe('LoginScreen', () => {
  it('signs in with trimmed credentials, and registers from the other tab', async () => {
    const onLogin = vi.fn(() => Promise.resolve(true));
    const onRegister = vi.fn(() => Promise.resolve(true));
    render(<LoginScreen onLogin={onLogin} onRegister={onRegister} />);
    fireEvent.change(screen.getByLabelText('USERNAME'), { target: { value: ' ann ' } });
    fireEvent.change(screen.getByLabelText('PASSWORD'), { target: { value: 'hunter2hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'SIGN IN' }));
    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({ username: 'ann', password: 'hunter2hunter2' });
    });
    fireEvent.click(screen.getByRole('tab', { name: 'REGISTER' }));
    fireEvent.click(screen.getByRole('button', { name: 'CREATE ACCOUNT' }));
    await waitFor(() => {
      expect(onRegister).toHaveBeenCalled();
    });
  });
});

describe('FeedPanel', () => {
  const view = makeView();

  it('says so when nothing has happened', () => {
    render(<FeedPanel view={view} feed={[]} lastSeenMs={0} nowMs={view.nowMs} onFly={vi.fn()} />);
    expect(screen.getByText(/Quiet so far/)).toBeTruthy();
  });

  it('lists newest first and flies to the district on click', () => {
    const onFly = vi.fn();
    const feed = [
      feedItem(1, 'siege.started', {
        districts: ['b'],
        data: { attacker: 'me', defender: 'rival' },
      }),
      feedItem(2, 'siege.started', {
        districts: ['a'],
        data: { attacker: 'rival', defender: 'me' },
      }),
    ];
    render(<FeedPanel view={view} feed={feed} lastSeenMs={0} nowMs={view.nowMs} onFly={onFly} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]?.textContent).toContain('THREAT');
    fireEvent.click(buttons[0] as HTMLElement);
    expect(onFly).toHaveBeenCalledWith('a');
  });
});

describe('DistrictPanel', () => {
  const view = makeView();
  const props = { view, nowMs: view.nowMs, onStance: vi.fn(), onBuild: vi.fn(), onFly: vi.fn() };

  it('shows a prompt with nothing selected', () => {
    render(<DistrictPanel {...props} districtId={null} />);
    expect(screen.getByText(/Pick a district/)).toBeTruthy();
  });

  it('offers a build action on your own district', () => {
    const onBuild = vi.fn();
    render(<DistrictPanel {...props} onBuild={onBuild} districtId="a" />);
    expect(screen.getByText('Alpha Docks')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /build/i }));
    expect(onBuild).toHaveBeenCalledWith('a');
  });

  it('shows a reduced view of a rival district without build or stance', () => {
    render(<DistrictPanel {...props} districtId="b" />);
    expect(screen.getByText('Beta Stacks')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /build/i })).toBeNull();
  });
});

describe('buildOrder', () => {
  const pick = {
    from: 'a',
    crewIds: ['c1'],
    carrierId: null,
    cargo: {},
    building: 'depot' as const,
  };

  it('builds a siege and a move once crews are picked', () => {
    expect(buildOrder({ kind: 'siege', districtId: 'b' }, pick)).toEqual({
      type: 'siege',
      carrierId: null,
      crewIds: ['c1'],
      target: 'b',
    });
    expect(buildOrder({ kind: 'move', districtId: 'b' }, pick)).toMatchObject({
      type: 'move',
      to: 'b',
    });
  });

  it('waits for crews, but a build needs none', () => {
    expect(buildOrder({ kind: 'siege', districtId: 'b' }, { ...pick, crewIds: [] })).toBeNull();
    expect(buildOrder({ kind: 'build', districtId: 'a' }, { ...pick, crewIds: [] })).toEqual({
      type: 'build',
      districtId: 'a',
      building: 'depot',
    });
  });

  it('needs cargo for a haul and keeps whole units only', () => {
    expect(buildOrder({ kind: 'haul', districtId: 'b' }, pick)).toBeNull();
    expect(
      buildOrder({ kind: 'haul', districtId: 'b' }, { ...pick, cargo: { parts: 2.7, power: 0 } }),
    ).toMatchObject({ cargo: { parts: 2 } });
  });
});

describe('OrderCard', () => {
  const view = makeView();
  const render_ = (kind: 'siege' | 'move', onConfirm = vi.fn(() => Promise.resolve(true))) => {
    const onClose = vi.fn();
    render(
      <OrderCard
        view={view}
        draft={{ kind, districtId: 'b' }}
        nowMs={view.nowMs}
        onConfirm={onConfirm}
        onClose={onClose}
        onRoute={vi.fn()}
      />,
    );
    return { onConfirm, onClose };
  };

  it('pre-picks the first crew, blocks confirming with none, then posts the order and closes', async () => {
    const { onConfirm, onClose } = render_('siege');
    const confirm = screen.getByRole('button', { name: /lay siege/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getAllByRole('checkbox')[0] as HTMLElement);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Pick at least one crew/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('checkbox')[0] as HTMLElement);
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith({
        type: 'siege',
        carrierId: null,
        crewIds: ['c1'],
        target: 'b',
      });
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('stays open when the server refuses the order', async () => {
    const { onClose } = render_(
      'move',
      vi.fn(() => Promise.resolve(false)),
    );
    fireEvent.click(screen.getAllByRole('checkbox')[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: /^move$/i }));
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();
  });
});
