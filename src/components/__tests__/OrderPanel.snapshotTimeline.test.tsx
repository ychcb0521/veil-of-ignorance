import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OrderPanel } from '@/components/OrderPanel';

/**
 * 决策模式下按「开多」先弹开仓快照：弹窗锁定模拟时间的同一刻，也要锁定回放时间线 id。
 * 弹窗随后会自动暂停时光机——暂停不分叉，但章必须在按下的那一下取好，
 * 而不是等用户填完表单再取（那时可能已经倒回 / 跳转过）。
 */
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

const { dialogProps, getTimelineId } = vi.hoisted(() => ({
  dialogProps: vi.fn(),
  getTimelineId: vi.fn<(symbol?: string) => string | null>(() => 'tl-open'),
}));

vi.mock('@/hooks/usePersistedState', () => ({
  usePersistedState: <T,>(_k: string, d: T) => useState(d),
}));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({
  PreTradeSnapshotDialog: (props: Record<string, unknown>) => { dialogProps(props); return null; },
}));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    tradingMode: 'decision',
    balance: 2_000_000,
    positionsMap: {}, ordersMap: {}, priceMap: { NOMUSD: 0.011199 }, leverageMap: {},
    getSymbolSettlementMode: () => 'coin',
    setSymbolSettlementMode: vi.fn(),
    getSymbolLeverage: () => 3,
    setSymbolLeverage: vi.fn(),
    getSymbolMarginMode: () => 'isolated',
    setSymbolMarginMode: vi.fn(),
    getEffectiveTime: () => 1_000,
    getTimelineId,
  }),
}));

function renderPanel() {
  const onPlaceOrder = vi.fn();
  render(
    <OrderPanel currentPrice={0.011199} onPlaceOrder={onPlaceOrder} disabled={false}
      symbol="NOMUSD" pricePrecision={6} quantityPrecision={6} />,
  );
  return onPlaceOrder;
}

const lastDialogProps = () => dialogProps.mock.calls[dialogProps.mock.calls.length - 1][0];

describe('开仓快照弹窗锁定的回放时间线', () => {
  it('按下开多那一刻取当前标的的时间线 id，与锁定的模拟时间一起交给弹窗', () => {
    getTimelineId.mockClear();
    const onPlaceOrder = renderPanel();
    fireEvent.click(screen.getByText('市价'));
    fireEvent.change(screen.getByTestId('order-qty-input'), { target: { value: '3600' } });
    fireEvent.click(screen.getByText('开多'));

    // 决策模式不直接下单，先弹快照
    expect(onPlaceOrder).not.toHaveBeenCalled();
    expect(getTimelineId).toHaveBeenCalledWith('NOMUSD');
    expect(lastDialogProps()).toMatchObject({
      isOpen: true, symbol: 'NOMUSD', simulatedTimeMs: 1_000, timelineId: 'tl-open', lockedEntryPrice: 0.011199,
    });
  });

  it('钟停着（拿不到时间线）：弹窗收到 null，不凭空造章', () => {
    getTimelineId.mockReturnValueOnce(null);
    renderPanel();
    fireEvent.click(screen.getByText('市价'));
    fireEvent.change(screen.getByTestId('order-qty-input'), { target: { value: '3600' } });
    fireEvent.click(screen.getByText('开多'));
    expect(lastDialogProps()).toMatchObject({ isOpen: true, timelineId: null });
  });
});
