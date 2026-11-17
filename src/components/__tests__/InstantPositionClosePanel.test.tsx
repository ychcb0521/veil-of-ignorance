import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { InstantPositionsContext } from '@/contexts/FishQualityContext';
import type { InstantPositionFill } from '@/lib/fish/instantCampaign';
import { OrderPanel } from '../OrderPanel';
import { PositionPanel } from '../PositionPanel';

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= TestResizeObserver;

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'instant-test' } }) }));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    tradingMode: 'direct',
    positionLimitMode: 'unlimited',
    balance: 1000,
    positionsMap: {}, ordersMap: {}, priceMap: {},
    getSymbolSettlementMode: () => 'coin',
    getSymbolMarginMode: () => 'isolated',
    getSymbolLeverage: () => 10,
  }),
}));
vi.mock('@/hooks/useInstantPositionQuote', () => ({
  useInstantPositionQuote: () => ({ value: { at: Date.now(), price: 0.0173, kind: 'mark' } }),
}));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({ PreTradeSnapshotDialog: () => null }));

const at = Date.parse('2026-11-17T03:25:00+08:00');
const first: InstantPositionFill = {
  id: 'campaign-1', recordId: 'fish-1', source: { id: 'signal-1', symbol: 'BULLAUSDT', timeMs: at },
  buyAt: at, detectors: [], entryPrice: 0.01682, marginUsdt: 20, leverage: 5,
};
const second: InstantPositionFill = { ...first, id: 'campaign-2', recordId: 'fish-2', buyAt: at + 3_600_000 };

function Desk({ onPlaceOrder, manage }: { onPlaceOrder: () => void; manage: (position: InstantPositionFill, action: unknown) => void }) {
  const [positions, setPositions] = useState([first, second]);
  const [open, setOpen] = useState(false);
  const [positionId, setPositionId] = useState<string>();
  return <InstantPositionsContext.Provider value={{ positions, monitorResults: new Map(), manualPositions: new Map(), mirrorFills: new Map(),
    manage: async (position, action) => {
      manage(position, action);
      if (action.kind === 'close' && action.fraction === 1) setPositions(rows => rows.filter(row => row.id !== position.id));
    },
  }}>
    <div data-testid="right-panel">
      <OrderPanel symbol="BTCUSDT" currentPrice={74000} disabled onPlaceOrder={onPlaceOrder}
        instantClose={{ open, setOpen, positionId, selectPosition: setPositionId }}/>
    </div>
    <PositionPanel positionsMap={{}} ordersMap={{}} tradeHistory={[]} priceMap={{}}
      activeSymbol="BTCUSDT" activeTab="positions" onClosePosition={vi.fn()} onCancelOrder={vi.fn()} onTabChange={vi.fn()}
      onOpenPositionChart={(_, __, ___, id) => { setPositionId(id); setOpen(true); }}/>
  </InstantPositionsContext.Provider>;
}

it('closes the selected instant position on the right without placing a BTC replay order', async () => {
  const manage = vi.fn(), onPlaceOrder = vi.fn();
  render(<Desk onPlaceOrder={onPlaceOrder} manage={manage}/>);
  fireEvent.click(within(screen.getByTestId('right-panel')).getByRole('button', { name: '平仓' }));
  const panel = within(screen.getByRole('region', { name: '即时模拟仓位平仓' }));
  expect(panel.getByText('请选择要平的仓位。')).toBeVisible();
  expect(screen.queryByTestId('order-qty-input')).not.toBeInTheDocument();
  fireEvent.change(panel.getByRole('combobox'), { target: { value: second.id } });
  fireEvent.click(panel.getByRole('button', { name: '市价平仓' }));
  const dialog = within(screen.getByRole('dialog', { name: '市价平仓' }));
  expect(dialog.getByText('BULLA/USDT 永续')).toBeVisible();
  fireEvent.click(dialog.getByRole('button', { name: /确认平仓/ }));
  await waitFor(() => expect(manage).toHaveBeenCalledWith(second, { kind: 'close', fraction: 1 }));
  expect(manage).toHaveBeenCalledOnce();
  expect(onPlaceOrder).not.toHaveBeenCalled();
  expect(panel.getByText('所选仓位已退出，请重新选择。')).toBeVisible();
  expect(panel.queryByRole('button', { name: '市价平仓' })).not.toBeInTheDocument();
  expect(panel.getByRole('option', { name: /03:25:00/ })).toBeInTheDocument();
});

it('opens right-side closure for the exact row even when two positions share a symbol', () => {
  const manage = vi.fn();
  render(<Desk onPlaceOrder={vi.fn()} manage={manage}/>);
  const row = within(screen.getAllByTestId('instant-position')[1]);
  fireEvent.click(row.getByRole('button', { name: '右侧管理' }));
  const panel = within(screen.getByRole('region', { name: '即时模拟仓位平仓' }));
  expect(panel.getByRole('combobox')).toHaveValue(second.id);
  fireEvent.change(panel.getByRole('combobox'), { target: { value: first.id } });
  fireEvent.click(row.getByRole('button', { name: '右侧管理' }));
  expect(panel.getByRole('combobox')).toHaveValue(second.id);
  fireEvent.click(panel.getByRole('button', { name: '市价平仓' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
  expect(manage).not.toHaveBeenCalled();
});
