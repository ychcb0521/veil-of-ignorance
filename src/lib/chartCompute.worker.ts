import { evaluateOnBars, type CompiledFeature } from './deepDig/features';
import { createFormulaEvaluationCache } from './deepDig/formula';
import type { ResearchBar } from './deepRsa/window';
export interface ChartComputeJob { id:number; length:number; from?:number; packet:ArrayBuffer; compiled?:CompiledFeature; params:NonNullable<Parameters<typeof evaluateOnBars>[2]>; variables:string[] }
const contexts = new Map<number, { compiled:CompiledFeature; cache:ReturnType<typeof createFormulaEvaluationCache>; bars:ResearchBar[] }>();
self.onmessage = ({ data: job }: MessageEvent<ChartComputeJob>) => {
  try {
    let context = contexts.get(job.id);
    if (!context) {
      if (!job.compiled) throw Error('Indicator program missing');
      context = { compiled:job.compiled, cache:createFormulaEvaluationCache(), bars:[] }; contexts.set(job.id, context);
      if (contexts.size > 64) contexts.delete(contexts.keys().next().value!);
    }
    const values = new Float64Array(job.packet), bars = context.bars; bars.length = job.length;
    for (let i=job.from ?? 0;i<job.length;i++) {
      const at=(i-(job.from ?? 0))*10, b=bars[i] ?? (bars[i]={} as ResearchBar);
      b.openTime=values[at]; b.open=values[at+1]; b.high=values[at+2]; b.low=values[at+3]; b.close=values[at+4];
      b.volume=values[at+5]; b.quoteVolume=values[at+6]; b.takerBuyQuoteVolume=values[at+7]; b.refClose=values[at+8]; b.takerBuyVolume=null;
    }
    const output = evaluateOnBars(bars, context.compiled, job.params, context.cache), vars:Record<string,Float64Array> = {};
    for (const name of job.variables) { const v=output.vars.get(name); if(v!=null) vars[name]=typeof v==='number'?new Float64Array(job.length).fill(v):v.slice(); }
    self.postMessage({id:job.id,first:bars[0]?.openTime,last:bars.at(-1)?.openTime,vars,packet:job.packet}, { transfer:[job.packet,...Object.values(vars).map(a=>a.buffer as ArrayBuffer)] });
  } catch (error) { self.postMessage({id:job.id,error:String(error),packet:job.packet},{transfer:[job.packet]}); }
};
