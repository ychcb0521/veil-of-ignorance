import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OrderPanel } from '@/components/OrderPanel';

/**
 * 张数锁的回归测试。事故由两张相隔 7 秒的截图钉死：
 * 「API3 金额」档填 99 @0.419209 → 提示 4 张;失焦吸附到 95.417571
 * (恰好 = 4 张的边界);价格跌到 0.419155 后点击,旧代码在点击那一刻
 * 用新价重算 floor(95.417571×0.419155/10)=3——用户看着 4 张下单,挂出 3 张。
 * 修后:张数在输入时刻锁定,价格跳动不得重算。
 */
// Radix Popover 的 Popper 需要 ResizeObserver;jsdom 没有,补一个空壳,
// 否则单位偏好弹层根本挂不出来,BTC 保证金档的回归无从展开。
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

vi.mock('@/hooks/usePersistedState', () => ({
  usePersistedState: <T,>(_k: string, d: T) => useState(d),
}));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({
  PreTradeSnapshotDialog: () => null,
}));
const lev = vi.hoisted(() => ({ v: 6 }));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    tradingMode: 'direct',                 // 直连下单，onPlaceOrder 直接收到参数
    balance: 2_000_000,
    positionsMap: {}, ordersMap: {}, priceMap: {}, leverageMap: {},
    getSymbolSettlementMode: () => 'coin',
    setSymbolSettlementMode: vi.fn(),
    getSymbolLeverage: () => lev.v,
    setSymbolLeverage: vi.fn(),
    getSymbolMarginMode: () => 'isolated',
    setSymbolMarginMode: vi.fn(),
    getEffectiveTime: () => 1_000,
  }),
}));

const P1 = 0.419209;   // 输入时刻的价:99 × P1 = 41.50 USD → 4 张
const P2 = 0.419155;   // 7 秒后的价:同一串数字 ×P2 = 39.99 USD → 旧代码掉成 3 张

function renderPanel(price: number, onPlaceOrder = vi.fn(), symbol = 'API3USD') {
  lev.v = 6;
  const view = render(
    <OrderPanel
      currentPrice={price}
      onPlaceOrder={onPlaceOrder}
      disabled={false}
      symbol={symbol}
      pricePrecision={6}
      quantityPrecision={6}
    />,
  );
  const rerenderAt = (p: number) =>
    view.rerender(
      <OrderPanel
        currentPrice={p}
        onPlaceOrder={onPlaceOrder}
        disabled={false}
        symbol={symbol}
        pricePrecision={6}
        quantityPrecision={6}
      />,
    );
  return { ...view, rerenderAt, onPlaceOrder };
}

const qtyInput = () => screen.getByTestId('order-qty-input') as HTMLInputElement;
const hint = () => screen.getByTestId('coin-effective-qty-hint');

describe('币本位张数锁', () => {
  it('【回归】输入后价格下跳,张数不得从 4 掉成 3', () => {
    const { rerenderAt } = renderPanel(P1);
    fireEvent.change(qtyInput(), { target: { value: '99' } });
    expect(hint()).toHaveTextContent('实际下单 4 张');

    fireEvent.blur(qtyInput());               // 吸附到 4 张的边界值
    expect(parseFloat(qtyInput().value)).toBeCloseTo(95.4176, 3);

    rerenderAt(P2);                           // 行情下跳
    expect(hint()).toHaveTextContent('实际下单 4 张');   // 旧代码这里是 3 张
  });

  it('【回归】点击提交的张数 = 提示里的张数,与点击那一刻的价格无关', () => {
    const { rerenderAt, onPlaceOrder } = renderPanel(P1);
    fireEvent.change(qtyInput(), { target: { value: '99' } });
    fireEvent.blur(qtyInput());
    rerenderAt(P2);

    fireEvent.click(screen.getByRole('button', { name: '开多' }));
    expect(onPlaceOrder).toHaveBeenCalledTimes(1);
    expect(onPlaceOrder.mock.calls[0][0]).toMatchObject({ contracts: 4, quantity: 4 });
  });

  it('重新输入才允许按新价重折——锁只挡行情,不挡用户', () => {
    const { rerenderAt } = renderPanel(P1);
    fireEvent.change(qtyInput(), { target: { value: '99' } });
    rerenderAt(P2);
    // 用户自己再敲一遍,按 P2 折:99 × 0.419155 = 41.496 → 仍 4 张
    fireEvent.change(qtyInput(), { target: { value: '95' } });
    // 95 × 0.419155 = 39.82 → 3 张:这是用户输入导致的,应该生效
    expect(hint()).toHaveTextContent('实际下单 3 张');
  });

  it('【回归】币金额档动杠杆不得重掷张数——那是原事故换个扳机', () => {
    // 杠杆不进「币金额 → 张数」的映射;若杠杆一变就用实时价重折,
    // 吸附在 4 张边界上的值会在下跳后的价格上掉成 3——与点击事故同构。
    const { rerenderAt } = renderPanel(P1);
    fireEvent.change(qtyInput(), { target: { value: '99' } });
    fireEvent.blur(qtyInput());               // 吸附到 4 张边界
    rerenderAt(P2);                           // 行情下跳
    lev.v = 10;                               // 用户动了下杠杆
    rerenderAt(P2);
    expect(hint()).toHaveTextContent('实际下单 4 张');
  });

  it('【回归·BTC】保证金档重折走未取整折算源——六位小数的显示串装不下整张边界', async () => {
    // BTC 面值 100、价 94537:一张的保证金 6x 下 ≈ 1.763e-4 BTC。
    // 7 张 = 1.2340783e-3,吸附串 '0.001234';杠杆 6→12 时若从串反推:
    // 0.001234×94537×12/100 = 13.99912 → 13 张;从未取整源折:恰好 14 张。
    const { rerenderAt } = renderPanel(94537, vi.fn(), 'BTCUSD');
    // 保证金档不是独立卡片，是 COIN 卡里的子模式（unit-sub-INITIAL_MARGIN）
    fireEvent.click(screen.getByTestId('unit-preference-trigger'));
    fireEvent.click(await screen.findByTestId('unit-sub-INITIAL_MARGIN'));

    fireEvent.change(qtyInput(), { target: { value: '0.00124' } });
    expect(hint()).toHaveTextContent('实际下单 7 张');   // 0.00124×94537×6/100 = 7.03

    fireEvent.blur(qtyInput());
    expect(qtyInput().value).toBe('0.001234');           // 显示串确实有损

    lev.v = 12;
    rerenderAt(94537);
    expect(hint()).toHaveTextContent('实际下单 14 张');  // 从串反推会是 13
  });

  it('不足一张仍然报最小量并禁用按钮', () => {
    renderPanel(P1);
    fireEvent.change(qtyInput(), { target: { value: '10' } });
    expect(screen.getByTestId('coin-min-order-hint')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开多' })).toBeDisabled();
  });
});
