// 【用户要求】2026-11-02 加仓否决：长上影线、向下大插针、高震荡、冲高回落时不加仓（ONT 第 3 次、STRK 第 2、3 次加仓都加在这些形态之后）
import { expect, it } from 'vitest';
import { additionVetoIdentity, evaluateAdditionVetoes, validateAdditionVetoes, type QualityAdditionEntryVeto, type VetoBar } from '../qualityAdditionVeto';
import { additionIdentity, defaultQualityAddition } from '../qualityAddition';
const T = Date.UTC(2026, 3, 1), STEP = 300000;
/** 平稳上行：每根实体 1、影线 0.2，ATR 约 1.4。 */
const calm = (n: number, start = 100): VetoBar[] => Array.from({ length: n }, (_, i) => ({ openTime: T + i * STEP, open: start + i, high: start + i + 1.2, low: start + i - .2, close: start + i + 1 }));
const atrOf = (bars: VetoBar[]) => bars.map(() => 1.4);
const on = (kind: QualityAdditionEntryVeto['kind'], extra: Partial<QualityAdditionEntryVeto> = {}): QualityAdditionEntryVeto[] => [{ kind, enabled: true, ...extra }];
it('long lower wick mirrors the upper rule for green and red candles and requires both ATR length and range share',()=>{
 for(const [open,close] of [[104,105],[105,104]]){
  const lower={openTime:T,open,close,low:101,high:106},upper={...lower,open:210-open,close:210-close,low:104,high:109};
  const hit=evaluateAdditionVetoes(on('lower-wick'),[lower],[2],T);
  expect(hit).toMatchObject({kind:'lower-wick',reading:expect.stringContaining('下影 1.5 ATR，占整根 60%')});
  expect(evaluateAdditionVetoes(on('upper-wick'),[upper],[2],T)).toBeDefined();
  expect(evaluateAdditionVetoes(on('lower-wick',{atr:1.51}),[lower],[2],T)).toBeUndefined();
  expect(evaluateAdditionVetoes(on('lower-wick',{ratio:61}),[lower],[2],T)).toBeUndefined();
 }
});
it('long lower wick respects its lookback and enabled flag and remains distinct from a downward price spike',()=>{
 const bars=calm(15);bars[2]={...bars[2],low:bars[2].open-8};
 expect(evaluateAdditionVetoes(on('lower-wick',{lookbackBars:13}),bars,atrOf(bars),T)).toMatchObject({kind:'lower-wick'});
 expect(evaluateAdditionVetoes(on('lower-wick',{lookbackBars:12}),bars,atrOf(bars),T)).toBeUndefined();
 expect(evaluateAdditionVetoes([{kind:'lower-wick',enabled:false}],bars,atrOf(bars),T)).toBeUndefined();
 const spike=[{openTime:T,open:100,close:100,high:101,low:99},{openTime:T+STEP,open:100,close:60,high:101,low:59}];
 expect(evaluateAdditionVetoes(on('lower-spike'),spike,[1,1],T)).toMatchObject({kind:'lower-spike'});
 expect(evaluateAdditionVetoes(on('lower-wick'),spike,[1,1],T)).toBeUndefined();
});
it('versions only an enabled long-lower-wick rule and preserves every original upper-wick identity',()=>{
 expect(additionVetoIdentity(on('upper-wick'))).toEqual([['upper-wick',12,1.5,60,null,null]]);
 expect(additionVetoIdentity([{kind:'lower-wick',enabled:false}])).toEqual([]);
 expect(additionVetoIdentity(on('lower-wick'))).toEqual([['lower-wick','addition-lower-wick-v1',12,1.5,60]]);
 for(const invalid of [{lookbackBars:0},{lookbackBars:1.5},{atr:NaN},{ratio:101}])expect(()=>validateAdditionVetoes(on('lower-wick',invalid))).toThrow('长下影线');
 expect(evaluateAdditionVetoes(on('lower-wick'),[{openTime:T,open:100,close:100,high:100,low:100}],[2],T)).toBeUndefined();
});
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

// 【用户要求】2026-11-02 冲高回落也能按百分比：≥ a ATR、≥ x%，两项都填时「且 / 或」（默认且）
it('pullback accepts a percentage, alone or combined with ATR by and / or, without changing old identities', () => {
  // 最高 170.2，最后收盘 164 → 回落 4.43 ATR、3.64%
  const fall = [...calm(70), ...Array.from({ length: 10 }, (_, i) => ({ openTime: T + (70 + i) * STEP, open: 169 - i * .5, high: 169.2 - i * .5, low: 168.3 - i * .5, close: 168.5 - i * .5 }))];
  const hit = (extra: Partial<QualityAdditionEntryVeto>) => evaluateAdditionVetoes(on('pullback', extra), fall, atrOf(fall), T);
  expect(hit({ pct: 3 })).toMatchObject({ kind: 'pullback', reading: expect.stringContaining('3.64%') });
  expect(hit({ pct: 4 })).toBeUndefined();
  expect(hit({ atr: 2, pct: 4 })).toBeUndefined();
  expect(hit({ atr: 2, pct: 4, join: 'or' })).toMatchObject({ kind: 'pullback' });
  expect(hit({ atr: 20, pct: 3, join: 'and' })).toBeUndefined();
  expect(hit({ atr: 20, pct: 3, join: 'or' })).toMatchObject({ label: '冲高回落：距持仓最高点回落 ≥ 20 ATR 或 ≥ 3%' });
  expect(hit({})).toMatchObject({ label: '冲高回落：距持仓最高点回落 ≥ 2 ATR' });
  expect(() => validateAdditionVetoes(on('pullback', { pct: 101 }))).toThrow('百分比');
  expect(() => validateAdditionVetoes(on('pullback', { pct: 3 }))).not.toThrow();
  expect(additionVetoIdentity(on('pullback', { atr: 2 }))).toEqual(additionVetoIdentity(on('pullback')));
  expect(JSON.stringify(additionVetoIdentity(on('pullback', { atr: 2, pct: 3 })))).toContain('pullback-pct-v1');
  expect(JSON.stringify(additionVetoIdentity(on('pullback', { atr: 2, pct: 3, join: 'or' })))).not.toBe(JSON.stringify(additionVetoIdentity(on('pullback', { atr: 2, pct: 3 }))));
});

// 【用户要求】2026-11-03「冲高回落·仅ATR」：只按 ATR，不看百分比
it('pullback-atr vetoes on ATR alone, with its own identity', () => {
  const fall = [...calm(70), ...Array.from({ length: 10 }, (_, i) => ({ openTime: T + (70 + i) * STEP, open: 169 - i * .5, high: 169.2 - i * .5, low: 168.3 - i * .5, close: 168.5 - i * .5 }))];
  expect(evaluateAdditionVetoes(on('pullback-atr'), fall, atrOf(fall), T)).toMatchObject({ kind: 'pullback-atr', label: '冲高回落（仅 ATR）：距持仓最高点回落 ≥ 2.5 ATR' });
  expect(evaluateAdditionVetoes(on('pullback-atr', { atr: 5 }), fall, atrOf(fall), T)).toBeUndefined();
  expect(evaluateAdditionVetoes(on('pullback'), fall, atrOf(fall), T)).toMatchObject({ kind: 'pullback' });
  expect(JSON.stringify(additionVetoIdentity(on('pullback-atr')))).not.toBe(JSON.stringify(additionVetoIdentity(on('pullback', { atr: 2.5 }))));
  expect(() => validateAdditionVetoes(on('pullback-atr', { atr: -1 }))).toThrow();
});

// 【用户要求】2026-11-03 冲高回落锁住：触发时带上要收复的持仓最高点；勾选与否身份不同
it('pullback with the lock returns the holding peak to recover and has its own identity', () => {
  const fall = [...calm(70), ...Array.from({ length: 10 }, (_, i) => ({ openTime: T + (70 + i) * STEP, open: 169 - i * .5, high: 169.2 - i * .5, low: 168.3 - i * .5, close: 168.5 - i * .5 }))];
  expect(evaluateAdditionVetoes(on('pullback-atr', { sticky: true }), fall, atrOf(fall), T)).toMatchObject({ kind: 'pullback-atr', lockPeak: 170.2, label: expect.stringContaining('未收复最高点前不再加仓') });
  expect(evaluateAdditionVetoes(on('pullback-atr'), fall, atrOf(fall), T)?.lockPeak).toBeUndefined();
  expect(evaluateAdditionVetoes(on('pullback', { atr: 2, sticky: true }), fall, atrOf(fall), T)).toMatchObject({ lockPeak: 170.2 });
  expect(JSON.stringify(additionVetoIdentity(on('pullback-atr', { sticky: true })))).toContain('pullback-sticky-v1');
  expect(additionVetoIdentity(on('pullback', { atr: 2 }))).toEqual(additionVetoIdentity(on('pullback')));
});
