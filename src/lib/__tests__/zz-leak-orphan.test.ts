import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Position, TradeRecord } from '@/types/trading';

let linkedRows: Array<{ trade_record_id: string | null }> = [];

vi.mock('@/integrations/supabase/client', () => {
  const chain = () => {
    const obj: Record<string, unknown> = {};
    const ret = () => obj;
    for (const k of ['select', 'eq', 'not', 'is', 'gte', 'lte', 'order', 'in']) obj[k] = ret;
    obj.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: linkedRows, error: null }).then(res);
    return obj;
  };
  return {
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }) },
      from: () => chain(),
    },
  };
});

import { listOrphanTradeRecords } from '@/lib/journalApi';
import { buildCloseRecords } from '@/lib/tradingSettlement';

/** ENJUSDT 币本位：主力 100 张 @0.102754，加仓 100 张 @0.12（合并价 0.112420 附近） */
function mergedPosition(): Position {
  return {
    id: 'pos-1',
    symbol: 'ENJUSDT',
    side: 'LONG',
    entryPrice: 0.1124199,
    quantity: 200,
    contracts: 200,
    leverage: 10,
    openLeverage: 10,
    margin: 100,
    marginMode: 'isolated',
    settlementMode: 'coin',
    settlementAsset: 'ENJ',
    contractSizeUsd: 10,
    openTime: 1000,
    fills: [
      { id: 'pos-1', openTime: 1000, entryPrice: 0.102754, units: 100, openLeverage: 10 },
      { id: 'add-1', openTime: 2000, entryPrice: 0.124, units: 100, openLeverage: 10 },
    ],
  } as unknown as Position;
}

function closeRecords(): TradeRecord[] {
  return buildCloseRecords({
    symbol: 'ENJUSDT',
    pos: mergedPosition(),
    closeQty: 200,
    fillPrice: 0.11,
    closeTime: 5000,
    exitMethod: 'manual',
    totals: { netPnl: -20, pnlCoin: -180, feeUsd: 1, feeCoin: 9, slippageUsd: 0, notionalUsd: 2000 },
  });
}

function seed(records: TradeRecord[]) {
  localStorage.setItem('sim_user-1_trade_history', JSON.stringify(records));
}

describe('zz-leak: listOrphanTradeRecords 的 fillId 条件', () => {
  beforeEach(() => { localStorage.clear(); linkedRows = []; });

  it('拆分出的两片各带自己的 fillId / 开仓价', () => {
    const recs = closeRecords();
    expect(recs.map(r => r.fillId)).toEqual(['pos-1', 'add-1']);
    expect(recs.map(r => r.entryPrice)).toEqual([0.102754, 0.124]);
    expect(recs.every(r => r.positionId === 'pos-1')).toBe(true);
    // record.id 是全新 UUID，与任何 journal 的 trade_record_id 都不相等
    expect(recs.some(r => r.id === 'pos-1' || r.id === 'add-1')).toBe(false);
  });

  it('只有主力做过开仓前快照时：主力那一片被滤掉，加仓那一片留下', async () => {
    const recs = closeRecords();
    seed(recs);
    linkedRows = [{ trade_record_id: 'pos-1' }];
    const out = await listOrphanTradeRecords('user-1');
    expect(out.map(r => r.fillId)).toEqual(['add-1']);
  });

  it('主力与加仓都做过快照时：一条都不剩', async () => {
    const recs = closeRecords();
    seed(recs);
    linkedRows = [{ trade_record_id: 'pos-1' }, { trade_record_id: 'add-1' }];
    const out = await listOrphanTradeRecords('user-1');
    expect(out).toEqual([]);
  });

  it('单笔成交（没有合并）也走同一条兜底：fillId === pos.id，做过快照就被滤掉', async () => {
    const pos = { ...mergedPosition(), fills: undefined } as unknown as Position;
    const recs = buildCloseRecords({
      symbol: 'ENJUSDT', pos, closeQty: 200, fillPrice: 0.11, closeTime: 5000,
      totals: { netPnl: -20, pnlCoin: -180, feeUsd: 1, feeCoin: 9, slippageUsd: 0, notionalUsd: 2000 },
    });
    expect(recs).toHaveLength(1);
    expect(recs[0].fillId).toBe('pos-1');
    seed(recs);
    linkedRows = [{ trade_record_id: 'pos-1' }];
    expect(await listOrphanTradeRecords('user-1')).toEqual([]);
  });

  it('同一笔成交被多次部分平仓：一条 journal 把 N 条平仓记录全部滤掉', async () => {
    const pos = { ...mergedPosition(), fills: undefined } as unknown as Position;
    const mk = (t: number) => buildCloseRecords({
      symbol: 'ENJUSDT', pos, closeQty: 100, fillPrice: 0.11, closeTime: t,
      totals: { netPnl: -10, pnlCoin: -90, feeUsd: 0.5, feeCoin: 4.5, slippageUsd: 0, notionalUsd: 1000 },
    })[0];
    const recs = [mk(5000), mk(6000), mk(7000)];
    expect(new Set(recs.map(r => r.fillId))).toEqual(new Set(['pos-1']));
    seed(recs);
    linkedRows = [{ trade_record_id: 'pos-1' }];
    expect(await listOrphanTradeRecords('user-1')).toEqual([]);
  });
});
