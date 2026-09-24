import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PendingOrder, Position } from '@/types/trading';
import {
  buildCloseRecords, executeSettlementFill, mergeFilledPosition,
  scaleSettlementPosition, settlePositionClose,
} from '@/lib/tradingSettlement';

const T0 = Date.parse('2026-09-20T00:00:00Z');
const order: PendingOrder = {
  id: 'o1', side: 'SHORT', type: 'MARKET', price: 100, stopPrice: 0, quantity: 10,
  leverage: 10, marginMode: 'isolated', status: 'FILLED', createdAt: T0,
};
const open = (entryMethod?: Position['entry_method']) => executeSettlementFill(
  'ETHUSDT', 100, order, false, T0, T0, 'timeline-1', entryMethod,
).position;

describe('开仓方式跟随每笔成交持久保存', () => {
  it('必须有执行路径的证据：MARKET 成交既可以是手动，也可以是委托，历史不补猜', () => {
    expect(open('manual').entry_method).toBe('manual');
    expect(open('order').entry_method).toBe('order');
    const legacy = open();
    expect(legacy).not.toHaveProperty('entry_method');
    const [record] = settlePositionClose('ETHUSDT', legacy, 99, 10, T0 + 1_000)!.records;
    expect(record.type).toBe('MARKET');
    expect(record).not.toHaveProperty('entry_method');
  });

  it('手动和委托合并、部分平仓、重新载入 JSON、整笔平仓均保持每笔自己的开仓方式', () => {
    const manual = open('manual');
    const pending = open('order');
    const merged = mergeFilledPosition('ETHUSDT', [manual], pending).survivor;
    expect(merged.fills?.map(fill => fill.entry_method)).toEqual(['manual', 'order']);
    const first = settlePositionClose('ETHUSDT', merged, 99, 10, T0 + 1_000, 'tp1')!;
    expect(first.records.map(record => [record.entry_method, record.exit_method])).toEqual([
      ['manual', 'tp1'], ['order', 'tp1'],
    ]);
    const reloaded = JSON.parse(JSON.stringify(scaleSettlementPosition(merged, 10))) as Position;
    const second = settlePositionClose('ETHUSDT', reloaded, 99, 10, T0 + 2_000, 'manual')!;
    expect(second.records.map(record => [record.entry_method, record.exit_method])).toEqual([
      ['manual', 'manual'], ['order', 'manual'],
    ]);
  });

  it('未知旧成交不能继承合并仓位第一笔的方式，反过来也不能抹掉已知的新成交', () => {
    for (const methods of [['manual', undefined], [undefined, 'order']] as const) {
      const first = open(methods[0]);
      const second = open(methods[1]);
      const merged = mergeFilledPosition('ETHUSDT', [first], second).survivor;
      const records = settlePositionClose('ETHUSDT', merged, 99, 20, T0 + 1_000)!.records;
      expect(records.map(record => record.entry_method)).toEqual(methods);
      expect(JSON.parse(JSON.stringify(records)).map((record: { entry_method?: string }) => record.entry_method)).toEqual(methods);
    }
  });

  it('强平的共用记录出口也保留每笔开仓来源，退出仍为强平', () => {
    const merged = mergeFilledPosition('ETHUSDT', [open('manual')], open('order')).survivor;
    const records = buildCloseRecords({
      symbol: 'ETHUSDT', pos: merged, closeQty: 20, fillPrice: 110, closeTime: T0 + 1_000,
      exitMethod: 'liquidation', totals: { netPnl: -200, feeUsd: 1, slippageUsd: 0, notionalUsd: 2200 },
    }).map(record => ({ ...record, action: 'LIQUIDATION' as const }));
    expect(records.map(record => [record.entry_method, record.exit_method, record.action])).toEqual([
      ['manual', 'liquidation', 'LIQUIDATION'], ['order', 'liquidation', 'LIQUIDATION'],
    ]);
  });

  it('单笔 fills 来源也会带入记录，不要求仓位级字段存在', () => {
    const position = open();
    position.fills = [{ id: position.id, openTime: T0, entryPrice: position.entryPrice, units: 10, entry_method: 'order' }];
    expect(settlePositionClose('ETHUSDT', position, 99, 10, T0 + 1_000)!.records[0].entry_method).toBe('order');
  });

  it.each([
    ['src/contexts/TradingContext.tsx', 'manual', 2],
    ['src/pages/Index.tsx', 'order', 3],
    ['src/hooks/useBackgroundPrices.ts', 'order', 1],
  ])('执行入口 %s 显式标记 %s 来源', (path, method, count) => {
    const source = readFileSync(path as string, 'utf8');
    const calls = [...source.matchAll(/executeSettlementFill\([\s\S]*?\);/g)];
    expect(calls).toHaveLength(count as number);
    // 开仓方式后面**必须**跟成交那一刻的持仓限制模式（决定仓位的维持保证金模型，lib/positionLimitMode）：
    // 漏传就按币安标准盖分层戳，无限制模式下开的大仓位会按分层维持保证金一开出来就被强平
    for (const [call] of calls) {
      expect(call).toMatch(new RegExp(`'${method}',\\s*(limitMode|getPositionLimitMode\\?\\.\\(\\))[,]?\\s*\\);$`));
    }
  });
});
