import { describe, expect, it } from 'vitest';
import { legNotionalUsd, pickPrimaryMainLeg } from '../campaignPrimaryMainLeg';
import type { TradeJournal } from '@/types/journal';

function leg(over: Partial<TradeJournal>): TradeJournal {
  return {
    id: 'l', leg_role: 'main_open', pre_position_size: null,
    pre_simulated_time: null, ...over,
  } as TradeJournal;
}

describe('pickPrimaryMainLeg', () => {
  it('多笔主仓时取名义金额最大的那笔——而不是排在前面的残仓', () => {
    // 实盘反例：1769.83 的残仓排在 17775439.86 的真正主力之前
    const legs = [
      leg({ id: 'dust', pre_position_size: 1769.83, pre_simulated_time: '2026-08-05T04:02:00Z' }),
      leg({ id: 'real', pre_position_size: 17775439.86, pre_simulated_time: '2026-08-05T04:02:30Z' }),
    ];
    expect(pickPrimaryMainLeg(legs)?.id).toBe('real');
  });

  it('金额并列时退回最早开仓，结果稳定可复现', () => {
    const legs = [
      leg({ id: 'late', pre_position_size: 1000, pre_simulated_time: '2026-08-05T05:00:00Z' }),
      leg({ id: 'early', pre_position_size: 1000, pre_simulated_time: '2026-08-05T04:00:00Z' }),
    ];
    expect(pickPrimaryMainLeg(legs)?.id).toBe('early');
  });

  it('金额缺失的排在有金额的之后；全缺失则退回最早开仓', () => {
    expect(pickPrimaryMainLeg([
      leg({ id: 'none' }),
      leg({ id: 'sized', pre_position_size: 5 }),
    ])?.id).toBe('sized');

    expect(pickPrimaryMainLeg([
      leg({ id: 'later', pre_simulated_time: '2026-08-05T06:00:00Z' }),
      leg({ id: 'earlier', pre_simulated_time: '2026-08-05T04:00:00Z' }),
    ])?.id).toBe('earlier');
  });

  it('main_open 优先于 reentry_main——小额主仓也压过大额重入仓', () => {
    const legs = [
      leg({ id: 'reentry', leg_role: 'reentry_main', pre_position_size: 999999 }),
      leg({ id: 'main', leg_role: 'main_open', pre_position_size: 10 }),
    ];
    expect(pickPrimaryMainLeg(legs)?.id).toBe('main');
  });

  it('没有 main_open 时才退回 reentry_main', () => {
    const legs = [
      leg({ id: 'hedge', leg_role: 'hedge_a', pre_position_size: 500 }),
      leg({ id: 'reentry', leg_role: 'reentry_main', pre_position_size: 100 }),
    ];
    expect(pickPrimaryMainLeg(legs)?.id).toBe('reentry');
  });

  it('没有任何主仓角色时返回 null，不臆造', () => {
    expect(pickPrimaryMainLeg([leg({ leg_role: 'mirror_tp', pre_position_size: 9 })])).toBeNull();
    expect(pickPrimaryMainLeg([])).toBeNull();
  });

  it('legNotionalUsd 只认有限正数', () => {
    expect(legNotionalUsd(leg({ pre_position_size: 12.5 }))).toBe(12.5);
    expect(legNotionalUsd(leg({ pre_position_size: 0 }))).toBeNull();
    expect(legNotionalUsd(leg({ pre_position_size: -3 }))).toBeNull();
    expect(legNotionalUsd(leg({ pre_position_size: Number.NaN }))).toBeNull();
    expect(legNotionalUsd(leg({}))).toBeNull();
  });
});
