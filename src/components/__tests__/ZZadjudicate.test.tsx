import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OrderPanel } from '@/components/OrderPanel';

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

vi.mock('@/hooks/usePersistedState', () => ({
  usePersistedState: <T,>(_k: string, d: T) => useState(d),
}));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({
  PreTradeSnapshotDialog: () => null,
}));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    tradingMode: 'direct',
    balance: 2_047_207,
    positionsMap: {}, ordersMap: {}, priceMap: {}, leverageMap: {},
    getSymbolSettlementMode: () => 'coin',
    setSymbolSettlementMode: vi.fn(),
    getSymbolLeverage: () => 3,
    setSymbolLeverage: vi.fn(),
    getSymbolMarginMode: () => 'isolated',
    setSymbolMarginMode: vi.fn(),
    getEffectiveTime: () => 1_000,
  }),
}));

const MARKET = 0.011199;
function renderPanel(price = MARKET) {
  const onPlaceOrder = vi.fn();
  const view = render(
    <OrderPanel currentPrice={price} onPlaceOrder={onPlaceOrder} disabled={false}
      symbol="NOMUSD" pricePrecision={6} quantityPrecision={6} />,
  );
  return { ...view, onPlaceOrder };
}
const qtyInput = () => screen.getByTestId('order-qty-input') as HTMLInputElement;
const hint = () => screen.queryByTestId('coin-effective-qty-hint');
const minHint = () => screen.queryByTestId('coin-min-order-hint');
const trigger = () => screen.getByTestId('order-trigger-price') as HTMLInputElement;

function pickAdvanced(name: string) {
  fireEvent.click(screen.getByTestId('advanced-type-slot'));
  const menu = screen.getByTestId('advanced-type-menu');
  fireEvent.click(within(menu).getByText(name));
}
function pickLimit() { fireEvent.click(screen.getByText('限价')); }

describe('adjudication', () => {
  it('F1 ratchet: toggle order-type tabs', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('order-limit-price'), { target: { value: '0.0113' } });
    fireEvent.change(qtyInput(), { target: { value: '3600' } });
    console.log('start   :', hint()?.textContent, '| box=', qtyInput().value);
    pickAdvanced('条件委托');
    console.log('->cond  :', hint()?.textContent, '| box=', qtyInput().value);
    pickLimit();
    console.log('->limit :', hint()?.textContent, '| box=', qtyInput().value);
    pickAdvanced('条件委托');
    console.log('->cond  :', hint()?.textContent, '| box=', qtyInput().value);
    pickLimit();
    console.log('->limit :', hint()?.textContent, '| box=', qtyInput().value);
    pickAdvanced('条件委托');
    console.log('->cond  :', hint()?.textContent, '| box=', qtyInput().value);
    pickLimit();
    console.log('->limit :', hint()?.textContent, '| box=', qtyInput().value);
  });

  it('F2 dead button after leaving CONDITIONAL', () => {
    renderPanel();
    pickAdvanced('条件委托');
    fireEvent.change(trigger(), { target: { value: '0.0125' } });
    fireEvent.change(qtyInput(), { target: { value: '800' } });
    console.log('cond    :', hint()?.textContent, '| box=', qtyInput().value);
    pickAdvanced('跟踪委托');
    console.log('trailing: hint=', hint()?.textContent, '| min=', minHint()?.textContent, '| box=', qtyInput().value);
    const btn = screen.getByText('开多').closest('button')!;
    console.log('disabled=', btn.disabled);
  });

  it('F3 100% slider vs available readout', () => {
    renderPanel();
    pickAdvanced('条件委托');
    fireEvent.change(trigger(), { target: { value: '0.010344' } });
    const slider = document.querySelector('input[type=range]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '100' } });
    console.log('box after 100% =', qtyInput().value);
    console.log('BODY:', document.body.textContent?.replace(/\s+/g,' '));
  });

  it('F4 MARKET+TPSL panel vs list', () => {
    const { onPlaceOrder } = renderPanel();
    fireEvent.click(screen.getByText('市价'));
    fireEvent.change(qtyInput(), { target: { value: '3600' } });
    const cb = document.querySelector('#enable-tpsl') as HTMLElement | null;
    console.log('tpsl cb found:', !!cb);
    if (cb) fireEvent.click(cb);
    console.log('after tpsl:', document.body.textContent?.slice(0, 0));
    const tp = screen.queryByPlaceholderText(/止盈触发/) ;
    console.log('tp field:', !!tp);
    console.log('panel hint:', hint()?.textContent);
  });
});
