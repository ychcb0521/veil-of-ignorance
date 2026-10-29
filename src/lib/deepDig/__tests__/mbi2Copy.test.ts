import {createHash} from 'node:crypto';
import {writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {computeMbi} from '@/lib/mbi';
import {computeMbi2Core} from '@/lib/mbi2';
import {MBI_DEF,MBI2_FORMULA,compileFeatureFormula,evaluateOnBars} from '../features';
import {mbiBars} from './fixtures/mbiBars';
it('copies every raw and smoothed value bit-for-bit before any MBI2 change',()=>{
 const rows=[];
 for(const minutes of [5,15,60]){
  const bars=mbiBars(1500,minutes*60000), prices=bars.map(b=>b.close);
  const old=computeMbi(prices),copy=computeMbi2Core(prices);
  expect(copy.z).toEqual(old.z); expect(copy.mbi).toEqual(old.mbi);
  const original=evaluateOnBars(bars,compileFeatureFormula(MBI_DEF.formula),{...MBI_DEF,interval:(minutes===5?'5m':minutes===15?'15m':'1h')});
  const next=evaluateOnBars(bars,compileFeatureFormula(MBI2_FORMULA),{...MBI_DEF,id:'mbi2',MBI2_Z0:1.25,interval:(minutes===5?'5m':minutes===15?'15m':'1h')} as typeof MBI_DEF);
  // Formula parameters are supplied independently, never aliases of MBI parameters.
  for(const [a,b] of [['MBI','MBI2'],['avg_MBI_2','avg_MBI2_2']])expect(next.vars.get(b)).toEqual(original.vars.get(a));
  rows.push({minutes,bars:bars.length,differingValues:0,rawSha256:createHash('sha256').update(Buffer.from(old.mbi.buffer)).digest('hex'),averageSha256:createHash('sha256').update(Buffer.from((original.vars.get('avg_MBI_2') as Float64Array).buffer)).digest('hex'),lastRaw:old.mbi.at(-1),lastAverage:(original.vars.get('avg_MBI_2') as Float64Array).at(-1)});
 }
 const out='/Users/a1/.codex/visualizations/2026/10/29/01a18627-9f2c-72b3-a080-e72ba7109656/mbi2-validation';mkdirSync(out,{recursive:true});
 writeFileSync(out+'/copy-after-modification.json',JSON.stringify({stage:'final implementation retains copy equality',rows},null,2));

 console.info('MBI2 copy',JSON.stringify(rows));
});
