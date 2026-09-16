import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderPanel } from '@/components/OrderPanel';
import { ADD_SIZING_PLAN_TTL_MS, __resetAddSizingPlanForTests, getAddSizingPlan, requestAddSizingPrefill } from '@/lib/addSizingPlan';
import { calcSlippage, type AddSizingSnapshot } from '@/types/trading';

/**
 * 下单面板与加仓计算器的两处接口：
 *   · 市价单先把预计成交价与滑点写出来（3,000 万名义就是 0.61%），不要等成交后在记录里发现；
 *   · 「按上限下单」把整张的上限连同下单方式预填进来，只应用一次。
 */
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

vi.mock('@/hooks/usePersistedState', () => ({
  usePersistedState: <T,>(_k: string, d: T) => useState(d),
}));
/**
 * 下单前快照弹窗换成一个「提交」按钮：真弹窗填完快照后做的就是 onPlaceOrder(orderParams)，参数原样透传。
 * 直接交易模式下它从不打开。
 */
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({
  PreTradeSnapshotDialog: ({ isOpen, orderParams, onPlaceOrder }: {
    isOpen: boolean; orderParams: unknown; onPlaceOrder: (p: unknown) => unknown;
  }) => (isOpen ? <button type="button" data-testid="pre-trade-submit" onClick={() => onPlaceOrder(orderParams)}>提交快照并下单</button> : null),
}));
/** 面板当前的结算方式、交易模式与「切结算方式」的调用记录：模块级可变量，mock 的 context 每次渲染都读它。 */
const panel = vi.hoisted(() => ({
  mode: 'coin' as 'coin' | 'usdt',
  tradingMode: 'direct' as 'direct' | 'decision',
  switches: [] as Array<[string, string]>,
}));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    get tradingMode() { return panel.tradingMode; },
    balance: 200_000_000,
    positionsMap: {}, ordersMap: {}, priceMap: {}, leverageMap: {},
    getSymbolSettlementMode: () => panel.mode,
    setSymbolSettlementMode: (symbol: string, mode: string) => { panel.switches.push([symbol, mode]); },
    getSymbolLeverage: () => 6,
    setSymbolLeverage: vi.fn(),
    getSymbolMarginMode: () => 'isolated',
    setSymbolMarginMode: vi.fn(),
    getEffectiveTime: () => 1_000,
    getTimelineId: () => null,
  }),
}));

const PX = 0.419209;

function renderPanel(onPlaceOrder = vi.fn(), symbol = 'API3USD', opts: { price?: number; quantityPrecision?: number } = {}) {
  const ui = () => (
    <OrderPanel
      currentPrice={opts.price ?? PX} onPlaceOrder={onPlaceOrder} disabled={false} symbol={symbol}
      pricePrecision={6} quantityPrecision={opts.quantityPrecision ?? 6}
    />
  );
  const view = render(ui());
  (onPlaceOrder as unknown as { rerenderPanel: () => void }).rerenderPanel = () => view.rerender(ui());
  return onPlaceOrder;
}
const qtyInput = () => screen.getByTestId('order-qty-input') as HTMLInputElement;
const marketTab = () => screen.getByRole('button', { name: '市价' });
const snapshot = (over: Partial<Omit<AddSizingSnapshot, 'at'>> = {}): Omit<AddSizingSnapshot, 'at'> => ({
  plan: 'B', side: 'LONG', settlement: 'coin', s1: 0.4, s2Ref: PX, s2Fill: PX * 1.0061, slippagePct: 0.61,
  x1: 1_000, sBar: 0.38, g: 12, gUnit: 'API3', addCoinsMax: 71_563_206, contracts: 3_000_000, orderKind: 'market',
  ...over,
});

beforeEach(() => { panel.mode = 'coin'; panel.tradingMode = 'direct'; panel.switches = []; __resetAddSizingPlanForTests(); });
afterEach(() => { __resetAddSizingPlanForTests(); vi.restoreAllMocks(); });

describe('市价单的预计成交价', () => {
  it('限价标签下没有这一行；切到市价后按 calcSlippage 写出多 / 空两个预计成交价与滑点', () => {
    renderPanel();
    expect(screen.queryByTestId('order-expected-fill')).toBeNull();
    fireEvent.click(marketTab());
    const line = screen.getByTestId('order-expected-fill');
    // 数量为空：只含固定的 0.01%
    expect(line.textContent).toContain('滑点 ±0.01%');
    expect(line.textContent).toContain(`开多 ≈ ${calcSlippage(PX, 0, 'LONG').toPrecision(6)}`);
    expect(line.textContent).toContain(`开空 ≈ ${calcSlippage(PX, 0, 'SHORT').toPrecision(6)}`);
    expect(line.textContent).not.toContain('名义');
  });

  it('【回归】3,000 万名义的市价单：滑点 ±0.61%，两个方向的成交价都按 0.01% + 名义/50亿 给出', () => {
    renderPanel();
    fireEvent.click(marketTab());
    // 币金额档：71,563,206 API3 × 0.419209 ≈ 30,000,000 USD → 2,999,99x 张
    fireEvent.change(qtyInput(), { target: { value: '71563206' } });
    const hint = screen.getByTestId('coin-effective-qty-hint');
    const contracts = Number(hint.textContent!.match(/实际下单 (\d+) 张/)![1]);
    expect(contracts).toBeGreaterThan(2_999_000);
    const notional = contracts * 10;
    const line = screen.getByTestId('order-expected-fill');
    expect(line.textContent).toContain('滑点 ±0.61%');
    expect(line.textContent).toContain(`开多 ≈ ${calcSlippage(PX, notional, 'LONG').toPrecision(6)}`);
    expect(line.textContent).toContain(`开空 ≈ ${calcSlippage(PX, notional, 'SHORT').toPrecision(6)}`);
    expect(line.textContent).toMatch(/名义 29,999,9\d0\.00 USD/);
  });
});

describe('「按上限下单」预填', () => {
  it('市价计划：切到市价、「张」档，数量就是整张的上限；点开多下出去的就是这张单；预填只应用一次', () => {
    const onPlaceOrder = renderPanel();
    act(() => {
      requestAddSizingPrefill('API3USD', snapshot(), { contracts: 3_000_000, coins: 71_563_206, orderType: 'MARKET', limitPrice: null, side: 'LONG', settlement: 'coin' });
    });
    expect(qtyInput().value).toBe('3000000');
    expect(screen.getByTestId('unit-preference-trigger').textContent).toContain('张');
    expect(screen.getByTestId('coin-effective-qty-hint')).toHaveTextContent('实际下单 3000000 张');
    expect(screen.getByTestId('order-expected-fill').textContent).toContain('滑点 ±0.61%');
    // 预填消费掉了，计划本身还在，等下单入口来取
    expect(getAddSizingPlan()?.prefill).toBeNull();
    expect(getAddSizingPlan()?.snapshot.contracts).toBe(3_000_000);

    fireEvent.click(screen.getByText('开多'));
    expect(onPlaceOrder).toHaveBeenCalledTimes(1);
    expect(onPlaceOrder.mock.calls[0][0]).toMatchObject({ side: 'LONG', type: 'MARKET', priceSelection: 'MARKET', contracts: 3_000_000, quantity: 3_000_000, currencyUnit: 'BASE' });
    // 用户之后改数量，预填不会把它改回去
    fireEvent.change(qtyInput(), { target: { value: '5' } });
    expect(qtyInput().value).toBe('5');
  });

  it('限价计划：切到限价并填入挂单价 S₂', () => {
    const onPlaceOrder = renderPanel();
    act(() => {
      requestAddSizingPrefill('API3USD', snapshot({ orderKind: 'limit', s2Fill: PX, slippagePct: 0 }),
        { contracts: 3_010_000, coins: 71_800_000, orderType: 'LIMIT', limitPrice: PX, side: 'LONG', settlement: 'coin' });
    });
    expect((screen.getByTestId('order-limit-price') as HTMLInputElement).value).toBe(PX.toFixed(6));
    expect(qtyInput().value).toBe('3010000');
    expect(screen.queryByTestId('order-expected-fill')).toBeNull();
    fireEvent.click(screen.getByText('开多'));
    expect(onPlaceOrder.mock.calls[0][0]).toMatchObject({ type: 'LIMIT', priceSelection: 'LIMIT', price: PX, contracts: 3_010_000 });
  });

  /**
   * 【回归 · 三审】条件单计划（突破加仓）：计算器按触发价上的滑点定量，面板预填一张以 S₂ 为触发价的条件委托——
   * 不是限价单，也不是按手填价定量、在基准价成交的市价单。触发价同样向有利侧取整；预计成交那一行按触发价写。
   */
  it('【回归 · 三审】条件单计划：切到「条件委托」、填好触发价与整张；预计成交按触发价写；点开多下出去的是 CONDITIONAL @触发价', () => {
    const onPlaceOrder = renderPanel(vi.fn(), 'COMMONUSD', { price: 0.0077 });
    act(() => {
      requestAddSizingPrefill('COMMONUSD', snapshot({ orderKind: 'conditional', s2Ref: 0.0077015, s2Fill: 0.00771233, slippagePct: 0.14 }),
        { contracts: 643_614, coins: 834_535_000, orderType: 'CONDITIONAL', limitPrice: null, triggerPrice: 0.0077015, side: 'LONG', settlement: 'coin' });
    });
    // 面板精度 6 位：多头触发价向下取到 0.007701（计算器按同一精度取整后定量，这里是兜底）
    expect((screen.getByTestId('order-trigger-price') as HTMLInputElement).value).toBe('0.007701');
    expect(screen.queryByTestId('order-limit-price')).toBeNull();
    expect(qtyInput().value).toBe('643614');
    expect(screen.getByTestId('unit-preference-trigger').textContent).toContain('张');
    const line = screen.getByTestId('order-expected-fill');
    expect(line.textContent).toContain('触发后预计成交');
    expect(line.textContent).toContain(`开多 ≈ ${calcSlippage(0.007701, 6_436_140, 'LONG').toPrecision(6)}`);
    expect(getAddSizingPlan('COMMONUSD')?.prefill).toBeNull();
    fireEvent.click(screen.getByText('开多'));
    expect(onPlaceOrder.mock.calls[0][0]).toMatchObject({ side: 'LONG', type: 'CONDITIONAL', stopPrice: 0.007701, contracts: 643_614, quantity: 643_614 });
    expect(onPlaceOrder.mock.calls[0][0].addSizingSnapshot).toMatchObject({ orderKind: 'conditional', s2Ref: 0.0077015 });
  });

  it('别的标的的预填不应用；U 本位预填币数', () => {
    renderPanel(vi.fn(), 'API3USD');
    act(() => {
      requestAddSizingPrefill('BTCUSD', snapshot(), { contracts: 7, coins: 1, orderType: 'MARKET', limitPrice: null, side: 'LONG', settlement: 'coin' });
    });
    expect(qtyInput().value).toBe('');
    expect(getAddSizingPlan()?.prefill).not.toBeNull();
  });

  it('U 本位：预填的是币数（按数量精度）', () => {
    panel.mode = 'usdt';
    renderPanel(vi.fn(), 'API3USDT');
    act(() => {
      requestAddSizingPrefill('API3USDT', snapshot({ settlement: 'usdt', gUnit: 'USD', contracts: null }),
        { contracts: null, coins: 1234.5678912, orderType: 'MARKET', limitPrice: null, side: 'LONG', settlement: 'usdt' });
    });
    expect(qtyInput().value).toBe('1234.567891');
    expect(screen.getByTestId('unit-preference-trigger').textContent).toContain('API3');
    expect(panel.switches).toEqual([]);
  });

  /**
   * 【回归 · 复审】上限是授权额度，两处取整只往安全侧：
   * U 本位币数按数量精度**向下**取（0.743605 → 0.743，四舍五入会给 0.744 → 超限 0.53 USD），
   * 限价挂单价多头**向下**、空头**向上**取到价格精度（0.0077015 多头 → 0.007701，四舍五入会给 0.007702 → 超限）。
   */
  it('【回归 · 复审】U 本位币数向下取整到数量精度：0.7436056 → 0.743（不是 0.744）；不足一格留空', () => {
    panel.mode = 'usdt';
    const onPlaceOrder = renderPanel(vi.fn(), 'BTCUSDT', { price: 62_344.8, quantityPrecision: 3 });
    act(() => {
      requestAddSizingPrefill('BTCUSDT', snapshot({ settlement: 'usdt', gUnit: 'USD', contracts: null, s2Ref: 62_344.8, s2Fill: 62_344.8, orderKind: 'limit' }),
        { contracts: null, coins: 0.7436056, orderType: 'MARKET', limitPrice: null, side: 'LONG', settlement: 'usdt' });
    });
    expect(qtyInput().value).toBe('0.743');
    fireEvent.click(screen.getByText('开多'));
    expect(onPlaceOrder.mock.calls[0][0]).toMatchObject({ quantity: 0.743 });
    act(() => {
      requestAddSizingPrefill('BTCUSDT', snapshot({ settlement: 'usdt', gUnit: 'USD', contracts: null }),
        { contracts: null, coins: 0.0009999, orderType: 'MARKET', limitPrice: null, side: 'LONG', settlement: 'usdt' });
    });
    expect(qtyInput().value).toBe('');
    // 浮点噪声不掉格：0.1 + 0.2 = 0.30000000000000004 → 0.3
    act(() => {
      requestAddSizingPrefill('BTCUSDT', snapshot({ settlement: 'usdt', gUnit: 'USD', contracts: null }),
        { contracts: null, coins: 0.1 + 0.2, orderType: 'MARKET', limitPrice: null, side: 'LONG', settlement: 'usdt' });
    });
    expect(qtyInput().value).toBe('0.300');
  });

  it('【回归 · 复审】限价挂单价向有利侧取整：多头 0.0077015 → 0.007701、空头 → 0.007702；点开多挂出去的正是 0.007701', () => {
    const onPlaceOrder = renderPanel(vi.fn(), 'COMMONUSD', { price: 0.0077 });
    act(() => {
      requestAddSizingPrefill('COMMONUSD', snapshot({ orderKind: 'limit', s2Ref: 0.0077015, s2Fill: 0.0077015, slippagePct: 0 }),
        { contracts: 653_579, coins: 848_639_223, orderType: 'LIMIT', limitPrice: 0.0077015, side: 'LONG', settlement: 'coin' });
    });
    expect((screen.getByTestId('order-limit-price') as HTMLInputElement).value).toBe('0.007701');
    expect(qtyInput().value).toBe('653579');
    fireEvent.click(screen.getByText('开多'));
    expect(onPlaceOrder.mock.calls[0][0]).toMatchObject({ type: 'LIMIT', price: 0.007701, contracts: 653_579 });

    act(() => {
      requestAddSizingPrefill('COMMONUSD', snapshot({ side: 'SHORT', orderKind: 'limit', s2Ref: 0.0077015, s2Fill: 0.0077015, slippagePct: 0 }),
        { contracts: 10, coins: 12_984, orderType: 'LIMIT', limitPrice: 0.0077015, side: 'SHORT', settlement: 'coin' });
    });
    expect((screen.getByTestId('order-limit-price') as HTMLInputElement).value).toBe('0.007702');
    // 已在格上的价不动
    act(() => {
      requestAddSizingPrefill('COMMONUSD', snapshot({ orderKind: 'limit', s2Ref: 0.007701, s2Fill: 0.007701, slippagePct: 0 }),
        { contracts: 10, coins: 12_985, orderType: 'LIMIT', limitPrice: 0.007701, side: 'LONG', settlement: 'coin' });
    });
    expect((screen.getByTestId('order-limit-price') as HTMLInputElement).value).toBe('0.007701');
  });

  it('【回归 · 复审】计划的结算方式与面板不同：先把面板切过去（仅本会话），切过去之后再预填；不留一个空数量', () => {
    // 面板在币本位，计划是 U 本位（被加仓的是 U 本位仓位）
    const onPlaceOrder = renderPanel(vi.fn(), 'API3USDT', { quantityPrecision: 2 });
    act(() => {
      requestAddSizingPrefill('API3USDT', snapshot({ settlement: 'usdt', gUnit: 'USD', contracts: null }),
        { contracts: null, coins: 0.749, orderType: 'MARKET', limitPrice: null, side: 'LONG', settlement: 'usdt' });
    });
    expect(panel.switches).toEqual([['API3USDT', 'usdt']]);
    // 还没切过去：预填留着，不往「张」档里写币数
    expect(getAddSizingPlan('API3USDT')?.prefill).not.toBeNull();
    expect(qtyInput().value).toBe('');
    // context 切过去 → 面板重渲染 → 预填应用（币数向下取整到两位）
    panel.mode = 'usdt';
    act(() => { (onPlaceOrder as unknown as { rerenderPanel: () => void }).rerenderPanel(); });
    expect(qtyInput().value).toBe('0.74');
    expect(screen.getByTestId('unit-preference-trigger').textContent).toContain('API3');
    expect(getAddSizingPlan('API3USDT')?.prefill).toBeNull();
    expect(panel.switches).toHaveLength(1);
    fireEvent.click(screen.getByText('开多'));
    expect(onPlaceOrder.mock.calls[0][0]).toMatchObject({ settlementMode: 'usdt', quantity: 0.74 });
  });

  it('反过来：面板在 U 本位、计划是币本位，同样先切到币本位再按整张预填', () => {
    panel.mode = 'usdt';
    const onPlaceOrder = renderPanel(vi.fn(), 'API3USD');
    act(() => {
      requestAddSizingPrefill('API3USD', snapshot(), { contracts: 3_000_000, coins: 71_563_206, orderType: 'MARKET', limitPrice: null, side: 'LONG', settlement: 'coin' });
    });
    expect(panel.switches).toEqual([['API3USD', 'coin']]);
    expect(qtyInput().value).toBe('');
    panel.mode = 'coin';
    act(() => { (onPlaceOrder as unknown as { rerenderPanel: () => void }).rerenderPanel(); });
    expect(qtyInput().value).toBe('3000000');
    expect(screen.getByTestId('unit-preference-trigger').textContent).toContain('张');
  });
});

/**
 * 【回归 · 二审】计划在点「开多 / 开空」那一刻就取进单子参数（只看不消费）。
 * 决策模式要先填下单前快照：以前到提交时才去仓库取，填了半小时，计划已过保鲜期，
 * 照计算器预填的这张单就不带计划下出去、成交后也不复判。
 */
describe('【回归 · 二审】计划随「开多 / 开空」一起取走', () => {
  const T0 = Date.parse('2026-09-16T00:00:00Z');

  it('决策模式：T0 预填、T0+1 分钟点开多、T0+31 分钟提交快照——参数里仍是那份计划；仓库不在这里消费', () => {
    panel.tradingMode = 'decision';
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const onPlaceOrder = renderPanel();
    act(() => {
      requestAddSizingPrefill('API3USD', snapshot(), { contracts: 3_000_000, coins: 71_563_206, orderType: 'MARKET', limitPrice: null, side: 'LONG', settlement: 'coin' });
    });
    const plan = getAddSizingPlan('API3USD')!.snapshot;
    now.mockReturnValue(T0 + 60_000);
    fireEvent.click(screen.getByText('开多'));
    expect(onPlaceOrder).not.toHaveBeenCalled();
    now.mockReturnValue(T0 + ADD_SIZING_PLAN_TTL_MS + 60_000);
    fireEvent.click(screen.getByTestId('pre-trade-submit'));
    expect(onPlaceOrder).toHaveBeenCalledTimes(1);
    expect(onPlaceOrder.mock.calls[0][0]).toMatchObject({ side: 'LONG', type: 'MARKET', contracts: 3_000_000 });
    expect(onPlaceOrder.mock.calls[0][0].addSizingSnapshot).toBe(plan);
    // 消费留给下单入口（单子真的成交才清）；面板只看不拿
    expect(getAddSizingPlan('API3USD')!.snapshot).toBe(plan);
  });

  it('直接交易模式同样在点按钮时带上；方向不同（开空）不带；过了保鲜期才点按钮也不带', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const onPlaceOrder = renderPanel();
    act(() => {
      requestAddSizingPrefill('API3USD', snapshot(), { contracts: 3_000_000, coins: 71_563_206, orderType: 'MARKET', limitPrice: null, side: 'LONG', settlement: 'coin' });
    });
    const plan = getAddSizingPlan('API3USD')!.snapshot;
    fireEvent.click(screen.getByText('开空'));
    expect(onPlaceOrder.mock.calls[0][0].side).toBe('SHORT');
    expect(onPlaceOrder.mock.calls[0][0].addSizingSnapshot).toBeUndefined();
    fireEvent.click(screen.getByText('开多'));
    expect(onPlaceOrder.mock.calls[1][0].addSizingSnapshot).toBe(plan);
    now.mockReturnValue(T0 + ADD_SIZING_PLAN_TTL_MS + 1);
    fireEvent.click(screen.getByText('开多'));
    expect(onPlaceOrder.mock.calls[2][0].addSizingSnapshot).toBeUndefined();
  });

  it('决策模式：快照弹窗关掉没下单——仓库里的计划原样留着', () => {
    panel.tradingMode = 'decision';
    const onPlaceOrder = renderPanel();
    act(() => {
      requestAddSizingPrefill('API3USD', snapshot(), { contracts: 3_000_000, coins: 71_563_206, orderType: 'MARKET', limitPrice: null, side: 'LONG', settlement: 'coin' });
    });
    const plan = getAddSizingPlan('API3USD')!.snapshot;
    fireEvent.click(screen.getByText('开多'));
    expect(screen.getByTestId('pre-trade-submit')).toBeInTheDocument();
    expect(onPlaceOrder).not.toHaveBeenCalled();
    expect(getAddSizingPlan('API3USD')!.snapshot).toBe(plan);
  });
});
