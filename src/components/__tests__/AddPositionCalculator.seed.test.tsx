import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingOrder, Position } from '@/types/trading';

const trading = vi.hoisted(() => ({
  positionsMap: {} as Record<string, unknown[]>,
  ordersMap: {} as Record<string, unknown[]>,
  tradeHistory: [] as unknown[],
  leverageMap: {} as Record<string, number>,
  positionLimitMode: 'unlimited',
  getSymbolSettlementMode: () => 'usdt',
}));
vi.mock('@/contexts/TradingContext', () => ({ useTradingContext: () => trading }));
vi.mock('@/lib/addSizingVerifiedProfit', () => ({
  addSizingProfitRecords: () => [],
  verifiedAddSizingProfit: vi.fn(async () => ({ complete: true, usd: 0 })),
}));
const freshPlan = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('@/lib/addSizingPlan', async (original) => ({
  ...(await original<typeof import('@/lib/addSizingPlan')>()),
  getFreshAddSizingPlan: () => freshPlan.current,
  publishAddSizingPlan: vi.fn(),
  touchAddSizingPlan: vi.fn(),
}));

import { AddPositionCalculator, __resetAddCalculatorSupportMemoryForTests } from '@/components/AddPositionCalculator';

const SYMBOL = 'VIRTUALUSDT';
const position = (over: Partial<Position> = {}): Position => ({
  id: 'p1', side: 'LONG', entryPrice: 1.39515281713, quantity: 3_492_441.78857, leverage: 10, marginMode: 'isolated',
  margin: 487_250, openTime: 1_000_000, openedRealAt: 10,
  fills: [{ id: 'p1', openTime: 1_000_000, openedRealAt: 10, entryPrice: 1.39515281713, units: 3_492_441.78857 }],
  ...over,
} as unknown as Position);
const order = (over: Partial<PendingOrder>): PendingOrder => ({
  id: 'o', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 0, quantity: 1, leverage: 10, marginMode: 'isolated',
  status: 'PENDING', createdAt: 1_000_500, createdRealAt: 10, ...over,
} as PendingOrder);

type Frame = Window & {
  AddPositionMath?: { setSeed: ReturnType<typeof vi.fn> };
  VeilAddSizingBridge?: (reading: Record<string, number | string> | null) => void;
};

/** 打开计算器，等宿主把缺省值交给内嵌页面；返回最后交过去的那份，以及计算器向宿主回报读数的入口。 */
async function open(props: Partial<React.ComponentProps<typeof AddPositionCalculator>> = {}) {
  const view = render(<AddPositionCalculator open onClose={() => {}} symbol={SYMBOL} currentPrice={1.4907} {...props} />);
  const frame = screen.getByTestId('add-position-calculator-frame') as HTMLIFrameElement;
  const child = frame.contentWindow as Frame;
  const setSeed = vi.fn();
  child.AddPositionMath = { setSeed };
  await act(async () => { fireEvent.load(frame); });
  await act(async () => { await Promise.resolve(); });
  // 测试环境里内嵌页面自己也会触发一次加载事件：以最后交过去的那份为准
  expect(setSeed).toHaveBeenCalled();
  const seed = () => setSeed.mock.calls.at(-1)![0] as Record<string, number | string>;
  /** 用户在计算器里把 K 改成 k 之后，计算器回报的那份读数。 */
  const typeSupport = (k: number) => act(() => {
    child.VeilAddSizingBridge!({ T: 1.4907, K: k, S: 1.3952, Q: 3_492_441.78857, P: 0, realAverage: 1.39515281713, side: 'LONG', addQty: 1 });
  });
  return { view, seed, typeSupport, reload: async () => { await act(async () => { fireEvent.load(frame); }); await act(async () => { await Promise.resolve(); }); } };
}

beforeEach(() => {
  localStorage.clear();
  __resetAddCalculatorSupportMemoryForTests();
  trading.positionsMap = { [SYMBOL]: [position()] };
  trading.ordersMap = {};
  freshPlan.current = null;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('【用户要求】加仓计算器：「新支撑线 / 止损线」缺省取最新委托空单的价格，并且可以手动输入', () => {
  it('主多持仓 + 挂着的对冲空单：K 缺省就是最新那张空单的价格，原样写、不四舍五入', async () => {
    trading.ordersMap = { [SYMBOL]: [
      // 最新的那张既不是数组最后一张、也不是价格最高的一张：只有按真实挂单时刻才取得对
      order({ id: 'new-hedge', stopPrice: 1.3728, createdAt: 1_000_600, createdRealAt: 30 }),
      order({ id: 'old-hedge', stopPrice: 1.3801, createdAt: 1_000_900, createdRealAt: 20 }),
      order({ id: 'take-profit', type: 'LIMIT', status: 'NEW', price: 1.9, reduceOnly: true, createdAt: 1_001_000, createdRealAt: 40 }),
      order({ id: 'cancelled', stopPrice: 1.45, status: 'CANCELED', createdAt: 1_001_100, createdRealAt: 50 }),
      // 挂在加仓线上方的限价空单（高位锁仓）、跟踪委托：都不是支撑线
      order({ id: 'lock-above', type: 'LIMIT', status: 'NEW', price: 1.6, stopPrice: 1.41, createdAt: 1_001_200, createdRealAt: 60 }),
      order({ id: 'trailing', type: 'TRAILING_STOP', status: 'ACTIVE', stopPrice: 1.44, createdAt: 1_001_300, createdRealAt: 70 }),
    ] };
    const { seed } = await open();
    expect(seed().side).toBe('LONG');
    expect(seed().support).toBe(1.3728);
    expect(Number(seed().supportDecimals)).toBeGreaterThanOrEqual(4);
    expect(seed().supportSource).toBe('缺省取最新挂着的空单价格，可直接改写');
    // 其余缺省值照旧：加仓线取现价，成本线与币数取持仓
    expect(seed().currentPrice).toBe(1.4907);
    expect(Number(seed().coins)).toBeCloseTo(3_492_441.78857, 6);
  });

  it('委托价的小数位比开仓价的显示位数多时，按委托价自己的位数写', async () => {
    trading.positionsMap = { [SYMBOL]: [position({ entryPrice: 95_000.5, fills: [{ id: 'p1', openTime: 1_000_000, openedRealAt: 10, entryPrice: 95_000.5, units: 2 }] } as Partial<Position>)] };
    trading.ordersMap = { [SYMBOL]: [order({ stopPrice: 91_234.5678 })] };
    const { seed } = await open({ currentPrice: 96_000 });
    expect(seed().support).toBe(91_234.5678);
    expect(seed().supportDecimals).toBe(Math.max(Number(seed().priceDecimals), 4));
  });

  it('主空持仓：取加仓线上方、最新委托多单的价格', async () => {
    trading.positionsMap = { [SYMBOL]: [position({ side: 'SHORT' })] };
    trading.ordersMap = { [SYMBOL]: [
      order({ id: 'short-add', side: 'SHORT', type: 'LIMIT', status: 'NEW', price: 1.33 }),
      order({ id: 'long-hedge', side: 'LONG', stopPrice: 1.52, createdAt: 1_000_700, createdRealAt: 20 }),
    ] };
    const { seed } = await open();
    expect(seed().side).toBe('SHORT');
    expect(seed().support).toBe(1.52);
    expect(seed().supportSource).toBe('缺省取最新挂着的多单价格，可直接改写');
  });

  it('上一场留下的挂单（早于主力开仓 5 分钟之前）不算；没有对冲委托时沿用上一次计算计划里的 K，都没有就留空', async () => {
    trading.ordersMap = { [SYMBOL]: [order({ id: 'previous-campaign', stopPrice: 1.38, createdAt: 1_000_000 - 5 * 60_000 - 1 })] };
    const empty = await open();
    expect(empty.seed().support).toBe(0);
    expect(empty.seed().supportSource).toBe('');
    cleanup();
    freshPlan.current = { side: 'LONG', s1: 1.31, s2Ref: 1.48, orderKind: 'limit', at: Date.now() };
    const fromPlan = await open();
    expect(fromPlan.seed().support).toBe(1.31);
    expect(fromPlan.seed().supportSource).toBe('');
    // 加仓线沿用计划里的参考价
    expect(fromPlan.seed().currentPrice).toBe(1.48);
  });

  it('可以手动输入：手改过的 K 关掉再打开不被盖回委托价；之后又挂了更新的委托，才以新委托为准', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000);
    trading.ordersMap = { [SYMBOL]: [order({ id: 'hedge', stopPrice: 1.3728, createdRealAt: 900 })] };
    const first = await open();
    expect(first.seed().support).toBe(1.3728);
    // 用户把 K 手改成 1.38125
    vi.setSystemTime(2_000);
    first.typeSupport(1.38125);
    cleanup();
    vi.setSystemTime(3_000);
    const reopened = await open();
    expect(reopened.seed().support).toBe(1.38125);
    expect(reopened.seed().supportDecimals).toBe(5);
    expect(reopened.seed().supportSource).toBe('沿用你上次手填的价格');
    cleanup();
    // 之后把对冲挪到新的支撑位（新挂一张，真实时刻晚于手改）：新委托才是这一轮的止损线
    trading.ordersMap = { [SYMBOL]: [
      order({ id: 'hedge', stopPrice: 1.3728, createdRealAt: 900 }),
      order({ id: 'moved-hedge', stopPrice: 1.4012, createdAt: 1_000_800, createdRealAt: 4_000 }),
    ] };
    vi.setSystemTime(5_000);
    expect((await open()).seed().support).toBe(1.4012);
  });

  it('手改的 K 过了 30 分钟保鲜期就不再沿用；改回缺省值等于取消手改', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000);
    trading.ordersMap = { [SYMBOL]: [order({ stopPrice: 1.3728, createdRealAt: 900 })] };
    const first = await open();
    first.typeSupport(1.38);
    cleanup();
    vi.setSystemTime(1_000 + 30 * 60_000 + 1);
    const expired = await open();
    expect(expired.seed().support).toBe(1.3728);
    // 手改成 1.39，又改回委托价 1.3728：不留手改的痕迹
    expired.typeSupport(1.39);
    expired.typeSupport(1.3728);
    cleanup();
    expect((await open()).seed().support).toBe(1.3728);
  });

  it('【复核】弹窗开着时宿主重新取数（落袋核验回来、持仓变了）：手填的 K 原样交回，不被换成委托价', async () => {
    trading.ordersMap = { [SYMBOL]: [order({ stopPrice: 1.3728, createdRealAt: 5 })] };
    const session = await open();
    expect(session.seed().support).toBe(1.3728);
    session.typeSupport(1.45);
    await session.reload();
    expect(session.seed().support).toBe(1.45);
    expect(session.seed().supportSource).toBe('沿用你上次手填的价格');
  });

  it('【复核】自动带入的委托价不借着计算计划留下来：那张委托撤掉之后重开，取还挂着的那张；一张都没有就留空', async () => {
    trading.ordersMap = { [SYMBOL]: [
      order({ id: 'a', stopPrice: 1.25, createdAt: 1_000_500, createdRealAt: 20 }),
      order({ id: 'b', stopPrice: 1.40, createdAt: 1_000_600, createdRealAt: 30 }),
    ] };
    const first = await open();
    expect(first.seed().support).toBe(1.4);
    // K 一带入就算出结果、计划随即发布（关弹窗还会续期）：计划里的 s1 就是自动带入的 1.40，用户一个字没改
    first.typeSupport(1.4);
    freshPlan.current = { side: 'LONG', s1: 1.4, s2Ref: 1.4907, orderKind: 'limit', at: Date.now() };
    cleanup();
    // 撤掉 B：只剩 A
    trading.ordersMap = { [SYMBOL]: [order({ id: 'a', stopPrice: 1.25, createdAt: 1_000_500, createdRealAt: 20 })] };
    expect((await open()).seed().support).toBe(1.25);
    cleanup();
    // A 也撤掉：计划里那个 1.40 是已经不在的委托的价，不沿用——留空等用户填（连开两次都一样）
    trading.ordersMap = {};
    freshPlan.current = { side: 'LONG', s1: 1.4, s2Ref: 1.4907, orderKind: 'limit', at: Date.now() };
    trading.ordersMap = { [SYMBOL]: [order({ id: 'b', stopPrice: 1.40, createdAt: 1_000_600, createdRealAt: 30 })] };
    expect((await open()).seed().support).toBe(1.4);
    cleanup();
    trading.ordersMap = {};
    expect((await open()).seed().support).toBe(0);
    cleanup();
    expect((await open()).seed().support).toBe(0);
  });
});
