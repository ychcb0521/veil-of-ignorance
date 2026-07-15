import { describe, expect, it } from 'vitest';
import {
  buildObjectiveLongMainReviewItems,
  buildUnreviewedLongMainItems,
  summarizeUnreviewedSymbols,
} from '@/lib/unreviewedLongMainTrades';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const operationA = Date.parse('2026-06-22T01:00:00.000Z');
const operationB = Date.parse('2026-06-23T02:00:00.000Z');

function journal(overrides: Partial<TradeJournal>): TradeJournal {
  return {
    id: 'journal-default',
    user_id: 'user-1',
    journal_kind: 'trade',
    order_kind: 'main',
    direction: 'long',
    symbol: 'BTCUSDT',
    trade_record_id: 'record-a',
    source: 'retroactive_from_record',
    post_reviewed_at: null,
    ...overrides,
  } as TradeJournal;
}

function record(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    id: 'record-a',
    symbol: 'BTCUSDT',
    closedRealAt: operationA,
    ...overrides,
  } as TradeRecord;
}

describe('未评价主力多单统一口径', () => {
  it('只收录有客观操作时间的主力多单，并兼容历史 positionId 关联', () => {
    const records = [
      record({ id: 'record-a', positionId: 'position-a', closedRealAt: operationA }),
      record({ id: 'record-b', positionId: 'legacy-position-b', symbol: 'ETHUSDT', closedRealAt: operationB }),
      record({ id: 'record-no-time', positionId: 'position-no-time', closedRealAt: undefined }),
    ];
    const journals = [
      journal({ id: 'a', trade_record_id: 'record-a' }),
      journal({ id: 'b', symbol: 'ethusdt', trade_record_id: 'legacy-position-b' }),
      journal({ id: 'reviewed', trade_record_id: 'record-a', post_reviewed_at: '2026-06-24T00:00:00Z' }),
      journal({ id: 'short', direction: 'short', trade_record_id: 'record-a' }),
      journal({ id: 'hedge', order_kind: 'hedge', trade_record_id: 'record-a' }),
      journal({ id: 'no-time', trade_record_id: 'record-no-time' }),
    ];

    const objective = buildObjectiveLongMainReviewItems(journals, records);
    expect(objective.map(item => item.journal.id)).toEqual(['a', 'b', 'reviewed']);
    expect(objective.find(item => item.journal.id === 'b')).toMatchObject({
      symbol: 'ETHUSDT',
      operationTime: operationB,
      record: expect.objectContaining({ id: 'record-b' }),
    });
    expect(buildUnreviewedLongMainItems(journals, records).map(item => item.journal.id)).toEqual(['a', 'b']);
  });

  it('按标的穷尽汇总，并保留最早与最近操作时间', () => {
    const items = buildUnreviewedLongMainItems([
      journal({ id: 'btc-old', trade_record_id: 'record-a' }),
      journal({ id: 'btc-new', trade_record_id: 'record-c' }),
      journal({ id: 'eth', symbol: 'ETHUSDT', trade_record_id: 'record-b' }),
    ], [
      record({ id: 'record-a', closedRealAt: operationA }),
      record({ id: 'record-b', symbol: 'ETHUSDT', closedRealAt: operationB }),
      record({ id: 'record-c', closedRealAt: operationB + 1000 }),
    ]);

    expect(summarizeUnreviewedSymbols(items)).toEqual([
      {
        symbol: 'BTCUSDT',
        count: 2,
        earliestOperationTime: operationA,
        latestOperationTime: operationB + 1000,
      },
      {
        symbol: 'ETHUSDT',
        count: 1,
        earliestOperationTime: operationB,
        latestOperationTime: operationB,
      },
    ]);
  });
});
