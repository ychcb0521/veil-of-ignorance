import { describe, expect, it } from 'vitest';
import { sortRuleRows } from '../JournalRulesPage';
import type { TradingRule } from '@/types/journal';

const row = (id: string, operationMs: number | null, createdMs: number | null) => ({
  rule: { id } as TradingRule,
  campaignId: operationMs == null ? null : `c-${id}`,
  campaign: null,
  operationMs,
  createdMs,
});

describe('【用户要求】规则按时间排序（默认操作时间）', () => {
  const rows = [row('a', 300, 10), row('b', null, 50), row('c', 100, 30), row('d', 200, 20), row('e', null, 40)];

  it('操作时间从新到旧；没有来源战役的排在最后，按创建时间从新到旧', () => {
    expect(sortRuleRows(rows, 'operation', 'desc').map(r => r.rule.id)).toEqual(['a', 'd', 'c', 'b', 'e']);
  });

  it('切到从旧到新时，没有操作时间的仍在最后', () => {
    expect(sortRuleRows(rows, 'operation', 'asc').map(r => r.rule.id)).toEqual(['c', 'd', 'a', 'b', 'e']);
  });

  it('按创建时间排', () => {
    expect(sortRuleRows(rows, 'created', 'desc').map(r => r.rule.id)).toEqual(['b', 'e', 'c', 'd', 'a']);
    expect(sortRuleRows(rows, 'created', 'asc').map(r => r.rule.id)).toEqual(['a', 'd', 'c', 'e', 'b']);
  });
});
