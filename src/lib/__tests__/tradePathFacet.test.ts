import { describe, it, expect } from 'vitest';
import {
  classifyTradePathProxy,
  aggregateTradePathFacet,
  pickInterval,
  buildReplayRequest,
  CLASS_ORDER,
  type ProxyPathClass,
} from '@/lib/tradePathFacet';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/** 已复盘真实主力单，默认做多、绑定成交记录 r1。 */
function mk(overrides: Partial<TradeJournal>): TradeJournal {
  return {
    id: 'j1',
    symbol: 'BTCUSDT',
    journal_kind: 'trade',
    order_kind: 'main',
    direction: 'long',
    trade_record_id: 'r1',
    pre_simulated_time: '2026-01-01T00:00:00.000Z',
    pre_real_time: '2026-01-01T00:00:00.000Z',
    post_reviewed_at: '2026-01-02T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    pre_planned_stop_loss: 95,
    post_outcome: 'win',
    post_r_multiple: 1,
    ...overrides,
  } as unknown as TradeJournal;
}

function rec(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    id: 'r1',
    symbol: 'BTCUSDT',
    side: 'LONG',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 100,
    exitPrice: 110,
    quantity: 1,
    leverage: 1,
    pnl: 10,
    fee: 0,
    slippage: 0,
    openTime: 1_000_000,
    closeTime: 1_000_000 + 60_000 * 30,
    ...overrides,
  } as unknown as TradeRecord;
}

describe('classifyTradePathProxy', () => {
  it('爆仓：强平 → liquidated（无需还原）', () => {
    const p = classifyTradePathProxy(
      mk({ post_outcome: 'loss' }),
      rec({ action: 'LIQUIDATION', exit_method: 'liquidation', exitPrice: 80 }),
    );
    expect(p.cls).toBe('liquidated');
    expect(p.tone).toBe('bad');
    expect(p.needsReplay).toBe(false);
  });

  it('止盈赢 → clean_tp_win，待验证', () => {
    const p = classifyTradePathProxy(mk({ post_outcome: 'win' }), rec({ exit_method: 'tp1', exitPrice: 120 }));
    expect(p.cls).toBe('clean_tp_win');
    expect(p.tone).toBe('good');
    expect(p.needsReplay).toBe(true);
  });

  it('手动赢 → win_unverified，待验证（扛单赢藏身处）', () => {
    const p = classifyTradePathProxy(mk({ post_outcome: 'win' }), rec({ exit_method: 'manual', exitPrice: 108 }));
    expect(p.cls).toBe('win_unverified');
    expect(p.tone).toBe('warn');
    expect(p.needsReplay).toBe(true);
  });

  it('做多亏、平仓在止损外 → overrun_loss', () => {
    // entry100 stop95，平在 90 < 95 → 越过止损
    const p = classifyTradePathProxy(mk({ post_outcome: 'loss' }), rec({ exit_method: 'manual', exitPrice: 90 }));
    expect(p.cls).toBe('overrun_loss');
    expect(p.tone).toBe('bad');
    expect(p.exitBeyondStop).toBe(true);
  });

  it('做多亏、平仓未越止损 → controlled_loss', () => {
    // 平在 97 > 95：还没越过止损（亏但受控）
    const p = classifyTradePathProxy(mk({ post_outcome: 'loss' }), rec({ exit_method: 'sl', exitPrice: 97 }));
    expect(p.cls).toBe('controlled_loss');
    expect(p.tone).toBe('warn');
    expect(p.exitBeyondStop).toBe(false);
  });

  it('无止损价 → exitBeyondStop 为 null，亏损默认归受控', () => {
    const p = classifyTradePathProxy(
      mk({ post_outcome: 'loss', pre_planned_stop_loss: null }),
      rec({ exit_method: 'manual', exitPrice: 80 }),
    );
    expect(p.exitBeyondStop).toBeNull();
    expect(p.cls).toBe('controlled_loss');
  });

  it('做空对称：平仓在止损上方 → overrun_loss', () => {
    // 做空 entry100 stop105，平在 110 > 105 → 越过止损
    const p = classifyTradePathProxy(
      mk({ direction: 'short', pre_planned_stop_loss: 105, post_outcome: 'loss' }),
      rec({ side: 'SHORT', entryPrice: 100, exit_method: 'manual', exitPrice: 110 }),
    );
    expect(p.exitBeyondStop).toBe(true);
    expect(p.cls).toBe('overrun_loss');
  });

  it('保本 → flat', () => {
    const p = classifyTradePathProxy(mk({ post_outcome: 'breakeven' }), rec({ exitPrice: 100 }));
    expect(p.cls).toBe('flat');
    expect(p.tone).toBe('muted');
    expect(p.needsReplay).toBe(false);
  });
});

describe('aggregateTradePathFacet', () => {
  it('空输入：六档齐备、固定顺序、全 0', () => {
    const f = aggregateTradePathFacet([], []);
    expect(f.buckets.map(b => b.cls)).toEqual(CLASS_ORDER);
    expect(f.totalReviewed).toBe(0);
    expect(f.buckets.every(b => b.count === 0)).toBe(true);
  });

  it('按 trade_record_id join，缺记录 / 缺 id 的丢弃', () => {
    const journals = [
      mk({ id: 'a', trade_record_id: 'r1', post_outcome: 'win' }),
      mk({ id: 'b', trade_record_id: 'missing', post_outcome: 'win' }), // 记录不存在
      mk({ id: 'c', trade_record_id: null, post_outcome: 'win' }),      // 无 id
    ];
    const records = [rec({ id: 'r1', exit_method: 'tp1' })];
    const f = aggregateTradePathFacet(journals, records);
    expect(f.totalReviewed).toBe(1);
    expect(f.items[0].journal.id).toBe('a');
  });

  it('过滤非已复盘主力单（对冲 / 未复盘 / 太难）', () => {
    const journals = [
      mk({ id: 'keep', trade_record_id: 'r1' }),
      mk({ id: 'hedge', trade_record_id: 'r2', order_kind: 'hedge' }),
      mk({ id: 'unreviewed', trade_record_id: 'r3', post_reviewed_at: null }),
    ];
    const records = [rec({ id: 'r1', exit_method: 'tp1' }), rec({ id: 'r2' }), rec({ id: 'r3' })];
    const f = aggregateTradePathFacet(journals, records);
    expect(f.totalReviewed).toBe(1);
    expect(f.items[0].journal.id).toBe('keep');
  });

  it('桶计数 + 顶层汇总字段', () => {
    const journals = [
      mk({ id: 'tp', trade_record_id: 'r1', post_outcome: 'win' }),
      mk({ id: 'man', trade_record_id: 'r2', post_outcome: 'win' }),
      mk({ id: 'ctl', trade_record_id: 'r3', post_outcome: 'loss' }),
      mk({ id: 'ovr', trade_record_id: 'r4', post_outcome: 'loss' }),
      mk({ id: 'liq', trade_record_id: 'r5', post_outcome: 'loss' }),
    ];
    const records = [
      rec({ id: 'r1', exit_method: 'tp1', exitPrice: 120 }),
      rec({ id: 'r2', exit_method: 'manual', exitPrice: 108 }),
      rec({ id: 'r3', exit_method: 'sl', exitPrice: 97 }),       // 受控
      rec({ id: 'r4', exit_method: 'manual', exitPrice: 90 }),   // 失控（< stop95）
      rec({ id: 'r5', action: 'LIQUIDATION', exit_method: 'liquidation', exitPrice: 80 }),
    ];
    const f = aggregateTradePathFacet(journals, records);
    const count = (c: ProxyPathClass) => f.buckets.find(b => b.cls === c)!.count;
    expect(count('clean_tp_win')).toBe(1);
    expect(count('win_unverified')).toBe(1);
    expect(count('controlled_loss')).toBe(1);
    expect(count('overrun_loss')).toBe(1);
    expect(count('liquidated')).toBe(1);
    expect(f.unverifiedWinCount).toBe(2);
    expect(f.overrunCount).toBe(1);
    expect(f.controlledLossCount).toBe(1);
    expect(f.liquidatedCount).toBe(1);
  });

  it('items 最近在前', () => {
    const journals = [
      mk({ id: 'old', trade_record_id: 'r1', post_reviewed_at: '2026-01-01T00:00:00Z' }),
      mk({ id: 'new', trade_record_id: 'r2', post_reviewed_at: '2026-05-01T00:00:00Z' }),
    ];
    const records = [rec({ id: 'r1' }), rec({ id: 'r2' })];
    const f = aggregateTradePathFacet(journals, records);
    expect(f.items.map(i => i.journal.id)).toEqual(['new', 'old']);
  });
});

describe('pickInterval', () => {
  it('短持仓走 1m', () => {
    expect(pickInterval(0, 60_000 * 60)).toBe('1m');   // 60 根
    expect(pickInterval(0, 60_000 * 500)).toBe('1m');  // 正好 500 根
  });
  it('超 500 根升周期', () => {
    expect(pickInterval(0, 60_000 * 600)).toBe('5m');           // 1m 会 600 根 → 升 5m
    expect(pickInterval(0, 86_400_000 * 400)).toBe('1d');       // 只有日线 ≤500
  });
  it('超长退回日线', () => {
    expect(pickInterval(0, 86_400_000 * 600)).toBe('1d');
  });
});

describe('buildReplayRequest', () => {
  it('正常单：构造 symbol / 时间 / 周期 / deriveTradePath 入参', () => {
    const j = mk({ direction: 'long', pre_planned_stop_loss: 95, pre_planned_take_profit: 130, post_outcome: 'win' });
    const r = rec({ symbol: 'ETHUSDT', entryPrice: 100, exitPrice: 120, openTime: 1_000_000, closeTime: 1_000_000 + 60_000 * 30 });
    const req = buildReplayRequest(j, r)!;
    expect(req.symbol).toBe('ETHUSDT');
    expect(req.fromTime).toBe(1_000_000);
    expect(req.toTime).toBe(1_000_000 + 60_000 * 30);
    expect(req.interval).toBe('1m');
    expect(req.input.side).toBe('long');
    expect(req.input.entryPrice).toBe(100);
    expect(req.input.plannedStop).toBe(95);
    expect(req.input.plannedTarget).toBe(130);
    expect(req.input.exitPrice).toBe(120);
    expect(req.input.outcome).toBe('win');
  });

  it('时间不合法 → null', () => {
    expect(buildReplayRequest(mk({}), rec({ openTime: 0, closeTime: 0 }))).toBeNull();
    expect(buildReplayRequest(mk({}), rec({ openTime: 5_000, closeTime: 1_000 }))).toBeNull();
  });

  it('no_entry 方向退回成交记录 side', () => {
    const req = buildReplayRequest(
      mk({ direction: 'no_entry' }),
      rec({ side: 'SHORT' }),
    )!;
    expect(req.input.side).toBe('short');
  });
});
