import { describe, expect, it } from 'vitest';
import { suggestLegRoles } from '../legRoleSuggestion';
import type { TradeJournal } from '@/types/journal';

const journal = (id: string, minutesFromStart: number, over: Partial<TradeJournal> = {}): TradeJournal =>
  ({
    id,
    order_kind: 'main',
    direction: 'long',
    pre_simulated_time: new Date(Date.parse('2026-04-10T00:00:00.000Z') + minutesFromStart * 60_000).toISOString(),
    trade_record_id: null,
    ...over,
  } as TradeJournal);

const roleOf = (out: ReturnType<typeof suggestLegRoles>, id: string) =>
  out.find(s => s.journalId === id)?.suggestedRole;

describe('suggestLegRoles 的加仓槽', () => {
  it('槽用尽后退到 reentry_main，不把溢出的都叫「加仓6」', () => {
    // 用户在归类页看到八行「建议：加仓6」——夹逼索引让 ?? 兜底成了死代码。
    const journals = [
      journal('main', 0),
      ...Array.from({ length: 8 }, (_, i) => journal(`add-${i + 1}`, i + 1)),
    ];
    const out = suggestLegRoles(journals);
    expect(roleOf(out, 'main')).toBe('main_open');
    expect(roleOf(out, 'add-1')).toBe('main_add_1');
    expect(roleOf(out, 'add-6')).toBe('main_add_6');
    expect(roleOf(out, 'add-7')).toBe('reentry_main');
    expect(roleOf(out, 'add-8')).toBe('reentry_main');
  });

  it('建议要能区分出第几笔加仓，不是一堆相同标签', () => {
    const journals = [
      journal('main', 0),
      ...Array.from({ length: 6 }, (_, i) => journal(`add-${i + 1}`, i + 1)),
    ];
    const roles = suggestLegRoles(journals)
      .filter(s => s.journalId.startsWith('add-'))
      .map(s => s.suggestedRole);
    expect(new Set(roles).size).toBe(6);
  });
});
