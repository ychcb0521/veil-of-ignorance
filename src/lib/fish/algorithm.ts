/** Fishing composes a program; all numerical evaluation stays in Deep dig's engine. */
import { compileFeatureFormula, evaluateOnBars, featureWindowMs, intervalOf, halfLifeOf, avgHoursOf, definitionKey, SERIES_VARIABLES, PARAM_VARIABLES, type DeepDigFeatureDef, type CompiledFeature } from '@/lib/deepDig/features';
import { parseFormula, programHistoryBars, evaluateProgram, type Program, type Value } from '@/lib/deepDig/formula';
import { intervalMs } from '@/lib/deepRsa/marketData';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { TradeSignal } from '@/lib/signalLibrary';
import { coreProgram, featureCoreName } from '@/lib/featureSource';
import { formatUTC8 } from '@/lib/timeFormat';
export interface FishConstraint { id: string; text: string; enabled: boolean }
/**
 * 一套捕捞算法：所选序列 statistic 直接与阈值比较（不再在外面套 avg）。
 * 【用户要求】2026-10-19：「去除最外层的 avg」——要均值就在 Deep dig 公式里写一行（如 avg_CBI2 = avg(CBI2, 24)）再选它，
 * 与原来「选 CBI2、外层 avg 24h」逐位相同，且不会再出现「均值的均值」。H 只为读旧设置保留，不参与计算。
 */
export interface FishAlgorithmSettings { statistic?: string; /** @deprecated 旧版外层 avg 的小时数，已不参与计算 */ H?: number; direction: '>' | '<'; threshold: number; constraints: FishConstraint[] }
export const FISH_PRESETS = [
  { name: '多周期为正', lines: [24,12,6,3,1].map(h=>`avg(X,${h}) > 0`) },
  { name: '短期强于长期', lines: ['avg(X,1)>=avg(X,3) and avg(X,3)>=avg(X,6) and avg(X,6)>=avg(X,12) and avg(X,12)>=avg(X,24)'] },
  { name: '正值占比', lines: ['avg(X > 0, 6) >= 0.7'] },
  { name: '均值上行', lines: ['avg(X,3) > ago(avg(X,3),3)'] },
  { name: '当前值为正', lines: ['X > 0'] },
  { name: '成交额门槛', lines: ['rsum(Q, 24) >= 20000000'] },
];
export const normalizeConstraint = (s: string) => s.trim().replace(/\s+/g,' ');
export function shortFishHash(text: string): string {
  let a=2166136261,b=5381;
  for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
  return `${(a>>>0).toString(36)}${(b>>>0).toString(36)}`;
}
export const constraintFingerprint = (texts: readonly string[]) => shortFishHash(texts.map(normalizeConstraint).join(';'));
/** 旧记录（外层 avg H 小时）键里第三段是 H；现在没有外层 avg，第三段写「=」，两种口径的记录不会互相去重。 */
export const fishAlgorithmKey = (id: string,H: number|undefined,direction: string,threshold: number,key: string,statistic = '结果') => `${id}|${statistic}|${H===undefined?'=':H}|${direction}|${threshold}|${key}`;
export interface FishStatistic { name: string; label: string }
/** The evaluator preserves scalar/series types, including aliases and scalar function calls. */
export function fishStatistics(def: DeepDigFeatureDef): FishStatistic[] {
  const base=compileFeatureFormula(def.formula), vars=evaluateOnBars([],base,def).vars,lines=def.formula.split(/\r?\n/);
  const named=new Map<string,string>();
  for(const st of base.program.statements)if(st.name&&st.name!=='结果'&&vars.get(st.name) instanceof Float64Array){
    const comment=lines[st.line-1]?.split('#').slice(1).join('#').trim();
    named.set(st.name,comment?`${st.name} · ${comment}`:st.name);
  }
  const lastName=base.program.statements.at(-1)?.name;
  return [{name:'结果',label:lastName&&lastName!=='结果'?`结果 · ${lastName}`:'结果'},...Array.from(named,([name,label])=>({name,label}))];
}
type Node = Program['statements'][number]['expr'];
const renameX = (n: Node,name: string): Node => n.k==='var'&&n.name==='X'?{...n,name}:n.k==='un'?{...n,a:renameX(n.a,name)}:n.k==='bin'?{...n,a:renameX(n.a,name),b:renameX(n.b,name)}:n.k==='call'?{...n,args:n.args.map(a=>renameX(a,name))}:n;
export function parseFishConstraint(def: DeepDigFeatureDef,text: string): Program {
  const base=compileFeatureFormula(def.formula);
  const known=new Set([...SERIES_VARIABLES.map(v=>v.name),...PARAM_VARIABLES.flatMap(p=>[p.name,p.alias]),...base.program.statements.flatMap(s=>s.name?[s.name]:[]),'X']);
  if(/[\r\n]/.test(text))throw new Error('每条约束只能写一行布尔式');
  const p=parseFormula(text,known);
  if(p.statements.length!==1||p.statements[0].name!==null)throw new Error('请写一条条件式，不要赋值或引用其他特征值');
  return p;
}
/** EMA / Wilder have infinite memory. Add a conservative convergence tail ONLY for fishing history planning.
 * The evaluated program and Deep dig formulas are never changed. 32 half-lives leaves < 2.4e-10 seed weight.
 */
function convergenceHistory(program: Program,params: Record<string,number>,minutes: number): number {
  const constants:Record<string,Value>={...params},history=new Map<string,number>();
  const isConstant=(n:Node):boolean=>n.k==='num'||(n.k==='var'?Number.isFinite(constants[n.name] as number):n.k==='un'?isConstant(n.a):n.k==='bin'?isConstant(n.a)&&isConstant(n.b):n.args.every(isConstant));
  const scalar=(expr:Node)=>{if(!isConstant(expr))return NaN;try{const v=evaluateProgram({statements:[{name:null,expr,line:1}],inputs:new Set()},constants,{barMinutes:minutes});return typeof v==='number'?v:NaN;}catch{return NaN;}};
  const depth=(n:Node):number=>{
    if(n.k==='num')return 0;if(n.k==='var')return history.get(n.name)??0;
    if(n.k==='un')return depth(n.a);if(n.k==='bin')return Math.max(depth(n.a),depth(n.b));
    const inherited=Math.max(0,...n.args.map(depth)),arg=(i:number,fallback=NaN)=>n.args[i]?scalar(n.args[i]):fallback;
    const hours=(i:number,fallback=NaN)=>Math.max(1,Math.ceil(arg(i,fallback)*60/minutes));
    let extra=0;
    if(['avg','sd','median','mad','rscale','zscore','rsum'].includes(n.name))extra=hours(1)-1;
    else if(['full','peak','sma','sum','highest','lowest','msum'].includes(n.name))extra=arg(1)-1;
    else if(n.name==='wsum')extra=arg(2)-1;
    else if(n.name==='prev')extra=arg(1,1);
    else if(n.name==='ago')extra=hours(1);
    else if(n.name==='beta')extra=hours(2)-1;
    else if(n.name==='retain')extra=hours(4,48)-1;
    else if(n.name==='ema')extra=32*hours(1);
    else if(n.name==='atr'){const size=arg(3);extra=size+(size===1?0:Math.ceil(32*-Math.LN2/Math.log1p(-1/size)));}
    if(!Number.isFinite(extra))throw new Error(`${n.name} 的窗口或平滑参数必须是固定的有限数字`);
    return inherited+Math.max(0,Math.ceil(extra));
  };
  let maximum=0;
  for(const st of program.statements){const d=depth(st.expr);maximum=Math.max(maximum,d);if(st.name){history.set(st.name,d);constants[st.name]=scalar(st.expr);}}
  return maximum;
}
export interface FishProgram {
  usesTaker: boolean; def: DeepDigFeatureDef; settings: FishAlgorithmSettings; compiled: CompiledFeature;
  resultName: string; statisticName: string; scale: number; unit: string; averageName: string; mainName: string; constraintNames: string[];
  texts: string[]; constraintKey: string; algorithmKey: string; warm: number; N: number; step: number; unavailable?: string;
}
export function compileFishProgram(def: DeepDigFeatureDef,settings: FishAlgorithmSettings): FishProgram {
  if(!Number.isFinite(settings.threshold))throw new Error('请填写有限数字阈值');
  if(!['>','<'].includes(settings.direction))throw new Error('方向只能选择 > 或 <');
  if(!(Number.isFinite(def.scale)&&def.scale>0))throw new Error('特征值显示倍率必须是有限正数');
  const statistic=settings.statistic??'结果',scale=statistic==='结果'?def.scale:1,unit=statistic==='结果'?def.unit:'原值';
  if(!fishStatistics(def).some(v=>v.name===statistic))throw new Error('所选统计量已不存在或不是序列，请重新选择');
  if(!Number.isFinite(settings.threshold/scale))throw new Error('换算后的阈值超出有效范围');
  const {H:_legacyH,...rest}=structuredClone(settings);
  const frozen=structuredClone(def), config:FishAlgorithmSettings={...rest,statistic}, full=compileFeatureFormula(frozen.formula);
  // Preserve the shared core by default, while explicitly selected/named constraint series remain available.
  const needed=new Set([statistic,...config.constraints.filter(c=>c.enabled).flatMap(c=>[...parseFishConstraint(frozen,c.text).inputs].filter(n=>n!=='X'))]);
  let end=coreProgram(full.program).statements.length;
  full.program.statements.forEach((s,i)=>{if(s.name&&needed.has(s.name))end=Math.max(end,i+1);});
  // 「结果」= 公式最后一句（与 Deep dig 的结果同一个量，末尾写了均值行就是那条均值）
  if(statistic==='结果')end=full.program.statements.length;
  const base={...full,program:{...full.program,statements:full.program.statements.slice(0,end)}};
  const used=new Set([...base.program.inputs,...base.program.statements.flatMap(s=>s.name?[s.name]:[])]);
  const name=(hint:string)=>{let n=hint;while(used.has(n))n+='_' ;used.add(n);return n;};
  const resultName=name('__result'),displayName=name('__X'),averageName=name('__A'),mainName=name('__main');
  const statements=base.program.statements.map(s=>({...s}));
  const last=statements.at(-1);if(!last)throw new Error('特征值公式不能为空');
  // 约束里的 X = 核心值的显示值（公式末尾的纯均值行如 avg_CBI2 = avg(CBI2, 24) 之前那个量），与 K 线图同一条规则
  let result=featureCoreName(full.program);
  if(!result){last.name=resultName;result=resultName;}
  if(statistic==='结果'&&!last.name)last.name=resultName;
  const known=new Set([...SERIES_VARIABLES.map(v=>v.name),...PARAM_VARIABLES.flatMap(p=>[p.name,p.alias]),...used]);
  const statisticName=statistic==='结果'?last.name!:statistic;
  // 主条件：所选序列本身与阈值比较；__A 只是它的别名（快照里的 average 字段沿用旧名）
  const tail=parseFormula(`${displayName} = ${result} * ${def.scale}\n${averageName} = ${statisticName}\n${mainName} = ${averageName} ${settings.direction} ${settings.threshold/scale}`,known);
  const inputs=new Set([...base.program.inputs,...tail.inputs].filter(n=>!used.has(n)));
  const enabled=config.constraints.filter(c=>c.enabled),texts=enabled.map(c=>normalizeConstraint(c.text));
  const constraintNames=enabled.map(c=>{
    const p=parseFishConstraint(frozen,c.text),n=name('__c'+used.size);
    for(const input of p.inputs)if(input!=='X'&&!used.has(input))inputs.add(input);
    tail.statements.push({name:n,expr:renameX(p.statements[0].expr,displayName),line:1});return n;
  });
  // Include original external inputs even when their name is also assigned inside a formula.
  for(const input of base.program.inputs)inputs.add(input);
  const program:Program={statements:[...statements,...tail.statements],inputs};
  const compiled={program,usesAmounts:[...inputs].some(n=>['Q','B','S','E'].includes(n)),usesBtc:inputs.has('CB')};
  evaluateOnBars([],compiled,frozen);
  const step=intervalMs(intervalOf(frozen)), params={hl:halfLifeOf(frozen),半衰期:halfLifeOf(frozen),avgh:avgHoursOf(frozen),平均时长:avgHoursOf(frozen)};
  const windowDef=end<full.program.statements.length?{...frozen,formula:frozen.formula.split(/\r?\n/).slice(0,full.program.statements[end-1].line).join('\n')}:frozen;
  const warm=Math.max(programHistoryBars(program,params,step/60000)+1,Math.ceil(featureWindowMs(windowDef)/step),convergenceHistory(program,params,step/60000)+1);
  const N=warm+546, constraintKey=constraintFingerprint(texts);
  return {usesTaker:inputs.has('B')||inputs.has('S'),def:frozen,settings:config,compiled,resultName:result,statisticName,scale,unit,averageName,mainName,constraintNames,texts,constraintKey,algorithmKey:fishAlgorithmKey(frozen.id,undefined,settings.direction,settings.threshold,constraintKey,statistic),warm,N,step,unavailable:!Number.isFinite(N)||N>5000?`需要 ${N} 根历史（含平滑收敛预热），超过 5000 根上限，暂不可扫`:undefined};
}
export interface FishValues { value: Float64Array; average: Float64Array; main: Float64Array; constraints: Float64Array[]; condition: Float64Array }
export function evaluateFishProgram(bars: readonly ResearchBar[],plan: FishProgram): FishValues {
  const out=evaluateOnBars(bars,plan.compiled,plan.def),n=bars.length;
  const series=(name:string)=>{const x=out.vars.get(name)??NaN;return typeof x==='number'?new Float64Array(n).fill(x):x;};
  const value=series(plan.statisticName),average=series(plan.averageName),main=series(plan.mainName),constraints=plan.constraintNames.map(series);
  const condition=Float64Array.from(main,(m,i)=>!Number.isFinite(m)||!Number.isFinite(average[i])||constraints.some(c=>!Number.isFinite(c[i]))?NaN:m!==0&&constraints.every(c=>c[i]!==0)?1:0);
  return {value,average,main,constraints,condition};
}
export interface FishSnapshot {
  algorithms?: FishSnapshot[]; intersectionStart?: number; outcome?: string; boundaryMs?: number;
  average: number; cbi2: number; startAverage: number; previousAverage: number; cutoffMs: number; threshold: number;
  statistic?: string; featureId?: string; featureName?: string; featureShort?: string; definitionKey?: string; interval?: string; H?: number; direction?: '>'|'<'; thresholdRaw?: number; scale?: number; unit?: string;
  constraints?: string[]; constraintKey?: string; algorithmKey?: string; value?: number; startIndex?: number; cutoffIndex?: number; startConstraints?: number[]; cutoffConstraints?: number[];
}
export function classifyFishProgram(symbol:string,bars:readonly ResearchBar[],r:FishValues,cutoffMs:number,plan:FishProgram): {outcome:'hit'|'below'|'blocked'|'unknown'|'readings';signal?:TradeSignal;snapshot?:FishSnapshot;boundaryMs?:number;blockedBy?:number[]} {
  const end=bars.length-1,first=plan.warm-1;
  if(end<first||r.condition.length!==bars.length||!Number.isFinite(r.condition[end]))return {outcome:'readings'};
  if(!r.main[end])return {outcome:'below'};
  if(!r.condition[end])return {outcome:'blocked',blockedBy:r.constraints.map(c=>c[end]===0?1:0)};
  let k=end;
  let unknown=false;
  while(k>first){const previous=r.condition[k-1];if(!Number.isFinite(previous)){unknown=true;break;}if(!previous)break;k--;}
  unknown ||= k===first;
  const {def,settings}=plan,timeMs=bars[k].openTime+plan.step;
  const fish:FishSnapshot={statistic:settings.statistic??'结果',featureId:def.id,featureName:def.name,featureShort:def.short,definitionKey:definitionKey(def),interval:intervalOf(def),direction:settings.direction,threshold:settings.threshold,thresholdRaw:settings.threshold/plan.scale,scale:plan.scale,unit:plan.unit,constraints:plan.texts,constraintKey:plan.constraintKey,algorithmKey:plan.algorithmKey,average:r.average[end],value:r.value[end],cbi2:r.value[end],startAverage:r.average[k],previousAverage:r.average[k-1],cutoffMs,startIndex:k,cutoffIndex:end,startConstraints:r.constraints.map(c=>c[k]?1:0),cutoffConstraints:r.constraints.map(c=>c[end]?1:0)};
  if(unknown)return {outcome:'unknown',boundaryMs:timeMs,snapshot:{...fish,outcome:'unknown',boundaryMs:timeMs,startIndex:undefined,startAverage:NaN,previousAverage:NaN}};
  return {outcome:'hit',signal:{id:`fish-${symbol}-${timeMs}-${encodeURIComponent(plan.algorithmKey)}`,symbol,timeMs,timeLabel:formatUTC8(timeMs),fallbackZone:'',fish}};
}
