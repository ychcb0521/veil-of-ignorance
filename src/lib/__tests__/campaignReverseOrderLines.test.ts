import { describe, expect, it } from 'vitest';
import {
  buildCampaignReverseOrderPriceLines,
  buildManualHedgeShortPriceLines,
  isHedgeShortLeg,
  type HedgeShortLegExecution,
} from '../campaignReverseOrderLines';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

const t = (iso: string) => Date.parse(iso);

function makeShortOrder(overrides: Partial<CampaignReverseHedgeOrder>): CampaignReverseHedgeOrder {
  return {
    id: overrides.id ?? 'short-order',
    tradeRecordId: overrides.tradeRecordId ?? null,
    side: overrides.side ?? 'SHORT',
    price: overrides.price ?? 1.2,
    fillPrice: overrides.fillPrice ?? null,
    createdAt: overrides.createdAt ?? t('2026-01-01T10:00:00.000Z'),
    triggeredAt: overrides.triggeredAt ?? null,
    cancelledAt: overrides.cancelledAt ?? null,
    status: overrides.status ?? 'pending',
  };
}

function makeRecord(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    id: overrides.id ?? 'record-1',
    symbol: overrides.symbol ?? 'ASTERUSDT',
    side: overrides.side ?? 'SHORT',
    type: overrides.type ?? 'MARKET',
    action: overrides.action ?? 'CLOSE',
    entryPrice: overrides.entryPrice ?? 1.2,
    exitPrice: overrides.exitPrice ?? 1.1,
    quantity: overrides.quantity ?? 100,
    leverage: overrides.leverage ?? 5,
    pnl: overrides.pnl ?? 10,
    fee: overrides.fee ?? 0,
    slippage: overrides.slippage ?? 0,
    openTime: overrides.openTime ?? t('2026-01-01T10:05:00.000Z'),
    closeTime: overrides.closeTime ?? t('2026-01-01T10:20:00.000Z'),
  };
}

describe('buildCampaignReverseOrderPriceLines', () => {
  it('draws triggered short orders as dashed before trigger and solid after trigger until fallback end', () => {
    const createdAt = t('2026-01-01T10:00:00.000Z');
    const triggeredAt = t('2026-01-01T10:05:00.000Z');
    const fallbackEnd = t('2026-01-01T10:30:00.000Z');

    const lines = buildCampaignReverseOrderPriceLines([
      makeShortOrder({
        id: 'triggered-open-short',
        status: 'triggered',
        createdAt,
        triggeredAt,
        cancelledAt: null,
      }),
    ], [], fallbackEnd);

    expect(lines).toEqual([
      expect.objectContaining({
        title: '委托空',
        startTime: createdAt,
        endTime: triggeredAt,
        dashed: true,
      }),
      expect.objectContaining({
        title: '触发空',
        startTime: triggeredAt,
        endTime: fallbackEnd,
        dashed: false,
      }),
    ]);
  });

  it('draws triggered solid segment to the matched close time when available', () => {
    const createdAt = t('2026-01-01T10:00:00.000Z');
    const triggeredAt = t('2026-01-01T10:05:00.000Z');
    const closeTime = t('2026-01-01T10:16:00.000Z');
    const fallbackEnd = t('2026-01-01T10:30:00.000Z');

    const lines = buildCampaignReverseOrderPriceLines([
      makeShortOrder({
        id: 'triggered-open-short',
        tradeRecordId: 'record-1',
        status: 'triggered',
        createdAt,
        triggeredAt,
        cancelledAt: null,
      }),
    ], [
      makeRecord({ id: 'record-1', openTime: triggeredAt, closeTime }),
    ], fallbackEnd);

    expect(lines.find(line => line.title === '触发空')).toMatchObject({
      startTime: triggeredAt,
      endTime: closeTime,
      dashed: false,
    });
  });

  it('matches a triggered order by its actual fill while drawing the original trigger price', () => {
    const createdAt = t('2026-01-01T10:00:00.000Z');
    const triggeredAt = t('2026-01-01T10:05:00.000Z');
    const closeTime = t('2026-01-01T10:16:00.000Z');
    const fallbackEnd = t('2026-01-01T10:30:00.000Z');

    const lines = buildCampaignReverseOrderPriceLines([
      makeShortOrder({
        id: 'slipped-triggered-short',
        status: 'triggered',
        price: 1.2,
        fillPrice: 1.201,
        createdAt,
        triggeredAt,
      }),
    ], [
      makeRecord({ id: 'slipped-record', entryPrice: 1.201, openTime: triggeredAt, closeTime }),
    ], fallbackEnd);

    expect(lines.find(line => line.title === '触发空')).toMatchObject({
      price: 1.2,
      startTime: triggeredAt,
      endTime: closeTime,
      dashed: false,
    });
  });

  it('keeps triggered short-order ranges solid even when a pending dashed order overlaps', () => {
    const createdAt = t('2026-01-01T10:00:00.000Z');
    const triggeredAt = t('2026-01-01T10:05:00.000Z');
    const fallbackEnd = t('2026-01-01T10:30:00.000Z');

    const lines = buildCampaignReverseOrderPriceLines([
      makeShortOrder({
        id: 'triggered-open-short',
        status: 'triggered',
        createdAt,
        triggeredAt,
      }),
      makeShortOrder({
        id: 'still-pending-same-price-short',
        status: 'pending',
        createdAt: triggeredAt,
      }),
    ], [], fallbackEnd);

    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: '委托空',
        startTime: createdAt,
        endTime: triggeredAt,
        dashed: true,
      }),
      expect.objectContaining({
        title: '委托空',
        startTime: triggeredAt,
        endTime: fallbackEnd,
        dashed: true,
      }),
      expect.objectContaining({
        title: '触发空',
        startTime: triggeredAt,
        endTime: fallbackEnd,
        dashed: false,
      }),
    ]));
  });

  it('keeps duplicate pending dashed ranges dashed and deduped', () => {
    const createdAt = t('2026-01-01T10:00:00.000Z');
    const fallbackEnd = t('2026-01-01T10:30:00.000Z');

    const lines = buildCampaignReverseOrderPriceLines([
      makeShortOrder({
        id: 'pending-short-1',
        status: 'pending',
        createdAt,
      }),
      makeShortOrder({
        id: 'pending-short-2',
        status: 'pending',
        createdAt,
      }),
    ], [], fallbackEnd);

    expect(lines).toEqual([
      expect.objectContaining({
        title: '委托空',
        startTime: createdAt,
        endTime: fallbackEnd,
        dashed: true,
      }),
    ]);
    expect(lines.some(line => !line.dashed)).toBe(false);
  });

  it('does not trim the solid triggered segment when a later dashed order overlaps it', () => {
    const createdAt = t('2026-01-01T10:00:00.000Z');
    const triggeredAt = t('2026-01-01T10:05:00.000Z');
    const pendingAt = t('2026-01-01T10:12:00.000Z');
    const cancelledAt = t('2026-01-01T10:18:00.000Z');
    const fallbackEnd = t('2026-01-01T10:30:00.000Z');

    const lines = buildCampaignReverseOrderPriceLines([
      makeShortOrder({
        id: 'triggered-open-short',
        status: 'triggered',
        createdAt,
        triggeredAt,
      }),
      makeShortOrder({
        id: 'cancelled-same-price-short',
        status: 'cancelled',
        createdAt: pendingAt,
        cancelledAt,
      }),
    ], [], fallbackEnd);

    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: '委托空',
        startTime: createdAt,
        endTime: triggeredAt,
        dashed: true,
      }),
      expect.objectContaining({
        title: '触发空',
        startTime: triggeredAt,
        endTime: fallbackEnd,
        dashed: false,
      }),
      expect.objectContaining({
        title: '委托空',
        startTime: pendingAt,
        endTime: cancelledAt,
        dashed: true,
      }),
    ]));
  });

  it('ends triggered solid segment at the explicit manual close time before fallback end', () => {
    const createdAt = t('2026-01-01T10:00:00.000Z');
    const triggeredAt = t('2026-01-01T10:05:00.000Z');
    const manualCloseTime = t('2026-01-01T10:12:00.000Z');
    const fallbackEnd = t('2026-01-01T10:30:00.000Z');

    const lines = buildCampaignReverseOrderPriceLines([
      makeShortOrder({
        id: 'triggered-open-short',
        status: 'triggered',
        createdAt,
        triggeredAt,
        cancelledAt: manualCloseTime,
      }),
    ], [], fallbackEnd);

    expect(lines.find(line => line.title === '触发空')).toMatchObject({
      startTime: triggeredAt,
      endTime: manualCloseTime,
      dashed: false,
    });
  });

  it('keeps non-short orders out of the campaign short-order layer', () => {
    const lines = buildCampaignReverseOrderPriceLines([
      makeShortOrder({ id: 'long-order', side: 'LONG', status: 'triggered', triggeredAt: t('2026-01-01T10:05:00.000Z') }),
    ], [], t('2026-01-01T10:30:00.000Z'));

    expect(lines).toEqual([]);
  });
});

/**
 * 手动开的对冲空单与被触发的委托空单同一个目的，图上照「触发空」画成黄色实线。
 * 例子取自 IMXUSDT 2025-09-16：主多 0.715953，两组委托空单 0.648644 / 0.694724 都被撤，
 * 16:17 手动开空 0.703118 对冲、17:17 平掉——原来图上只有一个蓝色 Hr1 三角，看不到这段对冲。
 */
describe('buildManualHedgeShortPriceLines', () => {
  const imx = (hhmm: string) => Date.parse(`2025-09-16T${hhmm}:00+08:00`);
  const fallbackEnd = imx('18:32');
  const manualHedge = (o: Partial<HedgeShortLegExecution> = {}): HedgeShortLegExecution => ({
    legId: 'hr1', recordId: 'manual-record', openTime: imx('16:17'), closeTime: imx('17:17'), entryPrice: 0.703118, ...o,
  });
  const cancelledOrders = [
    makeShortOrder({ id: 'o1', price: 0.648644, status: 'cancelled', createdAt: imx('15:51'), cancelledAt: imx('16:18') }),
    makeShortOrder({ id: 'o2', price: 0.694724, status: 'cancelled', createdAt: imx('17:17'), cancelledAt: imx('18:32') }),
  ];

  it('【用户要求】手动对冲空单画成黄色实线：开仓价，从开仓到平仓', () => {
    expect(buildManualHedgeShortPriceLines([manualHedge()], cancelledOrders, [], fallbackEnd)).toEqual([{
      price: 0.703118, color: '#F0B90B', startTime: imx('16:17'), endTime: imx('17:17'),
      dashed: false, endMarker: null, title: '手动空',
    }]);
  });

  it('与「触发空」同色同线型', () => {
    const triggered = buildCampaignReverseOrderPriceLines([
      makeShortOrder({ status: 'triggered', createdAt: imx('16:00'), triggeredAt: imx('16:10') }),
    ], [], fallbackEnd).find(line => line.title === '触发空');
    const manual = buildManualHedgeShortPriceLines([manualHedge()], [], [], fallbackEnd)[0];
    expect(manual).toMatchObject({ color: triggered?.color, dashed: triggered?.dashed });
  });

  it('还没平的对冲空单画到战役结束', () => {
    const [line] = buildManualHedgeShortPriceLines([manualHedge({ closeTime: null })], [], [], fallbackEnd);
    expect(line).toMatchObject({ startTime: imx('16:17'), endTime: fallbackEnd });
  });

  it('由委托触发开出的对冲腿不画第二条：按 trade record id 认', () => {
    const order = makeShortOrder({
      id: 'trig', tradeRecordId: 'manual-record', price: 0.703, status: 'triggered',
      createdAt: imx('16:00'), triggeredAt: imx('16:17'),
    });
    expect(buildManualHedgeShortPriceLines([manualHedge()], [order], [], fallbackEnd)).toEqual([]);
  });

  it('按成交时刻 ±60 秒与价位认出触发单开出的腿（逐笔拆条后记录 id 对不上时）', () => {
    const order = makeShortOrder({
      id: 'trig', price: 0.7031, fillPrice: 0.703118, status: 'triggered',
      createdAt: imx('16:00'), triggeredAt: imx('16:17') + 20_000,
    });
    expect(buildManualHedgeShortPriceLines([manualHedge({ recordId: 'per-fill-sibling' })], [order], [], fallbackEnd))
      .toEqual([]);
  });

  it('时刻或价位对不上的触发单不影响手动单', () => {
    const farInTime = makeShortOrder({ id: 'a', price: 0.703118, status: 'triggered', createdAt: imx('15:00'), triggeredAt: imx('15:30') });
    const otherPrice = makeShortOrder({ id: 'b', price: 0.72, status: 'triggered', createdAt: imx('16:00'), triggeredAt: imx('16:17') });
    expect(buildManualHedgeShortPriceLines([manualHedge()], [farInTime, otherPrice], [], fallbackEnd)).toHaveLength(1);
  });

  it('缺开仓价/开仓时刻、或平仓早于开仓的畸形腿不画', () => {
    expect(buildManualHedgeShortPriceLines([
      manualHedge({ entryPrice: null }),
      manualHedge({ openTime: null }),
      manualHedge({ closeTime: imx('16:00') }),
    ], [], [], fallbackEnd)).toEqual([]);
  });
});

describe('isHedgeShortLeg', () => {
  it('只认对冲类角色里方向为空的腿', () => {
    expect(isHedgeShortLeg({ leg_role: 'hedge_rolling', direction: 'short' })).toBe(true);
    expect(isHedgeShortLeg({ leg_role: 'hedge_initial_a', direction: 'short' })).toBe(true);
    expect(isHedgeShortLeg({ leg_role: 'reentry_hedge', direction: 'short' })).toBe(true);
    expect(isHedgeShortLeg({ leg_role: 'hedge_rolling', direction: 'long' })).toBe(false);
    expect(isHedgeShortLeg({ leg_role: 'main_open', direction: 'short' })).toBe(false);
    expect(isHedgeShortLeg({ leg_role: 'mirror_tp', direction: 'short' })).toBe(false);
    expect(isHedgeShortLeg({ leg_role: null, direction: 'short' })).toBe(false);
  });
});
