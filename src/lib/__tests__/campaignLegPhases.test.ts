import { describe, expect, it } from 'vitest';
import { legDeltaB, legSupportsPhases, splitMainLegPhases, visibleLegPhases, type MainPhaseInput } from '@/lib/campaignLegPhases';

const T = (h: number, m: number) => Date.parse(`2026-04-02T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);

const base: MainPhaseInput = {
  pnl: 31767.98,
  entryPrice: 0.00776554,
  exitPrice: 0.00902954,
  openTime: T(9, 34),
  closeTime: T(14, 9),
  side: 'long',
  hedges: [],
};

describe('splitMainLegPhases', () => {
  it('无对冲时只有一个阶段，即整腿本身', () => {
    const phases = splitMainLegPhases(base);
    expect(phases).toHaveLength(1);
    expect(phases[0].pnl).toBe(base.pnl);
    expect(phases[0].startPrice).toBe(base.entryPrice);
    expect(phases[0].endPrice).toBe(base.exitPrice);
    expect(phases[0].boundaryLegId).toBeNull();
  });

  it('一笔对冲按开仓和平仓切成「纯多头 → 对冲1 → 纯多头」', () => {
    const phases = splitMainLegPhases({
      ...base,
      hedges: [{ legId: 'h1', ordinal: 1, openTime: T(11, 0), openPrice: 0.0085, closeTime: T(13, 21), closePrice: 0.00935777 }],
    });
    expect(phases).toHaveLength(3);
    expect(phases.map(phase => phase.label)).toEqual(['纯多头阶段', '对冲1阶段', '纯多头阶段']);
    expect(phases.map(phase => [phase.startTime, phase.endTime])).toEqual([
      [base.openTime, T(11, 0)], [T(11, 0), T(13, 21)], [T(13, 21), base.closeTime],
    ]);
    // 守恒：各阶段之和严格等于整腿盈亏
    expect(phases.reduce((sum, phase) => sum + phase.pnl, 0)).toBeCloseTo(base.pnl, 8);
  });

  it('贴着主力平仓结束的对冲不切段——切出来是零长度尾段', () => {
    const phases = splitMainLegPhases({
      ...base,
      hedges: [{ legId: 'h2', ordinal: 1, openTime: base.closeTime!, openPrice: 0.00903213, closeTime: T(15, 0), closePrice: 0.0091 }],
    });
    expect(phases).toHaveLength(1);
  });

  it('主力开仓前结束的对冲不参与', () => {
    const phases = splitMainLegPhases({
      ...base,
      hedges: [{ legId: 'old', ordinal: 1, openTime: T(7, 0), openPrice: 0.006, closeTime: T(8, 0), closePrice: 0.007 }],
    });
    expect(phases).toHaveLength(1);
  });

  it('连续对冲按状态切段，同一时刻平旧开新不产生零长度段', () => {
    const phases = splitMainLegPhases({
      ...base,
      hedges: [
        { legId: 'a', ordinal: 1, openTime: T(10, 0), openPrice: 0.008, closeTime: T(11, 0), closePrice: 0.0085 },
        { legId: 'b', ordinal: 2, openTime: T(11, 0), openPrice: 0.0085, closeTime: T(12, 0), closePrice: 0.0088 },
      ],
    });
    expect(phases).toHaveLength(4);
    expect(phases.map(p => p.label)).toEqual(['纯多头阶段', '对冲1阶段', '对冲2阶段', '纯多头阶段']);
    expect(phases.reduce((s, p) => s + p.pnl, 0)).toBeCloseTo(base.pnl, 8);
  });

  it('空头方向：价格下行的阶段为正贡献', () => {
    const phases = splitMainLegPhases({
      pnl: 1000,
      entryPrice: 100, exitPrice: 90,
      openTime: T(9, 0), closeTime: T(12, 0),
      side: 'short',
      hedges: [{ legId: 'h', ordinal: 1, openTime: T(9, 30), openPrice: 97, closeTime: T(10, 0), closePrice: 94 }],
    });
    expect(phases.map(p => p.pnl)).toEqual([300, 300, 400]);
    expect(phases.map(p => p.label)).toEqual(['纯空头阶段', '对冲1阶段', '纯空头阶段']);
  });

  it('开平同价（总价差为 0）时盈亏全数记在最后一段，不产生 NaN', () => {
    const phases = splitMainLegPhases({
      pnl: -50, // 比如纯手续费亏损
      entryPrice: 100, exitPrice: 100,
      openTime: T(9, 0), closeTime: T(12, 0),
      side: 'long',
      hedges: [{ legId: 'h', ordinal: 1, openTime: T(9, 30), openPrice: 102, closeTime: T(10, 0), closePrice: 105 }],
    });
    expect(phases).toHaveLength(3);
    expect(phases[0].pnl).toBe(0);
    expect(phases[1].pnl).toBe(0);
    expect(phases[2].pnl).toBe(-50);
    expect(phases.every(p => Number.isFinite(p.pnl))).toBe(true);
  });

  it('价格非法时返回空数组，不臆造', () => {
    expect(splitMainLegPhases({ ...base, entryPrice: 0 })).toEqual([]);
    expect(splitMainLegPhases({ ...base, exitPrice: Number.NaN })).toEqual([]);
  });
});

describe('阶段呈现规则', () => {
  it('主力多空与其他多单可分阶段，空单对冲不呈现', () => {
    expect(legSupportsPhases({ leg_role: 'main_open', direction: 'short' })).toBe(true);
    expect(legSupportsPhases({ leg_role: 'main_add_1', direction: 'long' })).toBe(true);
    expect(legSupportsPhases({ leg_role: 'hedge_rolling', direction: 'long' })).toBe(true);
    expect(legSupportsPhases({ leg_role: 'hedge_rolling', direction: 'short' })).toBe(false);
  });

  it('有对冲时保留前后纯多头区间；无对冲时不重复展示整腿', () => {
    const phases = splitMainLegPhases({
      ...base,
      hedges: [{ legId: 'h1', ordinal: 1, openTime: T(11, 0), openPrice: 0.0085, closeTime: T(13, 21), closePrice: 0.00935777 }],
    });
    expect(visibleLegPhases(phases).map(phase => phase.label)).toEqual(['纯多头阶段', '对冲1阶段', '纯多头阶段']);
    expect(visibleLegPhases(splitMainLegPhases(base))).toEqual([]);
  });
});

describe('legDeltaB', () => {
  it('Δb = 盈亏 ÷ 初始最大预期亏损；Σ(各腿 Δb) = 战役已实现 b', () => {
    const L = 39130;
    const legs = [31767.98, -8708.85, -5050.46, 15119.37];
    const sum = legs.reduce((s, p) => s + legDeltaB(p, L)!, 0);
    expect(sum).toBeCloseTo((31767.98 - 8708.85 - 5050.46 + 15119.37) / L, 12);
    expect(legDeltaB(31767.98, L)).toBeCloseTo(0.812, 3);
  });

  it('L 缺失或非正时为 null——不臆造', () => {
    expect(legDeltaB(100, null)).toBeNull();
    expect(legDeltaB(100, 0)).toBeNull();
    expect(legDeltaB(100, -5)).toBeNull();
    expect(legDeltaB(null, 100)).toBeNull();
  });
});
