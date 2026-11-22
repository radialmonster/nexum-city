import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Bar,
  Button,
  Chip,
  Gauge,
  Panel,
  RadialMenu,
  Ribbon,
  Sparkline,
  StanceSwitch,
  Tabs,
  Tag,
  TimelineRow,
  Toast,
} from './index';

describe('UI kit smoke tests', () => {
  it('Panel renders its header, tag and body', () => {
    render(
      <Panel title="Docks" tag="HUB">
        body text
      </Panel>,
    );
    expect(screen.getByText('Docks')).toBeTruthy();
    expect(screen.getByText('HUB')).toBeTruthy();
    expect(screen.getByText('body text')).toBeTruthy();
  });

  it('Chip renders an icon, label and value', () => {
    render(<Chip icon="⚙" label="PARTS" value="1,240" faction="raider" />);
    expect(screen.getByText('1,240')).toBeTruthy();
    expect(screen.getByText('PARTS')).toBeTruthy();
  });

  it('Bar exposes progress and maps the faction to its token', () => {
    render(<Bar label="capture" value={0.4} faction="raider" />);
    const bar = screen.getByRole('progressbar', { name: 'capture' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.style.getPropertyValue('--k')).toBe('var(--faction-raider)');
    expect(bar.style.getPropertyValue('--p')).toBe('40%');
  });

  it('Bar clamps out-of-range values', () => {
    render(<Bar label="over" value={3} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('Button renders each variant and handles clicks', () => {
    const onClick = vi.fn();
    render(
      <>
        <Button variant="primary" onClick={onClick}>
          GO
        </Button>
        <Button>GHOST</Button>
        <Button variant="danger">DANGER</Button>
      </>,
    );
    fireEvent.click(screen.getByText('GO'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByText('GHOST')).toBeTruthy();
    expect(screen.getByText('DANGER')).toBeTruthy();
  });

  it('Tag renders with a faction colour', () => {
    render(<Tag faction="turtle">TURTLE</Tag>);
    expect(screen.getByText('TURTLE').style.getPropertyValue('--k')).toBe('var(--faction-turtle)');
  });

  it('Toast renders and can be dismissed', () => {
    const onDismiss = vi.fn();
    render(
      <Toast title="DONE" onDismiss={onDismiss}>
        saved
      </Toast>,
    );
    expect(screen.getByRole('status').textContent).toContain('saved');
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('Ribbon renders as an alert with a badge', () => {
    render(
      <Ribbon icon="⚠" title="RAID" badge="02:14">
        Lowline
      </Ribbon>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('RAID');
    expect(alert.textContent).toContain('02:14');
  });

  it('TimelineRow places the order bar and its previews', () => {
    const { container } = render(
      <TimelineRow
        label="H-2"
        start={0.25}
        end={0.5}
        progress={0.5}
        previews={[{ start: 0.5, end: 0.75 }]}
      >
        HAUL
      </TimelineRow>,
    );
    expect(screen.getByText('HAUL')).toBeTruthy();
    const order = screen.getByText('HAUL').parentElement;
    expect(order?.style.getPropertyValue('--from')).toBe('25%');
    expect(order?.style.getPropertyValue('--size')).toBe('25%');
    expect(container.querySelectorAll('[style*="--from: 50%"]')).toHaveLength(1);
  });

  it('Gauge fills cells up to capacity', () => {
    render(
      <Gauge
        label="Warehouse"
        capacity={10}
        segments={[
          { id: 'a', units: 4, tone: 'ok' },
          { id: 'b', units: 3, tone: 'warn' },
        ]}
      />,
    );
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('7');
    expect(meter.children).toHaveLength(10);
  });

  it('Sparkline draws a polyline', () => {
    const { container } = render(<Sparkline label="price" points={[1, 3, 2, 5]} />);
    expect(screen.getByRole('img', { name: 'price' })).toBeTruthy();
    expect(container.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(4);
  });

  it('RadialMenu selects an item', () => {
    const onSelect = vi.fn();
    render(
      <RadialMenu
        items={[
          { id: 'a', glyph: 'A', label: 'ALPHA' },
          { id: 'b', glyph: 'B', label: 'BETA' },
        ]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'BETA' }));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('Tabs marks the selected tab and changes with arrow keys', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="Market"
        value="sell"
        onChange={onChange}
        tabs={[
          { id: 'sell', label: 'SELL' },
          { id: 'buy', label: 'BUY' },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: 'SELL' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'SELL' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('buy');
  });

  it('StanceSwitch toggles between hold and pull back', () => {
    const onChange = vi.fn();
    render(<StanceSwitch value="hold" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'HOLD' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'PULL BACK' }));
    expect(onChange).toHaveBeenCalledWith('pullBack');
  });
});
