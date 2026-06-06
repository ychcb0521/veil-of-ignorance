import { describe, it, expect } from 'vitest';
import {
  deriveTradePath,
  type TradePathInput,
  type TradePathBar,
} from '@/lib/tradePath';

function long(bars: TradePathBar[], over: Partial<TradePathInput> = {}): TradePathInput {
  return {
    side: 'long',
    entryPrice: 100,
    plannedStop: 90,
    plannedTarget: null,
    exitPrice: null,
    bars,
    ...over,
  };
}

describe('deriveTradePath', () => {
  it('A 干净赢：几乎没浮亏、先确认 → clean_win', () => {
    const r = deriveTradePath(
      long(
        [
          { high: 101, low: 99, close: 100.5 },
          { high: 108, low: 100, close: 107 },
          { high: 121, low: 118, close: 120 },
        ],
        { plannedTarget: 120, exitPrice: 120, outcome: 'win' },
      ),
    );
    expect(r.maeR).toBeCloseTo(0.1);
    expect(r.resolution).toBe('confirmed');
    expect(r.nShape).toBe('continuation');
    expect(r.initiative).toBe('held');
    expect(r.winQuality).toBe('clean');
    expect(r.verdict).toBe('clean_win');
    expect(r.tone).toBe('good');
  });

  it('B 扛单赢：跌穿止损又拉回 → dragged_win', () => {
    const r = deriveTradePath(
      long(
        [
          { high: 101, low: 99, close: 100 },
          { high: 95, low: 85, close: 92 },
          { high: 121, low: 110, close: 121 },
        ],
        { exitPrice: 121, outcome: 'win' },
      ),
    );
    expect(r.maeR).toBeCloseTo(1.5);
    expect(r.breachedStop).toBe(true);
    expect(r.overran).toBe(true);
    expect(r.resolution).toBe('falsified');
    expect(r.nShape).toBe('breakdown');
    expect(r.initiative).toBe('surrendered');
    expect(r.winQuality).toBe('dragged');
    expect(r.verdict).toBe('dragged_win');
    expect(r.tone).toBe('bad');
  });

  it('C 受控亏：干净打到止损、全程水下 → controlled_loss', () => {
    const r = deriveTradePath(
      long(
        [
          { high: 100, low: 96, close: 97 },
          { high: 97, low: 93, close: 94 },
          { high: 94, low: 90, close: 90 },
        ],
        { exitPrice: 90, outcome: 'loss' },
      ),
    );
    expect(r.maeR).toBeCloseTo(1.0);
    expect(r.overran).toBe(false);
    expect(r.timeInLossPct).toBeCloseTo(1);
    expect(r.resolution).toBe('falsified');
    expect(r.initiative).toBe('surrendered'); // 久熬水下
    expect(r.verdict).toBe('controlled_loss');
    expect(r.tone).toBe('warn');
  });

  it('D 失控亏：平仓还在止损外 → overrun_loss', () => {
    const r = deriveTradePath(
      long(
        [
          { high: 100, low: 97, close: 98 },
          { high: 98, low: 90, close: 92 },
          { high: 92, low: 81, close: 82 },
        ],
        { exitPrice: 82, outcome: 'loss' },
      ),
    );
    expect(r.maeR).toBeCloseTo(1.9);
    expect(r.overran).toBe(true);
    expect(r.verdict).toBe('overrun_loss');
    expect(r.tone).toBe('bad');
  });

  it('E 没止损的赢：证伪距离缺失 → maeR null / unresolved，仍是 clean_win', () => {
    const r = deriveTradePath(
      long(
        [
          { high: 103, low: 99, close: 102 },
          { high: 110, low: 101, close: 108 },
          { high: 116, low: 112, close: 115 },
        ],
        { plannedStop: null, exitPrice: 115, outcome: 'win' },
      ),
    );
    expect(r.riskPerR).toBeNull();
    expect(r.maeR).toBeNull();
    expect(r.resolution).toBe('unresolved');
    expect(r.barsToResolution).toBeNull();
    expect(r.nShape).toBe('chop');
    expect(r.verdict).toBe('clean_win');
    expect(r.tone).toBe('good');
  });

  it('F 保本：走平 → flat / muted', () => {
    const r = deriveTradePath(
      long(
        [
          { high: 101, low: 99, close: 100 },
          { high: 100, low: 99, close: 100 },
        ],
        { exitPrice: 100 },
      ),
    );
    expect(r.verdict).toBe('flat');
    expect(r.tone).toBe('muted');
    expect(r.winQuality).toBeNull();
  });

  it('coarseOutcome：不传 outcome 时按 entry / exit 粗判赢', () => {
    const r = deriveTradePath(
      long(
        [
          { high: 105, low: 100, close: 104 },
          { high: 112, low: 103, close: 111 },
        ],
        { plannedTarget: 110, exitPrice: 111 },
      ),
    );
    expect(r.verdict).toBe('clean_win');
  });

  it('做空对称：不利在 high、有利在 low', () => {
    const r = deriveTradePath({
      side: 'short',
      entryPrice: 100,
      plannedStop: 110,
      plannedTarget: 80,
      exitPrice: 80,
      outcome: 'win',
      bars: [
        { high: 101, low: 95, close: 96 },
        { high: 97, low: 82, close: 84 },
        { high: 81, low: 78, close: 80 },
      ],
    });
    // entry100 stop110 → R=10；不利 = high − entry，最大在 bar0 = 1 → maeR 0.1
    expect(r.maeR).toBeCloseTo(0.1);
    expect(r.resolution).toBe('confirmed');
    expect(r.verdict).toBe('clean_win');
    expect(r.tone).toBe('good');
  });
});
