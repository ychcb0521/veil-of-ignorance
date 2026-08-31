import { describe, expect, it } from 'vitest';
import { suggestOrphanRecordRoles, type OrphanRecordRoleInput } from '@/lib/legRoleSuggestion';
import { buildCloseRecords, getPositionNotionalUsd } from '@/lib/tradingSettlement';
import type { Position } from '@/types/trading';

const T0 = Date.UTC(2025, 3, 23, 11, 31, 7);

describe('zz-leak: 同一笔成交的 S 个平仓分片各自领到一个角色', () => {
  it('两刀平仓 → 两条 main_open + 两条 main_add_1', () => {
    // 主力 fillA(100张 @0.102754) + 加仓 fillB(50张 @0.12) 合并成一个仓位,
    // 分两刀各平一半 → buildCloseRecords 每刀写两条(每笔成交一条),共 4 条。
    const records: OrphanRecordRoleInput[] = [
      { id: 'c1-a', fillId: 'fA', direction: 'long', openTimeMs: T0, closeTimeMs: T0 + 3_600_000, entryPrice: 0.102754, size: 500 },
      { id: 'c1-b', fillId: 'fB', direction: 'long', openTimeMs: T0 + 600_000, closeTimeMs: T0 + 3_600_000, entryPrice: 0.12, size: 250 },
      { id: 'c2-a', fillId: 'fA', direction: 'long', openTimeMs: T0, closeTimeMs: T0 + 7_200_000, entryPrice: 0.102754, size: 500 },
      { id: 'c2-b', fillId: 'fB', direction: 'long', openTimeMs: T0 + 600_000, closeTimeMs: T0 + 7_200_000, entryPrice: 0.12, size: 250 },
    ];
    const out = suggestOrphanRecordRoles(records, 'long');
    // eslint-disable-next-line no-console
    console.log('ROLES', out.map(x => `${x.id}=${x.suggestedRole}`).join(' '));
    expect(out).toHaveLength(4);
    const mainOpens = out.filter(x => x.suggestedRole === 'main_open');
    expect(mainOpens.map(x => x.id)).toEqual(['c1-a', 'c2-a']);
    expect(out.filter(x => x.suggestedRole === 'main_add_1').map(x => x.id)).toEqual(['c1-b', 'c2-b']);
  });

  it('单笔成交的仓位分两刀平掉,两条记录也共用 fillId=posId', () => {
    const pos = {
      id: 'p1', symbol: 'ENJUSDT', side: 'LONG', entryPrice: 0.102754,
      quantity: 100, contracts: 100, leverage: 5, openLeverage: 5,
      settlementMode: 'coin', settlementAsset: 'ENJ', contractSizeUsd: 10,
      openTime: T0, margin: 0, fills: undefined,
    } as unknown as Position;
    const cut = buildCloseRecords({
      symbol: 'ENJUSDT', pos, closeQty: 50, fillPrice: 0.11, closeTime: T0 + 3_600_000,
      totals: { netPnl: 10, feeUsd: 0.1, slippageUsd: 0, notionalUsd: 500 },
    });
    // eslint-disable-next-line no-console
    console.log('SINGLE-FILL SHARD', cut.length, cut[0].fillId, cut[0].positionId,
      'notional=', getPositionNotionalUsd('ENJUSDT', cut[0], cut[0].entryPrice));
    expect(cut).toHaveLength(1);
    expect(cut[0].fillId).toBe('p1');
  });

  it('币本位合并仓位一次平仓 → 每笔成交各一条,fillId 各不相同', () => {
    const pos = {
      id: 'p2', symbol: 'ENJUSDT', side: 'LONG', entryPrice: 0.10794,
      quantity: 150, contracts: 150, leverage: 5, openLeverage: 5,
      settlementMode: 'coin', settlementAsset: 'ENJ', contractSizeUsd: 10,
      openTime: T0, margin: 0,
      fills: [
        { id: 'p2', openTime: T0, entryPrice: 0.102754, units: 100 },
        { id: 'f2', openTime: T0 + 600_000, entryPrice: 0.12, units: 50 },
      ],
    } as unknown as Position;
    const cutA = buildCloseRecords({
      symbol: 'ENJUSDT', pos, closeQty: 75, fillPrice: 0.11, closeTime: T0 + 3_600_000,
      totals: { netPnl: 20, pnlCoin: 0.18, feeUsd: 0.2, feeCoin: 0.002, slippageUsd: 0, notionalUsd: 750 },
    });
    const cutB = buildCloseRecords({
      symbol: 'ENJUSDT', pos, closeQty: 75, fillPrice: 0.115, closeTime: T0 + 7_200_000,
      totals: { netPnl: 25, pnlCoin: 0.21, feeUsd: 0.2, feeCoin: 0.002, slippageUsd: 0, notionalUsd: 750 },
    });
    const all = [...cutA, ...cutB];
    // eslint-disable-next-line no-console
    console.log('MERGED SHARDS', all.map(r => `${r.fillId}:${r.quantity}@${r.entryPrice} notional=${getPositionNotionalUsd('ENJUSDT', r, r.entryPrice)}`));
    const out = suggestOrphanRecordRoles(
      all.map(r => ({
        id: r.id, fillId: r.fillId ?? null, direction: 'long' as const,
        openTimeMs: r.openTime, closeTimeMs: r.closeTime,
        entryPrice: r.entryPrice, size: getPositionNotionalUsd('ENJUSDT', r, r.entryPrice),
        exitMethod: r.exit_method ?? null,
      })),
      'long',
    );
    // eslint-disable-next-line no-console
    console.log('MERGED ROLES', out.map(x => x.suggestedRole).join(','));
    const counts = out.reduce<Record<string, number>>((acc, x) => {
      acc[x.suggestedRole] = (acc[x.suggestedRole] ?? 0) + 1; return acc;
    }, {});
    // eslint-disable-next-line no-console
    console.log('COUNTS', counts);
    expect(out).toHaveLength(4);
  });
});
