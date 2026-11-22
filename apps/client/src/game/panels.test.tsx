import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ATOMS_PER_CENT, ATOMS_PER_UNIT } from '@nexum/sim';
import { BattleReport } from './BattleReport';
import { Dossier } from './Dossier';
import { MarketPanel } from './MarketPanel';
import { buildReport } from './report';
import { buildDossier } from './rivalDossier';
import { Timeline } from './Timeline';
import { feedItem, makeView } from './testing';

const book = {
  bids: [{ price: 90, qty: 5 }],
  asks: [{ price: 110, qty: 4 }],
  civic: { bid: 92, ask: 108, bidDepth: 60, askDepth: 60 },
  refCents: 100,
  lastCents: 101,
};
const marketView = () =>
  makeView({
    self: {
      credits: 1000 * ATOMS_PER_CENT,
      stash: { h: { parts: 10 * ATOMS_PER_UNIT, power: 0, data: 0, supplies: 0 } },
      score: 0,
    },
    markets: { h: { parts: book, power: book, data: book, supplies: book } },
  });

describe('MarketPanel', () => {
  const setup = (onPlace = vi.fn(() => Promise.resolve(true))) => {
    render(
      <MarketPanel
        view={marketView()}
        feed={[]}
        hub="h"
        good="parts"
        onPlace={onPlace}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    return onPlace;
  };

  it('draws both sides of the book with the civic offer', () => {
    setup();
    expect(screen.getByLabelText('Asks').querySelectorAll('li').length).toBeGreaterThan(1);
    expect(screen.getByLabelText('Bids').querySelectorAll('li').length).toBeGreaterThan(1);
    expect(screen.getAllByText('CITY').length).toBeGreaterThan(0);
  });

  it('explains a rejected order in plain words and places a valid one', async () => {
    const onPlace = setup();
    fireEvent.change(screen.getByLabelText(/PRICE/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/QUANTITY/), { target: { value: '2' } });
    expect(screen.getByRole('alert').textContent?.length).toBeGreaterThan(5);
    fireEvent.change(screen.getByLabelText(/PRICE/), { target: { value: '1.00' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /PLACE|BUY/ }));
    await waitFor(() => {
      expect(onPlace).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'market.place',
          hub: 'h',
          good: 'parts',
          side: 'buy',
          price: 100,
          qty: 2,
        }),
      );
    });
  });
});

describe('Timeline', () => {
  it('shows an empty state, then a row with a recall button for a move', () => {
    const view = makeView();
    const { rerender } = render(
      <Timeline view={view} feed={[]} nowMs={view.nowMs} onRecall={vi.fn()} onFly={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /RECALL/ })).toBeNull();
    const onRecall = vi.fn();
    const moving = makeView({
      movements: {
        m1: {
          id: 'm1',
          owner: 'me',
          kind: 'move',
          from: 'a',
          to: 'b',
          crewIds: ['c1'],
          carrierId: null,
          departMs: view.nowMs - 60_000,
          arriveMs: view.nowMs + 600_000,
          recalled: false,
        },
      } as never,
    });
    rerender(
      <Timeline view={moving} feed={[]} nowMs={moving.nowMs} onRecall={onRecall} onFly={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /RECALL/ }));
    expect(onRecall).toHaveBeenCalledWith('m1');
  });
});

describe('BattleReport and Dossier', () => {
  const feed = [
    feedItem(1, 'siege.started', {
      districts: ['a'],
      actors: ['rival', 'me'],
      data: { attacker: 'rival', defender: 'me' },
    }),
    feedItem(2, 'combat.round', {
      districts: ['a'],
      actors: ['rival', 'me'],
      data: {
        round: 1,
        attackerStrength: 90,
        defenderStrength: 70,
        attackerLost: 3,
        defenderLost: 2,
      },
    }),
    feedItem(3, 'siege.broken', {
      districts: ['a'],
      actors: ['rival', 'me'],
      data: { attacker: 'rival', defender: 'me', reason: 'routed' },
    }),
  ];
  const view = makeView();

  it('renders a report and opens the rival dossier', () => {
    const report = buildReport(feed, view, 3);
    expect(report).not.toBeNull();
    const onRival = vi.fn();
    render(
      <BattleReport
        report={report as NonNullable<typeof report>}
        me="me"
        nowMs={view.nowMs}
        onRival={onRival}
        onFly={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('SIEGE BROKEN')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'rival' }));
    expect(onRival).toHaveBeenCalledWith('rival');
  });

  it('lists the rival districts and history', () => {
    render(
      <Dossier
        dossier={buildDossier(view, feed, 'rival')}
        nowMs={view.nowMs}
        onFly={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Beta Stacks')).toBeTruthy();
    expect(screen.getByText(/They started a siege/)).toBeTruthy();
  });
});
