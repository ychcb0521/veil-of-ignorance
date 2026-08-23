/**
 * 对冲单 A / B 的判据是价格，不是时间。
 *
 * 这套打法里初始对冲挂在主力开仓价上：委托价与触发价都压在成本线，
 * 跌回成本线就翻成反向仓。此前用「主仓开仓 30 分钟内」当代理，
 * 于是半小时内挂在别的价位的滚动对冲被误判成 A/B，
 * 半小时后才补挂到成本线上的 A/B 又被漏掉。
 */
import { describe, expect, it } from 'vitest';
import { suggestLegRoles } from '../legRoleSuggestion';
import type { TradeJournal } from '@/types/journal';

const T0 = Date.parse('2026-04-10T00:00:00.000Z');

const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

const main = (id: string, minutes: number, entryPrice: number | null): TradeJournal =>
  ({ id, order_kind: 'main', direction: 'long', pre_simulated_time: at(minutes), pre_entry_price: entryPrice, trade_record_id: null } as TradeJournal);

const hedge = (
  id: string,
  minutes: number,
  orderPrice: number | null,
  triggerPrice: number | null,
): TradeJournal =>
  ({
    id, order_kind: 'hedge', direction: 'short', pre_simulated_time: at(minutes),
    pre_entry_price: orderPrice, hedge_boundary_price: triggerPrice, trade_record_id: null,
  } as TradeJournal);

const suggestionOf = (out: ReturnType<typeof suggestLegRoles>, id: string) =>
  out.find(item => item.journalId === id);
const roleOf = (out: ReturnType<typeof suggestLegRoles>, id: string) => suggestionOf(out, id)?.suggestedRole;

describe('初始对冲 A / B 的价格判据', () => {
  it('委托价与触发价都在主力开仓价上 → 依次是对冲单 A、对冲单 B', () => {
    const out = suggestLegRoles([
      main('main', 0, 100),
      hedge('h1', 3, 100, 100),
      hedge('h2', 5, 100, 100),
    ]);
    expect(roleOf(out, 'h1')).toBe('hedge_initial_a');
    expect(roleOf(out, 'h2')).toBe('hedge_initial_b');
    expect(suggestionOf(out, 'h1')?.confidence).toBe('high');
    expect(suggestionOf(out, 'h1')?.reason).toContain('主力开仓价');
  });

  it('挂在成本线上就算 A/B —— 哪怕已经过了半小时', () => {
    // 时间代理会把这张漏成 hedge_rolling
    const out = suggestLegRoles([main('main', 0, 100), hedge('late', 240, 100, 100)]);
    expect(roleOf(out, 'late')).toBe('hedge_initial_a');
  });

  it('半小时内、但价位不在成本线上 → 不是初始对冲', () => {
    // 时间代理会把这张误判成 hedge_initial_a
    const out = suggestLegRoles([main('main', 0, 100), hedge('early-off', 5, 96, 96)]);
    expect(roleOf(out, 'early-off')).toBe('hedge_rolling');
    expect(suggestionOf(out, 'early-off')?.reason).toContain('不在主力开仓价上');
  });

  it('只有一个价压在成本线上不算——委托价与触发价必须都对上', () => {
    const out = suggestLegRoles([
      main('main', 0, 100),
      hedge('trigger-only', 4, 97, 100),
      hedge('order-only', 6, 100, 97),
    ]);
    expect(roleOf(out, 'trigger-only')).toBe('hedge_rolling');
    expect(roleOf(out, 'order-only')).toBe('hedge_rolling');
  });

  it('主力的实际成交价也认——对冲是照实际成本线挂的，不是照计划价', () => {
    const out = suggestLegRoles(
      [main('main', 0, 100), hedge('h1', 3, 100.4, 100.4)],
      { filledEntryPrice: journal => (journal.id === 'main' ? 100.4 : null) },
    );
    expect(roleOf(out, 'h1')).toBe('hedge_initial_a');
  });

  it('A、B 两个槽满了之后，同价位的第三张退成滚动对冲而不是抢槽', () => {
    const out = suggestLegRoles([
      main('main', 0, 100),
      hedge('h1', 1, 100, 100),
      hedge('h2', 2, 100, 100),
      hedge('h3', 3, 100, 100),
    ]);
    expect(roleOf(out, 'h3')).toBe('hedge_rolling');
    expect(suggestionOf(out, 'h3')?.reason).toContain('已占满');
  });

  it('老快照没记委托价 / 触发价时才退回 30 分钟窗口，并写明是按时间判的', () => {
    const out = suggestLegRoles([
      main('main', 0, 100),
      hedge('legacy-in', 5, null, null),
      hedge('legacy-out', 90, null, null),
    ]);
    expect(roleOf(out, 'legacy-in')).toBe('hedge_initial_a');
    expect(suggestionOf(out, 'legacy-in')?.reason).toContain('按时间判');
    expect(roleOf(out, 'legacy-out')).toBe('hedge_rolling');
  });

  it('主力没记开仓价时价格判据无从谈起，同样退回时间窗口', () => {
    const out = suggestLegRoles([main('main', 0, null), hedge('h1', 5, 100, 100)]);
    expect(roleOf(out, 'h1')).toBe('hedge_initial_a');
    expect(suggestionOf(out, 'h1')?.reason).toContain('按时间判');
  });

  it('价格判据按相对误差，低价币的最后一位不该把它判飞', () => {
    // 0.0128040 与 0.0128040000001：同一个价，只是浮点噪声
    const out = suggestLegRoles([
      main('main', 0, 0.012804),
      hedge('h1', 1, 0.0128040000001, 0.012804),
      hedge('h2', 2, 0.012805, 0.012805), // 差了一个 tick，是另一个价位
    ]);
    expect(roleOf(out, 'h1')).toBe('hedge_initial_a');
    expect(roleOf(out, 'h2')).toBe('hedge_rolling');
  });
});
