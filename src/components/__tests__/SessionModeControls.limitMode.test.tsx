import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionModeControls } from '../SessionModeControls';
import { toast } from '@/lib/notificationCenter';
import type { PositionLimitMode } from '@/lib/positionLimitMode';

/**
 * 顶栏「直接交易」右边的持仓限制模式开关：默认无限制、两段互斥、切换时记一条说明。
 * context 用可切换的替身：setPositionLimitMode 真的改值，界面跟着变——持久化本身见 TradingContext.positionLimitMode.test。
 */
const ctx = vi.hoisted(() => ({
  mode: undefined as PositionLimitMode | undefined,
  set: undefined as ((v: PositionLimitMode) => void) | undefined,
  calls: [] as PositionLimitMode[],
  withSetter: true,
  ordersMap: {} as Record<string, unknown[]>,
  positionsMap: {} as Record<string, unknown[]>,
  priceMap: {} as Record<string, number>,
}));

vi.mock('@/contexts/TradingContext', async () => {
  const actual = await vi.importActual<typeof import('@/contexts/TradingContext')>('@/contexts/TradingContext');
  return {
    ...actual,
    useTradingContext: () => ({
      tradingMode: 'direct',
      setTradingMode: vi.fn(),
      positionLimitMode: ctx.mode,
      setPositionLimitMode: ctx.withSetter ? ctx.set : undefined,
      ordersMap: ctx.ordersMap,
      positionsMap: ctx.positionsMap,
      priceMap: ctx.priceMap,
    }),
  };
});

function Harness({ initial }: { initial?: PositionLimitMode }) {
  const [mode, setMode] = useState<PositionLimitMode | undefined>(initial);
  ctx.mode = mode;
  ctx.set = (v: PositionLimitMode) => { ctx.calls.push(v); setMode(v); };
  return <SessionModeControls timeMode="synced" onSetTimeMode={vi.fn()} />;
}

afterEach(() => {
  ctx.mode = undefined;
  ctx.calls = [];
  ctx.withSetter = true;
  ctx.ordersMap = {};
  ctx.positionsMap = {};
  ctx.priceMap = {};
  vi.restoreAllMocks();
});

const segment = (mode: PositionLimitMode) => screen.getByTestId(`position-limit-mode-${mode}`);

describe('顶栏：持仓限制模式开关', () => {
  it('紧挨在「直接交易」右边、时间模式图标之前；两段「无限制 / 币安标准」，默认无限制', () => {
    render(<Harness initial="unlimited" />);
    const group = screen.getByTestId('position-limit-mode');
    expect(group).toHaveAttribute('role', 'group');
    expect(within(group).getAllByRole('button').map(b => b.textContent)).toEqual(['无限制', '币安标准']);
    const direct = screen.getByRole('button', { name: /直接交易/ });
    expect(direct.nextElementSibling).toBe(group);
    expect(group.nextElementSibling?.querySelector('[title^="时间模式"]')).not.toBeNull();
    expect(segment('unlimited')).toHaveAttribute('aria-pressed', 'true');
    expect(segment('binance')).toHaveAttribute('aria-pressed', 'false');
    // 与决策记录 / 直接交易同一套尺寸与选中样式
    expect(segment('unlimited').className).toContain('text-[10px]');
    expect(segment('unlimited').className).toContain('bg-sky-500/15');
    expect(segment('binance').className).not.toContain('bg-sky-500/15');
    // 说明写在 aria-label 里（不用 title：悬停提示会盖住模拟时钟）
    expect(segment('unlimited')).toHaveAttribute('aria-label', expect.stringContaining('任何币种杠杆 1–150x，不设持仓上限、不设单笔下单上限'));
    expect(segment('binance')).toHaveAttribute('aria-label', expect.stringContaining('按币安各币种杠杆分层、持仓上限、单笔市价 / 限价上限'));
    expect(segment('unlimited')).not.toHaveAttribute('title');
  });

  it('切到币安标准：写回 context、按钮跟着变，并记一条说明（现有仓位不换口径，新模式管之后的下单、触发与改杠杆）', () => {
    const message = vi.spyOn(toast, 'message');
    render(<Harness initial="unlimited" />);
    fireEvent.click(segment('binance'));
    expect(ctx.calls).toEqual(['binance']);
    expect(segment('binance')).toHaveAttribute('aria-pressed', 'true');
    expect(segment('unlimited')).toHaveAttribute('aria-pressed', 'false');
    expect(message).toHaveBeenCalledTimes(1);
    const [title, opts] = message.mock.calls[0] as [string, { description: string }];
    expect(title).toBe('已切换到币安标准模式');
    expect(opts.description).toContain('现有仓位保持原来的维持保证金口径');
    expect(opts.description).toContain('新模式作用于之后的下单、挂单触发 / 成交与杠杆调整');
    // 短：标题已经说了切到哪一种，说明不再以「币安标准：」开头重复一遍
    expect(opts.description.startsWith('按币安杠杆分层、持仓上限与单笔上限')).toBe(true);
    expect(opts.description).not.toContain('币安标准：');

    fireEvent.click(segment('unlimited'));
    expect(ctx.calls).toEqual(['binance', 'unlimited']);
    expect(message.mock.calls[1][0]).toBe('已切换到无限制模式');
    expect(String((message.mock.calls[1][1] as { description: string }).description))
      .toMatch(/^杠杆 1–150x，不设持仓与单笔上限，新仓按 0\.4% 计维持保证金。/);
  });

  it('悬停 / 键盘聚焦时在按钮正下方显示这一档的说明（不用 title，不跟着鼠标盖住模拟时钟）', async () => {
    render(<Harness initial="unlimited" />);
    fireEvent.focus(segment('binance'));
    const tip = await screen.findByTestId('position-limit-mode-tip-binance');
    expect(tip).toHaveTextContent('币安标准：按币安各币种杠杆分层、持仓上限、单笔市价 / 限价上限与分层维持保证金');
    expect(tip).toHaveAttribute('data-side', 'bottom');
    expect(segment('binance')).not.toHaveAttribute('title');
  });

  it('切到币安标准时，挂着的按成数止损到触发时会超单笔上限被撤：提示升为警告，说出张数与「止盈止损」', () => {
    const message = vi.spyOn(toast, 'message');
    const warning = vi.spyOn(toast, 'warning');
    // KAITOUSDT 单笔市价上限 200,000：无限制下挂的 50% 止损 500,000 个
    ctx.positionsMap = {
      KAITOUSDT: [{
        id: 'long', side: 'LONG', quantity: 1_000_000, entryPrice: 1, leverage: 5, marginMode: 'isolated', settlementMode: 'usdt',
        margin: 200_000, isolatedMargin: 200_000, openTime: 1, riskModel: 'unlimited-v1', riskSymbol: 'KAITOUSDT',
      }],
    };
    ctx.ordersMap = {
      KAITOUSDT: [{
        id: 'sl', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 0.9, quantity: 500_000, leverage: 5,
        marginMode: 'isolated', settlementMode: 'usdt', status: 'PENDING', createdAt: 1, reduceOnly: true,
        reduceSymbol: 'KAITOUSDT', reducePositionSide: 'LONG', linkedPositionId: 'long', reduceKind: 'SL', reducePercentage: 50,
        conditionalExecType: 'MARKET', lotSizeRule: 'binance-lot-size-v1', triggerDirection: 'DOWN', operator: '<=',
      }],
    };
    ctx.priceMap = { KAITOUSDT: 1 };
    render(<Harness initial="unlimited" />);
    fireEvent.click(segment('binance'));
    expect(message).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    const [title, opts] = warning.mock.calls[0] as [string, { description: string }];
    expect(title).toBe('已切换到币安标准模式');
    expect(opts.description).toContain('KAITOUSDT 有 1 张挂着的委托按币安标准到触发 / 成交时会被撤销（其中 1 张止盈止损');
    // 切回无限制不判
    fireEvent.click(segment('unlimited'));
    expect(message).toHaveBeenCalledTimes(1);
  });

  it('点已经选中的那一段什么都不做', () => {
    const message = vi.spyOn(toast, 'message');
    render(<Harness initial="binance" />);
    fireEvent.click(segment('binance'));
    expect(ctx.calls).toEqual([]);
    expect(message).not.toHaveBeenCalled();
  });

  it('context 里没有这两个字段（旧的替身）：按默认的无限制显示，点了也不报错', () => {
    ctx.withSetter = false;
    render(<Harness />);
    expect(segment('unlimited')).toHaveAttribute('aria-pressed', 'true');
    expect(() => fireEvent.click(segment('binance'))).not.toThrow();
    expect(ctx.calls).toEqual([]);
  });
});
