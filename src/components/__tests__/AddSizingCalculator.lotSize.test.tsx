import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddSizingCalculator } from '@/components/AddSizingCalculator';
import { __resetAddSizingPlanForTests, getAddSizingPlan } from '@/lib/addSizingPlan';
import type { Position } from '@/types/trading';

/**
 * 加仓计算器与币安单笔数量上限：「按上限下单」预填的是**一笔**单子——可下单量比单笔上限大时只预填一笔上限，
 * 说清剩下的还要再下几笔；计划本身（上限、对冲）不因此缩小。S₁ 上的合计对冲是一张条件单、触发后是一笔市价单，
 * 超过单笔市价上限时提示要拆成几张。
 *
 * 盘面：KAITOUSDT U 本位多 1,000,000 @0.5，现价 1.0，S₁ 0.9 → 旧仓垫 400,000 USD、每币风险 ≈ 0.1，
 * 可下单量约 400 万 KAITO，远超单笔市价上限 200,000 与限价上限 2,000,000。
 */
const usdtPositions: Position[] = [
  { id: 'p1', side: 'LONG', entryPrice: 0.5, quantity: 1_000_000, leverage: 5, marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', margin: 100_000, openTime: 1_000 },
];
/** 合成币本位（币安无 KAITO 币本位）：同一个盘面换成 50,000 张 × 10 USD，按 0.5 折 1,000,000 KAITO。 */
const coinPositions: Position[] = [
  { id: 'c1', side: 'LONG', entryPrice: 0.5, quantity: 50_000, contracts: 50_000, contractSizeUsd: 10, leverage: 5, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'KAITO', margin: 100_000, openTime: 1_000 } as Position,
];
const book = vi.hoisted(() => ({ settlement: 'usdt' as 'usdt' | 'coin' }));

vi.mock('@/contexts/TradingContext', async () => {
  const actual = await vi.importActual<typeof import('@/contexts/TradingContext')>('@/contexts/TradingContext');
  return {
    ...actual,
    useTradingContext: () => ({
      tradingMode: 'direct',
      setTradingMode: vi.fn(),
      positionsMap: { KAITOUSDT: book.settlement === 'coin' ? coinPositions : usdtPositions },
      ordersMap: {},
      priceMap: {},
      tradeHistory: [],
      getSymbolSettlementMode: () => book.settlement,
      leverageMap: {},
    }),
  };
});
/** 分层与单笔上限是两件事：这里关掉分层余量（addTierHeadroom 返回 null = 不另设限），只看单笔上限。 */
vi.mock('@/lib/addTierHeadroom', async () => {
  const actual = await vi.importActual<typeof import('@/lib/addTierHeadroom')>('@/lib/addTierHeadroom');
  return { ...actual, addTierHeadroom: () => null };
});

beforeEach(() => { __resetAddSizingPlanForTests(); book.settlement = 'usdt'; });

function renderCalc() {
  render(
    <MemoryRouter>
      <AddSizingCalculator open onClose={() => {}} symbol="KAITOUSDT" currentPrice={1} fillBasePrice={1} pricePrecision={4} quantityPrecision={1} />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByTestId('add-sizing-s1'), { target: { value: '0.9' } });
}

describe('加仓计算器：单笔数量上限', () => {
  it('市价：「按上限下单」只预填一笔 200,000 KAITO，说清剩下的还要再分几笔下（或改用限价单）；大字仍是计划的上限', () => {
    renderCalc();
    const button = screen.getByTestId('add-sizing-place-at-limit');
    expect(button).toHaveTextContent('按上限下单 · 200,000 KAITO');
    const note = screen.getByTestId('add-sizing-lot-size');
    // 剩下的约 380 万还要再分几笔下（每笔不超过 200,000），不是含糊的「另下一笔」
    const rest = note.textContent!.match(/^单笔市价上限 200,000 KAITO：「按上限下单」预填一笔 200,000 KAITO，剩下的 ([\d,.]+) KAITO 再分 (\d+) 笔下（或改用限价单）$/);
    expect(rest).not.toBeNull();
    expect(Number(rest![2])).toBe(Math.ceil(Number(rest![1].replace(/,/g, '')) / 200_000));
    // 计划（大字）不因单笔上限缩小：仍是约 400 万
    const hero = Number(screen.getByTestId('add-sizing-x2').textContent!.match(/\d[\d,]*(?:\.\d+)?/)![0].replace(/,/g, ''));
    expect(hero).toBeGreaterThan(3_000_000);
    fireEvent.click(button);
    expect(getAddSizingPlan('KAITOUSDT')?.prefill).toMatchObject({ orderType: 'MARKET', coins: 200_000 });
  });

  it('限价：按 LOT_SIZE（2,000,000）预填一笔，不再建议「改用限价单」', () => {
    renderCalc();
    fireEvent.click(screen.getByTestId('add-sizing-order-kind-limit'));
    expect(screen.getByTestId('add-sizing-place-at-limit')).toHaveTextContent('按上限下单 · 2,000,000 KAITO');
    const note = screen.getByTestId('add-sizing-lot-size');
    expect(note).toHaveTextContent('单笔限价上限 2,000,000 KAITO：「按上限下单」预填一笔 2,000,000 KAITO');
    expect(note).not.toHaveTextContent('改用限价单');
  });

  it('条件单（突破加仓挂在现价上方）：剩下的几笔同样挂成条件单，不建议「改用限价单」（现价上方的买入限价单会立刻成交）', () => {
    renderCalc();
    fireEvent.click(screen.getByTestId('add-sizing-order-kind-conditional'));
    fireEvent.change(screen.getByTestId('add-sizing-s2'), { target: { value: '1.05' } });
    const note = screen.getByTestId('add-sizing-lot-size');
    expect(note.textContent).toMatch(/^单笔市价上限 200,000 KAITO：「按上限下单」预填一笔 200,000 KAITO，剩下的 [\d,.]+ KAITO 再分 \d+ 笔下（每笔都挂成条件单）$/);
    expect(note).not.toHaveTextContent('限价单');
  });

  it('S₁ 上的合计对冲超过单笔市价上限：提示拆成几张条件单', () => {
    renderCalc();
    const note = screen.getByTestId('add-sizing-hedge-lot-size');
    const match = note.textContent!.match(/^S₁ 0\.900000 上的合计对冲 ([\d,.]+) KAITO 超过单笔市价上限 200,000 KAITO：条件单触发后是一笔市价单，要拆成 (\d+) 张条件单挂在 S₁$/);
    expect(match).not.toBeNull();
    const hedge = Number(match![1].replace(/,/g, ''));
    expect(Number(match![2])).toBe(Math.ceil(hedge / 200_000));
  });

  it('合成币本位市价：一笔上限按现价折张（1.0 上 20,000 张），预填与下单面板的 100% 一样留 0.2% 余量（19,960 张）并说明', () => {
    book.settlement = 'coin';
    renderCalc();
    expect(screen.getByTestId('add-sizing-place-at-limit')).toHaveTextContent('按上限下单 · 19,960 张');
    const note = screen.getByTestId('add-sizing-lot-size');
    expect(note).toHaveTextContent('单笔市价上限 20,000 张（按 KAITOUSDT 的 200,000 KAITO 折算）：「按上限下单」预填一笔 19,960 张（按现价折张，留 0.2% 余量）');
    fireEvent.click(screen.getByTestId('add-sizing-place-at-limit'));
    expect(getAddSizingPlan('KAITOUSDT')?.prefill).toMatchObject({ orderType: 'MARKET', contracts: 19_960 });
  });

  it('合成币本位限价：价钉在委托价上，按 LOT_SIZE 折张、不留余量；剩下的正好再下一笔', () => {
    book.settlement = 'coin';
    renderCalc();
    fireEvent.click(screen.getByTestId('add-sizing-order-kind-limit'));
    // 可下单 400,000 张（4,000,000 KAITO @1.0）；限价上限 2,000,000 KAITO 在委托价 1.0 上 = 200,000 张
    expect(screen.getByTestId('add-sizing-place-at-limit')).toHaveTextContent('按上限下单 · 200,000 张');
    expect(screen.getByTestId('add-sizing-lot-size')).toHaveTextContent(
      '单笔限价上限 200,000 张（按 KAITOUSDT 的 2,000,000 KAITO 折算）：「按上限下单」预填一笔 200,000 张，剩下的 200,000 张另下一笔',
    );
  });
});
