import { describe, expect, it } from 'vitest';
import { buildCampaignReverseOrderLegMap } from '@/lib/campaignReverseOrderAttribution';
import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder } from '@/types/trading';

function leg(
  id: string,
  role: TradeJournal['leg_role'],
  openedAt: string,
  tradeRecordId: string | null = null,
): TradeJournal {
  return {
    id,
    leg_role: role,
    trade_record_id: tradeRecordId,
    pre_simulated_time: openedAt,
    order_kind: role === 'mirror_tp' ? 'tp' : role?.startsWith('hedge_') ? 'hedge' : 'main',
  } as TradeJournal;
}

function order(
  id: string,
  createdAt: string,
  tradeRecordId: string | null = null,
  overrides: Partial<CampaignReverseHedgeOrder> = {},
): CampaignReverseHedgeOrder {
  return {
    id,
    tradeRecordId,
    side: 'SHORT',
    price: 1,
    createdAt: Date.parse(createdAt),
    triggeredAt: null,
    cancelledAt: null,
    status: 'pending',
    ...overrides,
  };
}

describe('campaign reverse-order attribution', () => {
  it('共享成交标识时仍归属主力，不归属镜像止盈', () => {
    const legs = [
      leg('main', 'main_open', '2026-07-14T01:00:00.000Z', 'shared-record'),
      leg('mirror', 'mirror_tp', '2026-07-14T01:00:00.000Z', 'shared-record'),
    ];
    const reverseOrder = order('reverse-1', '2026-07-14T01:01:00.000Z', 'shared-record');

    const attribution = buildCampaignReverseOrderLegMap(legs, [reverseOrder]);

    expect(attribution.get(reverseOrder.id)).toBe('main');
    expect([...attribution.values()]).not.toContain('mirror');
  });

  it('历史委托缺少直接关联时也统一汇总到主力开仓腿', () => {
    const legs = [
      leg('main', 'main_open', '2026-07-14T01:00:00.000Z'),
      leg('mirror', 'mirror_tp', '2026-07-14T01:05:00.000Z'),
      leg('hedge', 'hedge_rolling', '2026-07-14T01:08:00.000Z'),
      leg('add', 'main_add_1', '2026-07-14T01:10:00.000Z'),
    ];
    const beforeAdd = order('before-add', '2026-07-14T01:06:00.000Z');
    const afterAdd = order('after-add', '2026-07-14T01:12:00.000Z');

    const attribution = buildCampaignReverseOrderLegMap(legs, [beforeAdd, afterAdd]);

    expect(attribution.get(beforeAdd.id)).toBe('main');
    expect(attribution.get(afterAdd.id)).toBe('main');
    expect([...attribution.values()]).not.toContain('mirror');
    expect([...attribution.values()]).not.toContain('hedge');
  });

  it('已触发反向委托归到对应的对冲腿', () => {
    const legs = [
      leg('main', 'main_open', '2026-07-14T01:00:00.000Z'),
      leg('mirror', 'mirror_tp', '2026-07-14T01:00:00.000Z', 'shared-record'),
      leg('hedge-a', 'hedge_initial_a', '2026-07-14T01:05:00.000Z', 'hedge-record'),
    ];
    const triggered = order(
      'triggered-hedge',
      '2026-07-14T01:01:00.000Z',
      'hedge-record',
      {
        status: 'triggered',
        triggeredAt: Date.parse('2026-07-14T01:05:00.000Z'),
        fillPrice: 0.95,
      },
    );

    const attribution = buildCampaignReverseOrderLegMap(legs, [triggered]);

    expect(attribution.get(triggered.id)).toBe('hedge-a');
  });

  it('历史触发委托缺少关联 ID 时按触发时间和价格匹配对应对冲腿', () => {
    const legs = [
      { ...leg('main', 'main_open', '2026-07-14T01:00:00.000Z'), pre_entry_price: 1 },
      { ...leg('hedge-a', 'hedge_initial_a', '2026-07-14T01:05:00.000Z'), pre_entry_price: 0.95 },
      { ...leg('hedge-b', 'hedge_initial_b', '2026-07-14T01:15:00.000Z'), pre_entry_price: 0.9 },
    ];
    const triggered = order(
      'legacy-triggered',
      '2026-07-14T01:01:00.000Z',
      null,
      {
        status: 'triggered',
        triggeredAt: Date.parse('2026-07-14T01:15:00.000Z'),
        fillPrice: 0.9,
      },
    );

    const attribution = buildCampaignReverseOrderLegMap(legs, [triggered]);

    expect(attribution.get(triggered.id)).toBe('hedge-b');
  });

  it('尚未触发的委托即使关联对冲记录也仍归主力', () => {
    const legs = [
      leg('main', 'main_open', '2026-07-14T01:00:00.000Z'),
      leg('hedge-a', 'hedge_initial_a', '2026-07-14T01:05:00.000Z', 'hedge-record'),
    ];
    const pending = order('pending-hedge', '2026-07-14T01:01:00.000Z', 'hedge-record');

    const attribution = buildCampaignReverseOrderLegMap(legs, [pending]);

    expect(attribution.get(pending.id)).toBe('main');
  });

  it('多笔主仓时，未触发的反向委托挂在名义金额最大的那笔名下', () => {
    // 实盘反例：1769.83 的残仓 leg_sequence 在前，真正的主力是 17775439.86
    const dust = { ...leg('dust', 'main_open', '2026-08-05T04:02:00Z'), pre_position_size: 1769.83 } as TradeJournal;
    const real = { ...leg('real', 'main_open', '2026-08-05T04:02:30Z'), pre_position_size: 17775439.86 } as TradeJournal;
    const map = buildCampaignReverseOrderLegMap([dust, real], [order('o1', '2026-08-05T04:03:00Z')]);
    expect(map.get('o1')).toBe('real');
  });

  /**
   * 实盘事故（NAORISUSDT 2026-04-29）：两笔主力，所有未触发的委托都被塞给了
   * 名义金额更大的那笔——而它比委托本身晚出生约 8 小时。
   *
   *   主力1  开 04-29 19:48  平 04-29 23:53  仓位 399,868.51
   *   主力2  开 04-30 04:23  平 04-30 10:16  仓位 799,862.81   ← 金额更大
   *   撤单 ×2  委 04-29 19:49  撤 04-29 20:27               ← 属于主力1
   */
  describe('多笔主力：委托按时间归到当时开着的那一笔', () => {
    const win = (open: string, close: string | null) => ({
      openMs: Date.parse(open),
      closeMs: close ? Date.parse(close) : null,
    });
    const main1 = { ...leg('main1', 'main_open', '2026-04-29T19:48:00Z'), pre_position_size: 399_868.51 } as TradeJournal;
    const main2 = { ...leg('main2', 'main_open', '2026-04-30T04:23:00Z'), pre_position_size: 799_862.81 } as TradeJournal;
    const windows: Record<string, { openMs: number; closeMs: number | null }> = {
      main1: win('2026-04-29T19:48:00Z', '2026-04-29T23:53:00Z'),
      main2: win('2026-04-30T04:23:00Z', '2026-04-30T10:16:00Z'),
    };
    const opts = { legWindow: (l: TradeJournal) => windows[l.id] ?? { openMs: null, closeMs: null } };

    it('【回归】委 19:49 的撤单归主力1，不再归金额更大的主力2', () => {
      const o1 = order('c1', '2026-04-29T19:49:00Z', null, { status: 'cancelled', cancelledAt: Date.parse('2026-04-29T20:27:00Z') });
      const o2 = order('c2', '2026-04-29T19:49:30Z', null, { status: 'cancelled', cancelledAt: Date.parse('2026-04-29T20:27:00Z') });
      const map = buildCampaignReverseOrderLegMap([main1, main2], [o1, o2], opts);
      expect(map.get('c1')).toBe('main1');
      expect(map.get('c2')).toBe('main1');
    });

    it('主力2 存续期内挂出的委托才归主力2', () => {
      const later = order('c3', '2026-04-30T05:00:00Z');
      expect(buildCampaignReverseOrderLegMap([main1, main2], [later], opts).get('c3')).toBe('main2');
    });

    it('【回归】反过来也成立：先开的那笔更大时，晚挂的委托仍归当时开着的小仓', () => {
      // 只按「已开仓 + 取金额最大」会在这里翻车：main1 更大且窗口已闭，
      // 但订单挂出时开着的是 main2。
      const big = { ...main1, pre_position_size: 999_999 } as TradeJournal;
      const small = { ...main2, pre_position_size: 1_000 } as TradeJournal;
      const during2 = order('c4', '2026-04-30T05:00:00Z');
      expect(buildCampaignReverseOrderLegMap([big, small], [during2], opts).get('c4')).toBe('main2');
    });

    it('空仓期挂出的委托归紧随其后开出的那笔——朝前看，不是上一笔的遗留', () => {
      const inGap = order('c5', '2026-04-30T01:00:00Z');   // 主力1 已平、主力2 未开
      expect(buildCampaignReverseOrderLegMap([main1, main2], [inGap], opts).get('c5')).toBe('main2');
    });

    it('开主力之前预挂的反向空单归紧随其后的那笔主力', () => {
      const preOpen = order('c6', '2026-04-29T19:40:00Z');
      expect(buildCampaignReverseOrderLegMap([main1, main2], [preOpen], opts).get('c6')).toBe('main1');
    });

    it('全部平完之后才挂出的，归最后收尾的那笔', () => {
      const after = order('c7', '2026-04-30T12:00:00Z');
      expect(buildCampaignReverseOrderLegMap([main1, main2], [after], opts).get('c7')).toBe('main2');
    });

    it('两腿首尾相接时，交界那一刻只属于后一腿（窗口半开）', () => {
      const abut: Record<string, { openMs: number; closeMs: number | null }> = {
        main1: win('2026-04-29T19:48:00Z', '2026-04-30T04:23:00Z'),
        main2: win('2026-04-30T04:23:00Z', '2026-04-30T10:16:00Z'),
      };
      const at = order('c8', '2026-04-30T04:23:00Z');
      const map = buildCampaignReverseOrderLegMap([main1, main2], [at],
        { legWindow: (l) => abut[l.id] ?? { openMs: null, closeMs: null } });
      expect(map.get('c8')).toBe('main2');
    });

    it('【回归】锚点是委托时间，不是撤单时间', () => {
      // 生命期跨越边界：委托挂出时主力1 开着，撤销时已进入主力2。
      // 这一格回答的是「我持这笔仓位时，站着的保护是什么」。
      const spanning = order('c9', '2026-04-29T20:00:00Z', null, {
        status: 'cancelled', cancelledAt: Date.parse('2026-04-30T06:00:00Z'),
      });
      expect(buildCampaignReverseOrderLegMap([main1, main2], [spanning], opts).get('c9')).toBe('main1');
    });

    it('【回归】openTime 为 0 的脏记录不得吃掉整场战役的委托', () => {
      // TradeRecord 里 `openTime: pos.openTime || 0` 会写出 0，而 `??` 不在 0 上兜底。
      // 放它过去，窗口就变成 [1970, 平仓时刻]。
      const dirty: Record<string, { openMs: number | null; closeMs: number | null }> = {
        main1: { openMs: 0, closeMs: Date.parse('2026-04-29T23:53:00Z') },
        main2: windows.main2,
      };
      const during2 = order('c10', '2026-04-30T05:00:00Z');
      const map = buildCampaignReverseOrderLegMap([main1, main2], [during2],
        { legWindow: (l) => dirty[l.id] ?? { openMs: null, closeMs: null } });
      expect(map.get('c10')).toBe('main2');
    });

    it('拿不到平仓时刻时窗口开口朝右，仍然修好原事故', () => {
      // 进行中的战役里，正在累积委托的恰恰是那笔还没平的主力。
      const openEnded: Record<string, { openMs: number | null; closeMs: number | null }> = {
        main1: { openMs: Date.parse('2026-04-29T19:48:00Z'), closeMs: null },
        main2: { openMs: Date.parse('2026-04-30T04:23:00Z'), closeMs: null },
      };
      const early = order('c11', '2026-04-29T19:49:00Z');
      const map = buildCampaignReverseOrderLegMap([main1, main2], [early],
        { legWindow: (l) => openEnded[l.id] ?? { openMs: null, closeMs: null } });
      expect(map.get('c11')).toBe('main1');
    });
  });

  describe('已触发委托：先筛可行，再排序', () => {
    it('【回归】比委托本身还早开的对冲腿不得被选中', () => {
      const legs = [
        { ...leg('main', 'main_open', '2026-07-14T01:00:00.000Z'), pre_position_size: 100 },
        { ...leg('stale', 'hedge_rolling', '2026-07-14T00:30:00.000Z'), pre_entry_price: 0.9 },
      ] as TradeJournal[];
      const triggered = order('t1', '2026-07-14T01:01:00.000Z', null, {
        status: 'triggered', triggeredAt: Date.parse('2026-07-14T01:05:00.000Z'), fillPrice: 0.9,
      });
      // 唯一候选也不能选——排序不等于筛选。落回主力归类。
      expect(buildCampaignReverseOrderLegMap(legs, [triggered]).get('t1')).toBe('main');
    });

    it('【回归】一条对冲腿只认领一张委托，不再一腿囤满另一腿空着', () => {
      const legs = [
        { ...leg('main', 'main_open', '2026-07-14T01:00:00.000Z'), pre_position_size: 100 },
        { ...leg('h1', 'hedge_rolling', '2026-07-14T01:05:00.000Z'), pre_entry_price: 0.95 },
        { ...leg('h2', 'hedge_rolling', '2026-07-14T01:05:30.000Z'), pre_entry_price: 0.95 },
      ] as TradeJournal[];
      const a = order('t2', '2026-07-14T01:01:00.000Z', null, {
        status: 'triggered', triggeredAt: Date.parse('2026-07-14T01:05:00.000Z'), fillPrice: 0.95,
      });
      const b = order('t3', '2026-07-14T01:01:00.000Z', null, {
        status: 'triggered', triggeredAt: Date.parse('2026-07-14T01:05:30.000Z'), fillPrice: 0.95,
      });
      const map = buildCampaignReverseOrderLegMap(legs, [a, b]);
      expect(new Set([map.get('t2'), map.get('t3')]).size).toBe(2);
    });
  });
});
