import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { CTBA_DEFAULTS, CTBA_12H_DEFAULTS, CTBA_ABSOLUTE_BOUND, computeCtbaSeries, ctbaFormula } from '@/lib/ctba';
import { CTBA_DEF, CTBA_12H_DEF, compileFeatureFormula, evaluateOnBars, featureWindowMs, definitionKey, mergeFeatureDefs, FEATURES_KEY } from '../features';
import { createFormulaEvaluationCache } from '../formula';
import { mbiBars } from './fixtures/mbiBars';
import { collectDeepDigRun } from '../analysis';
import { chartFeatureSeries, ctbaChartParameterText } from '@/lib/featureSource';
import { qualityFilterChoices } from '@/lib/fish/qualityFilters';
import { seriesOffsets, seriesRangeOf } from '../series';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { CampaignGroupReport } from '@/lib/deepRsa/report';
import type { TradeSignal } from '@/lib/signalLibrary';

const p = CTBA_12H_DEFAULTS;
const barMs = 300000;
function flat(n = 500) {
  const array = (value: number) => new Float64Array(n).fill(value);
  return { C: array(100), H: array(101), L: array(99), E: array(100), B: array(50), S: array(50), time: Float64Array.from({ length: n }, (_, i) => i * barMs) };
}
const kline = (bars: ResearchBar[]) => bars.map(b => ({ timestamp: b.openTime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, turnover: b.quoteVolume!, takerBuyTurnover: b.takerBuyQuoteVolume! }));
function fetchBars(bars: ResearchBar[]) {
  return async (url: string) => {
    const u = new URL(url), from = Number(u.searchParams.get('startTime')), to = Number(u.searchParams.get('endTime')), limit = Number(u.searchParams.get('limit'));
    return { ok: true, status: 200, json: async () => bars.filter(b => b.openTime >= from && b.openTime <= to).slice(0, limit).map(b => [b.openTime,b.open,b.high,b.low,b.close,b.volume,b.openTime+barMs-1,b.quoteVolume,1,b.takerBuyVolume,b.takerBuyQuoteVolume,0]) };
  };
}
const run = (def: typeof CTBA_DEF, bars: ResearchBar[], anchor: number, symbol = 'CTBA12HTESTUSDT') => collectDeepDigRun({ rows: [] } as unknown as CampaignGroupReport,
  { ...def, source: 'signals', positive: 's >= 3', control: 's < 3' }, { signals: [{ id: 'ctba12h-' + symbol, symbol, timeMs: anchor, quality: 5 } as TradeSignal], fetchFn: fetchBars(bars), backgroundCap: 0 });

it('registers one independent copy and leaves the original formula, configuration and definition key unchanged', () => {
  expect(CTBA_12H_DEF.id).toBe('ctba_12h');
  expect(CTBA_12H_DEF).not.toBe(CTBA_DEF);
  expect(CTBA_DEF.formula).toBe(ctbaFormula(CTBA_DEFAULTS));
  expect(CTBA_DEF).not.toHaveProperty('researchWindowHours');
  expect(mergeFeatureDefs(mergeFeatureDefs([])).filter(d => d.id === 'ctba_12h')).toHaveLength(1);
  expect(CTBA_12H_DEF.formula).toBe('ctba_12h_version = 1\n' + ctbaFormula({ ...p }));
  expect(p).toMatchObject({ N:144,f:8,s:24,m:48,lambda:Math.LN2/24,epsilon:1e-12,alpha:.35,beta:.4,gamma:.25 });
  const before = JSON.stringify(CTBA_DEF), key = definitionKey(CTBA_DEF);
  const changed = structuredClone(CTBA_12H_DEF); changed.formula = ctbaFormula({ ...p, N: 200 }); changed.positive = 'X > 25';
  expect(definitionKey(changed)).not.toBe(definitionKey(CTBA_12H_DEF));
  expect(JSON.stringify(CTBA_DEF)).toBe(before); expect(definitionKey(CTBA_DEF)).toBe(key);
  expect(qualityFilterChoices([CTBA_DEF, CTBA_12H_DEF]).map(c => c.key)).toEqual(expect.arrayContaining(['ctba:CTBA','ctba_12h:CTBA']));
});

it('has a fixed neutral zero, signed response and the exact nested tanh without rescaling', () => {
  const b = flat(), neutral = computeCtbaSeries(b,p);
  for (const name of ['T','M','F','CTBA'] as const) expect(neutral[name].at(-1)).toBe(0);
  for (const direction of [1,-1]) {
    b.B.fill(50 + direction * 20); b.S.fill(50 - direction * 20);
    const out = computeCtbaSeries(b,p), i = b.C.length-1;
    expect(Math.sign(out.CTBA[i])).toBe(direction);
    expect(out.CTBA[i]).toBe(100*Math.tanh(.35*Math.tanh(out.T[i])+.4*Math.tanh(out.M[i])+.25*out.F[i]));
    expect(Math.abs(out.CTBA[i])).toBeLessThan(CTBA_ABSOLUTE_BOUND);
  }
  b.B[499] = NaN; expect(computeCtbaSeries(b,p).CTBA[499]).toBeNaN();
});

it('allows neutral cancellation with unequal active amounts, and uses exactly 24-bar flow half life', () => {
  const b = flat(); b.C.fill(100.1);
  const flow = -.35*Math.tanh(.1)/.25;
  b.B.fill(50*(1+flow)); b.S.fill(50*(1-flow));
  const out = computeCtbaSeries(b,p);
  expect(Math.abs(out.CTBA.at(-1)!)).toBeLessThan(1e-11); expect(out.F.at(-1)).not.toBe(0);
  b.C.fill(100); b.B.fill(0); b.S.fill(100); b.B[499]=100; b.S[499]=0;
  const weights = Array.from({length:144},(_,i)=>Math.exp(-p.lambda*i));
  expect(weights[24]).toBeCloseTo(.5,14);
  expect(computeCtbaSeries(b,p).F[499]).toBeCloseTo((weights[0]-weights.slice(1).reduce((a,x)=>a+x,0))/weights.reduce((a,x)=>a+x,0),12);
});

it('keeps formula states and chart caches independent, including incremental updates and missing/forming bars', () => {
  localStorage.clear(); const bars = mbiBars(1500), k = kline(bars), before = chartFeatureSeries(k,'ctba',576)!.core.slice();
  const compiled=compileFeatureFormula(CTBA_12H_DEF.formula), cache=createFormulaEvaluationCache();
  evaluateOnBars(bars.slice(0,1200),compiled,CTBA_12H_DEF,cache);
  const inc=evaluateOnBars(bars,compiled,CTBA_12H_DEF,cache), batch=evaluateOnBars(bars,compiled,CTBA_12H_DEF);
  expect(inc.vars.get('CTBA')).toEqual(batch.vars.get('CTBA'));
  const own = chartFeatureSeries(k,'ctba_12h',144)!;
  expect(own.core.at(-1)).toBe((batch.vars.get('CTBA') as Float64Array).at(-1));
  expect(own.core.at(-1)).not.toBe(before.at(-1));
  localStorage.setItem('sim_anon_'+FEATURES_KEY,JSON.stringify([{...CTBA_12H_DEF,formula:ctbaFormula({...p,N:200})}]));
  expect(chartFeatureSeries(k,'ctba_12h',200)!.core.at(-1)).not.toBe(own.core.at(-1));
  expect(chartFeatureSeries(k,'ctba',576)!.core).toEqual(before);
  localStorage.clear();
  const forming = k.map((b,i)=>({...b,cba2Closed:i!==k.length-1}));
  expect(chartFeatureSeries(forming,'ctba_12h',144)!.core.at(-1)).toBeNull();
  expect(ctbaChartParameterText('ctba_12h',144)).toContain('EMA 8/24');
  expect(ctbaChartParameterText('ctba',576)).toContain('EMA 12/48');
});

it('recomputes exactly 144 closed research points with additional warmup; original retains 576 dense points', async () => {
  const anchor=Date.UTC(2026,3,15), start=anchor-2000*barMs, bars=mbiBars(2500).map(b=>({...b,openTime:b.openTime+start}));
  const result=await run(CTBA_12H_DEF,bars,anchor), dense=Object.values(result.series.anchorWindows!)[0];
  expect(result.series.offsets).toEqual(seriesOffsets(seriesRangeOf(CTBA_12H_DEF)));
  expect(result.series.offsets).toHaveLength(144); expect(result.series.offsets.at(-1)).toBe(0);
  expect(dense.startMs).toBe(anchor-12*3600000); expect(dense.values.CTBA).toHaveLength(144);
  expect(Array.from(dense.values.CTBA).every(Number.isFinite)).toBe(true);
  expect(featureWindowMs(CTBA_12H_DEF)/barMs).toBeGreaterThan(288);
  expect(result.data.definition).toMatchObject({id:'ctba_12h',researchWindowHours:12});
  expect(result.data.rows[0].v).toBe(dense.values.CTBA.at(-1));
  expect(Object.values((await run(CTBA_DEF,bars,anchor,'CTBAORIGINALTESTUSDT')).series.anchorWindows!)[0].values.CTBA).toHaveLength(576);
});

it.skipIf(!process.env.CTBA_REAL_INPUT)('recomputes an existing frozen historical signal through the production research pipeline',async()=>{
  const input=JSON.parse(readFileSync(process.env.CTBA_REAL_INPUT!,'utf8')) as {metadata:{anchorMs:number;symbol:string;timeLabel:string};bars:ResearchBar[]};
  const result=await run(CTBA_12H_DEF,input.bars,input.metadata.anchorMs,input.metadata.symbol);
  expect(result.data.rows[0].v).not.toBeNull();
  const dense=Object.values(result.series.anchorWindows!)[0];
  expect(dense.values.CTBA).toHaveLength(144); expect(Array.from(dense.values.CTBA).every(Number.isFinite)).toBe(true);
  console.info('CTBA-12H real',JSON.stringify({symbol:input.metadata.symbol,time:input.metadata.timeLabel,values:result.data.rows[0].vars}));
  if(process.env.CTBA_REAL_OUTPUT)writeFileSync(process.env.CTBA_REAL_OUTPUT,JSON.stringify({...result,metadata:input.metadata},(_k,v)=>v instanceof Float64Array||v instanceof Float32Array?Array.from(v):v,2));
});
