import { useState } from 'react';
import { toUnits } from '@nexum/sim';
import type {
  ContractView,
  GoodName,
  MarketHistoryResponse,
  PlayerView,
  FeedItem,
} from '@nexum/contracts';
import { Button, Panel, Sparkline, Tabs } from '../ui';
import { vars } from '../ui/util';
import { ContractsBoard } from './ContractsBoard';
import { crewsAt, GOOD_KEYS, type CrewNames } from './derive';
import { GOOD_TONE } from './DistrictPanel';
import { costOf, saleVerdict, whyLine } from './economy';
import { formatUnits } from './feed';
import { PriceBoard } from './PriceBoard';
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
  /** Opens a haul order that carries your stash from this hub to one of your districts. */
  readonly onHaulHome?: ((hub: string) => void) | undefined;
  /** Crew names, for the contracts tab. */
  readonly names?: CrewNames | undefined;
  /** Sends a contract order; without it the contracts tab is hidden. */
  readonly onContract?: ((order: ContractOrder) => Promise<boolean>) | undefined;
  /** Opens the haul card for a contract you took. */
  readonly onDeliver?: ((contract: ContractView) => void) | undefined;
  /** Starts on this tab. */
  readonly tab?: 'market' | 'prices' | 'contracts' | undefined;
  /** Loads a good's hourly price history at a hub, for the price board trends. */
  readonly loadHistory?:
    ((hub: string, good: GoodName) => Promise<MarketHistoryResponse>) | undefined;
  /** Opens another hub's market (from the price board). */
  readonly onOpenHub?: ((hub: string, good: GoodName) => void) | undefined;
}

type ContractOrder =
  | {
      type: 'contract.post';
      hub: string;
      good: GoodName;
      qty: number;
      reward: number;
      hours: number;
    }
  | { type: 'contract.take'; contractId: string }
  | { type: 'contract.cancel'; contractId: string };

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
  onHaulHome,
  names,
  onContract,
  onDeliver,
  tab: initialTab,
  loadHistory,
  onOpenHub,
}: MarketPanelProps) {
  const [tab, setTab] = useState<'market' | 'prices' | 'contracts'>(initialTab ?? 'market');
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
  const stashed = GOOD_KEYS.reduce((n, g) => n + stashUnits(view, hub, g), 0);
  const myCost = costOf(view, 'stash', hub, good);
  const sellPrice = check.ok && side === 'sell' ? check.priceCents : null;
  const verdict =
    sellPrice === null || !check.ok ? null : saleVerdict(myCost, sellPrice, check.qty);
  const crewHere = crewsAt(view, hub).some((c) => c.readyAtMs <= view.nowMs);

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
      <Tabs
        label="Hub"
        value={tab}
        onChange={(id) => {
          setTab(id === 'contracts' ? 'contracts' : id === 'prices' ? 'prices' : 'market');
        }}
        tabs={[
          { id: 'market', label: 'MARKET' },
          { id: 'prices', label: 'PRICES' },
          ...(onContract ? [{ id: 'contracts', label: 'CONTRACTS' }] : []),
        ]}
      />
      {onContract && tab === 'contracts' && (
        <div className={styles['stack']}>
          <ContractsBoard
            view={view}
            hub={hub}
            names={names ?? {}}
            onPost={onContract}
            onTake={(contractId) => onContract({ type: 'contract.take', contractId })}
            onCancel={(contractId) => onContract({ type: 'contract.cancel', contractId })}
            onDeliver={onDeliver ?? (() => undefined)}
          />
          <div className={styles['actions']}>
            <Button onClick={onClose}>CLOSE</Button>
          </div>
        </div>
      )}
      <div className={styles['stack']} hidden={tab === 'contracts'}>
        <Tabs
          label="Good"
          value={good}
          onChange={(id) => {
            setGood(GOOD_KEYS.find((g) => g === id) ?? 'parts');
          }}
          tabs={GOOD_KEYS.map((g) => ({ id: g, label: g.toUpperCase() }))}
        />
        {tab === 'prices' && (
          <>
            <PriceBoard
              view={view}
              good={good}
              hub={hub}
              loadHistory={loadHistory}
              onOpenHub={
                onOpenHub &&
                ((h) => {
                  onOpenHub(h, good);
                })
              }
            />
            <div className={styles['actions']}>
              <Button onClick={onClose}>CLOSE</Button>
            </div>
          </>
        )}
        <div className={styles['stack']} hidden={tab === 'prices'}>
          {table === null ? (
            <p className={styles['none']}>This hub has no market for {good} yet.</p>
          ) : (
            <>
              <div className={styles['summary']}>
                <span>
                  CITY PRICE <b>{credits(table.refCents)}</b>
                </span>
                <span>
                  LAST FILL{' '}
                  <b>{table.lastCents === null ? 'none yet' : credits(table.lastCents)}</b>
                </span>
                {fills.length >= 2 ? (
                  <Sparkline points={fills} tone={GOOD_TONE[good]} label={`Recent ${good} fills`} />
                ) : (
                  <small>No recent fills</small>
                )}
              </div>
              <p className={styles['line']} data-testid="why">
                {whyLine(view, hub, good, (id) => view.districts[id]?.name ?? id)}
              </p>
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
            {myCost !== null && (
              <>
                {' '}
                Your cost: <b data-testid="my-cost">{credits(myCost)}</b> each.
              </>
            )}
          </p>
          <p className={styles['hint']}>
            Goods you buy land in your stash at this hub. Haul them home to use them.
          </p>
          {onHaulHome && stashed > 0 && (
            <div className={styles['actions']}>
              <Button
                disabled={!crewHere}
                onClick={() => {
                  onHaulHome(hub);
                }}
              >
                HAUL HOME
              </Button>
              {!crewHere && <small>Park a ready crew at this hub first.</small>}
            </div>
          )}
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
                placeholder="e.g. 1.50"
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
                placeholder="e.g. 10"
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
            {verdict && (
              <p
                className={styles['line']}
                data-testid="sale-verdict"
                data-gain={verdict.perUnit >= 0}
              >
                {verdict.text}
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
      </div>
    </Panel>
  );
}
