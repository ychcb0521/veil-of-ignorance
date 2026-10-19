import {beforeEach,it,expect,vi} from 'vitest';
import {CBI2_DEF,compileFeatureFormula,evaluateOnBars} from '@/lib/deepDig/features';
import {fishStatistics,compileFishProgram,evaluateFishProgram,classifyFishProgram} from '@/lib/fish/algorithm';
import {migrateFishSignal,mergeFishSignals} from '@/lib/fish/records';
import type {TradeSignal} from '@/lib/signalLibrary';
import {readFishPreference,saveFishPreference} from '@/lib/fish/preferences';
const def={...CBI2_DEF,id:'stat-test',formula:'n = 2 # 固定根数\nk = n * 3\nfixed = avg(k, 1)\nV = Q # 成交额（USDT）\ncopy = V / n # 成交额的一半\nC',scale:10000,unit:'基点'};
const settings={H:1/12,direction:'>' as const,threshold:100,constraints:[{id:'x',text:'X > 5',enabled:true}]};
const bars=(n:number)=>Array.from({length:n},(_,i)=>({openTime:(i+1)*300000,open:.001,high:.002,low:.0001,close:.001,volume:1,quoteVolume:i<n-3?100:200,takerBuyQuoteVolume:50,takerBuyVolume:null}));
beforeEach(()=>localStorage.clear());
it('命名序列和行注释进入选项，直接常数、常数别名及常数函数不列',()=>{
 expect(fishStatistics(def)).toEqual([{name:'结果',label:'avg（结果）'},{name:'V',label:'V · 成交额（USDT）'},{name:'copy',label:'copy · 成交额的一半'}]);
});
it('中间量逐根等于evaluateOnBars，平均按选中序列，X仍按结果显示单位；起点和快照使用新统计量',()=>{
 const plan=compileFishProgram(def,{...settings,statistic:'V'}),source=bars(plan.N),out=evaluateFishProgram(source,plan),native=evaluateOnBars(source,compileFeatureFormula(def.formula),def);
 expect([...out.value]).toEqual([...(native.vars.get('V') as Float64Array)]);expect([...out.average]).toEqual([...out.value]);expect(plan.scale).toBe(1);expect(plan.unit).toBe('原值');expect(out.constraints[0].at(-1)).toBe(1);
 const hit=classifyFishProgram('AAAUSDT',source,out,0,plan);expect(hit.signal?.fish).toMatchObject({statistic:'V',thresholdRaw:100,scale:1,unit:'原值'});expect(hit.signal?.timeMs).toBe(source.at(-3)!.openTime+300000);
 const result=compileFishProgram(def,{...settings,statistic:'结果'});expect(result.scale).toBe(10000);expect(result.algorithmKey).not.toBe(plan.algorithmKey);
 expect(()=>compileFishProgram(def,{...settings,statistic:'n'})).toThrow('不是序列');expect(()=>compileFishProgram(def,{...settings,statistic:'removed'})).toThrow();
});
it('选中中间量后整个程序重算warm，约束和更长平均时长继续增加历史依赖',()=>{
 const v=compileFishProgram(def,{...settings,statistic:'V'}),long=compileFishProgram(def,{...settings,statistic:'copy',H:48,constraints:[{id:'a',enabled:true,text:'avg(X,48)>ago(avg(X,48),48)'}]});expect(long.warm).toBeGreaterThan(v.warm);
});
it('旧鱼按结果迁移，重复迁移不增项；不同统计量同一标的时刻各一条，选择按特征值记住',()=>{
 const old:TradeSignal={id:'a',symbol:'AAAUSDT',timeMs:1000,timeLabel:'',fallbackZone:'',fish:{average:1,cbi2:2,startAverage:1,previousAverage:0,threshold:.3,cutoffMs:1000}};
 const migrated=migrateFishSignal(old);expect(migrated.fish?.statistic).toBe('结果');expect(migrateFishSignal(migrated)).toEqual(migrated);expect(mergeFishSignals([migrated],[old,{...old,fish:{...old.fish!,statistic:'V'}}])).toHaveLength(2);
 saveFishPreference('stat-test',{statistic:'V',H:'12',direction:'<',threshold:'2',constraints:[]});expect(readFishPreference('stat-test').statistic).toBe('V');expect(readFishPreference('cbi2').statistic).toBe('结果');
});

it('规则保留远端的真实结果变量名；选择中间量时写出中间量和原值单位',async()=>{
 const {fishRuleText}=await import('@/lib/fishRule');expect(fishRuleText(CBI2_DEF,24,'>',.3)).toBe('avg(CBI2, 24h) > 0.3');expect(fishRuleText({...CBI2_DEF,unit:'基点'},24,'>',5,0,'V')).toBe('avg(V, 24h) > 5 原值');
});

it('兼容最新单币诊断：所选中间量用原值显示，和捕捞同一主条件',async()=>{
 const {FishScanner}=await import('@/lib/fishScanner'),cut=Date.UTC(2026,5,20),market={symbol:'AAAUSDT',instrument:'AAAUSDT',base:'AAA',multiplier:1};
 const adapter={exchange:'binance' as const,list:async()=>[market],btc:()=>market,candles:async(_m,c,_s,q)=>bars(q.count).map((b,i)=>({...b,openTime:c-(q.count-i)*300000})),taker:async(_m,b)=>b};
 const scanner=new FishScanner(vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+300000}))) as typeof fetch,undefined,undefined,{binance:adapter});const out=await scanner.diagnose({symbol:'AAA',feature:def,algorithm:{...settings,statistic:'V'},anchorMs:cut,signal:new AbortController().signal});expect(out.outcome).toBe('hit');expect(out.lines[1]).toContain('avg(V, 0.08333333333333333h) 截止时 = 200.0000');
});

it('共享核心默认只套一次avg；显式尾部中间量和引用尾部变量的约束仍按原公式求值',()=>{
 const d={...def,formula:'V = C\nmean = avg(V, 72)'},a=compileFishProgram({...d,formula:'V = C'},{...settings,constraints:[]}),core=compileFishProgram(d,{...settings,constraints:[]}),middle=compileFishProgram(d,{...settings,statistic:'mean',constraints:[{id:'q',enabled:true,text:'mean > 0'}]});expect(core.N).toBe(a.N);expect(core.resultName).toBe('V');const source=bars(middle.N);const expected=evaluateOnBars(source,compileFeatureFormula(d.formula),d).vars.get('mean');expect([...evaluateFishProgram(source,middle).value]).toEqual([...(expected as Float64Array)]);expect(middle.warm).toBeGreaterThan(core.warm);
});
