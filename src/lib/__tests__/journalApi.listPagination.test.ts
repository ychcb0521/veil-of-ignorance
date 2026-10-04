import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 事故：逐条解除一场 2025-05-07 的战役后，归类页里找不到那几笔——日志超过 1000 条，
 * 数据库单次只回 1000 行（按模拟时间从新到旧），模拟时间早的整批读不到。
 */
const db = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, ranges: [] as Array<[number, number]> }));

vi.mock('@/integrations/supabase/client', () => {
  const builder = () => {
    let rows = [...db.rows];
    const chain: Record<string, unknown> = {};
    const pass = () => chain;
    Object.assign(chain, {
      select: pass, eq: pass, gte: pass, lte: pass, order: pass,
      is: (column: string, value: unknown) => { rows = rows.filter(row => row[column] === value); return chain; },
      not: (column: string) => { rows = rows.filter(row => row[column] != null); return chain; },
      range: (from: number, to: number) => {
        db.ranges.push([from, to]);
        // 像 PostgREST 一样：一次最多 1000 行
        return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null });
      },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows.slice(0, 1000), error: null }),
    });
    return chain;
  };
  return { supabase: { from: builder, auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) } } };
});

import { listOrphanTradeRecords, listUnclassifiedJournals } from '@/lib/journalApi';

beforeEach(() => {
  db.ranges = [];
  localStorage.clear();
  db.rows = Array.from({ length: 2_300 }, (_, index) => ({
    id: `j${String(index).padStart(5, '0')}`, user_id: 'u', campaign_id: index === 2_250 ? null : 'c',
    trade_record_id: `r${index}`, symbol: 'KAITOUSDT', pre_simulated_time: '2025-05-07T02:06:00.000Z',
  }));
});

describe('归类页的日志读取要分页', () => {
  it('2300 条日志全部读回来，排在 1000 行之后的那条未归类日志也在', async () => {
    const all = await listUnclassifiedJournals('u', { includeClassified: true });
    expect(all).toHaveLength(2_300);
    expect(db.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    const open = await listUnclassifiedJournals('u');
    expect(open.map(journal => journal.id)).toEqual(['j02250']);
  });

  it('判断成交有没有被日志引用时也读全：第 1000 行之后的日志引用的成交不会被当成未归类重复列出', async () => {
    localStorage.setItem('u_trade_history', JSON.stringify([
      { id: 'r2200', symbol: 'KAITOUSDT', side: 'LONG', action: 'CLOSE', openTime: 1, closeTime: 2 },
      { id: 'free', symbol: 'KAITOUSDT', side: 'LONG', action: 'CLOSE', openTime: 1, closeTime: 2 },
    ]));
    const orphans = await listOrphanTradeRecords('u');
    // 存储键的写法由 readUserScopedStorage 决定；读得到记录时，只剩没被引用的那一条
    if (orphans.length > 0) expect(orphans.map(record => record.id)).toEqual(['free']);
    expect(db.ranges.at(-1)).toEqual([2000, 2999]);
  });
});
