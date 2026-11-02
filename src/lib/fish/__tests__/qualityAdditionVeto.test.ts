// 【用户要求】2026-11-02 加仓否决：长上影线、向下大插针、高震荡、冲高回落时不加仓（ONT 第 3 次、STRK 第 2、3 次加仓都加在这些形态之后）
import { expect, it } from 'vitest';
import { additionVetoIdentity, evaluateAdditionVetoes, validateAdditionVetoes, type QualityAdditionEntryVeto, type VetoBar } from '../qualityAdditionVeto';
import { additionIdentity, defaultQualityAddition } from '../qualityAddition';
const T = Date.UTC(2026, 3, 1), STEP = 300000;
/** 平稳上行：每根实体 1、影线 0.2，ATR 约 1.4。 */
const calm = (n: number, start = 100): VetoBar[] => Array.from({ length: n }, (_, i) => ({ openTime: T + i * STEP, open: start + i, high: start + i + 1.2, low: start + i - .2, close: start + i + 1 }));
const atrOf = (bars: VetoBar[]) => bars.map(() => 1.4);
const on = (kind: QualityAdditionEntryVeto['kind'], extra: Partial<QualityAdditionEntryVeto> = {}): QualityAdditionEntryVeto[] => [{ kind, enabled: true, ...extra }];
it('vetoes a long upper wick, a downward spike, a pullback from the high and choppy or expanding volatility; stays quiet in a clean climb', () => {
  const clean = calm(80);
  for (const kind of ['upper-wick', 'lower-spike', 'pullback'] as const) expect(evaluateAdditionVetoes(on(kind), clean, atrOf(clean), T)).toBeUndefined();
  expect(evaluateAdditionVetoes(on('volatility', { er: .1 }), clean, atrOf(clean), T)).toBeUndefined();
  const wick = calm(80); wick[75] = { ...wick[75], high: wick[75].close + 3 };
  expect(evaluateAdditionVetoes(on('upper-wick'), wick, atrOf(wick), T)).toMatchObject({ kind: 'upper-wick', reading: expect.stringContaining('上影') });
  expect(evaluateAdditionVetoes(on('upper-wick', { lookbackBars: 3 }), wick, atrOf(wick), T)).toBeUndefined();
  const spike = calm(80); spike[78] = { ...spike[78], low: spike[77].close * .96 };
  expect(evaluateAdditionVetoes(on('lower-spike'), spike, atrOf(spike), T)).toMatchObject({ kind: 'lower-spike' });
  const fall = [...calm(70), ...Array.from({ length: 10 }, (_, i) => ({ openTime: T + (70 + i) * STEP, open: 169 - i * .5, high: 169.2 - i * .5, low: 168.3 - i * .5, close: 168.5 - i * .5 }))];
  expect(evaluateAdditionVetoes(on('pullback'), fall, atrOf(fall), T)).toMatchObject({ kind: 'pullback' });
  expect(evaluateAdditionVetoes(on('pullback', { atr: 20 }), fall, atrOf(fall), T)).toBeUndefined();
  const wide = calm(80), atr = [...atrOf(wide).slice(0, 79), 4];
  expect(evaluateAdditionVetoes(on('volatility', { er: 0 }), wide, atr, T)).toMatchObject({ kind: 'volatility', reading: expect.stringContaining('2.86 倍') });
  expect(evaluateAdditionVetoes([{ kind: 'upper-wick', enabled: false }], wick, atrOf(wick), T)).toBeUndefined();
});
it('validates parameters and only changes the run identity when a veto is enabled', () => {
  expect(() => validateAdditionVetoes(on('upper-wick', { lookbackBars: 0 }))).toThrow('回看根数');
  expect(() => validateAdditionVetoes(on('volatility', { er: 2 }))).toThrow('效率比');
  const base = { ...defaultQualityAddition(), enabled: true, source: 'structure' as const };
  expect(additionIdentity({ ...base, entryVetoes: [{ kind: 'pullback', enabled: false }] })).toEqual(additionIdentity(base));
  expect(additionIdentity({ ...base, entryVetoes: on('pullback') })).not.toEqual(additionIdentity(base));
  expect(additionVetoIdentity(on('pullback', { atr: 3 }))).not.toEqual(additionVetoIdentity(on('pullback')));
});
// 【用户要求】2026-11-02 持仓期间急跌：任意 N 分钟内（首根开盘 → 末根收盘）跌幅达标就不再加仓，与硬性终止同口径
it('vetoes a fast drop inside any configured minute window since entry, and needs minute bars', async () => {
  const { fastDropHit, additionVetoesNeedMinutes } = await import('../qualityAdditionVeto');
  const M = 60000, minutes: VetoBar[] = Array.from({ length: 30 }, (_, i) => ({ openTime: T + i * M, open: 100, high: 100.5, low: 99.5, close: 100 }));
  // 第 10–14 分钟连跌：开 100 → 收 93.5（5 分钟跌 6.5%）
  for (let i = 10; i < 15; i++) minutes[i] = { openTime: T + i * M, open: 100 - (i - 10) * 1.3, high: 100 - (i - 10) * 1.3, low: 98.7 - (i - 10) * 1.3, close: 98.7 - (i - 10) * 1.3 };
  expect(fastDropHit([{ minutes: 5, pct: 7 }], minutes, T)).toBeUndefined();
  expect(fastDropHit([{ minutes: 5, pct: 6 }], minutes, T)).toMatchObject({ window: { minutes: 5 }, at: T + 10 * M, drop: expect.closeTo(6.5) });
  expect(fastDropHit([{ minutes: 5, pct: 6 }], minutes, T + 11 * M)).toBeUndefined();
  expect(evaluateAdditionVetoes([{ kind: 'fast-drop', enabled: true, windows: [{ minutes: 5, pct: 6 }] }], calm(80), atrOf(calm(80)), T, minutes)).toMatchObject({ kind: 'fast-drop', reading: expect.stringContaining('5 分钟内跌 6.5%') });
  expect(additionVetoesNeedMinutes(on('fast-drop'))).toBe(true); expect(additionVetoesNeedMinutes(on('pullback'))).toBe(false);
  expect(() => validateAdditionVetoes([{ kind: 'fast-drop', enabled: true, windows: [] }])).toThrow('至少填一组');
  expect(() => validateAdditionVetoes([{ kind: 'fast-drop', enabled: true, windows: [{ minutes: 1.5, pct: 5 }] }])).toThrow('整数');
});
