import { describe, expect, it } from 'vitest';
import type { TradeRecord } from '@/types/trading';

/**
 * 事故：归类页只剩「一多一空」，镜像止盈、加仓、各对冲空单整批消失。
 *
 * 病根是把去重放错了层。合并仓位平仓会把一次平仓拆成多条分片记录，
 * 而 handlePlaceOrder 成交后返回的是**这一笔新成交自己的 id**（= fills[n].id），
 * 所以每为一条腿「记录决策」，日志的 trade_record_id 就等于该成交的 fillId。
 * 我曾在 listOrphanTradeRecords（数据层）按 fillId 排除分片——
 * 于是凡是记过决策的腿，它的分片全被隐藏。
 *
 * 数据层看不到「那条日志是否会出现在用户眼前」（归类页还有日期/标的/已归类三道过滤），
 * 日志被筛掉、分片也被隐藏，这笔成交就一个入口都没有。
 *
 * 这里钉的是不变量本身：**每笔成交至少有一个入口**。
 */

/** 复刻 JournalCampaignClassifyPage.allItems 的取舍。 */
function buildEntries(input: {
  visibleJournals: Array<{ id: string; trade_record_id: string | null }>;
  records: TradeRecord[];
}) {
  const journalRecordIds = new Set(
    input.visibleJournals.map(j => j.trade_record_id).filter((v): v is string => Boolean(v)),
  );
  const journalRows = input.visibleJournals.map(j => ({ kind: 'journal' as const, ref: j.trade_record_id }));
  const orphanRows = input.records
    .filter(r => !journalRecordIds.has(r.id) && !(r.fillId && journalRecordIds.has(r.fillId)))
    .map(r => ({ kind: 'orphan' as const, ref: r.fillId ?? r.id }));
  return [...journalRows, ...orphanRows];
}

const slice = (id: string, fillId: string, side: 'LONG' | 'SHORT'): TradeRecord => ({
  id, symbol: 'STXUSDT', side, action: 'CLOSE', positionId: side === 'LONG' ? 'pos-L' : 'pos-S',
  fillId, entryPrice: 0.84, exitPrice: 0.85, quantity: 100, leverage: 10, pnl: 1,
  openTime: 1_000, closeTime: 9_000,
} as unknown as TradeRecord);

/** 实盘形状：多头 主力+镜像+加仓 合并成一个仓位；空头 两条滚动对冲合并成一个。 */
const RECORDS = [
  slice('r1', 'f-main', 'LONG'),
  slice('r2', 'f-mirror', 'LONG'),
  slice('r3', 'f-add', 'LONG'),
  slice('r4', 'f-hedge1', 'SHORT'),
  slice('r5', 'f-hedge2', 'SHORT'),
];
const ALL_FILLS = ['f-main', 'f-mirror', 'f-add', 'f-hedge1', 'f-hedge2'];

const coveredFills = (entries: ReturnType<typeof buildEntries>) =>
  new Set(entries.map(e => e.ref).filter((v): v is string => Boolean(v)));

describe('归类页：每笔成交至少有一个入口', () => {
  it('一条日志都没有时，五笔成交各出一行', () => {
    const entries = buildEntries({ visibleJournals: [], records: RECORDS });
    expect(entries).toHaveLength(5);
    expect(coveredFills(entries)).toEqual(new Set(ALL_FILLS));
  });

  it('【回归】每条腿都记过决策 —— 仍然是五个入口，不是「一多一空」', () => {
    // 这正是事故形状：日志存的 trade_record_id 就是各成交的 fillId。
    const journals = ALL_FILLS.map((f, i) => ({ id: `j${i}`, trade_record_id: f }));
    const entries = buildEntries({ visibleJournals: journals, records: RECORDS });
    expect(entries).toHaveLength(5);
    expect(coveredFills(entries)).toEqual(new Set(ALL_FILLS));
    // 全部以日志行出现，分片行不重复列出
    expect(entries.every(e => e.kind === 'journal')).toBe(true);
  });

  it('部分记过决策：记过的走日志行，没记过的走分片行，总数不变', () => {
    const journals = [{ id: 'j0', trade_record_id: 'f-main' }];
    const entries = buildEntries({ visibleJournals: journals, records: RECORDS });
    expect(entries).toHaveLength(5);
    expect(coveredFills(entries)).toEqual(new Set(ALL_FILLS));
    expect(entries.filter(e => e.kind === 'journal')).toHaveLength(1);
    expect(entries.filter(e => e.kind === 'orphan')).toHaveLength(4);
  });

  it('【判据】日志被本页过滤掉时，分片必须补位 —— 不能两边都消失', () => {
    // 数据层按 fillId 排除的致命处：日志被日期/标的筛掉了，它却仍然让分片隐身。
    // 这里 visibleJournals 为空正是「被筛掉」的建模。
    const entries = buildEntries({ visibleJournals: [], records: RECORDS });
    expect(coveredFills(entries)).toEqual(new Set(ALL_FILLS));
    for (const f of ALL_FILLS) expect(coveredFills(entries).has(f)).toBe(true);
  });

  it('没有 fillId 的旧记录照常按 id 去重', () => {
    const legacy = [{ ...RECORDS[0], fillId: undefined } as TradeRecord];
    expect(buildEntries({ visibleJournals: [], records: legacy })).toHaveLength(1);
    expect(buildEntries({ visibleJournals: [{ id: 'j', trade_record_id: 'r1' }], records: legacy }))
      .toHaveLength(1);
  });
});
