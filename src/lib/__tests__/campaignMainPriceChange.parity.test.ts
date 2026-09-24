/**
 * 战役涨跌幅的真实一侧 ↔ 反事实副本对账（用真实夹具，走编辑器同一条路：buildManualLegs → JSON 往返 → counterfactualPriceChange）。
 *
 * 【复核发现】四个会让「原样重跑逐位相同」「改一格只挪这一格」失守的场景，固化成回归用例：
 *   1. 挂着从未成交的滚动对冲（Legs 表「挂单中」）不是对冲在手；
 *   2. 没有成交记录、靠 hedge_triggered 事件持有的对冲按触发时刻算（触发在主力平仓之后的不在手）；
 *   3. 主力最后一刀被加仓腿认领：只改开仓价，平仓价与主力平仓时刻不能跟着换；
 *   4. 一条腿都结算不了的战役：真实涨跌幅「—」，只改开仓价也不能印出幻影涨跌幅。
 */
import { describe, expect, it } from 'vitest';
import {
  campaignMainLegPriceChangePct,
  campaignPriceChange,
  campaignPriceChangeLegInputs,
  counterfactualPriceChange,
  type ActualMainPriceChange,
} from '@/lib/campaignMainPriceChange';
import { buildActualSimulationParams, buildManualLegs, buildPureSopParams } from '@/lib/campaignSimulationEngine';
import { parityFixture, type ParityFixture } from '@/test/fixtures/counterfactualParityFixtures';
import type { CampaignCounterfactualManualLeg, CampaignCounterfactualParams, CampaignEvent, TradeJournal } from '@/types/journal';

function localOrdersOf(fx: ParityFixture) {
  return fx.unfilledOrderIds ? { unfilledOrderIds: new Set(fx.unfilledOrderIds) } : {};
}

/** 真实一侧：与详情页同一份输入。 */
function real(fx: ParityFixture) {
  const actualMain: ActualMainPriceChange = {
    byLegId: Object.fromEntries(campaignPriceChangeLegInputs(fx.campaign, fx.legs, fx.tradeRecords, fx.corrections, localOrdersOf(fx)).map(input => [input.id, input])),
    pct: campaignMainLegPriceChangePct(fx.campaign, fx.legs, fx.tradeRecords, fx.corrections, localOrdersOf(fx)),
  };
  return { change: campaignPriceChange(fx.campaign, fx.legs, fx.tradeRecords, fx.corrections, localOrdersOf(fx)), actualMain };
}

/** 副本：编辑器的底稿（buildManualLegs）经 JSON 往返；可选地改几格。 */
function copy(fx: ParityFixture, edit?: (legs: CampaignCounterfactualManualLeg[]) => CampaignCounterfactualManualLeg[]) {
  const { campaign, legs, tradeRecords, klines, corrections } = fx;
  const defaults = buildActualSimulationParams(campaign, legs, tradeRecords) ?? buildPureSopParams(campaign, legs, tradeRecords);
  expect(defaults).not.toBeNull();
  const base = JSON.parse(JSON.stringify(defaults)) as CampaignCounterfactualParams;
  const manualLegs = buildManualLegs(base, legs, klines, tradeRecords, corrections, { campaign, localOrders: localOrdersOf(fx) });
  return JSON.parse(JSON.stringify(edit ? edit(manualLegs) : manualLegs)) as CampaignCounterfactualManualLeg[];
}

/** 从夹具里抄一条腿改成滚动对冲挂单 / 无记录腿。 */
function rollingLeg(fx: ParityFixture, over: Partial<TradeJournal>): TradeJournal {
  const template = fx.legs.find(leg => leg.leg_role === 'main_open') ?? fx.legs[0];
  return {
    ...template,
    id: 'roll-x', leg_role: 'hedge_rolling', direction: 'short', trade_record_id: null,
    post_exit_price_snapshot: null, post_realized_pnl: null, post_real_close_time: null, post_simulated_close_time: null, post_outcome: null,
    ...over,
  } as TradeJournal;
}

describe('战役涨跌幅：真实一侧 ↔ 反事实副本', () => {
  it('1. 挂着从未成交的滚动对冲不是对冲在手：真实与原样重跑都按主力平仓价', () => {
    const base = parityFixture('plain-long');
    const fx: ParityFixture = {
      ...base,
      legs: [...base.legs, rollingLeg(base, { pre_simulated_time: '2026-01-01T01:00:00.000Z', pre_entry_price: 98 })],
    };
    const { change, actualMain } = real(fx);
    expect(change).toMatchObject({ exitSource: 'main', exitPrice: 110 });
    expect(change.pct).toBeCloseTo(10, 9);
    const legs = copy(fx);
    expect(legs.find(leg => leg.id === 'roll-x')?.filled).toBe(false);
    expect(counterfactualPriceChange(legs, actualMain).pct).toBe(change.pct);
  });

  it('2. 无记录、事件里触发的滚动对冲按触发时刻算：主力平仓后才触发的不在手，只改它的平仓价也不会翻转', () => {
    const base = parityFixture('plain-long');
    const mainClose = base.legs.find(leg => leg.leg_role === 'main_open')!;
    const closeMs = Date.parse(mainClose.post_real_close_time ?? mainClose.post_simulated_close_time ?? '2026-01-01T03:00:00.000Z');
    const trigger = (offsetMs: number): CampaignEvent => ({
      id: 'e-roll', event_type: 'hedge_triggered', timestamp: new Date(closeMs + offsetMs).toISOString(),
      journal_id: 'roll-x', leg_role: 'hedge_rolling', direction: 'short', price: 98, size_usdt: 1_000,
    } as unknown as CampaignEvent);
    const withEvent = (offsetMs: number): ParityFixture => ({
      ...base,
      campaign: { ...base.campaign, actual_evolution: [...(base.campaign.actual_evolution ?? []), trigger(offsetMs)] },
      legs: [...base.legs, rollingLeg(base, { pre_simulated_time: '2026-01-01T00:00:00.000Z', pre_entry_price: 98 })],
    });
    // 触发在主力平仓之后：不在手
    const late = withEvent(5 * 60_000);
    const lateReal = real(late);
    expect(lateReal.change).toMatchObject({ exitSource: 'main', exitPrice: 110 });
    expect(counterfactualPriceChange(copy(late), lateReal.actualMain).pct).toBe(lateReal.change.pct);
    const edited = copy(late, legs => legs.map(leg => (leg.id === 'roll-x' ? { ...leg, exit_price: 97 } : leg)));
    expect(counterfactualPriceChange(edited, lateReal.actualMain)).toMatchObject({ exitSource: 'main', exitPrice: 110 });
    // 触发在主力平仓之前、之后一直在手：锁在触发价
    const early = withEvent(-60 * 60_000);
    const earlyReal = real(early);
    expect(earlyReal.change).toMatchObject({ exitSource: 'rolling_hedge', exitPrice: 98 });
    expect(counterfactualPriceChange(copy(early), earlyReal.actualMain).pct).toBe(earlyReal.change.pct);
  });

  it('3. 主力最后一刀被加仓腿认领：只改开仓价，平仓价与主力平仓时刻不动', () => {
    const fx = parityFixture('sim-close-claimed-by-add-leg');
    const { change, actualMain } = real(fx);
    expect(counterfactualPriceChange(copy(fx), actualMain)).toEqual(change);
    const edited = copy(fx, legs => legs.map(leg => (leg.id === change.entryLegId ? { ...leg, entry_price: leg.entry_price * 0.99 } : leg)));
    const after = counterfactualPriceChange(edited, actualMain);
    expect(after.exitPrice).toBe(change.exitPrice);
    expect(after.mainCloseTime).toBe(change.mainCloseTime);
    expect(after.exitSource).toBe(change.exitSource);
    expect(after.entryPrice).toBeCloseTo((change.entryPrice as number) * 0.99, 9);
  });

  it('4. 一条腿都结算不了的战役：真实涨跌幅「—」，只改开仓价后仍是「—」', () => {
    for (const id of ['sim-no-settlement-stored', 'sim-no-settlement-events']) {
      const fx = parityFixture(id);
      const { change, actualMain } = real(fx);
      expect(change.pct, id).toBeNull();
      expect(counterfactualPriceChange(copy(fx), actualMain).pct, id).toBeNull();
      const edited = copy(fx, legs => legs.map(leg => (leg.leg_role === 'main_open' ? { ...leg, entry_price: leg.entry_price * 0.99 } : leg)));
      expect(counterfactualPriceChange(edited, actualMain).pct, id).toBeNull();
    }
  });
});
