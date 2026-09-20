import { describe, expect, it } from 'vitest';
import { buildManualLegs } from '@/lib/campaignSimulationEngine';
import type { CampaignCounterfactualParams, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const T0 = Date.parse('2026-09-20T00:00:00Z');
const params = { entry: { time: new Date(T0).toISOString(), price: 100, size_usdt: 1000, direction: 'long', leverage: 10 } } as CampaignCounterfactualParams;
const leg = {
  id: 'leg', trade_record_id: 'record', leg_role: 'hedge_rolling', order_kind: 'hedge',
  source: 'live', direction: 'short', symbol: 'ETHUSDT', pre_simulated_time: new Date(T0).toISOString(),
  pre_entry_price: 100, pre_position_size: 1000, leverage: 10,
} as TradeJournal;
const record = {
  id: 'record', positionId: 'position', symbol: 'ETHUSDT', side: 'SHORT', type: 'MARKET',
  action: 'CLOSE', openTime: T0, closeTime: T0 + 60_000, entryPrice: 100, exitPrice: 99,
  quantity: 10, leverage: 10, pnl: 9, fee: 1, slippage: 0,
} as TradeRecord;

describe('反事实 actual 保存真实操作方式证据', () => {
  it('按实际记录保存开平方式，JSON 重载后仍在', () => {
    const [built] = buildManualLegs(params, [leg], [], [{ ...record, entry_method: 'manual', exit_method: 'tp1' }]);
    expect(JSON.parse(JSON.stringify(built.actual))).toMatchObject({ entry_method: 'manual', exit_method: 'order' });
  });

  it('开平证据各自独立，未知侧不添加字段；MARKET 和角色不作为来源', () => {
    const [unknown] = buildManualLegs(params, [leg], [], [record]);
    expect(unknown.actual).not.toHaveProperty('entry_method');
    expect(unknown.actual).not.toHaveProperty('exit_method');
    const [closeOnly] = buildManualLegs(params, [leg], [], [{ ...record, exit_method: 'manual' }]);
    expect(closeOnly.actual).not.toHaveProperty('entry_method');
    expect(closeOnly.actual?.exit_method).toBe('manual');
  });

  it('沿用真实开仓快照的预设委托证据，不根据回填来源判断', () => {
    const [built] = buildManualLegs(params, [{ ...leg, hedge_order_method: 'limit_preset', source: 'retroactive_from_record' }], [], [record]);
    expect(built.actual?.entry_method).toBe('order');
    expect(built.actual).not.toHaveProperty('exit_method');
  });

  it('已触发的反向委托可提供开仓证据，但未触发的单不行', () => {
    const reverseOrder = {
      id: 'order', tradeRecordId: record.id, side: 'SHORT' as const, price: 100,
      createdAt: T0 - 60_000, triggeredAt: T0, cancelledAt: null, status: 'triggered' as const,
    };
    const [built] = buildManualLegs(params, [leg], [], [record], {}, { reverseHedgeOrders: [reverseOrder] });
    expect(built.actual?.entry_method).toBe('order');
    const [pending] = buildManualLegs(params, [leg], [], [record], {}, {
      reverseHedgeOrders: [{ ...reverseOrder, status: 'pending', triggeredAt: null }],
    });
    expect(pending.actual).not.toHaveProperty('entry_method');
  });
});
