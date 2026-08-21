import { describe, expect, it } from 'vitest';
import { computeLegPnlContributions, sumLegPnl } from '@/lib/campaignLegPnl';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const leg = (id: string, over: Partial<TradeJournal> = {}): TradeJournal =>
  ({ id, post_realized_pnl: null, ...over } as TradeJournal);
const rec = (pnl: number): TradeRecord => ({ pnl } as TradeRecord);

// 取值优先级（成交记录压过复盘快照）现在归 campaignRealizedPnl 管，
// 这里只复刻同一条规则，好让本文件专注于「贡献率」这一层。
const run = (legs: TradeJournal[], records: Record<string, TradeRecord | null> = {}) =>
  computeLegPnlContributions(legs, l => {
    const fromRecord = records[l.id]?.pnl;
    if (typeof fromRecord === 'number' && Number.isFinite(fromRecord)) return fromRecord;
    const fromLeg = l.post_realized_pnl;
    return typeof fromLeg === 'number' && Number.isFinite(fromLeg) ? fromLeg : null;
  });

describe('computeLegPnlContributions', () => {
  it('成交记录优先于人工快照——事实压过回填', () => {
    const legs = [leg('a', { post_realized_pnl: 999 })];
    expect(run(legs, { a: rec(100) }).get('a')!.pnl).toBe(100);
  });

  it('没有成交记录时退回快照', () => {
    expect(run([leg('a', { post_realized_pnl: 42 })]).get('a')!.pnl).toBe(42);
  });

  it('两者都没有则为 null——未平仓的腿不该显示成 0', () => {
    const entry = run([leg('a')]).get('a')!;
    expect(entry.pnl).toBeNull();
    expect(entry.contribution).toBeNull();
  });

  it('贡献率按绝对值之和分摊，各腿份额之和为 100%', () => {
    // 主力 +1000、对冲 −200：分母 1200
    const map = run([leg('main'), leg('hedge')], { main: rec(1000), hedge: rec(-200) });
    expect(map.get('main')!.contribution).toBeCloseTo(1000 / 1200, 12);
    expect(map.get('hedge')!.contribution).toBeCloseTo(-200 / 1200, 12);
    const absSum = [...map.values()].reduce((s, e) => s + Math.abs(e.contribution ?? 0), 0);
    expect(absSum).toBeCloseTo(1, 12);
  });

  it('单腿战役贡献率为 100%', () => {
    expect(run([leg('a')], { a: rec(500) }).get('a')!.contribution).toBe(1);
    // 亏损单腿是 −100%
    expect(run([leg('a')], { a: rec(-500) }).get('a')!.contribution).toBe(-1);
  });

  it('不用净盈亏做分母——否则贡献率会超过 100%', () => {
    const map = run([leg('main'), leg('hedge')], { main: rec(1000), hedge: rec(-200) });
    // 若按净额 800 算，主力会是 125%
    expect(map.get('main')!.contribution!).toBeLessThan(1);
  });

  it('全部打平时不出贡献率，不产生 NaN', () => {
    const map = run([leg('a'), leg('b')], { a: rec(0), b: rec(0) });
    expect(map.get('a')!.pnl).toBe(0);
    expect(map.get('a')!.contribution).toBeNull();
  });

  it('有腿缺数据时，其余腿仍按已有数据分摊', () => {
    const map = run([leg('a'), leg('b')], { a: rec(300) });
    expect(map.get('a')!.contribution).toBe(1);
    expect(map.get('b')!.contribution).toBeNull();
  });

  it('非有限数被当作缺失，不污染分母', () => {
    const map = run([leg('a'), leg('b')], { a: rec(Number.NaN), b: rec(100) });
    expect(map.get('a')!.pnl).toBeNull();
    expect(map.get('b')!.contribution).toBe(1);
  });

  it('sumLegPnl 只累加有数据的腿', () => {
    const map = run([leg('a'), leg('b'), leg('c')], { a: rec(100), b: rec(-30) });
    expect(sumLegPnl(map.values())).toBe(70);
  });
});
