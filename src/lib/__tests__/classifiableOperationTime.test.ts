import { describe, expect, it } from 'vitest';

import { classifiableOperationTime } from '../classifiableOperationTime';
import type { ClassifiableItem } from '@/types/journalClassification';
import type { TradeRecord } from '@/types/trading';

function record(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: 'record-1',
    symbol: 'BTCUSDT',
    side: 'LONG',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 100,
    exitPrice: 110,
    quantity: 1,
    leverage: 10,
    pnl: 10,
    fee: 0,
    slippage: 0,
    openTime: Date.parse('2026-05-12T03:44:00.000Z'),
    closeTime: Date.parse('2026-05-12T04:03:21.000Z'),
    ...overrides,
  };
}

describe('classifiableOperationTime', () => {
  it('uses the linked trade record real wallet clock for journal items', () => {
    const linked = record({ closedRealAt: Date.parse('2026-06-26T12:23:32.000Z') });
    const item: ClassifiableItem = {
      id: 'journal-1',
      kind: 'journal',
      journal: {
        id: 'journal-1',
        symbol: 'BTCUSDT',
        pre_simulated_time: '2026-05-12T03:44:00.000Z',
        pre_real_time: '2026-05-12T03:44:00.000Z',
        post_real_close_time: '2026-05-12T04:03:21.000Z',
      } as any,
    };

    expect(classifiableOperationTime(item, linked)).toBe(linked.closedRealAt);
  });

  it('does not fall back to journal real-time fields when no trade record has closedRealAt', () => {
    const item: ClassifiableItem = {
      id: 'journal-1',
      kind: 'journal',
      journal: {
        id: 'journal-1',
        symbol: 'BTCUSDT',
        pre_simulated_time: '2026-05-12T03:44:00.000Z',
        pre_real_time: '2026-06-26T12:00:00.000Z',
        post_real_close_time: '2026-05-12T04:03:21.000Z',
        updated_at: '2026-06-26T12:10:00.000Z',
      } as any,
    };

    expect(classifiableOperationTime(item, record())).toBeNull();
    expect(classifiableOperationTime(item)).toBeNull();
  });

  it('uses closedRealAt for orphan trade records', () => {
    const orphan = record({ closedRealAt: Date.parse('2026-06-26T12:30:00.000Z') });
    const item: ClassifiableItem = {
      id: 'orphan-1',
      kind: 'orphanRecord',
      record: orphan,
    };

    expect(classifiableOperationTime(item)).toBe(orphan.closedRealAt);
  });
});
