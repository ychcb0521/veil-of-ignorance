import { describe, expect, it } from 'vitest';
import {
  MIRROR_TP_FLAT_BAND,
  campaignAchievedMirrorTp,
  mirrorTpOutcome,
  mirrorTpRank,
  summarizeMirrorTp,
} from '../mirrorTpSummary';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const leg = (over: Partial<TradeJournal>): TradeJournal => ({ id: 'l', leg_role: null, trade_record_id: null, ...over } as TradeJournal);
const rec = (id: string): TradeRecord => ({ id } as TradeRecord);

describe('campaignAchievedMirrorTp', () => {
  it('有成交的 mirror_tp 腿 → 达成', () => {
    expect(campaignAchievedMirrorTp(
      [leg({ leg_role: 'main_open', trade_record_id: 'r0' }), leg({ leg_role: 'mirror_tp', trade_record_id: 'r1' })],
      [rec('r0'), rec('r1')],
    )).toBe(true);
  });

  it('mirror_tp 腿未成交（无 trade_record_id 或记录不存在）→ 未达成', () => {
    expect(campaignAchievedMirrorTp([leg({ leg_role: 'mirror_tp', trade_record_id: null })], [])).toBe(false);
    expect(campaignAchievedMirrorTp([leg({ leg_role: 'mirror_tp', trade_record_id: 'missing' })], [rec('r0')])).toBe(false);
  });

  it('没有 mirror_tp 腿 → 未达成', () => {
    expect(campaignAchievedMirrorTp([leg({ leg_role: 'main_open', trade_record_id: 'r0' })], [rec('r0')])).toBe(false);
  });
});

describe('mirrorTpRank（排序权重）', () => {
  it('实现·盈利 > 实现·打平/进行中 > 实现·亏损 > 未实现', () => {
    expect(mirrorTpRank(true, 1.5, 100)).toBe(3);   // 实现·盈利
    expect(mirrorTpRank(true, 0, 0)).toBe(2);       // 实现·打平
    expect(mirrorTpRank(true, null, null)).toBe(2); // 实现·进行中
    expect(mirrorTpRank(true, -0.8, -50)).toBe(1);  // 实现·亏损
    expect(mirrorTpRank(false, 9.9, 999)).toBe(0);  // 未实现（不管盈亏）
  });

  it('【用户要求】b 落在 −0.1 ~ 0.1 之间算持平，两端含在带内', () => {
    expect(mirrorTpRank(true, 0.1, 5)).toBe(2);
    expect(mirrorTpRank(true, -0.1, -5)).toBe(2);
    expect(mirrorTpRank(true, 0.09, 4)).toBe(2);
    expect(mirrorTpRank(true, -0.02, -1)).toBe(2);
    // 带外仍按 b 的正负分
    expect(mirrorTpRank(true, 0.11, 5)).toBe(3);
    expect(mirrorTpRank(true, -0.11, -5)).toBe(1);
  });

  it('没有有效 b 时退回按金额符号判，且不套持平带', () => {
    expect(mirrorTpRank(true, null, 1)).toBe(3);
    expect(mirrorTpRank(true, undefined, -1)).toBe(1);
    expect(mirrorTpRank(true, null, 0)).toBe(2);
  });
});

describe('mirrorTpOutcome（盈亏三分）', () => {
  it('持平带只按 b 判，金额多大都不影响', () => {
    expect(mirrorTpOutcome(0.05, 9999)).toBe('flat');
    expect(mirrorTpOutcome(-0.05, -9999)).toBe('flat');
    expect(mirrorTpOutcome(0.5, 1)).toBe('win');
    expect(mirrorTpOutcome(-0.5, -1)).toBe('loss');
    expect(mirrorTpOutcome(null, null)).toBe('open');
  });

  it('持平带宽度是 0.1', () => {
    expect(MIRROR_TP_FLAT_BAND).toBe(0.1);
  });
});

describe('summarizeMirrorTp', () => {
  it('达成/未达成 + 达成内盈亏 + 百分比', () => {
    const s = summarizeMirrorTp([
      { achieved: true, payoffRatio: 1.2, realizedPnl: 100 },    // 达成·盈利
      { achieved: true, payoffRatio: -0.6, realizedPnl: -50 },   // 达成·亏损
      { achieved: true, payoffRatio: 0, realizedPnl: 0 },        // 达成·打平
      { achieved: true, payoffRatio: null, realizedPnl: null },  // 达成·进行中
      { achieved: false, payoffRatio: 0.4, realizedPnl: 30 },    // 未达成
    ]);
    expect(s.total).toBe(5);
    expect(s.achieved).toBe(4);
    expect(s.notAchieved).toBe(1);
    expect(s.achievedWin).toBe(1);
    expect(s.achievedLoss).toBe(1);
    expect(s.achievedNeutral).toBe(2);
    expect(s.achievedRatePct).toBeCloseTo(80, 10);
    expect(s.notAchievedRatePct).toBeCloseTo(20, 10);
    expect(s.achievedWinRatePct).toBeCloseTo(25, 10);
  });

  it('空表 → 比率为 null，不除零', () => {
    const s = summarizeMirrorTp([]);
    expect(s.total).toBe(0);
    expect(s.achievedRatePct).toBeNull();
    expect(s.notAchievedRatePct).toBeNull();
    expect(s.achievedWinRatePct).toBeNull();
  });

  it('【用户要求】|b| ≤ 0.1 的战役计入持平，不再算进盈利 / 亏损', () => {
    const s = summarizeMirrorTp([
      { achieved: true, payoffRatio: 0.08, realizedPnl: 12 },
      { achieved: true, payoffRatio: -0.07, realizedPnl: -9 },
      { achieved: true, payoffRatio: 0.35, realizedPnl: 40 },
    ]);
    expect(s.achievedWin).toBe(1);
    expect(s.achievedLoss).toBe(0);
    expect(s.achievedNeutral).toBe(2);
  });

  it('全未达成 → 达成率 0、未达成率 100、盈利率 null', () => {
    const s = summarizeMirrorTp([{ achieved: false, realizedPnl: 10 }, { achieved: false, realizedPnl: -10 }]);
    expect(s.achievedRatePct).toBe(0);
    expect(s.notAchievedRatePct).toBe(100);
    expect(s.achievedWinRatePct).toBeNull();
  });
});
