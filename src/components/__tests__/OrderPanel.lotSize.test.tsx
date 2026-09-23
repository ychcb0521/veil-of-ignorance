import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderPanel } from '@/components/OrderPanel';
import { resetLeverageClampNotices } from '@/lib/leverageClampNotice';

/**
 * 下单面板的币安单笔数量上限（MARKET_LOT_SIZE / LOT_SIZE）：
 * 市价类订单常驻一行「单笔市价上限」小字，数量超过时换成红色警告、按钮置灰；
 * 仓位比例按钮的 100% 与「可开」不会填出一张超过单笔上限的单。
 */
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

// 整面板渲染再开 Radix 浮层；机器负载高时首个用例会越过默认的 5 秒（与 OrderPanel.positionLimit 同一个放宽）。
vi.setConfig({ testTimeout: 60_000 });

const state = vi.hoisted(() => ({
  settlement: 'usdt' as 'coin' | 'usdt',
  leverage: 2,
}));

vi.mock('@/hooks/usePersistedState', () => ({
  usePersistedState: <T,>(_key: string, d: T) => useState<T>(d),
}));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({
  PreTradeSnapshotDialog: () => null,
}));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    tradingMode: 'direct',
    balance: 2_000_000,
    positionsMap: {},
    ordersMap: {},
    priceMap: {},
    leverageMap: {},
    getSymbolSettlementMode: () => state.settlement,
    setSymbolSettlementMode: vi.fn(),
    getSymbolLeverage: () => state.leverage,
    setSymbolLeverage: vi.fn(),
    getSymbolMarginMode: () => 'isolated',
    setSymbolMarginMode: vi.fn(),
    getEffectiveTime: () => 1_000,
    applySymbolLeverage: vi.fn(),
  }),
}));

function renderPanel(symbol: string, price: number) {
  const onPlaceOrder = vi.fn();
  render(
    <OrderPanel currentPrice={price} onPlaceOrder={onPlaceOrder} disabled={false}
      symbol={symbol} pricePrecision={4} quantityPrecision={1} />,
  );
  return onPlaceOrder;
}

const qtyInput = () => screen.getByTestId('order-qty-input') as HTMLInputElement;
const longButton = () => screen.getByRole('button', { name: '开多' }) as HTMLButtonElement;
const shortButton = () => screen.getByRole('button', { name: '开空' }) as HTMLButtonElement;
const hint = () => screen.queryByTestId('lot-size-hint');
const warning = () => screen.queryByTestId('lot-size-warning');
const clickPercent = (p: number) => fireEvent.click(screen.getByRole('button', { name: `${p}%` }));
const marketTab = () => fireEvent.click(screen.getByRole('button', { name: '市价' }));
const pickAdvanced = (label: string) => {
  fireEvent.click(screen.getByTestId('advanced-type-slot'));
  fireEvent.click(within(screen.getByTestId('advanced-type-menu')).getByRole('button', { name: label }));
};
async function pickUnit(card: 'BASE' | 'CONTRACTS' | 'USDT') {
  fireEvent.click(screen.getByTestId('unit-preference-trigger'));
  fireEvent.click(await screen.findByTestId(`unit-card-${card}`));
}

beforeEach(() => {
  state.settlement = 'usdt';
  state.leverage = 2;
  resetLeverageClampNotices();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('市价单：常驻小字，超过换成警告并置灰', () => {
  it('KAITOUSDT：「单笔市价上限 200,000 KAITO」；填 250,000 → 红色警告写明上限与出路，开多开空都置灰，点了也不下单；200,000 放行', async () => {
    const onPlaceOrder = renderPanel('KAITOUSDT', 1);
    marketTab();
    await pickUnit('BASE');
    expect(hint()).toHaveTextContent('单笔市价上限 200,000 KAITO');
    expect(warning()).toBeNull();

    fireEvent.change(qtyInput(), { target: { value: '250000' } });
    expect(hint()).toBeNull();
    expect(warning()).toHaveTextContent('单笔市价单最多 200,000 KAITO，这一单 250,000 KAITO');
    expect(warning()).toHaveTextContent('请拆成几笔市价单，或改用限价单（限价单单笔最多 2,000,000 KAITO）');
    expect(longButton().disabled).toBe(true);
    expect(shortButton().disabled).toBe(true);
    fireEvent.click(longButton());
    expect(onPlaceOrder).not.toHaveBeenCalled();

    fireEvent.change(qtyInput(), { target: { value: '200000' } });
    expect(warning()).toBeNull();
    expect(longButton().disabled).toBe(false);
  });

  it('按 USDT 金额下单：折出来的币数按 KAITO 的 stepSize（0.1）写，不带一长串浮点尾巴', async () => {
    renderPanel('KAITOUSDT', 1.0905);
    marketTab();
    await pickUnit('USDT');
    fireEvent.change(qtyInput(), { target: { value: '300000' } });
    const text = warning()?.textContent ?? '';
    expect(text).toMatch(/单笔市价单最多 200,000 KAITO，这一单 27\d,\d{3}(\.\d)? KAITO/);
    expect(text).not.toMatch(/\.\d{2,} KAITO/);
  });

  it('仓位比例 100% 按单笔上限封顶（币数档 200,000.0；USDT 金额档按现价折币、留 0.2% 余量 = 199,600.00），「可开」同一个数', async () => {
    renderPanel('KAITOUSDT', 1);
    marketTab();
    await pickUnit('BASE');
    clickPercent(100);
    expect(qtyInput().value).toBe('200000.0');
    expect(warning()).toBeNull();
    expect(screen.getByTestId('max-open-LONG-main')).toHaveTextContent('200,000.0 KAITO');
    clickPercent(50);
    expect(qtyInput().value).toBe('100000.0');
    await pickUnit('USDT');
    clickPercent(100);
    expect(qtyInput().value).toBe('199600.00');
    expect(warning()).toBeNull();
  });

  it('币本位（BTCUSD_PERP）写张数：「单笔市价上限 60,000 张」，60,001 张标红', async () => {
    state.settlement = 'coin';
    renderPanel('BTCUSD', 60_000);
    marketTab();
    await pickUnit('CONTRACTS');
    expect(hint()).toHaveTextContent('单笔市价上限 60,000 张');
    fireEvent.change(qtyInput(), { target: { value: '60001' } });
    expect(warning()).toHaveTextContent('单笔市价单最多 60,000 张，这一单 60,001 张');
    expect(longButton().disabled).toBe(true);
  });

  it('合成币本位 KAITOUSD @1.0905：写明借了 KAITOUSDT；100% 在 21,810 张前留 0.2% 余量（面板价与引擎价可能差一个 tick）', async () => {
    state.settlement = 'coin';
    renderPanel('KAITOUSD', 1.0905);
    marketTab();
    await pickUnit('CONTRACTS');
    expect(hint()).toHaveTextContent('单笔市价上限 21,810 张（按 KAITOUSDT 的 200,000 KAITO 折算）');
    clickPercent(100);
    // ⌊21,810 × 0.998⌋ = 21,766
    expect(qtyInput().value).toBe('21766');
    expect(warning()).toBeNull();
    fireEvent.change(qtyInput(), { target: { value: '21811' } });
    expect(warning()).toHaveTextContent('单笔市价单最多 21,810 张，这一单 21,811 张');
  });
});

/**
 * U 本位按 USDT 下单（面板的默认单位：订单金额 / 初始保证金）：框里是 USDT，引擎拿它 ÷ 现价折成币。
 * 单笔上限以币计、与价无关，但折出来的币数跟着现价走——100% 若恰好填到「上限 × 现价」，跌一个 tick 就又超了、
 * 按钮置灰。按现价折币的（市价、TWAP、跟踪委托）与合成币本位一样在上限前留 0.2% 余量；
 * 条件委托按触发价折币，价钉在触发价上，不留。
 */
describe('U 本位按 USDT 下单：100% 跌一个 tick 也不超上限', () => {
  function renderLive(symbol: string, price: number) {
    const onPlaceOrder = vi.fn();
    const panel = (px: number) => (
      <OrderPanel currentPrice={px} onPlaceOrder={onPlaceOrder} disabled={false}
        symbol={symbol} pricePrecision={4} quantityPrecision={1} />
    );
    const view = render(panel(price));
    return { onPlaceOrder, setPrice: (px: number) => view.rerender(panel(px)) };
  }
  const expectClean = () => {
    expect(warning()).toBeNull();
    expect(longButton().disabled).toBe(false);
    expect(shortButton().disabled).toBe(false);
  };

  it('市价 · 订单金额：KAITOUSDT @1.0905 点 100% = 199,600 × 1.0905 ≈ 217,663.80；跌到 1.0904 / 1.09 / 1.0885 都不标红', async () => {
    const { setPrice } = renderLive('KAITOUSDT', 1.0905);
    marketTab();
    await pickUnit('USDT');
    clickPercent(100);
    const usdt = Number(qtyInput().value);
    expect(usdt).toBeCloseTo(199_600 * 1.0905, 1);
    expectClean();
    for (const px of [1.0904, 1.09, 1.0885]) {
      setPrice(px);
      expect(Number(qtyInput().value)).toBe(usdt);
      expectClean();
    }
  });

  it('市价 · 初始保证金（2x）：100% ≈ 108,831.90，跌一个 tick 不标红', async () => {
    const { setPrice } = renderLive('KAITOUSDT', 1.0905);
    marketTab();
    fireEvent.click(screen.getByTestId('unit-preference-trigger'));
    fireEvent.click(await screen.findByTestId('unit-sub-INITIAL_MARGIN'));
    clickPercent(100);
    expect(Number(qtyInput().value)).toBeCloseTo((199_600 * 1.0905) / 2, 1);
    expectClean();
    setPrice(1.0904);
    expectClean();
  });

  it('TWAP · 订单金额：每一片按执行时的价折币，100% = 20 片 × 199,600 × 0.1；跌到 0.0999 每一片也不超', async () => {
    state.leverage = 1;
    const { setPrice } = renderLive('KAITOUSDT', 0.1);
    pickAdvanced('TWAP');
    await pickUnit('USDT');
    clickPercent(100);
    expect(Number(qtyInput().value)).toBeCloseTo(20 * 199_600 * 0.1, 1);
    expectClean();
    setPrice(0.0999);
    expectClean();
  });

  it('跟踪委托 · 订单金额（没有激活价、有激活价都按现价折币）：100% 跌一个 tick 不标红', async () => {
    const { setPrice } = renderLive('KAITOUSDT', 1.0905);
    pickAdvanced('跟踪委托');
    await pickUnit('USDT');
    clickPercent(100);
    expect(Number(qtyInput().value)).toBeCloseTo(199_600 * 1.0905, 1);
    setPrice(1.0904);
    expectClean();
    fireEvent.change(screen.getByTestId('order-trigger-price'), { target: { value: '1.2' } });
    clickPercent(100);
    setPrice(1.0903);
    expectClean();
  });

  it('条件委托 · 订单金额：按触发价折币、不随现价漂，100% 就是 200,000 × 1.2 = 240,000.00（不留余量）', async () => {
    const { setPrice } = renderLive('KAITOUSDT', 1.0905);
    pickAdvanced('条件委托');
    fireEvent.change(screen.getByTestId('order-trigger-price'), { target: { value: '1.2' } });
    await pickUnit('USDT');
    clickPercent(100);
    expect(qtyInput().value).toBe('240000.00');
    setPrice(1.0904);
    expectClean();
  });
});

describe('触发后按市价成交的类型', () => {
  it('条件委托按触发价折张（合成币本位）：触发价 1.2 上 24,000 张，100% 就是 24,000（价钉在触发价上，不留余量）', async () => {
    state.settlement = 'coin';
    renderPanel('KAITOUSD', 1.0905);
    pickAdvanced('条件委托');
    fireEvent.change(screen.getByTestId('order-trigger-price'), { target: { value: '1.2' } });
    await pickUnit('CONTRACTS');
    expect(hint()).toHaveTextContent('单笔市价上限 24,000 张（按 KAITOUSDT 的 200,000 KAITO 折算）');
    clickPercent(100);
    expect(qtyInput().value).toBe('24000');
  });

  it('TWAP：按每一片算——小字写明片数，100% = 单笔上限 × 片数', async () => {
    state.leverage = 1;
    renderPanel('KAITOUSDT', 0.1);
    pickAdvanced('TWAP');
    await pickUnit('BASE');
    expect(hint()).toHaveTextContent('单笔市价上限 200,000 KAITO · TWAP 按每一片算（共 20 片）');
    clickPercent(100);
    expect(qtyInput().value).toBe('4000000.0');
    expect(hint()).not.toHaveTextContent('价格下跌时');
    fireEvent.change(qtyInput(), { target: { value: '4400000' } });
    expect(warning()).toHaveTextContent('TWAP 每一片（共 20 片）：单笔市价单最多 200,000 KAITO，这一片 220,000 KAITO');
    expect(warning()).toHaveTextContent('请减少总量（每一片 = 总量 ÷ 片数');
    expect(longButton().disabled).toBe(true);
  });

  it('合成币本位的 TWAP：每一片按执行那一刻的价折张，小字写明价格下跌时每片上限随之变小', async () => {
    state.settlement = 'coin';
    renderPanel('KAITOUSD', 1.0905);
    pickAdvanced('TWAP');
    await pickUnit('CONTRACTS');
    expect(hint()).toHaveTextContent('单笔市价上限 21,810 张（按 KAITOUSDT 的 200,000 KAITO 折算） · TWAP 按每一片算（共 20 片），价格下跌时每片上限随之变小');
  });

  it('合成币本位的跟踪委托按激活价下方一个回调幅度折张（1.1 × 0.99 = 1.089 → 21,780 张），100% 就是它', async () => {
    state.settlement = 'coin';
    renderPanel('KAITOUSD', 1.0905);
    pickAdvanced('跟踪委托');
    fireEvent.change(screen.getByTestId('order-trigger-price'), { target: { value: '1.1' } });
    await pickUnit('CONTRACTS');
    expect(hint()).toHaveTextContent('单笔市价上限 21,780 张（按 KAITOUSDT 的 200,000 KAITO 折算） · 按激活价下方一个回调幅度（1.0890）算');
    clickPercent(100);
    expect(qtyInput().value).toBe('21780');
    expect(warning()).toBeNull();
    fireEvent.change(qtyInput(), { target: { value: '22000' } });
    expect(warning()).toHaveTextContent('单笔市价单最多 21,780 张，这一单 22,000 张');
    expect(shortButton().disabled).toBe(true);
    // 回调幅度改成 2%：1.1 × 0.98 = 1.078 → 21,560 张
    fireEvent.change(screen.getByTestId('trailing-callback'), { target: { value: '2' } });
    expect(warning()).toHaveTextContent('单笔市价单最多 21,560 张，这一单 22,000 张');
  });

  it('跟踪委托超过上限同样标红；出路是拆成几张跟踪委托，不叫人改用限价单', async () => {
    renderPanel('KAITOUSDT', 1);
    pickAdvanced('跟踪委托');
    await pickUnit('BASE');
    expect(hint()).toHaveTextContent('单笔市价上限 200,000 KAITO');
    fireEvent.change(qtyInput(), { target: { value: '200001' } });
    expect(warning()).toHaveTextContent('单笔市价单最多 200,000 KAITO，这一单 200,001 KAITO');
    expect(warning()).toHaveTextContent('请拆成几张跟踪委托（每张不超过上限）');
    expect(warning()).not.toHaveTextContent('限价单');
  });

  it('条件委托超过上限：出路是拆成几张条件单——止损方向的触发价上挂限价单会立刻成交，不叫人改用限价单', async () => {
    renderPanel('KAITOUSDT', 1);
    pickAdvanced('条件委托');
    fireEvent.change(screen.getByTestId('order-trigger-price'), { target: { value: '0.95' } });
    await pickUnit('BASE');
    fireEvent.change(qtyInput(), { target: { value: '250000' } });
    expect(warning()).toHaveTextContent('单笔市价单最多 200,000 KAITO，这一单 250,000 KAITO');
    expect(warning()).toHaveTextContent('请拆成几张条件单（每张不超过上限）');
    expect(warning()).not.toHaveTextContent('限价单');
    expect(shortButton().disabled).toBe(true);
  });
});

describe('限价类：不显示市价上限，按 LOT_SIZE 判', () => {
  it('限价单：没有「单笔市价上限」小字；250,000 放行，2,000,001 标红；100% 按限价上限 2,000,000 封顶', async () => {
    renderPanel('KAITOUSDT', 1);
    await pickUnit('BASE');
    fireEvent.change(screen.getByTestId('order-limit-price'), { target: { value: '1' } });
    expect(hint()).toBeNull();
    fireEvent.change(qtyInput(), { target: { value: '250000' } });
    expect(warning()).toBeNull();
    fireEvent.change(qtyInput(), { target: { value: '2000001' } });
    expect(warning()).toHaveTextContent('单笔限价单最多 2,000,000 KAITO，这一单 2,000,001 KAITO');
    expect(warning()).toHaveTextContent('请拆成几笔下单');
    clickPercent(100);
    expect(qtyInput().value).toBe('2000000.0');
    expect(warning()).toBeNull();
  });

  it('快照里查不到的合约：既不显示也不拦', async () => {
    renderPanel('NOTAREALCOINUSDT', 1);
    marketTab();
    await pickUnit('BASE');
    expect(hint()).toBeNull();
    fireEvent.change(qtyInput(), { target: { value: '1000000' } });
    expect(warning()).toBeNull();
  });
});
