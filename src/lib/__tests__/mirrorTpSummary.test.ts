import { describe, expect, it } from 'vitest';
import { campaignAchievedMirrorTp, mirrorTpRank, summarizeMirrorTp } from '../mirrorTpSummary';
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
    expect(mirrorTpRank(true, 100)).toBe(3);  // 实现·盈利
    expect(mirrorTpRank(true, 0)).toBe(2);    // 实现·打平
    expect(mirrorTpRank(true, null)).toBe(2); // 实现·进行中
    expect(mirrorTpRank(true, -50)).toBe(1);  // 实现·亏损
    expect(mirrorTpRank(false, 999)).toBe(0); // 未实现（不管盈亏）
  });
});

describe('summarizeMirrorTp', () => {
  it('达成/未达成 + 达成内盈亏 + 百分比', () => {
    const s = summarizeMirrorTp([
      { achieved: true, realizedPnl: 100 },   // 达成·盈利
      { achieved: true, realizedPnl: -50 },   // 达成·亏损
      { achieved: true, realizedPnl: 0 },     // 达成·打平
      { achieved: true, realizedPnl: null },  // 达成·进行中
      { achieved: false, realizedPnl: 30 },   // 未达成
    ]);
    expect(s.total).toBe(5);
    expect(s.achieved).toBe(4);
    expect(s.notAchieved).toBe(1);
    expect(s.achievedWin).toBe(1);
    expect(s.achievedLoss).toBe(1);
    expect(s.achievedNeutral).toBe(2);
    expect(s.achievedRatePct).toBeCloseTo(80, 10);
    expect(s.achievedWinRatePct).toBeCloseTo(25, 10);
  });

  it('空表 → 比率为 null，不除零', () => {
    const s = summarizeMirrorTp([]);
    expect(s.total).toBe(0);
    expect(s.achievedRatePct).toBeNull();
    expect(s.achievedWinRatePct).toBeNull();
  });

  it('全未达成 → 达成率 0、盈利率 null', () => {
    const s = summarizeMirrorTp([{ achieved: false, realizedPnl: 10 }, { achieved: false, realizedPnl: -10 }]);
    expect(s.achievedRatePct).toBe(0);
    expect(s.achievedWinRatePct).toBeNull();
  });
});
