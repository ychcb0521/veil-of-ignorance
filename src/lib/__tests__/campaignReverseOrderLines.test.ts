import { describe, expect, it } from 'vitest';
import { buildCampaignReverseOrderPriceLines } from '../campaignReverseOrderLines';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

const t = (iso: string) => Date.parse(iso);

function makeShortOrder(overrides: Partial<CampaignReverseHedgeOrder>): CampaignReverseHedgeOrder {
  return {
    id: overrides.id ?? 'short-order',
    tradeRecordId: overrides.tradeRecordId ?? null,
    side: overrides.side ?? 'SHORT',
    price: overrides.price ?? 1.2,
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

  it('keeps overlapping pending short-order ranges dashed instead of covering them with a solid segment', () => {
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

    expect(lines).toEqual([
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
    ]);
    expect(lines.some(line => line.title === '触发空')).toBe(false);
  });

  it('only trims the solid triggered segment where a dashed pending order overlaps it', () => {
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
        endTime: pendingAt,
        dashed: false,
      }),
      expect.objectContaining({
        title: '委托空',
        startTime: pendingAt,
        endTime: cancelledAt,
        dashed: true,
      }),
      expect.objectContaining({
        title: '触发空',
        startTime: cancelledAt,
        endTime: fallbackEnd,
        dashed: false,
      }),
    ]);
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
