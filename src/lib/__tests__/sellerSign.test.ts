import { beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_FEATURES, SELLER_FEATURE_CORES, compileFeatureFormula, evaluateOnBars, FEATURES_KEY, mergeFeatureDefs, sellerNegativeFormula } from '@/lib/deepDig/features';
import { compileFishProgram, evaluateFishProgram, classifyFishProgram } from '@/lib/fish/algorithm';
import { fishPreferenceKey, readFishPreference, saveFishPreference, withFishDefaultThreshold } from '@/lib/fish/preferences';
import { fishCardsKey, readFishCards } from '@/lib/fish/cards';
import { CUSTOM_RESEARCH_INDICATORS, researchChartSeries } from '@/lib/researchIndicators';
import { featureCoreName } from '@/lib/featureSource';
import type { ResearchBar } from '@/lib/deepRsa/window';
beforeEach(() => localStorage.clear());
const plain = (formula: string) => formula.split('# seller-negative-v1')[0].trim();
const averages = (formula: string, core: string) => `${formula}\navg_${core} = avg(${core}, 24)\nm6 = avg(${core}, 6)\navg_${core}_2 = (4*m6 + 3*ago(m6,6) + 2*ago(m6,12) + ago(m6,18))/10`;
function bars(n=760): ResearchBar[] { let c=100, btc=50000; return Array.from({length:n},(_,i)=>{const open=c;c*=Math.exp(.002*Math.sin(i/9)-.0002);btc*=Math.exp(.0003*Math.cos(i/13));const q=10000*(1.5+.4*Math.sin(i/11));return {openTime:i*300000,open,close:c,high:Math.max(open,c)*1.001,low:Math.min(open,c)*.999,volume:q/c,quoteVolume:q,takerBuyVolume:null,takerBuyQuoteVolume:q*(.5+.3*Math.sin(i/7)),refClose:btc};}); }
const arr=(x:unknown,n:number)=>typeof x==='number'?new Float64Array(n).fill(x):x as Float64Array;
const pair=Object.entries(SELLER_FEATURE_CORES).filter(([id])=>!id.endsWith('-retain'));
const legacyPair=pair.filter(([id])=>!['mbi-bear','ctba-bear'].includes(id));

describe('卖方负值口径',()=>{
 it.each(legacyPair)('%s 原值、两种均值逐位取负，绝对值、缺值及全部中间测量保持不变；升级幂等', (id,core)=>{
  const builtin=BUILTIN_FEATURES.find(d=>d.id===id)!,data=bars(),formula=averages(plain(builtin.formula),core);
  const legacy={...builtin,sellerSignVersion:undefined,formula}, migrated=mergeFeatureDefs([legacy]).find(d=>d.id===id)!;
  const old=evaluateOnBars(data,compileFeatureFormula(formula),legacy),out=evaluateOnBars(data,compileFeatureFormula(migrated.formula),migrated);
  for(const name of [core,`avg_${core}`,`avg_${core}_2`]) expect(Array.from(arr(out.vars.get(name),data.length))).toEqual(Array.from(arr(old.vars.get(name),data.length),v=>-v));
  const outputs=new Set([core,`avg_${core}`,`avg_${core}_2`]);
  for(const [name,x] of old.vars) if(!outputs.has(name))expect(out.vars.get(name)).toEqual(x);
  expect(mergeFeatureDefs([migrated]).find(d=>d.id===id)!.formula).toBe(migrated.formula);
  expect(sellerNegativeFormula(migrated.formula,core)).toBe(migrated.formula);
  expect(migrated.sellerSignVersion).toBe(1);
  const prefix=evaluateOnBars(data.slice(0,600),compileFeatureFormula(migrated.formula),migrated);
  for(const name of outputs)expect(arr(prefix.vars.get(name),600)).toEqual(arr(out.vars.get(name),data.length).slice(0,600));
 });
 it.each(legacyPair)('%s：> T 与 < −T 的捕捞逐根条件、预热、起点一致', (id,core)=>{
  const builtin=BUILTIN_FEATURES.find(d=>d.id===id)!,data=bars(),formula=averages(plain(builtin.formula),core);
  const oldDef={...builtin,sellerSignVersion:undefined,formula},newDef=mergeFeatureDefs([oldDef]).find(d=>d.id===id)!;
  for(const statistic of ['结果',core,`avg_${core}`,`avg_${core}_2`]){
   const old=compileFishProgram(oldDef,{statistic,direction:'>',threshold:.01,constraints:[]}),next=compileFishProgram(newDef,{statistic,direction:'<',threshold:-.01,constraints:[]});
   expect(next.N).toBe(old.N);expect(next.warm).toBe(old.warm);
   const a=evaluateFishProgram(data,old),b=evaluateFishProgram(data,next);
   expect(b.condition).toEqual(a.condition);expect(b.main).toEqual(a.main);
   const ca=classifyFishProgram('TESTUSDT',data,a,data.length*300000,old),cb=classifyFishProgram('TESTUSDT',data,b,data.length*300000,next);
   expect(cb.outcome).toBe(ca.outcome);expect(cb.signal?.timeMs).toBe(ca.signal?.timeMs);expect(cb.boundaryMs).toBe(ca.boundaryMs);
  }
 });
 it.each(legacyPair)('%s：已知假到真的越线起点在原值和两种均值上精确保留', (id,core)=>{
  const builtin=BUILTIN_FEATURES.find(d=>d.id===id)!;
  const data=bars(1000).map((b,i)=>{const close=i<970?1:2;return {...b,open:close,close,high:close+1,low:close/2}});
  const oldDef={...builtin,sellerSignVersion:undefined,formula:averages(`${core} = C`,core)},nextDef=mergeFeatureDefs([oldDef]).find(d=>d.id===id)!;
  for(const statistic of [core,`avg_${core}`,`avg_${core}_2`]){
   const before=compileFishProgram(oldDef,{statistic,direction:'>',threshold:1.05,constraints:[]}),after=compileFishProgram(nextDef,{statistic,direction:'<',threshold:-1.05,constraints:[]});
   const a=classifyFishProgram('TESTUSDT',data,evaluateFishProgram(data,before),300000000,before),b=classifyFishProgram('TESTUSDT',data,evaluateFishProgram(data,after),300000000,after);
   expect(a.outcome).toBe('hit');expect(b.outcome).toBe('hit');expect(b.signal!.timeMs).toBe(a.signal!.timeMs);
   expect(b.snapshot?.startAverage??b.signal!.fish!.startAverage).toBe(-(a.snapshot?.startAverage??a.signal!.fish!.startAverage));
  }
 });
 it('已保存的非线性均值和匿名结果也只翻一次符号，核心仍指向原始值',()=>{
  const f='DSS = C\navg_DSS = abs(DSS)\navg_DSS_2 = avg_DSS ^ 2',signed=sellerNegativeFormula(f,'DSS');
  const data=bars(5),a=evaluateOnBars(data,compileFeatureFormula(f)),b=evaluateOnBars(data,compileFeatureFormula(signed));
  for(const name of ['DSS','avg_DSS','avg_DSS_2'])expect(arr(b.vars.get(name),5)).toEqual(arr(a.vars.get(name),5).map(v=>-v));
  expect(featureCoreName(compileFeatureFormula(sellerNegativeFormula('DSS = C\navg_DSS = avg(DSS,24)','DSS')).program)).toBe('DSS');
  const anonymous=evaluateOnBars(data,compileFeatureFormula(sellerNegativeFormula('DSS = C\navg(DSS, 24) + 2','DSS')));
  expect(arr(anonymous.last,5)).toEqual(arr(evaluateOnBars(data,compileFeatureFormula('DSS = C\navg(DSS, 24) + 2')).last,5).map(v=>-v));
 });
 it.each(pair)('%s 旧偏好 / 卡片等价转换且不重置手动值，新设置读写不再翻转', (id,core)=>{
  const old={statistic:`avg_${core}_2`,direction:'>' as const,threshold:'3.7',lastSuggestion:'2.5',constraints:[]};
  localStorage.setItem(fishPreferenceKey(id),JSON.stringify(old));
  const converted=readFishPreference(id);expect(converted).toMatchObject({direction:'<',threshold:'-3.7',lastSuggestion:'-2.5',sellerSignVersion:1});
  saveFishPreference(id,converted);expect(readFishPreference(id)).toEqual(converted);
  localStorage.setItem(fishCardsKey(),JSON.stringify([{id:'a',featureId:id,enabled:true,pref:old}]));
  expect(readFishCards()[0].pref).toMatchObject({direction:'<',threshold:'-3.7'});
  expect(withFishDefaultThreshold(id,{...old,statistic:'F'})).toMatchObject({direction:'>',threshold:'3.7'});
  const adopted=withFishDefaultThreshold(id,{...old,statistic:'结果',threshold:'2.5',lastSuggestion:'2.5'});
  expect(adopted).toMatchObject({direction:'<',threshold:'-2.5',lastSuggestion:'-2.5'});
  expect(withFishDefaultThreshold(id,adopted)).toEqual(adopted);
 });
 it.each(pair)('%s 新增卡默认使用负门槛和 <；买方定义与偏好不变',id=>{
  expect(readFishPreference(id).direction).toBe('<');
  if (['seller-push', 'seller-control', 'mbi-bear', 'ctba-bear', 'mbi2-bear', 'ctba_12h-bear'].includes(id)) expect(readFishPreference(id).threshold).toBe('');
  else expect(Number(readFishPreference(id).threshold)).toBeLessThan(0);
  const buyer=BUILTIN_FEATURES.find(d=>d.id==='bss')!;expect(mergeFeatureDefs([buyer]).find(d=>d.id==='bss')!.formula).toBe(buyer.formula);
 });
});

it.each(['mbi-bear','ctba-bear'])('%s response v2 is already seller-negative and must not be sign-flipped on reload',id=>{
 const builtin=BUILTIN_FEATURES.find(d=>d.id===id)!;expect(mergeFeatureDefs([{...builtin,sellerSignVersion:undefined}]).find(d=>d.id===id)!.formula).toBe(builtin.formula);
});
