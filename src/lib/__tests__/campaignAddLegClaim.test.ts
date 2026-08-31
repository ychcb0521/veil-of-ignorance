import { describe, expect, it } from 'vitest';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { suggestOrphanRecordRoles } from '@/lib/legRoleSuggestion';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const campaign = (): Pick<TradeCampaign, 'final_realized_pnl' | 'actual_evolution'> =>
  ({ final_realized_pnl: null, actual_evolution: [] } as never);
const leg = (id: string, tradeRecordId: string | null): TradeJournal =>
  ({ id, trade_record_id: tradeRecordId, post_realized_pnl: null } as TradeJournal);
const rec = (id: string, pnl: number, over: Partial<TradeRecord> = {}): TradeRecord =>
  ({ id, action: 'CLOSE', pnl, closeTime: 0, openTime: 0, ...over } as TradeRecord);

/**
 * 加仓与主力合并成一个仓位之后，平仓按每笔成交各写一条记录：
 * 两片的 positionId 都是**存活仓位**的 id，而主力那一片的 fillId 按不变量
 * `fills[0].id === position.id` 恰好**等于**那个 positionId。
 */
const MAIN = rec('r-main', 500, { positionId: 'pos-1', fillId: 'pos-1' });
const ADD = rec('r-add', -300, { positionId: 'pos-1', fillId: 'add-1' });

describe('加仓那一片的钱不能从战役里蒸发', () => {
  it('【回归】加仓没单独建腿时，主力腿要一口认领全部分片', () => {
    // 事故：fillId 匹配这一级会命中主力那一片(fillId === ref)、认领完就结束，
    // 下一级的仓位匹配被 `length > 0` 短路跳过，加仓那一片谁也认领不了。
    // 而 total 只累加各腿认领到的记录 —— 那 −300 直接消失，战役总额虚高成 +500。
    const legs = [leg('L-main', 'pos-1')];        // 实时「记录决策」腿，存的是仓位 id
    const r = computeCampaignRealizedPnl(campaign(), legs, [MAIN, ADD]);
    expect(r.total).toBeCloseTo(200, 8);          // 500 − 300，不是 500
    expect(r.recordsByLeg.get('L-main')).toHaveLength(2);
  });

  it('加仓单独建了腿时，各认各的，不互相抢', () => {
    // 加仓腿存的是**这笔成交自己的 id**（handlePlaceOrder 返回的就是它）。
    const legs = [leg('L-main', 'pos-1'), leg('L-add', 'add-1')];
    const r = computeCampaignRealizedPnl(campaign(), legs, [MAIN, ADD]);
    expect(r.byLeg.get('L-main')).toBeCloseTo(500, 8);
    expect(r.byLeg.get('L-add')).toBeCloseTo(-300, 8);
    expect(r.total).toBeCloseTo(200, 8);
  });

  it('腿的先后顺序不影响认领结果', () => {
    const a = computeCampaignRealizedPnl(campaign(), [leg('L-main', 'pos-1'), leg('L-add', 'add-1')], [MAIN, ADD]);
    const b = computeCampaignRealizedPnl(campaign(), [leg('L-add', 'add-1'), leg('L-main', 'pos-1')], [MAIN, ADD]);
    expect(a.byLeg.get('L-add')).toBeCloseTo(b.byLeg.get('L-add')!, 8);
    expect(a.total).toBeCloseTo(b.total!, 8);
  });

  it('多次部分平仓：每一刀的每一片都要计入', () => {
    const records = [
      rec('m1', 100, { positionId: 'pos-1', fillId: 'pos-1', closeTime: 1 }),
      rec('a1', -60, { positionId: 'pos-1', fillId: 'add-1', closeTime: 1 }),
      rec('m2', 40, { positionId: 'pos-1', fillId: 'pos-1', closeTime: 2 }),
      rec('a2', -25, { positionId: 'pos-1', fillId: 'add-1', closeTime: 2 }),
    ];
    const both = computeCampaignRealizedPnl(campaign(), [leg('L-main', 'pos-1'), leg('L-add', 'add-1')], records);
    expect(both.byLeg.get('L-main')).toBeCloseTo(140, 8);
    expect(both.byLeg.get('L-add')).toBeCloseTo(-85, 8);
    // 加仓没建腿时钱一分不能少
    const only = computeCampaignRealizedPnl(campaign(), [leg('L-main', 'pos-1')], records);
    expect(only.total).toBeCloseTo(55, 8);
  });

  it('【回归】没有 fillId 的旧记录行为不变', () => {
    const legacy = [rec('x1', 400, { positionId: 'pos-1' }), rec('x2', -150, { positionId: 'pos-1' })];
    const r = computeCampaignRealizedPnl(campaign(), [leg('L-main', 'pos-1')], legacy);
    expect(r.total).toBeCloseTo(250, 8);
  });
});

describe('归类建议：代表片取最晚平仓的那一次', () => {
  const input = (id: string, fillId: string, closeTimeMs: number, exitMethod: string) =>
    ({ id, fillId, direction: 'long' as const, openTimeMs: fillId === 'add-1' ? 900 : 100,
       closeTimeMs, exitMethod } as Parameters<typeof suggestOrphanRecordRoles>[0][number]);

  it('【回归】取最早那片会让加仓继承主力第一刀的止盈方式', () => {
    // 部分平仓按比例缩每一笔成交，所以每一刀都会给**所有**成交各写一条记录：
    // 两组的平仓时刻集合完全相同，取最早等于没取；真正的差别在 exit_method——
    // 最早那片带的是镜像止盈第一刀的 'tp1'，加仓会被当成 mirror_tp。
    const records = [
      input('m-1', 'pos-1', 1_000, 'tp1'), input('a-1', 'add-1', 1_000, 'tp1'),
      input('m-2', 'pos-1', 5_000, 'manual'), input('a-2', 'add-1', 5_000, 'manual'),
    ];
    const out = suggestOrphanRecordRoles(records, 'long');
    // 分组真的启用了：4 条记录塌成 2 组，每组内建议一致
    expect(out).toHaveLength(4);
    const role = (id: string) => out.find(s => s.id === id)?.suggestedRole;
    expect(role('m-1')).toBe(role('m-2'));
    expect(role('a-1')).toBe(role('a-2'));
    // 加仓不该被判成镜像止盈
    expect(role('a-1')).not.toBe('mirror_tp');
  });

  it('不传 fillId 时逐条定角色，与改动前一致', () => {
    const records = [
      { id: 'r1', direction: 'long' as const, openTimeMs: 100, closeTimeMs: 5_000, exitMethod: null },
      { id: 'r2', direction: 'long' as const, openTimeMs: 900, closeTimeMs: 1_000, exitMethod: null },
    ];
    expect(suggestOrphanRecordRoles(records, 'long')).toHaveLength(2);
  });
});
