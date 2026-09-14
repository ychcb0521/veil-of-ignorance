import { describe, expect, it } from 'vitest';
import { buildCampaignReverseOrderLegMap, buildDisplayReverseOrderLegMap } from '@/lib/campaignReverseOrderAttribution';
import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

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

/**
 * 用户要求：「加仓之后，委托单就放在加仓那一行的后面，新的加仓之后，委托空单就放在最新的加仓的后面」。
 * 这是**展示口径**（ownerPolicy: 'latest-add'），默认口径与风险指标不变——上面的用例一条没改。
 */
describe('【用户要求】展示口径 latest-add：加仓之后的委托接在最新那次加仓后面', () => {
  type Win = { openMs: number | null; closeMs: number | null };
  const win = (open: string, close: string | null = null): Win => ({
    openMs: Date.parse(open),
    closeMs: close ? Date.parse(close) : null,
  });
  const sized = (l: TradeJournal, sequence: number, size?: number) => (
    { ...l, leg_sequence: sequence, pre_position_size: size ?? null }
  ) as TradeJournal;
  const latestAdd = (windows: Record<string, Win>) => ({
    ownerPolicy: 'latest-add' as const,
    legWindow: (l: TradeJournal) => windows[l.id] ?? { openMs: null, closeMs: null },
  });
  const cancelled = (id: string, createdAt: string, cancelledAt: string) => (
    order(id, createdAt, null, { status: 'cancelled', cancelledAt: Date.parse(cancelledAt) })
  );

  const main = sized(leg('main', 'main_open', '2026-07-14T10:00:00Z'), 1, 1000);
  const add1 = sized(leg('add1', 'main_add_1', '2026-07-14T11:00:00Z'), 2, 500);
  const add2 = sized(leg('add2', 'main_add_2', '2026-07-14T13:00:00Z'), 3, 500);
  const windows: Record<string, Win> = {
    main: win('2026-07-14T10:00:00Z', '2026-07-14T16:00:00Z'),
    add1: win('2026-07-14T11:00:00Z', '2026-07-14T16:00:00Z'),
    add2: win('2026-07-14T13:00:00Z', '2026-07-14T16:00:00Z'),
  };

  it('加仓 1 之后的委托归加仓 1，加仓 2 之后的归加仓 2；加仓前的仍归主力', () => {
    const orders = [
      cancelled('before', '2026-07-14T10:30:00Z', '2026-07-14T10:50:00Z'),
      cancelled('after-add1', '2026-07-14T11:30:00Z', '2026-07-14T12:30:00Z'),
      order('after-add2', '2026-07-14T13:30:00Z'),
    ];
    const map = buildCampaignReverseOrderLegMap([main, add1, add2], orders, latestAdd(windows));
    expect(map.get('before')).toBe('main');
    expect(map.get('after-add1')).toBe('add1');
    expect(map.get('after-add2')).toBe('add2');
  });

  it('opt-in：不传 ownerPolicy 时与原口径完全一致（全部归主力）', () => {
    const orders = [order('a', '2026-07-14T11:30:00Z'), order('b', '2026-07-14T13:30:00Z')];
    const map = buildCampaignReverseOrderLegMap([main, add1, add2], orders, {
      legWindow: (l) => windows[l.id] ?? { openMs: null, closeMs: null },
    });
    expect(map.get('a')).toBe('main');
    expect(map.get('b')).toBe('main');
  });

  it('为加仓预挂：5 分钟内挂出且加仓开出时仍挂着才算；开出前已撤、或早了 6 分钟都仍归主力', () => {
    const orders = [
      cancelled('pre-live', '2026-07-14T10:57:00Z', '2026-07-14T11:30:00Z'),
      order('pre-pending', '2026-07-14T10:58:00Z'),
      cancelled('pre-cancelled', '2026-07-14T10:57:00Z', '2026-07-14T10:59:00Z'),
      cancelled('six-min-early', '2026-07-14T10:54:00Z', '2026-07-14T11:30:00Z'),
    ];
    const map = buildCampaignReverseOrderLegMap([main, add1], orders, latestAdd(windows));
    expect(map.get('pre-live')).toBe('add1');
    expect(map.get('pre-pending')).toBe('add1');
    expect(map.get('pre-cancelled')).toBe('main');
    expect(map.get('six-min-early')).toBe('main');
  });

  it('同一分钟：加仓 18:34:00 开出，委托 18:34:30 挂、18:35 撤，归这次加仓', () => {
    const sameMinuteWindows: Record<string, Win> = {
      main: win('2026-07-14T10:00:00Z', null),
      add1: win('2026-07-14T18:34:00Z', null),
    };
    const orders = [
      cancelled('same-minute', '2026-07-14T18:34:30Z', '2026-07-14T18:35:00Z'),
      cancelled('same-second', '2026-07-14T18:34:00Z', '2026-07-14T18:34:00Z'),
    ];
    const map = buildCampaignReverseOrderLegMap([main, add1], orders, latestAdd(sameMinuteWindows));
    expect(map.get('same-minute')).toBe('add1');
    expect(map.get('same-second')).toBe('add1');
  });

  it('加仓之前很久挂出、加仓之后才撤的，仍归主力——锚点是委托时间', () => {
    const spanning = cancelled('spanning', '2026-07-14T10:30:00Z', '2026-07-14T11:30:00Z');
    expect(buildCampaignReverseOrderLegMap([main, add1], [spanning], latestAdd(windows)).get('spanning')).toBe('main');
  });

  it('加仓先于主力平掉：之后挂出的委托回到主力', () => {
    const shortAdd: Record<string, Win> = {
      main: windows.main,
      add1: win('2026-07-14T11:00:00Z', '2026-07-14T12:00:00Z'),
    };
    const orders = [
      order('during-add', '2026-07-14T11:30:00Z'),
      order('at-add-close', '2026-07-14T12:00:00Z'),
      order('after-add', '2026-07-14T12:30:00Z'),
    ];
    const map = buildCampaignReverseOrderLegMap([main, add1], orders, latestAdd(shortAdd));
    expect(map.get('during-add')).toBe('add1');
    expect(map.get('at-add-close')).toBe('main');
    expect(map.get('after-add')).toBe('main');
  });

  it('加仓比主力平得晚：主力平掉之后、加仓仍开着时挂出的委托归加仓', () => {
    const longAdd: Record<string, Win> = {
      main: win('2026-07-14T10:00:00Z', '2026-07-14T12:00:00Z'),
      add1: win('2026-07-14T11:00:00Z', '2026-07-14T14:00:00Z'),
    };
    const late = order('late', '2026-07-14T13:00:00Z');
    expect(buildCampaignReverseOrderLegMap([main, add1], [late], latestAdd(longAdd)).get('late')).toBe('add1');
  });

  it('主力开仓前预挂的委托仍归主力，即使 2 分钟后就加仓', () => {
    const quickAdd: Record<string, Win> = {
      main: windows.main,
      add1: win('2026-07-14T10:02:00Z', '2026-07-14T16:00:00Z'),
    };
    const preMain = cancelled('pre-main', '2026-07-14T09:58:00Z', '2026-07-14T10:30:00Z');
    expect(buildCampaignReverseOrderLegMap([main, add1], [preMain], latestAdd(quickAdd)).get('pre-main')).toBe('main');
  });

  it('按开仓时刻排，不读 main_add_N 里的 N', () => {
    const laterNamedEarlier = sized(leg('add-n2', 'main_add_2', '2026-07-14T11:00:00Z'), 2, 500);
    const earlierNamedLater = sized(leg('add-n1', 'main_add_1', '2026-07-14T13:00:00Z'), 3, 500);
    const swapped: Record<string, Win> = {
      main: windows.main,
      'add-n2': win('2026-07-14T11:00:00Z', '2026-07-14T16:00:00Z'),
      'add-n1': win('2026-07-14T13:00:00Z', '2026-07-14T16:00:00Z'),
    };
    const map = buildCampaignReverseOrderLegMap(
      [main, laterNamedEarlier, earlierNamedLater],
      [order('mid', '2026-07-14T12:00:00Z'), order('late', '2026-07-14T14:00:00Z')],
      latestAdd(swapped),
    );
    expect(map.get('mid')).toBe('add-n2');
    expect(map.get('late')).toBe('add-n1');
  });

  it('全部平完之后才挂出的：主力与加仓同一刻平，接到开仓最晚的那次加仓', () => {
    const after = order('after-all', '2026-07-14T16:30:00Z');
    expect(buildCampaignReverseOrderLegMap([main, add1, add2], [after], latestAdd(windows)).get('after-all')).toBe('add2');
    // 默认口径不变：仍是最后收尾的那笔主力
    expect(buildCampaignReverseOrderLegMap([main, add1, add2], [after], {
      legWindow: (l) => windows[l.id] ?? { openMs: null, closeMs: null },
    }).get('after-all')).toBe('main');
  });

  it('重入主力带着自己的 main_add_1：加仓只接它自己那笔主力的委托', () => {
    const first = sized(leg('first', 'main_open', '2026-07-14T10:00:00Z'), 1, 1000);
    const reentry = sized(leg('reentry', 'reentry_main', '2026-07-14T12:00:00Z'), 2, 1000);
    const reAdd = sized(leg('re-add', 'main_add_1', '2026-07-14T12:30:00Z'), 3, 500);
    const reWindows: Record<string, Win> = {
      first: win('2026-07-14T10:00:00Z', '2026-07-14T11:00:00Z'),
      reentry: win('2026-07-14T12:00:00Z', '2026-07-14T14:00:00Z'),
      're-add': win('2026-07-14T12:30:00Z', '2026-07-14T14:00:00Z'),
    };
    const orders = [
      order('on-first', '2026-07-14T10:30:00Z'),
      order('in-gap', '2026-07-14T11:30:00Z'),
      order('on-reentry', '2026-07-14T12:10:00Z'),
      order('on-re-add', '2026-07-14T13:00:00Z'),
    ];
    const map = buildCampaignReverseOrderLegMap([first, reentry, reAdd], orders, latestAdd(reWindows));
    expect(map.get('on-first')).toBe('first');
    expect(map.get('in-gap')).toBe('reentry');
    expect(map.get('on-reentry')).toBe('reentry');
    expect(map.get('on-re-add')).toBe('re-add');
  });

  it('残仓 + 真主力 + 加仓：加仓挂在真主力名下，照样接住加仓之后的委托', () => {
    const dust = sized(leg('dust', 'main_open', '2026-08-05T04:02:00Z'), 1, 1769.83);
    const real = sized(leg('real', 'main_open', '2026-08-05T04:02:30Z'), 2, 17_775_439.86);
    const add = sized(leg('add', 'main_add_1', '2026-08-05T05:00:00Z'), 3, 5_000_000);
    const orders = [order('early', '2026-08-05T04:03:00Z'), order('after-add', '2026-08-05T05:10:00Z')];
    const map = buildCampaignReverseOrderLegMap([dust, real, add], orders, { ownerPolicy: 'latest-add' });
    expect(map.get('early')).toBe('real');
    expect(map.get('after-add')).toBe('add');
  });

  it('先后两笔主力：主力1 的加仓活得比主力1 久，也不抢主力2 的委托', () => {
    const main1 = sized(leg('main1', 'main_open', '2026-07-14T10:00:00Z'), 1, 100);
    const add1Of1 = sized(leg('add1-of-1', 'main_add_1', '2026-07-14T11:00:00Z'), 2, 50);
    const main2 = sized(leg('main2', 'main_open', '2026-07-14T13:00:00Z'), 3, 200);
    const seqWindows: Record<string, Win> = {
      main1: win('2026-07-14T10:00:00Z', '2026-07-14T12:00:00Z'),
      'add1-of-1': win('2026-07-14T11:00:00Z', '2026-07-14T14:00:00Z'),
      main2: win('2026-07-14T13:00:00Z', '2026-07-14T16:00:00Z'),
    };
    const orders = [
      order('on-add1', '2026-07-14T11:30:00Z'),
      order('on-main2', '2026-07-14T13:30:00Z'),
      order('after-add1', '2026-07-14T15:00:00Z'),
    ];
    const map = buildCampaignReverseOrderLegMap([main1, add1Of1, main2], orders, latestAdd(seqWindows));
    expect(map.get('on-add1')).toBe('add1-of-1');
    expect(map.get('on-main2')).toBe('main2');
    expect(map.get('after-add1')).toBe('main2');
  });

  it('已触发的委托仍优先归到它开出的对冲腿', () => {
    const hedge = sized(leg('hedge', 'hedge_rolling', '2026-07-14T12:00:00Z'), 4);
    const triggered = order('trig', '2026-07-14T11:30:00Z', null, {
      status: 'triggered', triggeredAt: Date.parse('2026-07-14T12:00:00Z'),
    });
    const map = buildCampaignReverseOrderLegMap([main, add1, hedge], [triggered], latestAdd(windows));
    expect(map.get('trig')).toBe('hedge');
  });

  /**
   * 实盘回归（TUTUSDT 2026-08-07）：主力开仓 → 加仓1 → 加仓2 → 滚动对冲，四条腿同一刻 01:46 平。
   * 原来 11 张委托全堆在「主力开仓」一行，加仓两行的委托列是空的。
   */
  it('【回归】TUTUSDT：委托逐一落到主力 / 加仓1 / 加仓2 / 滚动对冲', () => {
    const at = (day: string, hhmmss: string) => `2026-08-${day}T${hhmmss}+08:00`;
    const tutLegs = [
      sized(leg('m', 'main_open', at('07', '19:41:00')), 1, 10_000),
      sized(leg('tp', 'mirror_tp', at('07', '19:41:00')), 2, 10_000),
      sized(leg('a1', 'main_add_1', at('08', '12:02:00')), 3, 5_000),
      sized(leg('a2', 'main_add_2', at('08', '18:34:00')), 4, 5_000),
      sized(leg('h', 'hedge_rolling', at('09', '01:42:00')), 5, 5_000),
    ];
    const tutWindows: Record<string, Win> = {
      m: win(at('07', '19:41:00'), at('09', '01:46:00')),
      tp: win(at('07', '19:41:00'), at('08', '00:36:00')),
      a1: win(at('08', '12:02:00'), at('09', '01:46:00')),
      a2: win(at('08', '18:34:00'), at('09', '01:46:00')),
      h: win(at('09', '01:42:00'), at('09', '01:46:00')),
    };
    const c = (id: string, created: [string, string], cancelledAt: [string, string]) => (
      cancelled(id, at(...created), at(...cancelledAt))
    );
    const orders = [
      c('0.0300500-a', ['07', '19:42:00'], ['08', '01:07:00']),
      c('0.0300500-b', ['07', '19:42:10'], ['08', '12:01:00']),
      c('0.0347260-a', ['08', '12:01:00'], ['08', '15:18:00']),
      c('0.0347260-b', ['08', '12:02:20'], ['08', '15:18:00']),
      c('0.0403140', ['08', '15:18:10'], ['08', '18:35:00']),
      c('0.0503520-a', ['08', '18:34:30'], ['08', '18:35:00']),
      c('0.0503520-b', ['08', '18:35:05'], ['08', '18:35:40']),
      c('0.0507000', ['08', '18:35:50'], ['08', '20:44:00']),
      c('0.0564150', ['08', '20:44:10'], ['08', '22:20:00']),
      c('0.0623010', ['08', '22:20:10'], ['08', '23:39:00']),
      c('0.0637270', ['08', '23:39:10'], ['09', '00:22:00']),
      order('0.0685430-triggered', at('09', '00:22:10'), null, {
        status: 'triggered', triggeredAt: Date.parse(at('09', '01:42:00')),
      }),
    ];

    const map = buildCampaignReverseOrderLegMap(tutLegs, orders, latestAdd(tutWindows));
    const byLeg = (legId: string) => orders.filter(o => map.get(o.id) === legId).map(o => o.id);

    expect(byLeg('m')).toEqual(['0.0300500-a', '0.0300500-b']);
    expect(byLeg('tp')).toEqual([]);
    expect(byLeg('a1')).toEqual(['0.0347260-a', '0.0347260-b', '0.0403140']);
    expect(byLeg('a2')).toEqual([
      '0.0503520-a', '0.0503520-b', '0.0507000', '0.0564150', '0.0623010', '0.0637270',
    ]);
    expect(byLeg('h')).toEqual(['0.0685430-triggered']);

    // 风险口径（默认）不受影响：未触发的仍全部归主力
    const riskMap = buildCampaignReverseOrderLegMap(tutLegs, orders, {
      legWindow: (l) => tutWindows[l.id] ?? { openMs: null, closeMs: null },
    });
    expect(orders.filter(o => o.status !== 'triggered').every(o => riskMap.get(o.id) === 'm')).toBe(true);
  });
});

/** 评审补的边界：展示口径 latest-add 的四处漏洞，每条都在 harness 里跑出过错位。 */
describe('【评审】latest-add 边界', () => {
  type Win = { openMs: number | null; closeMs: number | null };
  const T = (hhmmss: string) => `2026-07-14T${hhmmss}Z`;
  const win = (open: string, close: string | null = null): Win => ({
    openMs: Date.parse(T(open)),
    closeMs: close ? Date.parse(T(close)) : null,
  });
  const sized = (l: TradeJournal, sequence: number | null, size?: number) => (
    { ...l, leg_sequence: sequence, pre_position_size: size ?? null }
  ) as TradeJournal;
  const latestAdd = (windows: Record<string, Win>) => ({
    ownerPolicy: 'latest-add' as const,
    legWindow: (l: TradeJournal) => windows[l.id] ?? { openMs: null, closeMs: null },
  });

  it('成交记录 openTime 为 0 的加仓不吞委托：窗口不会从 1970 开始', () => {
    const record = (id: string, openTime: number, closeTime: number): TradeRecord => ({
      id, symbol: 'TUTUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE',
      entryPrice: 1, exitPrice: 1.1, quantity: 1000, leverage: 5,
      pnl: 10, fee: 0, slippage: 0, openTime, closeTime,
    } as TradeRecord);
    const mainRec = record('rec-main', Date.parse(T('10:00:00')), Date.parse(T('16:00:00')));
    // tradingSettlement 写的 `openTime: pos.openTime || 0`
    const addRec = record('rec-add', 0, Date.parse(T('16:00:00')));
    const legs = [
      sized(leg('main', 'main_open', T('10:00:00'), 'rec-main'), 1, 1000),
      sized(leg('add', 'main_add_1', T('11:00:00'), 'rec-add'), 2, 500),
    ];
    const recordMap = new Map([mainRec, addRec].map(r => [r.id, r] as const));
    const orders = [order('before-add', T('10:30:00')), order('after-add', T('12:00:00'))];

    const map = buildDisplayReverseOrderLegMap(legs, orders, recordMap);
    expect(map.get('before-add')).toBe('main');
    expect(map.get('after-add')).toBe('main');

    // 直接给 legWindow 的 0 也同样拦下
    const direct = buildCampaignReverseOrderLegMap(legs, orders, latestAdd({
      main: win('10:00:00', '16:00:00'),
      add: { openMs: 0, closeMs: Date.parse(T('16:00:00')) },
    }));
    expect(direct.get('before-add')).toBe('main');
    expect(direct.get('after-add')).toBe('main');
  });

  it('已触发的委托以触发时刻判「加仓时是否还挂着」：cancelledAt 是对冲平仓时刻，不算挂着', () => {
    const legs = [
      sized(leg('main', 'main_open', T('10:00:00')), 1, 1000),
      sized(leg('add', 'main_add_1', T('11:00:00')), 2, 500),
    ];
    const windows = { main: win('10:00:00', '16:00:00'), add: win('11:00:00', '16:00:00') };
    const orders = [
      // 加仓前 2 分钟就已触发；journalApi 把它开出的对冲平仓时刻 15:00 写进 cancelledAt
      order('fired-before-add', T('10:57:00'), null, {
        status: 'triggered', triggeredAt: Date.parse(T('10:58:00')), cancelledAt: Date.parse(T('15:00:00')),
      }),
      // 对照：加仓开出时还没触发
      order('fired-after-add', T('10:57:00'), null, {
        status: 'triggered', triggeredAt: Date.parse(T('11:02:00')), cancelledAt: Date.parse(T('15:00:00')),
      }),
    ];
    // 没有对冲腿可认领 → 走主力 / 加仓的归属
    const map = buildCampaignReverseOrderLegMap(legs, orders, latestAdd(windows));
    expect(map.get('fired-before-add')).toBe('main');
    expect(map.get('fired-after-add')).toBe('add');
  });

  it('全部同一刻平掉之后挂出的：与收尾前一刻挂出的落在同一行，不因 leg_sequence 并列裁决跳到别家加仓', () => {
    const legs = [
      sized(leg('m1', 'main_open', T('10:00:00')), 1, 1000),
      sized(leg('a1', 'main_add_1', T('11:00:00')), 2, 500),
      sized(leg('m2', 'main_open', T('12:00:00')), 3, 2000),
      sized(leg('a2', 'main_add_2', T('13:00:00')), 4, 500),
    ];
    const windows = {
      m1: win('10:00:00', '15:00:00'),
      a1: win('11:00:00', '15:00:00'),
      m2: win('12:00:00', '15:00:00'),
      a2: win('13:00:00', '15:00:00'),
    };
    const orders = [order('just-before', T('14:59:00')), order('just-after', T('15:00:30'))];
    const map = buildCampaignReverseOrderLegMap(legs, orders, latestAdd(windows));
    expect(map.get('just-before')).toBe('a2');
    expect(map.get('just-after')).toBe('a2');
  });

  it('全部平完之后挂出的：结果与 legs 数组的排列无关（leg_sequence 缺失时）', () => {
    const m1 = sized(leg('m1', 'main_open', T('10:00:00')), null);
    const a1 = sized(leg('a1', 'main_add_1', T('11:00:00')), null);
    const r = sized(leg('r', 'reentry_main', T('12:30:00')), null);
    const ra = sized(leg('ra', 'main_add_1', T('13:00:00')), null);
    const windows = {
      m1: win('10:00:00', '12:00:00'),
      a1: win('11:00:00', '15:00:00'),
      r: win('12:30:00', '15:00:00'),
      ra: win('13:00:00', '15:00:00'),
    };
    const orders = [order('mid', T('14:00:00')), order('post', T('15:30:00'))];
    for (const permutation of [[m1, a1, r, ra], [ra, r, a1, m1], [r, ra, m1, a1], [a1, m1, ra, r]]) {
      const map = buildCampaignReverseOrderLegMap(permutation, orders, latestAdd(windows));
      expect(map.get('mid')).toBe('ra');
      expect(map.get('post')).toBe('ra');
    }
  });

  it('两笔主力并存、加仓挂靠的那笔先平：加仓仍开着且是最新一行，委托不跳回另一笔主力', () => {
    const legs = [
      sized(leg('big', 'main_open', T('10:00:00')), 1, 2000),
      sized(leg('small', 'main_open', T('10:00:30')), 2, 1000),
      sized(leg('a', 'main_add_1', T('11:00:00')), 3, 500),
    ];
    const windows = {
      big: win('10:00:00', '13:00:00'),
      small: win('10:00:30', '16:00:00'),
      a: win('11:00:00', '16:00:00'),
    };
    const orders = [order('while-big-open', T('12:00:00')), order('after-big-closed', T('14:00:00'))];
    const map = buildCampaignReverseOrderLegMap(legs, orders, latestAdd(windows));
    expect(map.get('while-big-open')).toBe('a');
    expect(map.get('after-big-closed')).toBe('a');
    // 风险口径不变
    const riskMap = buildCampaignReverseOrderLegMap(legs, orders, {
      legWindow: (l) => windows[l.id as keyof typeof windows],
    });
    expect(riskMap.get('after-big-closed')).toBe('small');
  });

  it('重入主力压着一笔残仓开出：残仓平掉之后，重入的加仓仍接住委托', () => {
    const legs = [
      sized(leg('dust', 'main_open', T('10:00:00')), 1, 1769.83),
      sized(leg('r', 'reentry_main', T('13:00:00')), 2, 1_000_000),
      sized(leg('ra', 'main_add_1', T('13:30:00')), 3, 500_000),
    ];
    const windows = {
      dust: win('10:00:00', '14:00:00'),
      r: win('13:00:00', '16:00:00'),
      ra: win('13:30:00', '16:00:00'),
    };
    const orders = [
      order('on-dust', T('11:00:00')),
      order('dust-still-open', T('13:45:00')),
      order('dust-closed', T('14:30:00')),
    ];
    const map = buildCampaignReverseOrderLegMap(legs, orders, latestAdd(windows));
    expect(map.get('on-dust')).toBe('dust');
    expect(map.get('dust-still-open')).toBe('ra');
    expect(map.get('dust-closed')).toBe('ra');
  });
});
