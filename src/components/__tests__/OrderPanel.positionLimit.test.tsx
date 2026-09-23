import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderPanel } from '@/components/OrderPanel';
import { toast } from '@/lib/notificationCenter';
import { resetLeverageClampNotices } from '@/lib/leverageClampNotice';
import { DEFAULT_TRADING_PREFERENCES } from '@/lib/tradingPreferences';
import type { PendingOrder, Position } from '@/types/trading';
import { checkOrderPositionLimit, placementOrderNotionalUsd } from '@/lib/positionLimit';
import { formatPrice } from '@/lib/formatters';

/**
 * 下单面板的币安分层上限（-2027）。
 * 用户的原始案例：币本位 KAITOUSD 163,578 张（≈ 1,635,780 USD）、15x 被拦成「最高 10x」——
 * 那是旧的通用表；币安对这个规模只给 2x，15x 最高只能持有 50,000。
 */
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

// 每个用例都整面板渲染、再开 Radix 浮层；首个用例还要付首次渲染的冷启动。
// 机器负载高时单个用例会越过默认的 5 秒；整套并行跑（多个 agent 同时压机器）时 20 秒也会被越过，
// 这里放宽到 60 秒（只影响本文件）——超时在这里从来不是被测逻辑的失败，只是渲染排队。
vi.setConfig({ testTimeout: 60_000 });

const state = vi.hoisted(() => ({
  settlement: 'coin' as 'coin' | 'usdt',
  leverage: 15,
  leverageMap: {} as Record<string, number>,
  positionsMap: {} as Record<string, unknown[]>,
  ordersMap: {} as Record<string, unknown[]>,
  prefs: null as unknown,
  setSymbolLeverage: vi.fn(),
  applySymbolLeverage: vi.fn(),
}));

vi.mock('@/hooks/usePersistedState', () => ({
  usePersistedState: <T,>(key: string, d: T) =>
    useState<T>(key === 'trading_preferences_v1' && state.prefs ? (state.prefs as T) : d),
}));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({
  PreTradeSnapshotDialog: () => null,
}));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    tradingMode: 'direct',
    balance: 2_000_000,
    positionsMap: state.positionsMap,
    ordersMap: state.ordersMap,
    priceMap: {},
    leverageMap: state.leverageMap,
    getSymbolSettlementMode: () => state.settlement,
    setSymbolSettlementMode: vi.fn(),
    getSymbolLeverage: () => state.leverage,
    setSymbolLeverage: state.setSymbolLeverage,
    getSymbolMarginMode: () => 'isolated',
    setSymbolMarginMode: vi.fn(),
    getEffectiveTime: () => 1_000,
    applySymbolLeverage: state.applySymbolLeverage,
  }),
}));

const PRICE = 1.0905;
let seq = 0;
/** stamped：本次更新之后开的仓位（带分层戳）；缺省是更新前的旧仓位。 */
const coinPos = (side: 'LONG' | 'SHORT', contracts: number, stamped = false): Position => ({
  id: `p${++seq}`, side, quantity: contracts, contracts, contractSizeUsd: 10,
  settlementMode: 'coin', settlementAsset: 'KAITO', entryPrice: 1, leverage: 15,
  marginMode: 'isolated', margin: (contracts * 10) / 15, isolatedMargin: (contracts * 10) / 15,
  marginCoin: (contracts * 10) / 15, openTime: 1,
  ...(stamped ? { riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSD' } : {}),
} as Position);
const coinOrder = (contracts: number, over: Partial<PendingOrder> = {}): PendingOrder => ({
  id: `o${++seq}`, side: 'LONG', type: 'LIMIT', price: 1, stopPrice: 0, quantity: contracts, contracts,
  contractSizeUsd: 10, settlementMode: 'coin', settlementAsset: 'KAITO', leverage: 15,
  marginMode: 'isolated', status: 'NEW', createdAt: 0,
  ...over,
} as PendingOrder);

function renderPanel(symbol = 'KAITOUSD', price = PRICE) {
  const onPlaceOrder = vi.fn();
  const view = render(
    <OrderPanel currentPrice={price} onPlaceOrder={onPlaceOrder} disabled={false}
      symbol={symbol} pricePrecision={4} quantityPrecision={1} />,
  );
  const rerender = () => view.rerender(
    <OrderPanel currentPrice={price} onPlaceOrder={onPlaceOrder} disabled={false}
      symbol={symbol} pricePrecision={4} quantityPrecision={1} />,
  );
  return { ...view, onPlaceOrder, rerender };
}

const qtyInput = () => screen.getByTestId('order-qty-input') as HTMLInputElement;
const warning = () => screen.queryByTestId('position-limit-warning');
const longButton = () => screen.getByRole('button', { name: '开多' }) as HTMLButtonElement;
const shortButton = () => screen.getByRole('button', { name: '开空' }) as HTMLButtonElement;
/** 两列「可开」的主读数（按输入框当前那一档的单位）；小字另取。 */
const maxOpenTexts = () => (['LONG', 'SHORT'] as const).map(side => screen.getByTestId(`max-open-${side}-main`).textContent);
const maxOpenSubs = () => (['LONG', 'SHORT'] as const).map(side => screen.queryByTestId(`max-open-${side}-sub`)?.textContent ?? null);

async function useContracts() {
  fireEvent.click(screen.getByTestId('unit-preference-trigger'));
  fireEvent.click(await screen.findByTestId('unit-card-CONTRACTS'));
}

beforeEach(() => {
  state.settlement = 'coin';
  state.leverage = 15;
  state.leverageMap = {};
  state.positionsMap = {};
  state.ordersMap = {};
  state.prefs = null;
  state.setSymbolLeverage = vi.fn();
  state.applySymbolLeverage = vi.fn((_s: string, to: number) => ({ ok: true, refusal: null, to, totalReleaseUsd: 0 }));
  resetLeverageClampNotices();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('用户的原始案例：KAITOUSD 163,578 张', () => {
  it('15x 被拦：最高可持有 50,000 USD，这个规模最高 2x；按钮置灰', async () => {
    renderPanel();
    await useContracts();
    fireEvent.change(qtyInput(), { target: { value: '163578' } });
    expect(warning()).toHaveTextContent(
      '持仓和当前委托价值超过当前杠杆倍数最高可持有头寸：15x 最高 50,000 USD。按这个规模最高可用 2x，请调低杠杆或减少数量。',
    );
    // 旧表的文案不能再出现
    expect(document.body.textContent).not.toContain('名义价值超出当前');
    expect(document.body.textContent).not.toContain('最高 10x');
    // 合成合约：小字说明借的是谁的分层
    expect(screen.getByTestId('position-limit-note'))
      .toHaveTextContent('币安无 KAITO 币本位合约，按 U 本位 KAITOUSDT 分层折算');
    expect(longButton().disabled).toBe(true);
    expect(shortButton().disabled).toBe(true);
  });

  it('2x 放行，下出去的就是 163,578 张', async () => {
    state.leverage = 2;
    const { onPlaceOrder } = renderPanel();
    await useContracts();
    fireEvent.change(qtyInput(), { target: { value: '163578' } });
    expect(warning()).toBeNull();
    expect(longButton().disabled).toBe(false);
    fireEvent.click(longButton());
    expect(onPlaceOrder).toHaveBeenCalledTimes(1);
    expect(onPlaceOrder.mock.calls[0][0]).toMatchObject({ contracts: 163_578, quantity: 163_578, leverage: 2 });
  });

  it('同一张单，杠杆从 15x 调到 2x 后警告消失', async () => {
    const { rerender } = renderPanel();
    await useContracts();
    fireEvent.change(qtyInput(), { target: { value: '163578' } });
    expect(warning()).not.toBeNull();
    state.leverage = 2;
    rerender();
    expect(warning()).toBeNull();
  });
});

describe('判的是持仓 + 当前委托 + 这一单', () => {
  it('双向持仓多空相加：多 20,000 + 空 20,000，再开 15,000 就超了', async () => {
    state.positionsMap = { KAITOUSD: [coinPos('LONG', 2_000), coinPos('SHORT', 2_000)] };
    renderPanel();
    await useContracts();
    fireEvent.change(qtyInput(), { target: { value: '1500' } });
    expect(warning()).toHaveTextContent('15x 最高 50,000 USD');
    expect(warning()).toHaveTextContent('最高可用 10x');
    fireEvent.change(qtyInput(), { target: { value: '1000' } });   // 恰好 50,000
    expect(warning()).toBeNull();
  });

  it('非只减仓的挂单计入，只减仓单不计', async () => {
    state.ordersMap = { KAITOUSD: [coinOrder(4_000)] };
    const first = renderPanel();
    await useContracts();
    fireEvent.change(qtyInput(), { target: { value: '1500' } });
    expect(warning()).not.toBeNull();
    first.unmount();

    state.ordersMap = { KAITOUSD: [coinOrder(4_000, { reduceOnly: true })] };
    renderPanel();
    await useContracts();
    fireEvent.change(qtyInput(), { target: { value: '1500' } });
    expect(warning()).toBeNull();
  });

  it('U 本位按 USDT 计：60,000 在 15x 下超限，这个规模最高 10x', () => {
    state.settlement = 'usdt';
    renderPanel('KAITOUSDT', 1);
    fireEvent.change(qtyInput(), { target: { value: '60000' } });
    expect(warning()).toHaveTextContent('15x 最高 50,000 USDT');
    expect(warning()).toHaveTextContent('最高可用 10x');
    expect(screen.queryByTestId('position-limit-note')).toBeNull();   // 真合约，不用说明
    fireEvent.change(qtyInput(), { target: { value: '50000' } });
    expect(warning()).toBeNull();
  });
});

describe('可开与仓位比例', () => {
  it('可开 = min(可用 × 杠杆, 分层上限 − 现有敞口)，按输入框的单位（币金额档：整张 × 面值 ÷ 折算价）报', () => {
    renderPanel();
    // 可用 2,000,000 × 15 = 30,000,000，但 15x 最高只能持有 50,000 = 5,000 张 = 50,000 ÷ 1.0905 KAITO
    expect(maxOpenTexts()).toEqual(['45,850.527281 KAITO', '45,850.527281 KAITO']);
    expect(maxOpenSubs()).toEqual(['5,000 张 · 50,000.00 USD', '5,000 张 · 50,000.00 USD']);
  });

  it('已有 20,000 的持仓时只剩 30,000', () => {
    state.positionsMap = { KAITOUSD: [coinPos('LONG', 2_000, true)] };
    renderPanel();
    expect(maxOpenTexts()).toEqual(['27,510.316368 KAITO', '27,510.316368 KAITO']);
    expect(maxOpenSubs()).toEqual(['3,000 张 · 30,000.00 USD', '3,000 张 · 30,000.00 USD']);
  });

  it('【复核 r3】可开跟着输入框的单位走：张 / 币保证金 / U 本位币数 / USDT 金额 / USDT 保证金', async () => {
    const coin = renderPanel();
    await useContracts();
    expect(maxOpenTexts()).toEqual(['5,000 张', '5,000 张']);
    expect(maxOpenSubs()).toEqual(['50,000.00 USD', '50,000.00 USD']);
    fireEvent.click(screen.getByTestId('unit-preference-trigger'));
    fireEvent.click(await screen.findByTestId('unit-sub-INITIAL_MARGIN'));
    // 50,000 ÷ 1.0905 ÷ 15 = 3,056.701818… KAITO 保证金（向下取整到 6 位）
    expect(maxOpenTexts()[0]).toBe('3,056.701818 KAITO 保证金');
    coin.unmount();

    state.settlement = 'usdt';
    renderPanel('KAITOUSDT', 1.3);
    setLimitPrice('1.25');
    // 限价 1.25 < 现价 1.3：买单挂着（按委托价估值、不留余量）；卖单已经穿价，等于市价卖出——按现价 1.3 估值、留余量，
    // 折回输入框的金额（币数 × 1.25）：49,900 ÷ 1.3 × 1.25 = 47,980.76
    expect(maxOpenTexts()).toEqual(['50,000.00 USDT', '47,980.76 USDT']);
    expect(maxOpenSubs()).toEqual([null, null]);
    await pickUnit('USDT', 'INITIAL_MARGIN');
    expect(maxOpenTexts()[0]).toBe('3,333.33 USDT 保证金');
    await pickUnit('BASE');
    expect(maxOpenTexts()[0]).toBe('40,000.0 KAITO');
    expect(maxOpenSubs()[0]).toBe('50,000.00 USDT');
  });

  it('拖到 100% 也拖不出一张过不了分层的单', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(screen.getByTestId('coin-effective-qty-hint')).toHaveTextContent('实际下单 5000 张');
    expect(warning()).toBeNull();
    expect(longButton().disabled).toBe(false);
  });

  it('U 本位初始保证金档：100% = 可开名义 ÷ 杠杆', async () => {
    state.settlement = 'usdt';
    renderPanel('KAITOUSDT', 0.95);
    // 限价 1 > 现价 0.95：卖单挂着（估值不随价浮动，不留余量）；买单穿价、按现价 0.95 估值能开得更多——100% 取两列里较小的
    fireEvent.change(screen.getByTestId('order-limit-price'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('unit-preference-trigger'));
    fireEvent.click(await screen.findByTestId('unit-sub-INITIAL_MARGIN'));
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(parseFloat(qtyInput().value)).toBeCloseTo(50_000 / 15, 2);
    expect(warning()).toBeNull();
  });
});

describe('「杠杆分层」浮层', () => {
  it('原来标着「手续费等级」的链接改名，并显示当前杠杆的上限', () => {
    renderPanel();
    expect(document.body.textContent).not.toContain('手续费等级');
    expect(screen.getByTestId('leverage-tier-link')).toHaveTextContent('杠杆分层· 15x 最高 50,000 USD');
  });

  it('点开列出这个合约的全部档位、单位与快照日期', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('leverage-tier-link'));
    const popover = await screen.findByTestId('leverage-tier-popover');
    const rows = within(popover).getAllByTestId('leverage-tier-row');
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent('10–5,00075x1%0');
    expect(rows[3]).toHaveTextContent('425,000–50,00020x2.5%200');
    expect(rows[9]).toHaveTextContent('107,500,000–12,500,0001x50%1,993,100');
    expect(within(popover).getByTestId('leverage-tier-unit')).toHaveTextContent('金额单位：USD');
    expect(within(popover).getByTestId('leverage-tier-snapshot')).toHaveTextContent('快照 2026-09-16');
    expect(within(popover).getByTestId('leverage-tier-note'))
      .toHaveTextContent('币安无 KAITO 币本位合约，按 U 本位 KAITOUSDT 分层折算');
    expect(popover).toHaveTextContent('当前 15x 最高可持有头寸：50,000 USD');
  });

  it('输入的单落在哪一档就标哪一档', async () => {
    renderPanel();
    await useContracts();
    fireEvent.change(qtyInput(), { target: { value: '163578' } });
    fireEvent.click(screen.getByTestId('leverage-tier-link'));
    const popover = await screen.findByTestId('leverage-tier-popover');
    const marked = within(popover).getAllByTestId('leverage-tier-row').filter(r => r.dataset.exposureTier === 'true');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent('91,000,000–7,500,0002x25%118,100');
  });

  it('真币本位（BTCUSD）的档位以 BTC 计', async () => {
    renderPanel('BTCUSD', 60_000);
    fireEvent.click(screen.getByTestId('leverage-tier-link'));
    const popover = await screen.findByTestId('leverage-tier-popover');
    expect(within(popover).getByTestId('leverage-tier-unit')).toHaveTextContent('金额单位：BTC');
    expect(within(popover).getAllByTestId('leverage-tier-row')[0]).toHaveTextContent('10–5125x0.4%0');
    expect(screen.getByTestId('leverage-tier-link')).toHaveTextContent('15x 最高 150 BTC');
    expect(within(popover).queryByTestId('leverage-tier-note')).toBeNull();
  });
});

describe('币本位下不出现写死的 USDT', () => {
  it('警告、浮层、杠杆对话框里的单位都是 USD / 币', async () => {
    renderPanel();
    await useContracts();
    fireEvent.change(qtyInput(), { target: { value: '163578' } });
    fireEvent.click(screen.getByTestId('leverage-tier-link'));
    await screen.findByTestId('leverage-tier-popover');
    fireEvent.click(screen.getByTestId('order-leverage'));
    expect(screen.getByTestId('leverage-max-position')).toHaveTextContent('50,000 USD');
    // 「KAITOUSDT」是币安合约名，不是单位；单位意义上的 USDT 前面不会紧跟字母
    const text = document.body.textContent ?? '';
    expect(text).toContain('KAITOUSDT');
    expect(text).not.toMatch(/(^|[^A-Z])USDT/);
  });
});

describe('杠杆的夹取', () => {
  it('保存的 125x 超过 KAITO 的 75x：面板说一声，而且只说一次', () => {
    state.leverageMap = { KAITOUSD: 125 };
    state.leverage = 75;                     // TradingContext.getSymbolLeverage 已经夹过
    const info = vi.spyOn(toast, 'info');
    const { rerender } = renderPanel();
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toBe('KAITOUSD 杠杆已按合约上限调整为 75x');
    expect(String((info.mock.calls[0][1] as { description?: string })?.description))
      .toContain('保存的 125x 超过该合约（币本位）的最高杠杆 75x');
    rerender();
    rerender();
    expect(info).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('order-leverage')).toHaveTextContent('75x');
  });

  it('没有超过就不打扰', () => {
    state.leverageMap = { KAITOUSD: 20 };
    state.leverage = 20;
    const info = vi.spyOn(toast, 'info');
    renderPanel();
    expect(info).not.toHaveBeenCalled();
  });

  it('偏好里的默认杠杆按合约夹到上限再应用', () => {
    state.prefs = { ...DEFAULT_TRADING_PREFERENCES, useDefaultLeverage: true, defaultLeverage: 50 };
    renderPanel('NOMUSD', 0.011);            // 借 NOMUSDT 的分层：最高 10x
    expect(state.setSymbolLeverage).toHaveBeenCalledWith('NOMUSD', 10, 'any');
  });

  it('默认杠杆没超过上限时原样应用', () => {
    state.prefs = { ...DEFAULT_TRADING_PREFERENCES, useDefaultLeverage: true, defaultLeverage: 50 };
    renderPanel('KAITOUSD');
    expect(state.setSymbolLeverage).toHaveBeenCalledWith('KAITOUSD', 50, 'any');
  });

  it('【复核 r3】面板停在币本位时也不把 U 本位压到币本位的上限：BNBUSDT（75x / 20x）存 50x，由读取时各自夹', () => {
    state.prefs = { ...DEFAULT_TRADING_PREFERENCES, useDefaultLeverage: true, defaultLeverage: 50 };
    renderPanel('BNBUSDT', 600);
    expect(state.setSymbolLeverage).toHaveBeenCalledWith('BNBUSDT', 50, 'any');
  });
});


const usdtPos = (quantity: number, entryPrice = 1, leverage = 15): Position => ({
  id: `u${++seq}`, side: 'LONG', quantity, entryPrice, leverage, marginMode: 'isolated',
  settlementMode: 'usdt', settlementAsset: 'USDT',
  margin: (quantity * entryPrice) / leverage, isolatedMargin: (quantity * entryPrice) / leverage, openTime: 1,
} as Position);

async function pickUnit(card: 'BASE' | 'USDT', sub?: 'ORDER_VALUE' | 'INITIAL_MARGIN') {
  fireEvent.click(screen.getByTestId('unit-preference-trigger'));
  if (sub) fireEvent.click(await screen.findByTestId(`unit-sub-${sub}`));
  else fireEvent.click(await screen.findByTestId(`unit-card-${card}`));
}
const setLimitPrice = (v: string) => fireEvent.change(screen.getByTestId('order-limit-price'), { target: { value: v } });
const clickPercent = (p: number) => fireEvent.click(screen.getByRole('button', { name: `${p}%` }));
const pickAdvanced = (label: string) => {
  fireEvent.click(screen.getByTestId('advanced-type-slot'));
  fireEvent.click(within(screen.getByTestId('advanced-type-menu')).getByRole('button', { name: label }));
};

describe('【回归】仓位比例按钮向下取整，100% 不会自己把单子推过分层上限', () => {
  it('KAITOUSDT 限价 1.09、15x、币数档（1 位小数）：100% = 45,871.5，不是四舍五入出来的 45,871.6', async () => {
    state.settlement = 'usdt';
    // 现价 1.08：卖单挂在 1.09（不穿价，不留余量），它那一列更小，100% 取它
    renderPanel('KAITOUSDT', 1.08);
    await pickUnit('BASE');
    setLimitPrice('1.09');
    clickPercent(100);
    expect(qtyInput().value).toBe('45871.5');
    expect(parseFloat(qtyInput().value) * 1.09).toBeLessThanOrEqual(50_000);
    expect(warning()).toBeNull();
    expect(longButton().disabled).toBe(false);
  });

  it('初始保证金档 12x：100% = 4,166.66（× 12 = 49,999.92），不是 4,166.67', async () => {
    state.settlement = 'usdt';
    state.leverage = 12;
    renderPanel('KAITOUSDT', 0.99);
    setLimitPrice('1');
    await pickUnit('USDT', 'INITIAL_MARGIN');
    clickPercent(100);
    expect(qtyInput().value).toBe('4166.66');
    expect(warning()).toBeNull();
    expect(longButton().disabled).toBe(false);
  });

  it('初始保证金档 75x：100% = 66.66（× 75 = 4,999.5），不是 66.67', async () => {
    state.settlement = 'usdt';
    state.leverage = 75;
    renderPanel('KAITOUSDT', 0.99);
    setLimitPrice('1');
    await pickUnit('USDT', 'INITIAL_MARGIN');
    clickPercent(100);
    expect(qtyInput().value).toBe('66.66');
    expect(warning()).toBeNull();
  });

  it('订单金额档、已有 12,345.674 的持仓：100% 不超过剩下的 37,654.326', () => {
    state.settlement = 'usdt';
    state.positionsMap = { KAITOUSDT: [usdtPos(12_345.674)] };
    renderPanel('KAITOUSDT', 1);
    setLimitPrice('1');
    clickPercent(100);
    const value = parseFloat(qtyInput().value);
    expect(value).toBeLessThanOrEqual(37_654.326);
    expect(value).toBeGreaterThan(37_000);
    expect(warning()).toBeNull();
    expect(longButton().disabled).toBe(false);
  });
});

describe('按现价估值的单：100% 在分层上限前留 0.2% 余量', () => {
  /**
   * 面板按平滑后的显示价估值，引擎按最新价（Index 的 latestChartPriceRef）。
   * 两者差一个 tick，恰好卡在上限上的单就会被引擎拒掉，而面板刚刚说它没问题。
   */
  it('KAITOUSDT 市价 15x、显示价 1.0：100% = 49,900 USDT；引擎按 1.0001 再估一次仍然放行', () => {
    state.settlement = 'usdt';
    const { onPlaceOrder } = renderPanel('KAITOUSDT', 1.0);
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    expect(maxOpenTexts()).toEqual(['49,900.00 USDT', '49,900.00 USDT']);
    clickPercent(100);
    expect(qtyInput().value).toBe('49900.00');
    expect(warning()).toBeNull();
    fireEvent.click(longButton());
    const params = onPlaceOrder.mock.calls[0][0];
    const engine = checkOrderPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions: [], orders: [], markPrice: 1.0001,
      orderNotionalUsd: placementOrderNotionalUsd('KAITOUSDT', params, 1.0001),
    });
    expect(engine.ok).toBe(true);
  });

  it('【复核 r5】币数档同样留余量；挂着的限价单且没有持仓时不留（价格不会漂）；穿价或贴着现价的限价单留', async () => {
    state.settlement = 'usdt';
    renderPanel('KAITOUSDT', 1.0);
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    await pickUnit('BASE');
    clickPercent(100);
    expect(qtyInput().value).toBe('49900.0');
    expect(maxOpenTexts()).toEqual(['49,900.0 KAITO', '49,900.0 KAITO']);
    fireEvent.click(screen.getByRole('button', { name: '限价' }));
    setLimitPrice('0.99');
    // 买单挂在 0.99：50,000 ÷ 0.99；卖单 0.99 已经穿价（等于市价卖出）：按现价 1.0 估值、留余量
    expect(maxOpenTexts()).toEqual(['50,505.0 KAITO', '49,900.0 KAITO']);
    expect(maxOpenSubs()).toEqual(['50,000.00 USDT', '49,900.00 USDT']);
    // 100% 取限价挂得住的那一列（买单）：卖单那边等于市价卖出，标红并说明是因为卖价已经穿价
    clickPercent(100);
    expect(qtyInput().value).toBe('50505.0');
    expect(longButton().disabled).toBe(false);
    expect(shortButton().disabled).toBe(true);
    expect(warning()?.textContent?.startsWith('开空：卖价已穿过现价、下一根就成交，按现价估值：')).toBe(true);
    // 手填成卖单那一列的量：两个按钮都点得了
    fireEvent.change(qtyInput(), { target: { value: '49900' } });
    expect(warning()).toBeNull();
    expect(longButton().disabled).toBe(false);
    expect(shortButton().disabled).toBe(false);
    // 买价 = 现价：下一根就成交，两个方向都按现价估值、都留余量
    setLimitPrice('1');
    expect(maxOpenTexts()).toEqual(['49,900.0 KAITO', '49,900.0 KAITO']);
    // 离现价不到 0.2% 的买单：面板与引擎可能对穿没穿价看法不同，同样留余量（49,900 ÷ 0.999）
    setLimitPrice('0.999');
    expect(maxOpenTexts()[0]).toBe('49,949.9 KAITO');
  });

  it('合成币本位按面值计、与价格无关：不留余量（仍是整 5,000 张）', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(screen.getByTestId('coin-effective-qty-hint')).toHaveTextContent('实际下单 5000 张');
  });

  it('真币本位（BTCUSD，以 BTC 计、随价变）：留余量', () => {
    renderPanel('BTCUSD', 60_000);
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    // 15x 最高 150 BTC = 9,000,000 USD；留 0.2% → 8,982,000 USD = 89,820 张 = 149.7 BTC
    expect(maxOpenTexts()).toEqual(['149.700000 BTC', '149.700000 BTC']);
    expect(maxOpenSubs()).toEqual(['89,820 张 · 8,982,000.00 USD', '89,820 张 · 8,982,000.00 USD']);
  });
});

describe('【回归】分段订单与跟踪委托：面板与引擎按同一个价给这一单估值', () => {
  it('分段做多 55,000（0.5→1.0 五笔）：引擎估 41,250，开多不拦；开空的话五笔全都穿价（= 市价卖 55,000），开空拦', () => {
    state.settlement = 'usdt';
    renderPanel('KAITOUSDT', 1.0);
    pickAdvanced('分段订单');
    fireEvent.change(screen.getByTestId('scaled-start'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByTestId('scaled-end'), { target: { value: '1.0' } });
    fireEvent.change(screen.getByTestId('scaled-count'), { target: { value: '5' } });
    fireEvent.change(qtyInput(), { target: { value: '55000' } });
    expect(longButton().disabled).toBe(false);
    expect(shortButton().disabled).toBe(true);
    expect(warning()?.textContent?.startsWith('开空：')).toBe(true);
    expect(warning()).not.toHaveTextContent('开多：');
  });

  it('分段做空 45,000（1.0→1.5 五笔）：引擎估 56,250，面板就拦', () => {
    state.settlement = 'usdt';
    renderPanel('KAITOUSDT', 1.0);
    pickAdvanced('分段订单');
    fireEvent.change(screen.getByTestId('scaled-start'), { target: { value: '1.0' } });
    fireEvent.change(screen.getByTestId('scaled-end'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByTestId('scaled-count'), { target: { value: '5' } });
    fireEvent.change(qtyInput(), { target: { value: '45000' } });
    expect(warning()).toHaveTextContent('15x 最高 50,000 USDT');
    expect(shortButton().disabled).toBe(true);
  });

  it('【复核 r5】分段做空 100%（1.0→1.5）：按离现价最远的一笔（1.5）成交那一刻封顶，全部成交后也不超过上限', () => {
    state.settlement = 'usdt';
    const { onPlaceOrder } = renderPanel('KAITOUSDT', 1.0);
    pickAdvanced('分段订单');
    fireEvent.change(screen.getByTestId('scaled-start'), { target: { value: '1.0' } });
    fireEvent.change(screen.getByTestId('scaled-end'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByTestId('scaled-count'), { target: { value: '5' } });
    clickPercent(100);
    expect(warning()).toBeNull();
    fireEvent.click(shortButton());
    const params = onPlaceOrder.mock.calls[0][0];
    // 引擎按子单委托价估值（阶梯均价 1.25）放得下；价格涨到 1.5 时五笔都已成交：币数 × 1.5 ≤ 50,000
    expect(placementOrderNotionalUsd('KAITOUSDT', params, 1.0, 1.0)).toBeLessThanOrEqual(50_000);
    expect(params.quantity * 1.5).toBeLessThanOrEqual(50_000);
    expect(params.quantity * 1.5).toBeGreaterThan(49_900);
  });

  it('币本位分段 100%（3 笔）：张数取到 3 的整数倍，引擎拆出来的子单合计不超过 5,000 张', async () => {
    const { onPlaceOrder } = renderPanel('KAITOUSD', 1.0);
    pickAdvanced('分段订单');
    fireEvent.change(screen.getByTestId('scaled-start'), { target: { value: '0.9' } });
    fireEvent.change(screen.getByTestId('scaled-end'), { target: { value: '1.0' } });
    fireEvent.change(screen.getByTestId('scaled-count'), { target: { value: '3' } });
    await useContracts();
    clickPercent(100);
    expect(qtyInput().value).toBe('4998');
    expect(warning()).toBeNull();
    fireEvent.click(longButton());
    const params = onPlaceOrder.mock.calls[0][0];
    // 不取整数倍时是 5,000 张 → round(5000 / 3) × 3 = 5,001 张 = 50,010 USD，面板自己就会标红
    expect(placementOrderNotionalUsd('KAITOUSD', params, 1.0)).toBe(49_980);
  });

  it('跟踪委托按激活价估值：45,000 USDT、激活价 1.2 → 54,000，面板就拦', () => {
    state.settlement = 'usdt';
    renderPanel('KAITOUSDT', 1.0);
    pickAdvanced('跟踪委托');
    fireEvent.change(screen.getByTestId('order-trigger-price'), { target: { value: '1.2' } });
    fireEvent.change(qtyInput(), { target: { value: '45000' } });
    expect(warning()).toHaveTextContent('15x 最高 50,000 USDT');
    // 没有激活价时按现价估：45,000 放行
    fireEvent.change(screen.getByTestId('order-trigger-price'), { target: { value: '' } });
    expect(warning()).toBeNull();
  });
});

describe('杠杆对话框把面板的结算方式交给引擎', () => {
  it.each([['coin', 'KAITOUSD'], ['usdt', 'KAITOUSDT']] as const)('%s', (settlement, symbol) => {
    state.settlement = settlement;
    renderPanel(symbol, 1);
    fireEvent.click(screen.getByTestId('order-leverage'));
    const input = screen.getByTestId('leverage-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByTestId('leverage-confirm'));
    expect(state.applySymbolLeverage).toHaveBeenCalledWith(symbol, 20, settlement);
  });
});

describe('【复核】条件委托：面板同样按触发价再判一道（与引擎下单同一个判定）', () => {
  /** U 本位 20x 最高 50,000：空 24,000 @1.0。多头条件单 24,000 @1.05 → 触发时 25,200 + 25,200 = 50,400。 */
  const setup = async () => {
    state.settlement = 'usdt';
    state.leverage = 20;
    // 本次更新之后开的空仓（带分层戳）：没有旧仓位，这张多头条件单不享受对冲豁免
    state.positionsMap = { KAITOUSDT: [{ ...usdtPos(24_000, 1, 20), side: 'SHORT', riskModel: 'binance-tiers-v1' }] };
    const view = renderPanel('KAITOUSDT', 1.0);
    pickAdvanced('条件委托');
    await pickUnit('BASE');
    return view;
  };
  const setTrigger = (v: string) => fireEvent.change(screen.getByTestId('order-trigger-price'), { target: { value: v } });

  it('触发价 1.05：面板就标红、按钮置灰，并说明是按触发价估的', async () => {
    await setup();
    setTrigger('1.05');
    fireEvent.change(qtyInput(), { target: { value: '24000' } });
    expect(warning()).toHaveTextContent('按触发价 1.05');
    expect(warning()).toHaveTextContent('20x 最高 50,000 USDT');
    expect(longButton().disabled).toBe(true);
  });

  it('触发价 0.95：两道都过，不拦', async () => {
    await setup();
    setTrigger('0.95');
    fireEvent.change(qtyInput(), { target: { value: '24000' } });
    expect(warning()).toBeNull();
    expect(longButton().disabled).toBe(false);
  });

  it('100% 按两道余量的较小者封顶：下出去的单在触发价上也不超过上限', async () => {
    const { onPlaceOrder } = await setup();
    setTrigger('1.05');
    clickPercent(100);
    expect(warning()).toBeNull();
    fireEvent.click(longButton());
    const params = onPlaceOrder.mock.calls[0][0];
    expect(params.type).toBe('CONDITIONAL');
    // 触发那一刻：持仓 24,000 × 1.05 + 这一单 × 1.05 ≤ 50,000
    expect(24_000 * 1.05 + params.quantity * 1.05).toBeLessThanOrEqual(50_000);
    expect(params.quantity).toBeGreaterThan(23_000);
  });
});

// ───────────────────────── 复核第三轮 ─────────────────────────

describe('【复核 r3】真币本位的买入限价单按委托价折币：100% 下出去、成交后仓位仍在上限之内', () => {
  it('BTCUSD 现价 100,000、125x（最高 5 BTC）、限价 90,000：100% = 4,500 张（旧口径按现价折是 4,990 张 → 成交后 5.54 BTC）', async () => {
    state.leverage = 125;
    const { onPlaceOrder } = renderPanel('BTCUSD', 100_000);
    setLimitPrice('90000');
    await useContracts();
    clickPercent(100);
    expect(qtyInput().value).toBe('4500');
    // 卖出 90,000 已经穿价（等于市价卖出）：按现价估值、留余量 → 4,990 张
    expect(maxOpenTexts()).toEqual(['4,500 张', '4,990 张']);
    expect(warning()).toBeNull();
    fireEvent.click(longButton());
    const params = onPlaceOrder.mock.calls[0][0];
    expect(params).toMatchObject({ type: 'LIMIT', price: 90_000, contracts: 4_500 });
    // 成交在 90,000：仓位 4,500 × 100 ÷ 90,000 = 5 BTC，恰好在 125x 的上限上；再多一张面板就拦
    expect(checkOrderPositionLimit({
      symbol: 'BTCUSD', settlement: 'coin', leverage: 125, markPrice: 90_000, orders: [], orderNotionalUsd: 0,
      positions: [{ ...coinPos('LONG', 4_500, true), contractSizeUsd: 100, settlementAsset: 'BTC', entryPrice: 90_000, leverage: 125 }],
    })).toMatchObject({ ok: true, exposureBefore: 5 });
    fireEvent.change(qtyInput(), { target: { value: '4501' } });
    expect(warning()).toHaveTextContent('125x 最高 5 BTC');
    expect(longButton().disabled).toBe(true);
  });
});

describe('【复核 r3】已挂的带戳条件单：这张单下出去后触发时会被拒——面板提醒但不拦', () => {
  const stampedShort = (qty: number) => ({ ...usdtPos(qty, 1, 15), side: 'SHORT' as const, riskModel: 'binance-tiers-v1' as const });
  const longStop = (qty: number, over: Partial<PendingOrder> = {}) => ({
    id: `stop${++seq}`, side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice: 1.2, quantity: qty, leverage: 15,
    marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', status: 'PENDING', createdAt: 0,
    riskModel: 'binance-tiers-v1', ...over,
  } as PendingOrder);

  it('KAITOUSDT 15x：空 20,000 + 多头条件单 20,000 @1.2；市价空 5,000 → 提醒、按钮照常可点；空 1,000 不提醒', async () => {
    state.settlement = 'usdt';
    state.positionsMap = { KAITOUSDT: [stampedShort(20_000)] };
    state.ordersMap = { KAITOUSDT: [longStop(20_000)] };
    const { onPlaceOrder } = renderPanel('KAITOUSDT', 1.0);
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    await pickUnit('BASE');
    fireEvent.change(qtyInput(), { target: { value: '5000' } });
    const box = screen.getByTestId('trigger-risk-warning');
    expect(box).toHaveTextContent(`这张单下出去后，已挂的做多条件单 ${formatPrice(1.2)} 触发时会因超出当前杠杆最高可持有头寸被拒`);
    expect(box).toHaveTextContent('= 54,000 USDT');
    expect(warning()).toBeNull();
    expect(shortButton().disabled).toBe(false);
    fireEvent.click(shortButton());
    expect(onPlaceOrder).toHaveBeenCalledTimes(1);

    fireEvent.change(qtyInput(), { target: { value: '1000' } });
    expect(screen.queryByTestId('trigger-risk-warning')).toBeNull();
  });

  it('【复核 r5 · 二】路的起点是现价：挂着穿价的买入限价 20,000 @1.1，到 1.2 时已是持仓（24,000）——市价空 2,000 提醒，空 1,000 不提醒', async () => {
    state.settlement = 'usdt';
    state.positionsMap = { KAITOUSDT: [] };
    state.ordersMap = {
      KAITOUSDT: [
        {
          id: 'crossed-buy', side: 'LONG', type: 'LIMIT', price: 1.1, stopPrice: 0, quantity: 20_000, leverage: 15,
          marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', status: 'NEW', createdAt: 0,
          riskModel: 'binance-tiers-v1',
        } as PendingOrder,
        longStop(20_000),
      ],
    };
    renderPanel('KAITOUSDT', 1.0);
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    await pickUnit('BASE');
    // 到 1.2：24,000 + 24,000 + 2,400 = 50,400（不知道现价的话，买单按 1.1 挂着：22,000 + 24,000 + 2,400 = 48,400）
    fireEvent.change(qtyInput(), { target: { value: '2000' } });
    const box = screen.getByTestId('trigger-risk-warning');
    expect(box).toHaveTextContent(`已挂的做多条件单 ${formatPrice(1.2)} 触发时会因超出当前杠杆最高可持有头寸被拒`);
    expect(box).toHaveTextContent('= 50,400 USDT');
    expect(shortButton().disabled).toBe(false);
    fireEvent.change(qtyInput(), { target: { value: '1000' } });
    expect(screen.queryByTestId('trigger-risk-warning')).toBeNull();
  });

  it('更新前挂的条件单（没有戳）触发时不再判：不提醒', async () => {
    state.settlement = 'usdt';
    state.positionsMap = { KAITOUSDT: [stampedShort(20_000)] };
    state.ordersMap = { KAITOUSDT: [longStop(20_000, { riskModel: undefined })] };
    renderPanel('KAITOUSDT', 1.0);
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    await pickUnit('BASE');
    fireEvent.change(qtyInput(), { target: { value: '5000' } });
    expect(screen.queryByTestId('trigger-risk-warning')).toBeNull();
  });

  it('杠杆对话框：空 10,000 @20x + 多头止损对冲 11,000 @1.2，滑到 25x → 确认前提醒，确认键照常可点', () => {
    state.settlement = 'usdt';
    state.leverage = 20;
    state.positionsMap = { KAITOUSDT: [{ ...stampedShort(10_000), leverage: 20 }] };
    state.ordersMap = { KAITOUSDT: [longStop(11_000, { leverage: 20 })] };
    renderPanel('KAITOUSDT', 1.0);
    fireEvent.click(screen.getByTestId('order-leverage'));
    const input = screen.getByTestId('leverage-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('leverage-trigger-risk'))
      .toHaveTextContent(`杠杆调到 25x 后，已挂的做多条件单 ${formatPrice(1.2)} 触发时会因超出当前杠杆最高可持有头寸被拒`);
    expect((screen.getByTestId('leverage-confirm') as HTMLButtonElement).disabled).toBe(false);
    // 21x–25x 同属一档（最高 25,000）：21x 同样提醒；回到 20x（最高 50,000）就没有了
    fireEvent.change(input, { target: { value: '21' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('leverage-trigger-risk')).toHaveTextContent('杠杆调到 21x 后');
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.blur(input);
    expect(screen.queryByTestId('leverage-trigger-risk')).toBeNull();
  });
});

describe('【复核 r3】更新前的旧仓位超过新上限：开空（对冲）可下，开多（加仓）被拦', () => {
  it('KAITOUSD 旧多仓 20,000 张 @20x（新规则 20x 最高 50,000）：空 1,000 张放行、多 1,000 张标红；可开两列不同', async () => {
    state.leverage = 20;
    state.positionsMap = { KAITOUSD: [{ ...coinPos('LONG', 20_000), leverage: 20 }] };
    const { onPlaceOrder } = renderPanel('KAITOUSD', 1.0);
    await useContracts();
    fireEvent.change(qtyInput(), { target: { value: '1000' } });
    expect(longButton().disabled).toBe(true);
    expect(shortButton().disabled).toBe(false);
    const text = warning()?.textContent ?? '';
    expect(text.startsWith('开多：现有持仓和当前委托价值 200,000 USD（含更新前按旧规则开的仓位）已超过')).toBe(true);
    expect(text).toContain('反向开仓对冲更新前的仓位不受此限，最多 200,000 USD。');
    expect(text).not.toContain('开空：');
    expect(maxOpenTexts()).toEqual(['0 张', '20,000 张']);
    fireEvent.click(shortButton());
    expect(onPlaceOrder).toHaveBeenCalledTimes(1);
    expect(onPlaceOrder.mock.calls[0][0]).toMatchObject({ side: 'SHORT', contracts: 1_000 });
    fireEvent.click(longButton());
    expect(onPlaceOrder).toHaveBeenCalledTimes(1);
    // 仓位比例按钮取两列里较小的那个，开多那一列是 0（点不了）就取另一列：100% = 20,000 张（整份旧仓位的对冲）
    clickPercent(100);
    expect(qtyInput().value).toBe('20000');
    expect(shortButton().disabled).toBe(false);
  });
});

describe('【复核 r3】账户区的维持保证金按仓位的风险模型算', () => {
  it('KAITOUSDT 60,000 @1.0、10x：分层仓位 60,000 × 5% − 1,450 = 1,550；旧仓位 60,000 × 0.4% = 240', () => {
    state.settlement = 'usdt';
    state.positionsMap = { KAITOUSDT: [{ ...usdtPos(60_000, 1, 10), riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT' }] };
    const tiered = renderPanel('KAITOUSDT', 1.0);
    expect(screen.getByTestId('account-maintenance')).toHaveTextContent('1,550.0000 USDT');
    tiered.unmount();
    state.positionsMap = { KAITOUSDT: [usdtPos(60_000, 1, 10)] };
    renderPanel('KAITOUSDT', 1.0);
    expect(screen.getByTestId('account-maintenance')).toHaveTextContent('240.0000 USDT');
  });
});

describe('【复核 v1】对冲更新前仓位的豁免：按仓位大小比，靠它放行的单在按钮前说明按旧模型开', () => {
  it('KAITOUSD 旧多 20,000 张 @20x：空 20,000 张可下并说明按旧模型；多那一边不说；超过 20,000 张不再说', async () => {
    state.leverage = 20;
    state.positionsMap = { KAITOUSD: [{ ...coinPos('LONG', 20_000), leverage: 20 }] };
    renderPanel('KAITOUSD', 1.0);
    await useContracts();
    expect(screen.queryByTestId('legacy-hedge-note')).toBeNull();
    fireEvent.change(qtyInput(), { target: { value: '20000' } });
    expect(shortButton().disabled).toBe(false);
    const note = screen.getByTestId('legacy-hedge-note');
    expect(note).toHaveTextContent('开空：这一单是对冲更新前的仓位，不受分层上限约束；开出的仓位与它对冲的旧仓位一样按旧模型计维持保证金（0.4%）');
    expect(note).not.toHaveTextContent('开多');
    fireEvent.change(qtyInput(), { target: { value: '20001' } });
    expect(shortButton().disabled).toBe(true);
    expect(screen.queryByTestId('legacy-hedge-note')).toBeNull();
  });

  it('正常放行（没有旧仓位）不说', async () => {
    renderPanel('KAITOUSD', 1.0);
    await useContracts();
    fireEvent.change(qtyInput(), { target: { value: '10' } });
    expect(screen.queryByTestId('legacy-hedge-note')).toBeNull();
  });

  it('KAITOUSDT 旧空 200,000 @20x、买入限价 0.8：可开 = 200,000 KAITO（与旧仓位同样大），100% 下的单引擎也放行', async () => {
    state.settlement = 'usdt';
    state.leverage = 20;
    state.positionsMap = { KAITOUSDT: [{ ...usdtPos(200_000, 1, 20), side: 'SHORT' }] };
    const { onPlaceOrder } = renderPanel('KAITOUSDT', 1.0);
    await pickUnit('BASE');
    setLimitPrice('0.8');
    // 持仓按标记价估值会漂：留 0.2% 余量（200,000 × 0.998）
    expect(maxOpenTexts()[0]).toBe('199,600.0 KAITO');
    clickPercent(100);
    expect(qtyInput().value).toBe('199600.0');
    expect(longButton().disabled).toBe(false);
    fireEvent.click(longButton());
    const params = onPlaceOrder.mock.calls[0][0];
    const engine = checkOrderPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20, positions: state.positionsMap.KAITOUSDT as Position[], orders: [],
      markPrice: 1.0001, orderNotionalUsd: placementOrderNotionalUsd('KAITOUSDT', params, 0.8), orderPrice: 0.8, side: 'LONG',
    });
    expect(engine).toMatchObject({ ok: true, reason: 'legacy-hedge' });
    // 250,000 个币（= 200,000 USDT @0.8）不再放行
    fireEvent.change(qtyInput(), { target: { value: '250000' } });
    expect(longButton().disabled).toBe(true);
  });
});

// ───────────────────────── 复核第五轮 ─────────────────────────

describe('【复核 r5】限价单：挂着的按成交那一刻再封顶，穿价的按现价估值', () => {
  const btcLong = (contracts: number) => ({
    ...coinPos('LONG', contracts, true), contractSizeUsd: 100, settlementAsset: 'BTC', entryPrice: 100_000, leverage: 125,
    riskSymbol: 'BTCUSD',
  });

  it('【F3】BTCUSD 125x、已有多 2,000 张、买入限价 90,000：100% = 2,500 张（成交后正好 5 BTC）；2,501 张标红', async () => {
    state.leverage = 125;
    state.positionsMap = { BTCUSD: [btcLong(2_000)] };
    const { onPlaceOrder } = renderPanel('BTCUSD', 100_000);
    setLimitPrice('90000');
    await useContracts();
    // 开多：现价那一道留余量是 2,691 张，成交那一刻（持仓按 90,000 估值）只有 2,500 张；开空已经穿价，按现价 2,990 张
    expect(maxOpenTexts()).toEqual(['2,500 张', '2,990 张']);
    clickPercent(100);
    expect(qtyInput().value).toBe('2500');
    expect(warning()).toBeNull();
    fireEvent.click(longButton());
    expect(onPlaceOrder.mock.calls[0][0]).toMatchObject({ type: 'LIMIT', price: 90_000, contracts: 2_500 });
    expect(checkOrderPositionLimit({
      symbol: 'BTCUSD', settlement: 'coin', leverage: 125, markPrice: 90_000, orders: [], orderNotionalUsd: 0,
      positions: [btcLong(4_500)],
    })).toMatchObject({ ok: true, exposureBefore: 5 });
    fireEvent.change(qtyInput(), { target: { value: '2501' } });
    expect(longButton().disabled).toBe(true);
    expect(warning()).toHaveTextContent(`按委托价 ${formatPrice(90_000)} 成交那一刻估值：`);
    expect(warning()).toHaveTextContent('125x 最高 5 BTC');
  });

  it('【F4】BTCUSD 125x、没有持仓、买入限价 100,100（穿价）：开多 4,990 张（按现价、留余量）；100% 取挂得住的卖单那一列 4,994 张，开多照样放得下、成交后 4.994 BTC', async () => {
    state.leverage = 125;
    const { onPlaceOrder } = renderPanel('BTCUSD', 100_000);
    setLimitPrice('100100');
    await useContracts();
    // 开空时 100,100 是挂着的卖单：按委托价折币；离现价不到 0.2%，同样留余量 → (5 − 0.01) BTC × 100,100 = 4,994 张
    expect(maxOpenTexts()).toEqual(['4,990 张', '4,994 张']);
    clickPercent(100);
    expect(qtyInput().value).toBe('4994');
    expect(warning()).toBeNull();
    fireEvent.click(longButton());
    expect(onPlaceOrder.mock.calls[0][0]).toMatchObject({ side: 'LONG', type: 'LIMIT', price: 100_100, contracts: 4_994 });
    // 下一根按现价（再高一个 tick 也一样）成交：4,994 张 = 4.994 BTC，不超过 5 BTC
    for (const mark of [100_000, 99_990]) {
      expect(checkOrderPositionLimit({
        symbol: 'BTCUSD', settlement: 'coin', leverage: 125, markPrice: mark, orders: [], orderNotionalUsd: 0,
        positions: [{ ...coinPos('LONG', 4_994, true), contractSizeUsd: 100, settlementAsset: 'BTC', entryPrice: 100_100, leverage: 125, riskSymbol: 'BTCUSD' }],
      }).ok).toBe(true);
    }
    fireEvent.change(qtyInput(), { target: { value: '5005' } });
    expect(longButton().disabled).toBe(true);
    expect(shortButton().disabled).toBe(false);
    expect(warning()?.textContent?.startsWith('开多：买价已穿过现价、下一根就成交，按现价估值：')).toBe(true);
  });

  it('【F4】U 本位卖出限价 0.95（现价 1.0，穿价）：开空一列 49,900 个币（按现价、留余量），不是 52,631；100% 取挂得住的买单那一列，开空标红、下不出超限的单', async () => {
    state.settlement = 'usdt';
    const { onPlaceOrder } = renderPanel('KAITOUSDT', 1.0);
    await pickUnit('BASE');
    setLimitPrice('0.95');
    expect(maxOpenTexts()).toEqual(['52,631.5 KAITO', '49,900.0 KAITO']);
    clickPercent(100);
    expect(qtyInput().value).toBe('52631.5');
    expect(longButton().disabled).toBe(false);
    expect(shortButton().disabled).toBe(true);
    expect(warning()?.textContent?.startsWith('开空：卖价已穿过现价、下一根就成交，按现价估值：')).toBe(true);
    // 按开空那一列下：放得下，下一根按现价（高一个 tick）成交后 49,904.99 ≤ 50,000
    fireEvent.change(qtyInput(), { target: { value: '49900' } });
    expect(shortButton().disabled).toBe(false);
    fireEvent.click(shortButton());
    const params = onPlaceOrder.mock.calls[0][0];
    expect(params).toMatchObject({ side: 'SHORT', type: 'LIMIT', price: 0.95, quantity: 49_900 });
    expect(checkOrderPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, markPrice: 1.0001, orders: [], orderNotionalUsd: 0,
      positions: [{ ...usdtPos(49_900, 0.95), side: 'SHORT', riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT' }],
    }).ok).toBe(true);
  });

  it('【复现】真币本位卖出限价高于现价（BTCUSD 15x、现价 100,000、卖价 125,000）：100% 取挂得住的卖单那一列 187,500 张，不是 149,700', async () => {
    renderPanel('BTCUSD', 100_000);
    setLimitPrice('125000');
    await useContracts();
    expect(maxOpenTexts()).toEqual(['149,700 张', '187,500 张']);
    clickPercent(100);
    expect(qtyInput().value).toBe('187500');
    expect(shortButton().disabled).toBe(false);
    expect(longButton().disabled).toBe(true);
    expect(warning()?.textContent?.startsWith('开多：买价已穿过现价、下一根就成交，按现价估值：')).toBe(true);
    // 187,500 张在 125,000 成交 = 150 BTC，正好是 15x 的上限
    expect(checkOrderPositionLimit({
      symbol: 'BTCUSD', settlement: 'coin', leverage: 15, markPrice: 125_000, orders: [], orderNotionalUsd: 0,
      positions: [{ ...coinPos('SHORT', 187_500, true), contractSizeUsd: 100, settlementAsset: 'BTC', entryPrice: 125_000, riskSymbol: 'BTCUSD' }],
    })).toMatchObject({ ok: true, exposureBefore: 150 });
  });

  it('对冲豁免让两列不同（没有穿价）：100% 取较大的那一列——整份对冲；往旧仓位那一侧点会标红', async () => {
    state.leverage = 20;
    state.positionsMap = { KAITOUSD: [{ ...coinPos('LONG', 4_000), leverage: 20 }] };
    renderPanel('KAITOUSD', 1.0);
    await useContracts();
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    // 合成币本位按面值计、不留余量。开多：50,000 − 40,000 = 10,000 USD；开空：普通 10,000，豁免额度 40,000
    expect(maxOpenTexts()).toEqual(['1,000 张', '4,000 张']);
    clickPercent(100);
    expect(qtyInput().value).toBe('4000');
    expect(shortButton().disabled).toBe(false);
    expect(longButton().disabled).toBe(true);
  });

  it('【F3】U 本位：空 20,000、卖出限价 1.1：100% = 25,454.5 个币（成交后 50,000），不是 27,181', async () => {
    state.settlement = 'usdt';
    state.positionsMap = { KAITOUSDT: [{ ...usdtPos(20_000), side: 'SHORT', riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT' }] };
    renderPanel('KAITOUSDT', 1.0);
    await pickUnit('BASE');
    setLimitPrice('1.1');
    expect(maxOpenTexts()[1]).toBe('25,454.5 KAITO');
    clickPercent(100);
    expect(qtyInput().value).toBe('25454.5');
    expect((20_000 + 25_454.5) * 1.1).toBeLessThanOrEqual(50_000);
    expect(warning()).toBeNull();
  });
});

describe('【复核 r5】已挂的对冲单：回调限价加仓到触发价时已是持仓，面板提醒', () => {
  it('KAITOUSDT 15x：空 10,000 + 多头对冲 22,272 @1.15；卖出限价 12,272 @1.05 → 提醒对冲到时会被拒；11,000 不提醒', async () => {
    state.settlement = 'usdt';
    state.positionsMap = { KAITOUSDT: [{ ...usdtPos(10_000), side: 'SHORT', riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT' }] };
    state.ordersMap = {
      KAITOUSDT: [{
        id: 'hedge', side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice: 1.15, quantity: 22_272, leverage: 15,
        marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', status: 'PENDING', createdAt: 0,
        riskModel: 'binance-tiers-v1',
      }],
    };
    renderPanel('KAITOUSDT', 1.0);
    await pickUnit('BASE');
    setLimitPrice('1.05');
    fireEvent.change(qtyInput(), { target: { value: '12272' } });
    expect(screen.getByTestId('trigger-risk-warning'))
      .toHaveTextContent(`已挂的做多条件单 ${formatPrice(1.15)} 触发时会因超出当前杠杆最高可持有头寸被拒`);
    expect(shortButton().disabled).toBe(false);
    // 到 1.15：(10,000 + 11,000) × 1.15 + 22,272 × 1.15 = 49,762.8 ≤ 50,000
    fireEvent.change(qtyInput(), { target: { value: '11000' } });
    expect(screen.queryByTestId('trigger-risk-warning')).toBeNull();
  });
});

describe('【复核 r5】来源：豁免说明写清挂着的单还要再判；口径不同的两笔说明不合并', () => {
  it('KAITOUSD 旧多 20,000 张：空 20,000 张的限价对冲——说明写「不能再给别的单当豁免额度」与「挂着的这张单…还会再判」；市价对冲不说后半句', async () => {
    state.leverage = 20;
    state.positionsMap = { KAITOUSD: [{ ...coinPos('LONG', 20_000), leverage: 20 }] };
    renderPanel('KAITOUSD', 1.0);
    await useContracts();
    setLimitPrice('1.05');
    fireEvent.change(qtyInput(), { target: { value: '20000' } });
    const note = screen.getByTestId('legacy-hedge-note');
    expect(note).toHaveTextContent('但它不算更新前的仓位，不能再给别的单当豁免额度');
    expect(note).toHaveTextContent('挂着的这张单触发 / 成交那一刻还会再判一次：旧仓位已减少或平掉时按普通分层判，放不下就撤单');
    expect(note).not.toHaveTextContent('不再按分层判');
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    fireEvent.change(qtyInput(), { target: { value: '20000' } });
    expect(screen.getByTestId('legacy-hedge-note')).not.toHaveTextContent('还会再判一次');
  });

  it('【复核 r7】KAITOUSDT 旧多 30,000 @15x（在上限之内）：市价再多 5,000 → 说明会并进旧仓位、整仓仍按 0.4%；开空不说', async () => {
    state.settlement = 'usdt';
    state.positionsMap = { KAITOUSDT: [usdtPos(30_000)] };
    renderPanel('KAITOUSDT', 1.0);
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    await pickUnit('BASE');
    fireEvent.change(qtyInput(), { target: { value: '5000' } });
    const note = screen.getByTestId('merge-model-note');
    expect(note).toHaveTextContent('开多：这一单会并进更新前开的同方向仓位——合并后整个仓位（含这一笔）仍按旧的统一 0.4% 计维持保证金，不换模型、不重新定价，也不会多出一条只靠自己那点保证金硬扛的新腿。');
    expect(note).toHaveTextContent('加进去的这一截不会把「对冲更新前仓位」的豁免额度做大：豁免的底冻在这一笔之前。');
    // 第 6 轮那一套（另成一个仓位、各算各的强平价）不能再出现
    expect(note).not.toHaveTextContent('单独成一个仓位');
    expect(note).not.toHaveTextContent('改按币安分层计维持保证金');
    expect(note).not.toHaveTextContent('开空');
  });

  /**
   * 【复核 r7】规则二把加仓并回旧仓位之后，「不合并的代价」这件事本身消失了：
   * 合并会把两笔的保证金与均价汇到一起、把旧仓位的强平价**推远**（实测同一盘面 0.954000 → 0.945206，0.92%）。
   * 面板要把这两个数摆出来，而不是再念一遍「加仓救不了它，去单独追加保证金」——那句在这一格已经不成立。
   */
  it('【复核 r7】旧仓位贴着强平价（0.954 vs 现价 0.96）：说明写明合并后强平价被推远，不再叫人去单独追加保证金', async () => {
    state.settlement = 'usdt';
    state.leverage = 20;
    state.positionsMap = { KAITOUSDT: [usdtPos(40_000, 1, 20)] };
    renderPanel('KAITOUSDT', 0.96);
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    await pickUnit('BASE');
    fireEvent.change(qtyInput(), { target: { value: '1000' } });
    // 这一单本身过得去分层（38,400 + 960 ≤ 50,000）
    expect(longButton().disabled).toBe(false);
    const note = screen.getByTestId('merge-model-note');
    expect(note).toHaveTextContent('会并进更新前开的同方向仓位');
    // 1,000 个币（960 USDT）这一刀把整仓的强平价推远 0.10%
    expect(note).toHaveTextContent('整仓强平价 0.954000 → 0.953069（推远 0.10%）。');
    expect(note).not.toHaveTextContent('离现价只剩');
    expect(note).not.toHaveTextContent('单独给那一笔追加保证金');
    // 加满一刀（11,500 USDT ≈ 11,979.1667 个币，38,400 + 11,500 = 49,900 ≤ 50,000）：推远 0.92%，
    // 正是第 6 轮拿来说「不合并的代价」的那个数——现在它是合并**带来的**好处
    fireEvent.change(qtyInput(), { target: { value: '11979.1667' } });
    expect(screen.getByTestId('merge-model-note')).toHaveTextContent('整仓强平价 0.954000 → 0.945206（推远 0.92%）。');
  });

  it('【复现】豁免对冲不并进分层仓位：KAITOUSDT 5x 旧多 240,000 + 分层空 9,000、现价 1.1——市价空 230,000 靠豁免放行，说明单独成仓、不改按分层', async () => {
    state.settlement = 'usdt';
    state.leverage = 5;
    state.positionsMap = {
      KAITOUSDT: [
        usdtPos(240_000, 1, 5),
        { ...usdtPos(9_000, 1, 5), side: 'SHORT', riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT' },
      ],
    };
    renderPanel('KAITOUSDT', 1.1);
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    await pickUnit('BASE');
    fireEvent.change(qtyInput(), { target: { value: '230000' } });
    expect(shortButton().disabled).toBe(false);
    expect(screen.getByTestId('legacy-hedge-note')).toHaveTextContent('开空：这一单是对冲更新前的仓位');
    const note = screen.getByTestId('merge-model-note');
    expect(note).toHaveTextContent('开空：这一单靠对冲豁免按旧的 0.4% 开，不会并进按币安分层计的同方向仓位（并进去会把这一截也按档位定价、把那个分层仓位推进更高的档），单独成一个仓位、各算各的强平价；现有仓位的维持保证金与强平价不变。');
    // 第 7 轮补的那句：两笔的卡照样能按成数部分平仓
    expect(note).toHaveTextContent('卡上的「平仓」照常可以按成数部分平仓（成数摊到卡上每一笔）。');
    expect(note).not.toHaveTextContent('改按币安分层计维持保证金');
  });

  /**
   * 【复核 r7 · 修订】规则三那一格里的「救旧仓位」指路必须与界面一致：
   * 持仓卡上的「+」是**卡级**的，卡上多于一笔时按名义等比摊到每一笔（AdjustMarginModal 自己就这么写），
   * 没有单腿的追加入口。旧文案说「单独给那一笔追加保证金」，按它做会有约 23% 的钱落在没风险的那一笔上。
   */
  it('【复核 r7】规则三那一格里旧仓位贴着强平价：指路说清「+」是卡级的、按名义摊到每一笔', async () => {
    state.settlement = 'usdt';
    state.leverage = 20;
    state.positionsMap = {
      KAITOUSDT: [
        // 反方向的更新前仓位给豁免当底
        { ...usdtPos(200_000, 1, 20), side: 'SHORT' } as Position,
        // 同方向已有的分层仓位，强平价 0.954 贴着现价 0.96
        { ...usdtPos(40_000, 1, 20), riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT' } as Position,
      ],
    };
    renderPanel('KAITOUSDT', 0.96);
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    await pickUnit('BASE');
    fireEvent.change(qtyInput(), { target: { value: '100000' } });
    const note = screen.getByTestId('merge-model-note');
    expect(note).toHaveTextContent('这一单不会把它推远（并不进去）：要给它续命，用持仓卡上的「+」追加保证金——卡上有两笔时这笔钱按名义等比摊到每一笔，旧仓位只拿到其中一部分，要按这个比例多存一些。');
    // 旧文案（说「+」能单独给那一笔追加）不能再出现
    expect(note).not.toHaveTextContent('单独给那一笔追加保证金');
  });

  it('【复核 r7】分层成交会并进靠对冲豁免开的同方向仓位：整仓仍按 0.4%，不提豁免额度（豁免仓位本来就不是底）', async () => {
    state.settlement = 'usdt';
    state.positionsMap = {
      KAITOUSDT: [{ ...usdtPos(20_000), side: 'SHORT', riskModel: 'legacy-hedge-v1', riskSymbol: 'KAITOUSDT' }],
    };
    renderPanel('KAITOUSDT', 1.0);
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    await pickUnit('BASE');
    fireEvent.change(qtyInput(), { target: { value: '1000' } });
    expect(shortButton().disabled).toBe(false);
    const note = screen.getByTestId('merge-model-note');
    expect(note).toHaveTextContent('开空：这一单会并进靠对冲豁免开的同方向仓位——合并后整个仓位（含这一笔）仍按旧的统一 0.4% 计维持保证金');
    expect(note).not.toHaveTextContent('豁免额度');
    expect(note).not.toHaveTextContent('单独成一个仓位');
  });

  it('本来就是分层仓位、或杠杆不同不会合并：不说', async () => {
    state.settlement = 'usdt';
    state.positionsMap = { KAITOUSDT: [{ ...usdtPos(30_000), riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT' }, usdtPos(1_000, 1, 20)] };
    renderPanel('KAITOUSDT', 1.0);
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    await pickUnit('BASE');
    fireEvent.change(qtyInput(), { target: { value: '5000' } });
    expect(screen.queryByTestId('merge-model-note')).toBeNull();
  });
});
