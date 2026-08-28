import { describe, expect, it } from 'vitest';
import type { TradeJournal } from '@/types/journal';
import { buildMainLegOrdinals } from '@/lib/campaignMainLegOrdinals';

const leg = (id: string, role: TradeJournal['leg_role'], at: string, seq?: number): TradeJournal =>
  ({ id, leg_role: role, pre_simulated_time: at, leg_sequence: seq } as TradeJournal);

describe('主力编号', () => {
  it('两笔及以上主力才编号，按开仓先后', () => {
    const m = buildMainLegOrdinals([
      leg('b', 'main_open', '2026-04-30T04:23:00Z'),
      leg('a', 'main_open', '2026-04-29T19:48:00Z'),
    ]);
    expect(m.get('a')).toBe(1);
    expect(m.get('b')).toBe(2);
  });

  it('只有一笔主力时不编号——「主力1」会暗示还有个主力2', () => {
    expect(buildMainLegOrdinals([leg('a', 'main_open', '2026-04-29T19:48:00Z')]).size).toBe(0);
  });

  it('加仓不参与编号：它自己有 加仓1 / 加仓2 的标签', () => {
    const m = buildMainLegOrdinals([
      leg('a', 'main_open', '2026-04-29T19:48:00Z'),
      leg('add', 'main_add_2', '2026-04-29T21:54:00Z'),
      leg('b', 'main_open', '2026-04-30T04:23:00Z'),
    ]);
    expect(m.get('add')).toBeUndefined();
    expect([m.get('a'), m.get('b')]).toEqual([1, 2]);
  });

  it('没有 main_open 时才退回 reentry_main，与主力选取的角色分档一致', () => {
    const m = buildMainLegOrdinals([
      leg('r1', 'reentry_main', '2026-04-29T19:48:00Z'),
      leg('r2', 'reentry_main', '2026-04-30T04:23:00Z'),
    ]);
    expect([m.get('r1'), m.get('r2')]).toEqual([1, 2]);
    // 有 main_open 时 reentry 不参与
    const mixed = buildMainLegOrdinals([
      leg('m1', 'main_open', '2026-04-29T19:48:00Z'),
      leg('m2', 'main_open', '2026-04-30T04:23:00Z'),
      leg('r', 'reentry_main', '2026-04-30T12:00:00Z'),
    ]);
    expect(mixed.get('r')).toBeUndefined();
  });

  it('时间并列时按 leg_sequence 定序，结果稳定可复现', () => {
    const m = buildMainLegOrdinals([
      leg('y', 'main_open', '2026-04-29T19:48:00Z', 7),
      leg('x', 'main_open', '2026-04-29T19:48:00Z', 3),
    ]);
    expect(m.get('x')).toBe(1);
    expect(m.get('y')).toBe(2);
  });

  it('时间为 0 / 缺失的排到最后，不抢 1 号', () => {
    const m = buildMainLegOrdinals([
      leg('bad', 'main_open', null as unknown as string),
      leg('good', 'main_open', '2026-04-29T19:48:00Z'),
    ]);
    expect(m.get('good')).toBe(1);
    expect(m.get('bad')).toBe(2);
  });
});
