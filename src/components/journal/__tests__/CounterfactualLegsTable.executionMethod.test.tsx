import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CounterfactualLegsTable } from '@/components/journal/CounterfactualLegsTable';
import type { CampaignCounterfactualManualLeg, CampaignCounterfactualResult, TradeCampaign, TradeJournal } from '@/types/journal';

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
function renderLeg(leg: CampaignCounterfactualManualLeg = base, originalLegs?: TradeJournal[]) {
  render(<MemoryRouter><CounterfactualLegsTable
    campaign={{ id: 'campaign', user_id: 'u', symbol: 'ETHUSDT', direction: 'main_long' } as TradeCampaign}
    legs={[leg]} result={result} originalLegs={originalLegs}
  /></MemoryRouter>);
  return screen.getByTestId('leg-execution-method-leg');
}
function methods(cell: HTMLElement) {
  return Array.from(cell.children).map(element => element.getAttribute('data-method'));
}

describe('反事实 Legs 与实际交易的操作方式区分', () => {
  it('原样分支显示保存的实际开平方式，使用和原始 Legs 同一列', () => {
    const cell = renderLeg(JSON.parse(JSON.stringify(base)));
    expect(methods(cell)).toEqual(['manual', 'order']);
    expect(cell).toHaveTextContent('手动（开）');
    expect(cell).toHaveTextContent('自动（平）');
    expect(cell.previousElementSibling).toHaveTextContent('99.0000');
    expect(cell.nextElementSibling).toHaveAttribute('data-testid', 'leg-price-change-leg');
  });

  it.each([
    { entry_price: 101 }, { open_time: '2026-09-20T00:01:00Z' }, { direction: 'long' as const },
  ])('修改开仓 %j 只清除开仓方式，不当成手动交易', (edit) => {
    expect(methods(renderLeg({ ...base, ...edit }))).toEqual(['unknown', 'order']);
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

  it('旧分支即使有 actual 经济快照，没有操作证据仍然未知', () => {
    expect(methods(renderLeg({ ...base, actual: { ...base.actual!, entry_method: undefined, exit_method: undefined } }))).toEqual(['unknown', 'unknown']);
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
  });

  it('新增模拟主力不会因角色而冒充真实手动交易', () => {
    expect(methods(renderLeg({ ...base, leg_role: 'main_open', actual: undefined }))).toEqual(['unknown', 'unknown']);
  });

  it('把实际对冲改成模拟主力，不沿用真实开仓方式或主力手动规则', () => {
    expect(methods(renderLeg({ ...base, leg_role: 'main_open', actual: { ...base.actual!, leg_role: 'hedge_rolling' } }))).toEqual(['unknown', 'order']);
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
      .toEqual(['unknown', 'order']);
  });

  it('原始主力 id 不匹配，不为旧分支或新增模拟主力补造方式', () => {
    expect(methods(renderLeg({ ...base, leg_role: 'main_open', actual: { ...base.actual!, entry_method: undefined } },
      [{ id: 'another-leg', leg_role: 'main_open' } as TradeJournal])))
      .toEqual(['unknown', 'order']);
  });
});
