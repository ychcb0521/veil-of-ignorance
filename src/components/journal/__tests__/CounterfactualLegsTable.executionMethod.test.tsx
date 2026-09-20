import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CounterfactualLegsTable } from '@/components/journal/CounterfactualLegsTable';
import type { CampaignCounterfactualManualLeg, CampaignCounterfactualResult, TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const open = '2026-09-20T00:00:00Z';
const close = '2026-09-20T01:00:00Z';
const base: CampaignCounterfactualManualLeg = {
  id: 'leg', leg_role: 'hedge_rolling', direction: 'short', open_time: open, close_time: close,
  entry_price: 100, exit_price: 99, size_usdt: 1000, leverage: 10, enabled: true,
  actual: {
    source: 'records', direction: 'short', open_time: open, close_time: close,
    entry_price: 100, exit_price: 99, size_usdt: 1000, realized_pnl_usdt: 9,
    close_fee_usdt: 1, open_fee_usdt: 0.5, entry_method: 'manual', exit_method: 'order',
  },
};
const result = {
  final_realized_pnl: 9, legs_summary: [{ leg_role: 'hedge_rolling', status: 'filled', realized_pnl_usdt: 9 }],
} as CampaignCounterfactualResult;
function renderLeg(leg: CampaignCounterfactualManualLeg = base, originalLegs?: TradeJournal[], originalTradeRecords?: TradeRecord[]) {
  render(<MemoryRouter><CounterfactualLegsTable
    campaign={{ id: 'campaign', user_id: 'u', symbol: 'ETHUSDT', direction: 'main_long' } as TradeCampaign}
    legs={[leg]} result={result} originalLegs={originalLegs} originalTradeRecords={originalTradeRecords}
  /></MemoryRouter>);
  return screen.getByTestId('leg-execution-method-leg');
}
function methods(cell: HTMLElement) {
  return Array.from(cell.children).map(element => element.getAttribute('data-method'));
}

describe('反事实 Legs 与实际交易的操作方式区分', () => {
  const mirrorFixture = (pct: number) => {
    const mirrorLeg: CampaignCounterfactualManualLeg = {
      ...base, leg_role: 'mirror_tp', direction: 'long',
      actual: { ...base.actual!, leg_role: 'mirror_tp', direction: 'long', entry_method: 'manual', exit_method: 'manual' },
    };
    const originalLegs = [
      { id: 'main', leg_role: 'main_open', trade_record_id: 'main', direction: 'long', symbol: 'ETHUSDT' },
      { id: 'leg', leg_role: 'mirror_tp', trade_record_id: 'mirror', direction: 'long', symbol: 'ETHUSDT' },
    ] as TradeJournal[];
    const originalTradeRecords = [['main', 100 - pct], ['mirror', pct]].map(([id, quantity]) => ({
      id, quantity, fillId: 'shared', symbol: 'ETHUSDT', side: 'LONG', action: 'CLOSE',
      entryPrice: 100, exitPrice: 99, openTime: Date.parse(open), closeTime: Date.parse(close),
    })) as TradeRecord[];
    return { mirrorLeg, originalLegs, originalTradeRecords };
  };

  it.each([60, 59.99, 50])('未改动镜像沿用原始成交组的 %s%%，不拿反事实样本作分母', pct => {
    const fixture = mirrorFixture(pct);
    const cell = renderLeg(fixture.mirrorLeg, fixture.originalLegs, fixture.originalTradeRecords);
    expect(methods(cell)).toEqual(['order', pct === 60 ? 'order' : 'manual']);
    expect(cell.innerHTML).not.toContain('amber');
  });

  it('改变镜像数量后的模拟成交不冒用真实自动60%方式', () => {
    const fixture = mirrorFixture(60);
    const cell = renderLeg({ ...fixture.mirrorLeg, size_usdt: 999 }, fixture.originalLegs, fixture.originalTradeRecords);
    expect(methods(cell)).toEqual(['unknown', 'unknown']);
  });

  it('尚未归类的手动对冲沿用原始 hedge 类型，与原始 Legs 同样强调开仓', () => {
    const cell = renderLeg({ ...base, leg_role: 'standalone' }, [
      { id: base.id, leg_role: 'standalone', order_kind: 'hedge' } as TradeJournal,
    ]);
    expect(cell.children[0].children[0].className).toContain('amber');
    expect(screen.getByTestId('leg-frozen-role-leg')).toHaveTextContent('滚动对冲 1');
  });

  it('原样分支显示保存的实际开平方式，使用和原始 Legs 同一列', () => {
    const cell = renderLeg(JSON.parse(JSON.stringify(base)));
    expect(methods(cell)).toEqual(['manual', 'order']);
    expect(cell).toHaveTextContent('手动（开）');
    expect(cell).toHaveTextContent('自动（平）');
    expect(cell.children[0].children[0].className).toContain('amber');
    expect(cell.children[1].children[0].className).not.toContain('amber');
    expect(cell.previousElementSibling).toHaveTextContent('99.0000');
    expect(cell.nextElementSibling).toHaveAttribute('data-testid', 'leg-price-change-leg');
  });

  it.each([
    { entry_price: 101 }, { open_time: '2026-09-20T00:01:00Z' },
  ])('修改开仓 %j 只清除开仓方式，不当成手动交易', (edit) => {
    const cell = renderLeg({ ...base, ...edit });
    expect(methods(cell)).toEqual(['unknown', 'order']);
    expect(cell.innerHTML).not.toContain('amber');
  });

  it('修改方向后开平都不冒用原始操作方式', () => {
    expect(methods(renderLeg({ ...base, direction: 'long' }))).toEqual(['unknown', 'unknown']);
  });

  it('镜像改为空仓后不冒用原始多仓60%的自动平仓', () => {
    const fixture = mirrorFixture(60);
    const cell = renderLeg({ ...fixture.mirrorLeg, direction: 'short' }, fixture.originalLegs, fixture.originalTradeRecords);
    expect(methods(cell)).toEqual(['unknown', 'unknown']);
  });

  it.each([{ exit_price: 98 }, { close_time: '2026-09-20T01:01:00Z' }])('修改平仓 %j 只清除平仓方式', (edit) => {
    expect(methods(renderLeg({ ...base, ...edit }))).toEqual(['manual', 'unknown']);
  });

  it('ISO 时间字符串格式不同但同一时刻，仍认作未改动', () => {
    expect(methods(renderLeg({ ...base, open_time: '2026-09-20T08:00:00+08:00', close_time: '2026-09-20T09:00:00+08:00' }))).toEqual(['manual', 'order']);
  });

  it('旧分支/新增模拟腿没有保存证据，MARKET 合成记录不会冒充真实手动成交', () => {
    expect(methods(renderLeg({ ...base, actual: undefined }))).toEqual(['unknown', 'unknown']);
  });

  it('旧分支保留未改动真实成交，缺少方式也按用户口径显示手动', () => {
    const cell = renderLeg({ ...base, actual: { ...base.actual!, entry_method: undefined, exit_method: undefined } });
    expect(methods(cell)).toEqual(['manual', 'manual']);
    expect(cell.children[0].children[0].className).toContain('amber');
    expect(cell.children[1].children[0].className).not.toContain('amber');
  });

  it('没有真实成交来源的模拟经济快照不套用手动兜底', () => {
    expect(methods(renderLeg({ ...base, actual: { ...base.actual!, source: 'unsettled', entry_method: undefined, exit_method: undefined } }))).toEqual(['unknown', 'unknown']);
  });

  it.each([{ filled: false }, { enabled: false }])('未成交或停用的腿 %j 不展示实际方式', (state) => {
    expect(methods(renderLeg({ ...base, ...state }))).toEqual(['unknown', 'unknown']);
  });

  it('未平仓腿的模拟兜底时间不是实际平仓方式证据', () => {
    expect(methods(renderLeg({ ...base, actual: { ...base.actual!, close_time_fallback: true, still_open: true } }))).toEqual(['manual', 'unknown']);
  });

  it.each(['main_open', 'reentry_main'] as const)('未改动的实际 %s 沿用主力手动约定，来源缺失不影响业务标记', role => {
    const main = { ...base, leg_role: role, actual: { ...base.actual!, leg_role: role, entry_method: undefined } };
    const cell = renderLeg(main);
    expect(methods(cell)).toEqual(['manual', 'order']);
    expect(cell.firstElementChild?.getAttribute('title')).toContain('业务约定');
    expect(cell.innerHTML).not.toContain('amber');
  });

  it('新增模拟主力不会因角色而冒充真实手动交易', () => {
    expect(methods(renderLeg({ ...base, leg_role: 'main_open', actual: undefined }))).toEqual(['unknown', 'unknown']);
  });

  it('把实际对冲改成模拟主力，不沿用真实开仓方式或主力手动规则', () => {
    expect(methods(renderLeg({ ...base, leg_role: 'main_open', actual: { ...base.actual!, leg_role: 'hedge_rolling' } }))).toEqual(['unknown', 'unknown']);
  });

  it('修改主力开仓参数后，不再套用实际主力手动规则', () => {
    expect(methods(renderLeg({ ...base, leg_role: 'main_open', entry_price: 101,
      actual: { ...base.actual!, leg_role: 'main_open', entry_method: undefined } }))).toEqual(['unknown', 'order']);
  });

  it('旧分支没有角色快照时，同 id 的原始主力可补充业务角色，不修改实际证据', () => {
    const legacy = { ...base, leg_role: 'main_open', actual: { ...base.actual!, entry_method: undefined } };
    const cell = renderLeg(legacy, [{ id: base.id, leg_role: 'main_open' } as TradeJournal]);
    expect(methods(cell)).toEqual(['manual', 'order']);
    expect(legacy.actual.entry_method).toBeUndefined();
  });

  it('同 id 原始腿是对冲：旧分支改成主力后仍未知，不套主力约定', () => {
    expect(methods(renderLeg({ ...base, leg_role: 'main_open' }, [{ id: base.id, leg_role: 'hedge_rolling' } as TradeJournal])))
      .toEqual(['unknown', 'unknown']);
  });

  it('主力 id 不匹配不套角色约定，但未改动真实成交仍适用缺记录手动口径', () => {
    expect(methods(renderLeg({ ...base, leg_role: 'main_open', actual: { ...base.actual!, entry_method: undefined } },
      [{ id: 'another-leg', leg_role: 'main_open' } as TradeJournal])))
      .toEqual(['manual', 'order']);
  });
});
