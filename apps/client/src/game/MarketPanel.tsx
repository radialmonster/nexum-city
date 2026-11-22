import { useState } from 'react';
import { toUnits } from '@nexum/sim';
import type { GoodName, PlayerView, FeedItem } from '@nexum/contracts';
import { Button, Panel, Sparkline, Tabs } from '../ui';
import { vars } from '../ui/util';
import { GOOD_KEYS } from './derive';
import { GOOD_TONE } from './DistrictPanel';
import { formatUnits } from './feed';
import styles from './MarketPanel.module.css';
import {
  bookTable,
  checkLimit,
  credits,
  ESCROW_LINE,
  fillPrices,
  openOrders,
  placement,
  stashUnits,
  type BookRow,
  type Side,
} from './market';
import { messageFor } from './messages';

export interface MarketPanelProps {
  readonly view: PlayerView;
  readonly feed: readonly FeedItem[];
  readonly hub: string;
  readonly good?: GoodName | undefined;
  readonly onPlace: (order: {
    type: 'market.place';
    hub: string;
    side: Side;
    good: GoodName;
    price: number;
    qty: number;
  }) => Promise<boolean>;
  readonly onCancel: (orderId: string) => void;
  readonly onClose: () => void;
}

function Rows({ rows, side, max }: { rows: readonly BookRow[]; side: Side; max: number }) {
  if (rows.length === 0) return <p className={styles['none']}>Nothing here.</p>;
  return (
    <ul className={styles['rows']} aria-label={side === 'sell' ? 'Asks' : 'Bids'}>
      {rows.map((r) => (
        <li
          key={`${String(r.price)}-${String(r.civic)}`}
          className={styles['row']}
          data-side={side}
          data-civic={r.civic}
          style={vars({ '--depth': `${String(Math.round((r.depth / max) * 100))}%` })}
        >
          <b>{credits(r.price)}</b>
          <span>{formatUnits(r.qty)}</span>
          <small>{r.civic ? 'CITY' : formatUnits(r.depth)}</small>
        </li>
      ))}
    </ul>
  );
}

/** A public hub's market: book, civic reference price, recent fills, your stash and orders. */
export function MarketPanel({
  view,
  feed,
  hub,
  good: initial,
  onPlace,
  onCancel,
  onClose,
}: MarketPanelProps) {
  const [good, setGood] = useState<GoodName>(initial ?? 'parts');
  const [side, setSide] = useState<Side>('buy');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const table = bookTable(view, hub, good);
  const fills = fillPrices(feed, hub, good);
  const mine = openOrders(view, hub);
  const check = checkLimit(view, { hub, good, side, price, qty });
  const hubName = view.districts[hub]?.name ?? hub;
  const empty = price.trim() === '' && qty.trim() === '';

  const submit = async () => {
    setShown(true);
    if (!check.ok) return;
    setBusy(true);
    try {
      if (
        await onPlace({
          type: 'market.place',
          hub,
          side,
          good,
          price: check.priceCents,
          qty: check.qty,
        })
      ) {
        setPrice('');
        setQty('');
        setShown(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Market" tag={hubName.toUpperCase()} className={styles['panel']}>
      <div className={styles['stack']}>
        <Tabs
          label="Good"
          value={good}
          onChange={(id) => {
            setGood(GOOD_KEYS.find((g) => g === id) ?? 'parts');
          }}
          tabs={GOOD_KEYS.map((g) => ({ id: g, label: g.toUpperCase() }))}
        />
        {table === null ? (
          <p className={styles['none']}>This hub has no market for {good} yet.</p>
        ) : (
          <>
            <div className={styles['summary']}>
              <span>
                CITY PRICE <b>{credits(table.refCents)}</b>
              </span>
              <span>
                LAST FILL <b>{table.lastCents === null ? 'none yet' : credits(table.lastCents)}</b>
              </span>
              {fills.length >= 2 ? (
                <Sparkline points={fills} tone={GOOD_TONE[good]} label={`Recent ${good} fills`} />
              ) : (
                <small>No recent fills</small>
              )}
            </div>
            <div className={styles['book']}>
              <div>
                <span className={styles['cap']}>SELLERS (ASKS) - price / qty / depth</span>
                <Rows rows={table.asks} side="sell" max={table.maxDepth} />
              </div>
              <div>
                <span className={styles['cap']}>BUYERS (BIDS) - price / qty / depth</span>
                <Rows rows={table.bids} side="buy" max={table.maxDepth} />
              </div>
            </div>
          </>
        )}
        <p className={styles['line']}>
          Your stash here: <b>{formatUnits(stashUnits(view, hub, good))}</b> {good}. Your credits:{' '}
          <b>{formatUnits(toUnits(view.self.credits))}</b>.
        </p>
        <form
          className={styles['form']}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Tabs
            label="Side"
            value={side}
            onChange={(id) => {
              setSide(id === 'sell' ? 'sell' : 'buy');
            }}
            tabs={[
              { id: 'buy', label: 'BUY' },
              { id: 'sell', label: 'SELL' },
            ]}
          />
          <label>
            <span className={styles['cap']}>PRICE (CREDITS EACH)</span>
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
              }}
            />
          </label>
          <label>
            <span className={styles['cap']}>QUANTITY</span>
            <input
              inputMode="numeric"
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
              }}
            />
          </label>
          {!check.ok && (shown || !empty) && (
            <p className={styles['blocker']} role="alert">
              {messageFor(check.code)}
            </p>
          )}
          {check.ok && (
            <p className={styles['line']}>
              {placement(table, side, check.priceCents)} Sets aside {check.escrow}.
            </p>
          )}
          <p className={styles['hint']}>{ESCROW_LINE}</p>
          <div className={styles['actions']}>
            <Button onClick={onClose}>CLOSE</Button>
            <Button type="submit" variant="primary" disabled={busy || !check.ok}>
              PLACE {side.toUpperCase()} ORDER
            </Button>
          </div>
        </form>
        <div>
          <span className={styles['cap']}>YOUR OPEN ORDERS HERE</span>
          {mine.length === 0 ? (
            <p className={styles['none']}>None.</p>
          ) : (
            <ul className={styles['orders']}>
              {mine.map((o) => (
                <li key={o.id}>
                  <span>
                    {o.side.toUpperCase()} {formatUnits(o.qty)} {o.good} at {credits(o.price)}
                  </span>
                  <Button
                    variant="danger"
                    onClick={() => {
                      onCancel(o.id);
                    }}
                  >
                    CANCEL
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
