/**
 * 【用户要求】盈亏概览「多方总名义仓位」：主方向那一侧所有腿（主力、镜像、加仓）的名义仓位合计，
 * 与 Legs 表合计行这一侧的 Σ名义仓位同一个数（同一个 buildLegPositionShareInputs）；反事实按副本的「仓位」一格逐位复现。
 */
import { describe, expect, it } from 'vitest';
import { buildLegPositionShareInputs, campaignMainSideNotional } from '@/lib/legPositionShareInputs';
import { counterfactualMainSideNotional } from '@/lib/counterfactualOverview';
import type { CampaignCounterfactualManualLeg, TradeJournal } from '@/types/journal';

const leg = (over: Partial<TradeJournal>): TradeJournal => ({
  id: 'main', leg_role: 'main_open', direction: 'long', trade_record_id: null,
  pre_simulated_time: '2026-01-01T00:00:00.000Z', pre_entry_price: 100, pre_position_size: 10_000,
  post_realized_pnl: 10, post_real_close_time: '2026-01-02T00:00:00.000Z', post_exit_price: 110,
  ...over,
} as TradeJournal);

const EVIDENCE = { unfilledOrderIds: new Set<string>(), orders: [], events: [] };

describe('多方总名义仓位', () => {
  const legs = [
    leg({ id: 'main-1' }),
    leg({ id: 'mirror', leg_role: 'mirror_tp', pre_position_size: 10_000 }),
    leg({ id: 'add-1', leg_role: 'main_add_1', pre_position_size: 5_000 }),
    leg({ id: 'hedge', leg_role: 'hedge_initial_a', direction: 'short', pre_position_size: 25_000 }),
  ];

  it('主多战役：主力 + 镜像 + 加仓的多单合计，空单对冲不算', () => {
    const inputs = buildLegPositionShareInputs(legs, new Map(), {}, EVIDENCE);
    expect(campaignMainSideNotional('main_long', inputs)).toEqual({ side: 'long', total: 25_000 });
  });

  it('主空战役数空方', () => {
    const shortLegs = legs.map(item => ({ ...item, direction: item.direction === 'long' ? 'short' : 'long' } as TradeJournal));
    const inputs = buildLegPositionShareInputs(shortLegs, new Map(), {}, EVIDENCE);
    expect(campaignMainSideNotional('main_short', inputs)).toEqual({ side: 'short', total: 25_000 });
  });

  it('一条同方向的腿都没有：null（显示「—」）', () => {
    const inputs = buildLegPositionShareInputs([legs[3]], new Map(), {}, EVIDENCE);
    expect(campaignMainSideNotional('main_long', inputs).total).toBeNull();
  });

  describe('反事实', () => {
    const manual = (over: Partial<CampaignCounterfactualManualLeg>): CampaignCounterfactualManualLeg => ({
      id: 'main-1', leg_role: 'main_open', direction: 'long',
      open_time: '2026-01-01T00:00:00.000Z', close_time: '2026-01-02T00:00:00.000Z',
      entry_price: 100, exit_price: 110, size_usdt: 10_000, leverage: 10, enabled: true,
      ...over,
    } as CampaignCounterfactualManualLeg);
    const copy = [
      manual({}),
      manual({ id: 'mirror', leg_role: 'mirror_tp' }),
      manual({ id: 'add-1', leg_role: 'main_add_1', size_usdt: 5_000 }),
      manual({ id: 'hedge', leg_role: 'hedge_initial_a', direction: 'short', size_usdt: 25_000 }),
    ];

    it('原样重跑：与真实一侧同一个数', () => {
      expect(counterfactualMainSideNotional(copy, 'long')).toBe(25_000);
    });

    it('停用、挂单中的腿不算；改了「仓位」按改后的算', () => {
      expect(counterfactualMainSideNotional([copy[0], { ...copy[1], enabled: false }, copy[2], copy[3]], 'long')).toBe(15_000);
      expect(counterfactualMainSideNotional([copy[0], { ...copy[1], filled: false }, copy[2]], 'long')).toBe(15_000);
      expect(counterfactualMainSideNotional([copy[0], copy[1], { ...copy[2], size_usdt: 20_000 }], 'long')).toBe(40_000);
      expect(counterfactualMainSideNotional([copy[3]], 'long')).toBeNull();
    });
  });
});
