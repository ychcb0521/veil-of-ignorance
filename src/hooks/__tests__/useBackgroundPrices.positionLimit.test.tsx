import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundPrices } from '@/hooks/useBackgroundPrices';
import { fetchCanonicalTimePriceAt } from '@/lib/canonicalTimePrice';
import { useTradingContext, type SettleFillTrigger } from '@/contexts/TradingContext';
import type { PendingOrder } from '@/types/trading';

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: vi.fn(),
}));
vi.mock('@/lib/canonicalTimePrice', () => ({
  fetchCanonicalTimePriceAt: vi.fn(),
}));

/**
 * 条件单触发 = 币安此刻才真正下单，所以杠杆分层上限要在触发时再判一次。
 * 判定在 settleFillDebit 里（带上触发价才判）；这里验每个触发点都把触发价交了过去，
 * 而挂在盘口的限价单成交时不交（不再判）——只靠对冲豁免挂出的限价单除外，它成交时要再判豁免是否仍成立。
 */
function Harness() {
  useBackgroundPrices();
  return null;
}

const base = {
  side: 'LONG', price: 0, quantity: 100, contracts: 100, contractSizeUsd: 10,
  settlementMode: 'coin', settlementAsset: 'NOM', leverage: 3, marginMode: 'isolated', createdAt: 100,
} as const;
const conditional = { ...base, id: 'bg-cond', type: 'CONDITIONAL', stopPrice: 0.0104, status: 'PENDING', operator: '<=', triggerDirection: 'DOWN' } as PendingOrder;
const limit = { ...base, id: 'bg-limit', type: 'LIMIT', price: 0.0104, stopPrice: 0, status: 'NEW' } as PendingOrder;

async function runFill(
  orders: PendingOrder[],
  settle: (s: string, o: PendingOrder, m: number, f: number, t: number, trigger?: SettleFillTrigger) => boolean = () => true,
  setPositionsMap: (...args: unknown[]) => void = vi.fn(),
) {
  const settleFillDebit = vi.fn(settle);
  vi.mocked(fetchCanonicalTimePriceAt).mockResolvedValue({ high: 0.011, low: 0.0102, close: 0.0105 });
  vi.mocked(useTradingContext).mockReturnValue({
    sim: { isRunning: true },
    activeSymbol: 'ACTIVEUSDT',
    activeSymbols: ['ACTIVEUSDT', 'NOMUSD'],
    setPriceMap: vi.fn(),
    markPriceAsOf: vi.fn(),
    ordersMap: { NOMUSD: orders },
    setOrdersMap: vi.fn(),
    setPositionsMap,
    setBalance: vi.fn(),
    setFilledOrders: vi.fn(),
    settleFillDebit,
    tradingMode: 'direct',
    getEffectiveTime: vi.fn(() => 1_000),
    stampClock: vi.fn(() => 'tl'),
    recordExecutionTrade: vi.fn(),
    executeReduceOnlyTrigger: vi.fn(),
    applyAttachedTpSl: vi.fn(),
    applyMergeSideEffects: vi.fn(),
  } as unknown as ReturnType<typeof useTradingContext>);
  render(<Harness />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  return settleFillDebit;
}

describe('后台标的：触发时交出触发价', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('条件单：带上触发价，并把同一轮已成交的单（含它自己）排除', async () => {
    const settle = await runFill([conditional, { ...conditional, id: 'bg-cond-2' }]);
    expect(settle).toHaveBeenCalledTimes(2);
    const [first, second] = settle.mock.calls.map(call => call[5]);
    expect(first?.price).toBeCloseTo(0.0104, 12);
    expect(second?.price).toBeCloseTo(0.0104, 12);
    // 同一个数组，调用结束后两张都在里面；第二张判定时第一张已经记进持仓，必须被排除
    expect(second?.settledOrderIds).toEqual(['bg-cond', 'bg-cond-2']);
  });

  it('【复核 r5】条件单把刚造出的仓位交给闸门：闸门按豁免改盖豁免标记，并进持仓的就是改过来源的那一笔', async () => {
    const merged: Array<Record<string, unknown>> = [];
    const settle = await runFill(
      [{ ...conditional, riskModel: 'binance-tiers-v1' } as PendingOrder],
      (_s, _o, _m, _f, _t, trigger) => {
        // 模拟 TradingContext：只靠对冲旧仓位的豁免放行时就地改盖豁免标记
        if (trigger?.position) Object.assign(trigger.position, { riskModel: 'legacy-hedge-v1', riskSymbol: 'NOMUSD' });
        return true;
      },
      (updater: unknown) => {
        const next = (updater as (prev: Record<string, unknown[]>) => Record<string, unknown[]>)({});
        merged.push(...(next.NOMUSD as Array<Record<string, unknown>>));
      },
    );
    const trigger = settle.mock.calls[0][5];
    expect(trigger?.position).toBeDefined();
    expect(trigger?.position?.side).toBe('LONG');
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(trigger?.position?.id);
    expect(merged[0].riskModel).toBe('legacy-hedge-v1');
  });

  it('限价单：成交时不再判（不带触发价）；带分层戳的也一样', async () => {
    const settle = await runFill([limit, { ...limit, id: 'bg-limit-tiered', riskModel: 'binance-tiers-v1' } as PendingOrder]);
    expect(settle).toHaveBeenCalledTimes(2);
    expect(settle.mock.calls.map(call => call[5])).toEqual([undefined, undefined]);
  });

  it('【复核 r5】只靠对冲豁免挂出的限价单：成交这一刻带上成交价与仓位，再判豁免是否仍成立', async () => {
    const settle = await runFill([{ ...limit, riskModel: 'legacy-hedge-v1' } as PendingOrder]);
    expect(settle).toHaveBeenCalledTimes(1);
    const trigger = settle.mock.calls[0][5];
    expect(trigger?.price).toBeCloseTo(0.0104, 12);
    expect(trigger?.settledOrderIds).toEqual(['bg-limit']);
    expect(trigger?.position?.riskModel).toBe('legacy-hedge-v1');
  });
});

describe('盘面标的：两个触发点都交出触发价', () => {
  const index = readFileSync(join(process.cwd(), 'src/pages/Index.tsx'), 'utf8');

  it('条件 / 跟踪委托的触发成交（createTriggeredConditionalPosition）', () => {
    const at = index.indexOf('const createTriggeredConditionalPosition');
    expect(at).toBeGreaterThan(-1);
    const body = index.slice(at, index.indexOf('const runConditionalMatchingForSymbol', at));
    expect(body).toContain('settleFillDebit(symbol, order, margin, fee, openTime, { price: entryPrice, position })');
  });

  it('逐 K 线撮合里的触发类（旧止盈止损开仓单、跟踪委托）带触发价，限价单只有豁免单带', () => {
    const at = index.indexOf('for (const kline of newKlines) {');
    const body = index.slice(at, index.indexOf('// ===== TWAP ENGINE =====', at));
    expect(body).toContain('isConditionalType || recheckedAtFill(matchedOrder)');
    expect(body).toContain('? { price: fillPrice, settledOrderIds: filledIds, position }');
    // filledIds 必须先于闸门写入，否则同一批的前一张会被重复计算
    expect(body.indexOf('filledIds.push(matchedOrder.id)')).toBeLessThan(body.indexOf('settleFillDebit('));
  });

  it('【复核 v1】TWAP 的每一片也把刚造出的仓位交给闸门', () => {
    const at = index.indexOf('// ===== TWAP ENGINE =====');
    const body = index.slice(at);
    expect(body).toContain('{ ...twapSliceTrigger(order, sliceOrder, price, { updated: slicedThisPass, removedIds: removedThisPass }), position }');
  });
});
