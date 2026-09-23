import { describe, expect, it } from 'vitest';
import { LEG_ROW_STATUS_HINTS, LEG_ROW_STATUS_LABELS, legRowStatus } from '@/lib/legRowStatus';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/** Legs 表（页面与导出 PNG）共用的腿状态规则：已平仓 / 爆仓 / 挂单中 / 进行中。 */
describe('legRowStatus', () => {
  const leg = (over: Partial<TradeJournal>) => ({ leg_role: 'main_open', ...over }) as TradeJournal;
  const record = { id: 'r' } as TradeRecord;

  it('有成交记录，或腿上记着平仓时间 / 结果：已平仓', () => {
    expect(legRowStatus(leg({ leg_role: 'hedge_initial_a' }), record)).toBe('closed');
    expect(legRowStatus(leg({ post_simulated_close_time: '2026-08-07T01:00:00Z' }), null)).toBe('closed');
    expect(legRowStatus(leg({ leg_role: 'mirror_tp', post_real_close_time: '2026-08-07T01:00:00Z' }), null)).toBe('closed');
    expect(legRowStatus(leg({ leg_role: 'hedge_rolling', post_outcome: 'win' }), null)).toBe('closed');
  });

  it('成交记录是强平：爆仓（页面与导出 PNG 都据此画红色的「爆仓」）', () => {
    const liquidation = { id: 'r', action: 'LIQUIDATION' } as TradeRecord;
    expect(legRowStatus(leg({}), liquidation)).toBe('liquidated');
    // 老记录没有 action，只有 exit_method
    expect(legRowStatus(leg({}), { id: 'r', exit_method: 'liquidation' } as TradeRecord)).toBe('liquidated');
    // 全仓强平不带 bankruptcy 标记，同样是爆仓
    expect(legRowStatus(leg({ leg_role: 'mirror_tp' }), { id: 'r', action: 'LIQUIDATION' } as TradeRecord)).toBe('liquidated');
    expect(legRowStatus(leg({}), { id: 'r', action: 'CLOSE', exit_method: 'sl' } as TradeRecord)).toBe('closed');
  });

  it('没平仓的对冲 / 镜像腿：挂单中（还没成交，不是仓位）', () => {
    for (const role of ['hedge_initial_a', 'hedge_initial_b', 'hedge_rolling', 'mirror_tp'] as const) {
      expect(legRowStatus(leg({ leg_role: role }), null)).toBe('pending');
    }
  });

  it('没平仓的主力、加仓、回场腿、独立单、未归类：进行中', () => {
    for (const role of ['main_open', 'main_add_3', 'reentry_main', 'reentry_hedge', 'standalone', null] as const) {
      expect(legRowStatus(leg({ leg_role: role }), null)).toBe('open');
    }
  });

  it('状态名与悬停说明', () => {
    expect(LEG_ROW_STATUS_LABELS).toEqual({ liquidated: '爆仓', pending: '挂单中', open: '进行中' });
    expect(LEG_ROW_STATUS_HINTS).toEqual({
      liquidated: '爆仓：交易所强制平仓。逐仓按破产价结算——亏损恰为这笔仓位的保证金，与平仓价上的价差无关；全仓强平没有保证金封顶',
      pending: '挂单中：还没有成交或平仓记录，不计入多单 / 空单合计',
      open: '进行中：还没有平仓',
    });
  });
});
