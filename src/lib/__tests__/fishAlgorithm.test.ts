import {it,expect} from 'vitest';
import {BUILTIN_FEATURES,compileFeatureFormula,evaluateOnBars} from '@/lib/deepDig/features';
import {compileFishProgram,evaluateFishProgram} from '@/lib/fish/algorithm';
import {mulberry32} from '@/lib/deepRsa/grouping';
import type {ResearchBar} from '@/lib/deepRsa/window';
export function fishBars(n:number):ResearchBar[]{const rand=mulberry32(812),step=300000;let p=100,btc=50000;return Array.from({length:n},(_,i)=>{const o=p;p*=Math.exp((rand()-.495)*.01);btc*=Math.exp((rand()-.5)*.004);const q=1e5*(.2+rand());return {openTime:(i+1)*step,open:o,close:p,high:Math.max(o,p)*1.002,low:Math.min(o,p)*.998,volume:q/p,quoteVolume:q,takerBuyQuoteVolume:q*(.1+.8*rand()),takerBuyVolume:null,refClose:btc};});}
for(const def of BUILTIN_FEATURES)it(`${def.id}:逐根同源且预热满足历史收敛`,{timeout:60000},()=>{
 const plan=compileFishProgram(def,{H:24,direction:'>',threshold:def.id==='cbi2'?.3:0,constraints:[]});console.info(def.id,plan.warm,plan.N,plan.unavailable);
 const bars=fishBars(plan.N+1000),small=bars.slice(1000),a=evaluateFishProgram(small,plan),long=evaluateFishProgram(bars,plan),original=evaluateOnBars(small,compileFeatureFormula(def.formula),def).last;
 for(let i=0;i<small.length;i++)expect(a.value[i]).toBe(typeof original==='number'?original:original[i]);
 for(let i=plan.warm-1;i<small.length;i++){const x=a.average[i],y=long.average[i+1000];if(Number.isFinite(x)&&Number.isFinite(y))expect(Math.abs(x-y)).toBeLessThanOrEqual(1e-6*Math.max(1,Math.abs(y)));else expect(Number.isFinite(x)).toBe(Number.isFinite(y));expect(a.condition[i]).toBe(long.condition[i+1000]);}
});

import {classifyFishProgram,constraintFingerprint,type FishAlgorithmSettings} from '@/lib/fish/algorithm';
import {CBI2_DEF,DRIFT_SPEED_DEF,featureWindowMs,intervalOf,halfLifeOf,avgHoursOf,type DeepDigFeatureDef} from '@/lib/deepDig/features';
import {programHistoryBars} from '@/lib/deepDig/formula';
const simple:DeepDigFeatureDef={...CBI2_DEF,id:'custom',name:'自定义',short:'Z',formula:'v = C\nv',scale:1,unit:'点'};
const config=(constraints:string[]=[],patch:Partial<FishAlgorithmSettings>={}):FishAlgorithmSettings=>({H:1/12,direction:'>',threshold:100,constraints:constraints.map((text,i)=>({id:String(i),text,enabled:true})),...patch});
it('合成条件的起点取交集第一根，截止约束为假时计挡下，并记录起点与截止逐条读数',()=>{
 const plan=compileFishProgram(simple,config(['B > 50'])),bars=fishBars(plan.N).map((b,i)=>({...b,close:i<plan.N-10?99:101,takerBuyQuoteVolume:i<plan.N-5?40:60}));
 const r=evaluateFishProgram(bars,plan),first=classifyFishProgram('AAAUSDT',bars,r,bars.at(-1)!.openTime+plan.step,plan);expect(first.outcome).toBe('hit');expect(first.signal!.timeMs).toBe(bars.at(-5)!.openTime+plan.step);expect(first.signal!.fish).toMatchObject({startConstraints:[1],cutoffConstraints:[1],featureId:'custom',direction:'>'});
 bars.at(-1)!.takerBuyQuoteVolume=40;const blocked=classifyFishProgram('AAA',bars,evaluateFishProgram(bars,plan),0,plan);expect(blocked).toMatchObject({outcome:'blocked',blockedBy:[1]});
});
it('向后移动截止节点，完整条件仍为真时保持同一起点；等于阈值与持续高位不入库',()=>{
 const plan=compileFishProgram(simple,config()),bars=fishBars(plan.N+3).map((b,i)=>({...b,close:i<plan.N-10?99:101}));
 const a=classifyFishProgram('A',bars.slice(0,-3),evaluateFishProgram(bars.slice(0,-3),plan),0,plan),b=classifyFishProgram('A',bars.slice(3),evaluateFishProgram(bars.slice(3),plan),0,plan);expect(a.signal?.timeMs).toBe(b.signal?.timeMs);
 bars.forEach(b=>b.close=100);expect(classifyFishProgram('A',bars,evaluateFishProgram(bars,plan),0,plan).outcome).toBe('below');bars.forEach(b=>b.close=101);expect(classifyFishProgram('A',bars,evaluateFishProgram(bars,plan),0,plan).outcome).toBe('unknown');
});
it('除零约束：截止未知为读数不全，回溯撞到未知为起点不明；禁用约束不求值、不入指纹',()=>{
 const plan=compileFishProgram(simple,config(['1 / (B - 50) > 0'])),bars=fishBars(plan.N).map((b,i)=>({...b,close:101,takerBuyQuoteVolume:i<plan.N-5?50:60}));
 expect(classifyFishProgram('A',bars,evaluateFishProgram(bars,plan),0,plan).outcome).toBe('unknown');bars.at(-1)!.takerBuyQuoteVolume=50;expect(classifyFishProgram('A',bars,evaluateFishProgram(bars,plan),0,plan).outcome).toBe('readings');
 const disabled=compileFishProgram(simple,{...config(),constraints:[{id:'x',text:'不存在 / 0',enabled:false}]});expect(disabled.constraintNames).toHaveLength(0);expect(disabled.constraintKey).toBe(constraintFingerprint([]));
});
it('显示倍率、严格下穿与未命名结果；X保留显示单位而同名公式变量不被覆盖',()=>{
 const def={...simple,scale:1e4,formula:'X = C\nC'},plan=compileFishProgram(def,config(['X > 5'],{threshold:5}));
 expect(plan.settings.threshold/plan.def.scale).toBe(5e-4);const bars=fishBars(plan.N).map((b,i)=>({...b,close:i<plan.N-5?.0005:.0006}));
 expect(classifyFishProgram('A',bars,evaluateFishProgram(bars,plan),0,plan).signal?.timeMs).toBe(bars.at(-5)!.openTime+plan.step);
 const down=compileFishProgram(simple,config([],{direction:'<'}));bars.forEach((b,i)=>b.close=i<bars.length-5?100:99);expect(classifyFishProgram('A',bars,evaluateFishProgram(bars,down),0,down).outcome).toBe('hit');
});
it('完整程序的ago均值约束增加warm，所有定义参数都沿用Deep dig；超5000根给出原因',()=>{
 const base=compileFishProgram(simple,config([],{H:1/12})),long=compileFishProgram(simple,config(['avg(X,600) > ago(avg(X,600),600)'],{H:1/12}));expect(long.warm).toBeGreaterThan(base.warm);expect(long.unavailable).toContain('5000');
 const withAgo=compileFishProgram({...simple,formula:'avg(C,48)'},config(['avg(X,3) > ago(avg(X,3),3)']));const plain=compileFishProgram({...simple,formula:'avg(C,48)'},config());expect(withAgo.warm).toBeGreaterThan(plain.warm);
 const def={...simple,interval:'15m' as const,halfLifeHours:3,avgHours:8,formula:'avg(C,avgh) + ema(C,hl)'};const plan=compileFishProgram(def,config()),bars=fishBars(plan.N);const own=evaluateFishProgram(bars,plan),native=evaluateOnBars(bars,compileFeatureFormula(def.formula),def).last as Float64Array;expect([...own.value]).toEqual([...native]);expect(plan.step).toBe(900000);
 expect(()=>compileFishProgram(simple,config([],{threshold:Infinity}))).toThrow();expect(()=>compileFishProgram(simple,config(['other_feature > 0']))).toThrow();expect(compileFishProgram(simple,config([],{H:0})).algorithmKey).toBe(compileFishProgram(simple,config([],{H:24})).algorithmKey);expect(compileFishProgram(simple,config([],{threshold:1234})).settings.threshold).toBe(1234);
});
it('只有整个程序真正引用CB才需要BTC，约束可引入BTC，禁用的引用不取',()=>{
 expect(compileFishProgram(simple,config()).compiled.usesBtc).toBe(false);expect(compileFishProgram(simple,config(['CB > 0'])).compiled.usesBtc).toBe(true);expect(compileFishProgram(simple,{...config(),constraints:[{id:'x',text:'CB>0',enabled:false}]}).compiled.usesBtc).toBe(false);
});
it('启用ago约束后的整个程序也满足N和N+1000的平均读数及C序列收敛',()=>{
 const def={...simple,formula:'avg(C,48)'},plan=compileFishProgram(def,config(['avg(X,3)>ago(avg(X,3),3)'])),all=fishBars(plan.N+1000),short=evaluateFishProgram(all.slice(1000),plan),long=evaluateFishProgram(all,plan);
 for(let i=plan.warm-1;i<plan.N;i++){expect(Math.abs(short.average[i]-long.average[i+1000])).toBeLessThanOrEqual(1e-6*Math.max(1,Math.abs(long.average[i+1000])));expect(short.condition[i]).toBe(long.condition[i+1000]);}
});
// 【用户要求】2026-10-19「把渔这里的最外层的 avg 算法去除」：公式里写 avg_CBI2 = avg(CBI2, 24) 再选它，与原来「CBI2 外层 avg 24h」一致
it('去掉外层avg：选公式里的 avg(CBI2,24) 与原2000根实现的24小时均值一致；选「结果」= 最后一句同一个量',async()=>{
 const {calculateFishReadings}=await import('@/lib/fishScanner');const def={...CBI2_DEF,formula:`${CBI2_DEF.formula}\navg_CBI2 = avg(CBI2, 24)`};
 const all=fishBars(4000),legacy=calculateFishReadings(all.slice(-2000));
 for(const statistic of ['avg_CBI2','结果']){const plan=compileFishProgram(def,{statistic,direction:'>',threshold:.3,constraints:[]}),now=evaluateFishProgram(all.slice(-plan.N),plan);expect(Math.abs(now.average.at(-1)!-legacy.average.at(-1)!)).toBeLessThan(1e-9);expect(now.main.at(-1)).toBe(legacy.average.at(-1)!>.3?1:0);}
 // 选 CBI2 本身：直接比较当根读数，不再取均值
 const raw=compileFishProgram(def,{statistic:'CBI2',direction:'>',threshold:.3,constraints:[]}),r=evaluateFishProgram(all.slice(-raw.N),raw);expect(r.average.at(-1)).toBe(r.value.at(-1));expect(Math.abs(r.value.at(-1)!-legacy.cbi2.at(-1)!)).toBeLessThan(1e-9);
});
it('C只由主条件与启用约束组成：核心值缺失但公式里的滚动均值仍有限时，不隐式添加当前值条件',()=>{
 const d={...simple,formula:'v = if(B > 0, C, 0/0)\nm = avg(v, 1)'},plan=compileFishProgram(d,config([],{H:1})),bars=fishBars(plan.N).map(b=>({...b,close:101,takerBuyQuoteVolume:1}));bars.at(-1)!.takerBuyQuoteVolume=0;
 const result=evaluateFishProgram(bars,plan);expect(Number.isFinite(result.average.at(-1)!)).toBe(true);expect(result.main.at(-1)).toBe(1);expect(result.condition.at(-1)).toBe(1);
 const constrained=compileFishProgram(d,config(['X > 0'],{H:1}));expect(Number.isNaN(evaluateFishProgram(bars,constrained).condition.at(-1)!)).toBe(true);
});
