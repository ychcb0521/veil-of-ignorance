import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OrderPanel } from '@/components/OrderPanel';

/**
 * 勾选「止盈止损」不得改写订单类型,也不得把止盈价塞进开仓触发价。
 *
 * 旧行为:MARKET → MARKET_TP_SL,止盈价顺着
 * `stopPrice || tpTrigger || slTrigger` 兜底链进了 stopPrice。
 * 而触发价那行输入在市价/限价标签下**根本不渲染**（类型是提交这一刻才合成的），
 * 所以兜底必然抓到止盈价。引擎于是把止盈价当成开仓触发价:
 * 市价单不再立刻成交、挂到止盈价上开仓（Index.tsx:1136-1144）;
 * 限价单要等价格先摸到止盈价才肯激活（Index.tsx:1149-1159）。
 */
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
    balance: 2_000_000,
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
const TP = 0.015;
const SL = 0.009;

function renderPanel() {
  const onPlaceOrder = vi.fn();
  render(
    <OrderPanel currentPrice={MARKET} onPlaceOrder={onPlaceOrder} disabled={false}
      symbol="NOMUSD" pricePrecision={6} quantityPrecision={6} />,
  );
  return onPlaceOrder;
}

const qtyInput = () => screen.getByTestId('order-qty-input') as HTMLInputElement;
const tickTpSl = () => fireEvent.click(screen.getByLabelText('止盈/止损', { selector: 'input' }));

function fillTpSl(tp?: string, sl?: string) {
  const boxes = screen.getAllByPlaceholderText('触发价') as HTMLInputElement[];
  if (tp !== undefined) fireEvent.change(boxes[0], { target: { value: tp } });
  if (sl !== undefined) fireEvent.change(boxes[1], { target: { value: sl } });
}

describe('随单下达的止盈止损', () => {
  it('【回归】市价单勾了止盈止损，类型仍是 MARKET —— 它必须当场成交', () => {
    const onPlaceOrder = renderPanel();
    fireEvent.click(screen.getByText('市价'));
    fireEvent.change(qtyInput(), { target: { value: '3600' } });
    tickTpSl();
    fillTpSl(String(TP), String(SL));
    fireEvent.click(screen.getByText('开多'));

    const p = onPlaceOrder.mock.calls[0][0];
    expect(p.type).toBe('MARKET');            // 旧值是 'MARKET_TP_SL' —— 那会挂在止盈价上开仓
    expect(p.stopPrice).toBe(0);              // 旧值是 0.015 —— 止盈价冒充了开仓触发价
    expect(p.tpTriggerPrice).toBe(TP);
    expect(p.slTriggerPrice).toBe(SL);
  });

  it('【回归】限价单勾了止盈止损，类型仍是 LIMIT、委托价还是委托价', () => {
    const onPlaceOrder = renderPanel();
    fireEvent.change(screen.getByTestId('order-limit-price'), { target: { value: '0.0100' } });
    fireEvent.change(qtyInput(), { target: { value: '3600' } });
    tickTpSl();
    fillTpSl(String(TP), String(SL));
    fireEvent.click(screen.getByText('开多'));

    const p = onPlaceOrder.mock.calls[0][0];
    expect(p.type).toBe('LIMIT');             // 旧值 'LIMIT_TP_SL':要等价格摸到止盈价才肯激活
    expect(p.price).toBeCloseTo(0.0100, 9);
    expect(p.stopPrice).toBe(0);
    expect(p.tpTriggerPrice).toBe(TP);
  });

  it('条件委托的触发价不被止盈价顶掉', () => {
    const onPlaceOrder = renderPanel();
    fireEvent.click(screen.getByTestId('advanced-type-slot'));
    fireEvent.click(screen.getAllByText('条件委托')[1]);
    fireEvent.change(screen.getByTestId('order-trigger-price'), { target: { value: '0.010344' } });
    fireEvent.change(qtyInput(), { target: { value: '3600' } });
    tickTpSl();
    fillTpSl(String(TP), String(SL));
    fireEvent.click(screen.getByText('开多'));

    const p = onPlaceOrder.mock.calls[0][0];
    expect(p.type).toBe('CONDITIONAL');
    expect(p.stopPrice).toBeCloseTo(0.010344, 9);   // 开仓触发价
    expect(p.tpTriggerPrice).toBe(TP);              // 保护价,两者不再共用一个字段
  });

  it('没勾选就一个保护价都不发', () => {
    const onPlaceOrder = renderPanel();
    fireEvent.click(screen.getByText('市价'));
    fireEvent.change(qtyInput(), { target: { value: '3600' } });
    fireEvent.click(screen.getByText('开多'));

    const p = onPlaceOrder.mock.calls[0][0];
    expect(p.tpTriggerPrice).toBe(0);
    expect(p.slTriggerPrice).toBe(0);
  });

  it('只填止损也成立', () => {
    const onPlaceOrder = renderPanel();
    fireEvent.click(screen.getByText('市价'));
    fireEvent.change(qtyInput(), { target: { value: '3600' } });
    tickTpSl();
    fillTpSl(undefined, String(SL));
    fireEvent.click(screen.getByText('开多'));

    const p = onPlaceOrder.mock.calls[0][0];
    expect(p.type).toBe('MARKET');
    expect(p.tpTriggerPrice).toBe(0);
    expect(p.slTriggerPrice).toBe(SL);
  });

  /**
   * 【回归】分段 / TWAP / 跟踪委托不挂随单保护单——它们的挂单是显式字面量造的、
   * 不带附挂字段，TWAP 的切片成交点更没有兑现入口。此前勾选框对这三类照常渲染、
   * 照常可勾、然后**静默丢弃**。没做到就别摆在那里。
   */
  it.each(['分段订单', 'TWAP', '跟踪委托'])('%s 不给勾选止盈止损', (label) => {
    renderPanel();
    fireEvent.click(screen.getByTestId('advanced-type-slot'));
    fireEvent.click(within(screen.getByTestId('advanced-type-menu')).getByText(label));
    const box = screen.getByTestId('enable-tpsl') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/该类型不支持/)).toBeInTheDocument();
  });

  it('从支持的类型切到不支持的类型，已填的保护价不得随单发出去', () => {
    const onPlaceOrder = renderPanel();
    fireEvent.click(screen.getByText('市价'));
    fireEvent.change(qtyInput(), { target: { value: '3600' } });
    tickTpSl();
    fillTpSl(String(TP), String(SL));

    fireEvent.click(screen.getByTestId('advanced-type-slot'));
    fireEvent.click(within(screen.getByTestId('advanced-type-menu')).getByText('TWAP'));
    fireEvent.click(screen.getByText('开多'));

    const p = onPlaceOrder.mock.calls[0][0];
    expect(p.type).toBe('TWAP');
    expect(p.tpTriggerPrice).toBe(0);
    expect(p.slTriggerPrice).toBe(0);
  });
});
