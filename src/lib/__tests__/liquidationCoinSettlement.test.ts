/**
 * 币本位强平必须写下 pnlCoin，否则「G」有两个值。
 *
 * 加仓计算器（addSizing.detectBankedMirrorProfit）按 `pnlCoin ?? 盈亏 ÷ 平仓价` 累计落袋币量，
 * Legs 的「加仓校验」（campaignAddSizingCheck）只认 `record.pnlCoin`、没有就退回 USD 口径。
 * 强平记录一直不带 pnlCoin，于是同一笔爆仓在两处被折成不同的数——正是这道校验要消灭的那类分叉。
 */
import { describe, expect, it } from 'vitest';
import { detectBankedMirrorProfit } from '@/lib/addSizing';
import { isolatedLiquidationSettlement } from '@/lib/liquidationGuards';
import { buildCloseRecords } from '@/lib/tradingSettlement';
import type { Position, TradeRecord } from '@/types/trading';

const T = (iso: string) => Date.parse(iso);

/** 币本位逐仓多单：100 张 × 10 USD 面值 = 1000 USD 名义，10 倍 → 保证金 0.001 BTC @100,000。 */
const coinPosition = (): Position => ({
  id: 'pos-coin',
  side: 'LONG',
  entryPrice: 100_000,
  quantity: 100,
  contracts: 100,
  contractSizeUsd: 10,
  settlementMode: 'coin',
  settlementAsset: 'BTC',
  leverage: 10,
  openLeverage: 10,
  marginMode: 'isolated',
  margin: 100,
  marginCoin: 0.001,
  isolatedMargin: 100,
  openTime: T('2026-08-07T01:00:00Z'),
  fills: [{ id: 'pos-coin', openTime: T('2026-08-07T01:00:00Z'), entryPrice: 100_000, units: 100 }],
} as unknown as Position);

describe('币本位强平写下 pnlCoin', () => {
  it('逐仓破产价结算：pnlCoin = −整笔币保证金（与 netPnl = −保证金 同一件事）', () => {
    const totals = isolatedLiquidationSettlement({
      symbol: 'BTCUSD_PERP',
      position: coinPosition(),
      exitPrice: 91_000,
    });
    expect(totals.netPnl).toBeCloseTo(-100, 9);
    expect(totals.pnlCoin).toBeCloseTo(-0.001, 12);
  });

  it('U 本位强平不写 pnlCoin（与普通平仓一致）', () => {
    const usdt = { ...coinPosition(), settlementMode: 'usdt', contracts: undefined, marginCoin: undefined, quantity: 0.01 } as Position;
    const totals = isolatedLiquidationSettlement({ symbol: 'BTCUSDT', position: usdt, exitPrice: 91_000 });
    expect(totals.pnlCoin).toBeUndefined();
  });

  it('拆成成交记录后 pnlCoin 落到记录上，计算器与 Legs 校验读到同一个币数', () => {
    const pos = coinPosition();
    const totals = isolatedLiquidationSettlement({ symbol: 'BTCUSD_PERP', position: pos, exitPrice: 91_000 });
    const records = buildCloseRecords({
      symbol: 'BTCUSD_PERP',
      pos,
      closeQty: 100,
      fillPrice: 91_000,
      closeTime: T('2026-08-07T02:00:00Z'),
      exitMethod: 'liquidation',
      totals,
    }).map(record => ({ ...record, action: 'LIQUIDATION' as const, liquidationSettlement: 'bankruptcy' as const }));

    expect(records).toHaveLength(1);
    const record = records[0] as TradeRecord;
    expect(record.pnlCoin).toBeCloseTo(-0.001, 12);

    // 计算器：本轮已实现亏损从 G 里扣掉，币口径读的正是 record.pnlCoin
    const banked = detectBankedMirrorProfit(
      'BTCUSD_PERP',
      'LONG',
      [record],
      T('2026-08-07T01:00:00Z'),
    );
    expect(banked.coin).toBeCloseTo(-0.001, 12);
    // 缺 pnlCoin 时计算器会退到「盈亏 ÷ 平仓价」= −100 / 91,000 ≈ −0.0010989，与 Legs 校验的口径对不上
    const withoutCoin = detectBankedMirrorProfit(
      'BTCUSD_PERP',
      'LONG',
      [{ ...record, pnlCoin: undefined }],
      T('2026-08-07T01:00:00Z'),
    );
    expect(withoutCoin.coin).not.toBeCloseTo(banked.coin, 6);
  });
});
