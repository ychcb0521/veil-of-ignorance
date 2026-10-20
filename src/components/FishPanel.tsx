import {readPersistedStateRaw,writePersistedStateRaw} from '@/lib/persistedStateStorage';
import { FishReconstructionResults } from './FishReconstruction';
import type { FishReconstructionState } from '@/hooks/useFishReconstruction';
import {FishAlgorithmCard,RECORDED_RANGES,type FishCard} from './FishAlgorithmCard';
import {getUserPrefix} from '@/lib/userStoragePrefix';
import { useFishFeatures } from '@/hooks/useFishFeatures';
import {compileFishProgram,type FishProgram} from '@/lib/fish/algorithm';
import {readFishPreference,saveFishPreference,type FishPreference} from '@/lib/fish/preferences';
import { fishRuleText } from '@/lib/fishRule';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AUDITED_EXCHANGES, EXCHANGE_NAMES, type FishExchange } from '@/lib/fish/exchanges';
import { CircleHelp, Search, SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TradeSignal } from '@/lib/signalLibrary';
import { parseFishSettings, type FishScanSettings, type FishProgress, type FishDiagnosis } from '@/lib/fishScanner';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { FishAlgorithmSettings } from '@/lib/fish/algorithm';
import { formatUTC8 } from '@/lib/timeFormat';
import { FishLibrary } from '@/components/FishLibrary';

import {fishSuggestionKey,readFishSuggestion,latestFishSuggestion,saveFishSuggestion,suggestedFishThreshold,mayFillFishThreshold,fishSuggestionTitle,type FishSuggestion,type FishSuggestionOptions,type FishSuggestionProgress} from '@/lib/fish/suggestions';

export interface FishPanelProps {
  reconstruction?: FishReconstructionState;
  /** 查单个币：与捕捞同一套取数与判定，说明命中 / 没命中的原因。 */
  onDiagnose?: (options: { symbol: string; exchange?: FishExchange; anchorMs?: number; feature?: DeepDigFeatureDef; algorithm?: FishAlgorithmSettings; algorithms?: import('@/lib/fish/intersection').FishAlgorithmInput[]; combination?: 'and'|'or'; signal: AbortSignal }) => Promise<FishDiagnosis>;
  librarySignals?: TradeSignal[];
  onSuggest?: (options:FishSuggestionOptions)=>Promise<FishSuggestion>;
  signals: TradeSignal[]; progress: FishProgress | null;
  inputs: { time: string; threshold: string }; onInputsChange: (value: { time: string; threshold: string }) => void;
  selection: { exchanges: FishExchange[]; includeDuplicates: boolean; includeUsStocks?: boolean }; onSelectionChange: (value: { exchanges: FishExchange[]; includeDuplicates: boolean; includeUsStocks?: boolean }) => void;
  onStart: (settings: FishScanSettings) => void; onCancel: () => void; onAdd: (target?: string | readonly string[]) => void;
  onJump: (id: string) => void; onDelete: (id: string) => void; onRate: (id: string, value: number) => void;
  jumpingSignalId: string | null; tradedDayIndex: Set<string>; campaignDayIndex: Set<string>;
}
/**
 * 【用户要求】2026-10-19「渔这里，界面要简单一点，只用显示命中以及加载进度，其他的都折叠收起来，用非常隐形的符号做入口」：
 * 平时只有一行设置 + 一行「状态 · 命中 · 进度」；交易所勾选收在淡色滑杆图标后（展开状态记在这次浏览里）。
 * 2026-10-19 用户又要求删掉进度旁的「›」明细入口：各家计数与跳过原因不再显示，只在整次扫描失败时写出报错。
 */
const cardsKey=()=>`${getUserPrefix()}fish-cards.v1`;
function readCards():FishCard[]{try{const x=JSON.parse(readPersistedStateRaw(cardsKey())??'[]');return Array.isArray(x)?x.filter(c=>c&&typeof c.id==='string'&&typeof c.featureId==='string'&&typeof c.enabled==='boolean'&&c.pref&&Array.isArray(c.pref.constraints)).slice(0,6).map(c=>({...c,pref:{...c.pref,constraints:[]}})):[];}catch{return [];}}
const cleanPreference=(p:FishPreference):FishPreference=>({...p,constraints:[]});
const OPEN_KEY = 'veil.fish.open';
function readOpen(): { scope: boolean; detail: boolean; probe: boolean } {
  try { const v = JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? '{}'); return { scope: !!v.scope, detail: !!v.detail, probe: !!v.probe }; } catch { return { scope: false, detail: false, probe: false }; }
}
const faint = 'rounded p-1 text-muted-foreground/40 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const STATUS: Record<FishProgress['status'], string> = { running: '捕捞中', complete: '捕捞完成', cancelled: '已取消', aborted: '已中止', skipped: '已跳过' };

export function FishPanel(p: FishPanelProps) {
  const [error,setError]=useState(''),defs=useFishFeatures();
  const [open, setOpenState] = useState(readOpen);
  const setOpen = (patch: Partial<{ scope: boolean; detail: boolean; probe: boolean }>) => setOpenState(o => {
    const next = { ...o, ...patch };
    try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* 记不住只是下次要再点 */ }
    return next;
  });

  const owner=getUserPrefix();

  const [extraCards,setExtraCards]=useState<FishCard[]>(()=>readCards().slice(1));
  // 【用户要求】2026-10-19「多重选择除了交集，再增加一种并集（只要符合其中一个算法的，都留下）」：合并方式跟账号记在本机
  const combinationKey=()=>`${getUserPrefix()}fish-combination.v1`;
  const readCombination=():'and'|'or'=>{try{return readPersistedStateRaw(combinationKey())==='or'?'or':'and';}catch{return 'and';}};
  const [combination,setCombinationState]=useState<'and'|'or'>(readCombination);
  const setCombination=(v:'and'|'or')=>{setCombinationState(v);try{writePersistedStateRaw(combinationKey(),v);}catch{/* 记不住只是下次要再选 */}};
  const [firstEnabled,setFirstEnabled]=useState(()=>readCards()[0]?.enabled??true);
  const [selected,setSelected]=useState(()=>readCards()[0]?.featureId??'cbi2'),[pref,setPref]=useState<FishPreference>(()=>readCards()[0]?.pref??cleanPreference(readFishPreference('cbi2')));
  const cardsOwner=useRef(owner);
  useEffect(()=>{p.reconstruction?.onCardsChange([{id:'first',featureId:selected,enabled:firstEnabled,pref},...extraCards]);},[selected,firstEnabled,pref,extraCards,p.reconstruction?.onCardsChange]);
  useEffect(()=>{if(cardsOwner.current!==owner)return;try{writePersistedStateRaw(cardsKey(),JSON.stringify([{id:'first',featureId:selected,enabled:firstEnabled,pref},...extraCards]));}catch{/* Local storage may be full or disabled. */}},[selected,pref,firstEnabled,extraCards,owner]);
  const [suggestion,setSuggestion]=useState<FishSuggestion|null>(()=>latestFishSuggestion('cbi2'));
  const [suggestionProgress,setSuggestionProgress]=useState<FishSuggestionProgress|null>(null);
  const suggestionController=useRef<AbortController|null>(null);
  /** 正在算的这一次：auto = 打开时后台自动算（不锁设置，开始捕捞时让路）；manual = 点计算图标（锁定，可取消）。 */
  const suggestionRun=useRef<{mode:'auto'|'manual';key:string;done:Promise<void>;target?:string}|null>(null);
  const autoTried=useRef(new Set<string>());
  useEffect(()=>{cardsOwner.current=owner;setCombinationState(readCombination());const cards=readCards();setExtraCards(cards.slice(1));setFirstEnabled(cards[0]?.enabled??true);setSelected(cards[0]?.featureId??'cbi2');setPref(cards[0]?.pref??cleanPreference(readFishPreference('cbi2')));setSuggestion(latestFishSuggestion(selected));setSuggestionProgress(null);return()=>{suggestionController.current?.abort();suggestionController.current=null;};},[owner]);
  const listedDef=defs.find(d=>d.id===selected)??defs.find(d=>d.id==='cbi2')??defs[0];
  // 【用户要求】2026-10-19「保证内在统一」：渔与 K 线图、Deep dig 读同一份定义，没有「内置 / Deep dig」之分
  const def=listedDef;
  const [probe,setProbe]=useState<{symbol:string;exchange:FishExchange;busy:boolean;result:FishDiagnosis|null}>({symbol:'',exchange:'binance',busy:false,result:null});
  useEffect(()=>{if(def&&selected!==def.id){setSelected(def.id);setPref(cleanPreference(readFishPreference(def.id)));}},[def?.id,selected]);
  const update=(next:FishPreference)=>{if(!def)return;setPref(next);saveFishPreference(def.id,next);setError('');};
  const [autoSuggesting,setAutoSuggesting]=useState(false);
  const {exchanges,includeDuplicates,includeUsStocks=true}=p.selection,suggesting=suggestionProgress?.status==='running'&&!autoSuggesting,running=p.progress?.status==='running'||suggesting||!!p.reconstruction?.running;
  const compiled=useMemo(()=>{try{if(!def)throw new Error('Deep dig 里没有可用特征值');const plan=compileFishProgram(def,{statistic:pref.statistic??'结果',direction:pref.direction,threshold:pref.threshold.trim()?Number(pref.threshold):NaN,constraints:[]});return {plan,error:plan.unavailable??''};}catch(e){return {plan:null,error:e instanceof Error?e.message:String(e)};}},[def,pref]);
  const multiple=useMemo(()=>{
    const plans=[];let error='';
    const cards=[{id:'first',featureId:selected,enabled:firstEnabled,pref},...extraCards];
    for(const [i,c] of cards.entries())if(c.enabled)try{if(i===0){if(!compiled.plan||compiled.error)throw Error(compiled.error);plans.push(compiled.plan);continue;}const d=defs.find(d=>d.id===c.featureId);if(!d)throw Error('特征值已不存在');const plan=compileFishProgram(d,{statistic:c.pref.statistic,direction:c.pref.direction,threshold:c.pref.threshold.trim()?Number(c.pref.threshold):NaN,constraints:[]});if(plan.unavailable)throw Error(plan.unavailable);plans.push(plan);}catch(e){error=`算法 ${i+1}：${e instanceof Error?e.message:String(e)}`;}
    return {plans,error:error||(!plans.length?'请启用至少一个算法':'')};
  },[selected,firstEnabled,pref,extraCards,defs,compiled]);
  // 进度悬停里的「算法 n」用卡片上的编号（停用的卡不参与，编号不顺延）
  const enabledCardNumbers=[firstEnabled,...extraCards.map(c=>c.enabled)].flatMap((on,i)=>on?[i+1]:[]);
  const algorithmInputs=()=>multiple.plans.map(p=>({feature:p.def,algorithm:p.settings}));
  const runProbe=async()=>{
    if(!p.onDiagnose||!probe.symbol.trim()||running)return;
    let anchorMs:number|undefined;
    try{anchorMs=parseFishSettings(p.inputs.time,pref.threshold||'0').anchorMs;}catch(e){setProbe(v=>({...v,result:{outcome:'failed',lines:[e instanceof Error?e.message:String(e)]}}));return;}
    if(multiple.error){setProbe(v=>({...v,result:{outcome:'failed',lines:[multiple.error||'算法设置有误']}}));return;}
    setProbe(v=>({...v,busy:true,result:null}));
    try{const result=await p.onDiagnose({symbol:probe.symbol,exchange:probe.exchange,anchorMs,algorithms:algorithmInputs(),combination,signal:new AbortController().signal});setProbe(v=>({...v,busy:false,result}));}
    catch(e){setProbe(v=>({...v,busy:false,result:{outcome:'failed',lines:[e instanceof TypeError?'浏览器拦截（网络 / 跨域）':e instanceof Error?e.message:String(e)]}}));}
  };
  const suggestionCompiled=useMemo(()=>{try{if(!def)return null;return compileFishProgram(def,{statistic:pref.statistic??'结果',direction:pref.direction,threshold:pref.threshold.trim()?Number(pref.threshold):0,constraints:[]});}catch{return null;}},[def,pref]);
  const library=p.librarySignals??[],suggestionKey=suggestionCompiled?fishSuggestionKey(suggestionCompiled,library):'';
  useEffect(()=>{const cached=readFishSuggestion(suggestionKey);setSuggestion(previous=>previous?.key===suggestionKey?previous:cached?{...cached,cacheHit:true}:previous?.featureId===def?.id?previous:def?latestFishSuggestion(def.id):null);},[suggestionKey,def?.id,owner]);
  const plan=compiled.plan??suggestionCompiled;
  const suggestionStale=!!suggestion&&suggestion.key!==suggestionKey;
  const prefRef=useRef(pref);prefRef.current=pref;
  /** 每张附加算法卡的建议：按该卡设置编译（阈值不影响分布），同设置的卡共用一份缓存。 */
  const [suggestionVersion,setSuggestionVersion]=useState(0);
  /** 这次打开算出但没进缓存的结果（有临时失败时不缓存），也照样显示。 */
  const memResults=useRef(new Map<string,FishSuggestion>());
  const extraSuggest=useMemo(()=>extraCards.map(c=>{
    try{const d=defs.find(d=>d.id===c.featureId);if(!d||!c.enabled)return null;const plan=compileFishProgram(d,{statistic:c.pref.statistic,direction:c.pref.direction,threshold:0,constraints:[]});if(plan.unavailable)return null;const key=fishSuggestionKey(plan,library);return {id:c.id,plan,key,cached:readFishSuggestion(key)??memResults.current.get(key)??null,queued:!RECORDED_RANGES[c.featureId]&&!autoTried.current.has(key)};}catch{return null;}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }),[extraCards,defs,library,suggestionVersion]);
  const calculateSuggestion=async(mode:'auto'|'manual'='manual',target:{id:string;plan:FishProgram}|null=null)=>{
    const targetPlan=target?.plan??suggestionCompiled;
    if(!targetPlan||targetPlan.unavailable||!p.onSuggest||running||probe.busy)return;
    // 同一个取数器一次只算一份：手动点时先停掉后台那份、等它收尾
    const pending=suggestionRun.current;if(pending){suggestionController.current?.abort();await pending.done;}
    const mine=new AbortController();suggestionController.current=mine;
    const samples=[...library],frozen=targetPlan,key=fishSuggestionKey(frozen,samples);
    if(mode==='manual')setError('');
    setAutoSuggesting(mode==='auto');setSuggestionProgress({status:'running',phase:'signals',done:0,total:0,current:''});
    const valid=()=>suggestionController.current===mine&&!mine.signal.aborted;
    const done=(async()=>{try{
      const result=await p.onSuggest!({plan:frozen,signals:samples,signal:mine.signal,force:mode==='manual',onProgress:value=>{if(suggestionController.current===mine)setSuggestionProgress(value);}});
      if(!valid())return;
      memResults.current.set(key,result);setSuggestionVersion(v=>v+1);
      // 阈值为空、或仍是上次自动填的建议值时填入；手动改过的不覆盖
      if(target){
        setExtraCards(cs=>cs.map(c=>{if(c.id!==target.id)return c;const t=suggestedFishThreshold(result,c.pref.direction);if(t===null||!mayFillFishThreshold(c.pref.threshold,c.pref.lastSuggestion))return c;return {...c,pref:{...c.pref,threshold:String(t),lastSuggestion:String(t)}};}));
        setSuggestionProgress(null);return;
      }
      const current=prefRef.current,threshold=suggestedFishThreshold(result,current.direction);
      if(threshold!==null&&mayFillFishThreshold(current.threshold,current.lastSuggestion)){const value=String(threshold);update({...current,threshold:value,lastSuggestion:value});p.onInputsChange({...p.inputs,threshold:value});}
      setSuggestion(result);setSuggestionProgress(value=>value?{...value,status:'complete'}:null);
    }catch(e){if(suggestionController.current===mine){setSuggestionProgress(value=>value?{...value,status:mine.signal.aborted?'cancelled':'aborted'}:null);if(!mine.signal.aborted&&mode==='manual')setError(e instanceof Error?e.message:String(e));}}
    finally{if(suggestionController.current===mine)suggestionController.current=null;if(suggestionRun.current?.done===done){suggestionRun.current=null;setAutoSuggesting(false);}}})();
    suggestionRun.current={mode,key,done,target:target?.id??'first'};
  };
  // 【用户要求】2026-10-19「默认的建议区间…源于信号库中所有信号的统计」：当前设置还没有建议时，打开就在后台算；
  // 设置一变（换特征值 / 序列 / 约束 / 公式 / 信号库）先停掉旧的再按新设置算；同一设置每次打开只自动算一次
  const scanning=p.progress?.status==='running';
  // 已有截图记录区间的卡只在点击刷新时计算；其余卡保留按顺序的后台建议。
  const queueKeys=[suggestionKey,...extraSuggest.map(x=>x?.key??'')].filter(Boolean).join('\n');
  useEffect(()=>{
    const queue:{key:string;target:{id:string;plan:FishProgram}|null}[]=[...(suggestionKey&&firstEnabled&&!RECORDED_RANGES[selected]?[{key:suggestionKey,target:null}]:[]),...extraSuggest.flatMap(x=>x&&!RECORDED_RANGES[x.plan.def.id]?[{key:x.key,target:{id:x.id,plan:x.plan}}]:[])];
    const run=suggestionRun.current;
    if(run?.mode==='auto'&&!queue.some(q=>q.key===run.key))suggestionController.current?.abort();
    if(!library.length||scanning||p.reconstruction?.running||suggestionRun.current)return;
    const next=queue.find(q=>!autoTried.current.has(q.key)&&!readFishSuggestion(q.key));
    if(!next)return;
    const timer=setTimeout(()=>{if(suggestionRun.current||autoTried.current.has(next.key))return;autoTried.current.add(next.key);void calculateSuggestion('auto',next.target);},800);
    return()=>clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[queueKeys,firstEnabled,scanning,library.length,autoSuggesting,p.reconstruction?.running]);
  // 方向一换，阈值仍是上次自动填的建议时改填另一端（> 取 P25，< 取 P75）；分布与方向无关，不用重算
  const changeDirection=(direction:'>'|'<')=>{
    const fill=suggestion&&!suggestionStale?suggestedFishThreshold(suggestion,direction):null;
    if(fill!==null&&pref.lastSuggestion!==undefined&&mayFillFishThreshold(pref.threshold,pref.lastSuggestion)){const value=String(fill);update({...pref,direction,threshold:value,lastSuggestion:value});p.onInputsChange({...p.inputs,threshold:value});}
    else update({...pref,direction});
  };
  const start=async()=>{try{const settings=parseFishSettings(p.inputs.time,String(multiple.plans[0]?.settings.threshold??0));if(!exchanges.length)throw new Error('请至少选择一家交易所');if(multiple.error)throw new Error(multiple.error);setError('');
    // 后台的建议计算给捕捞让路：先停掉、等它收尾（共用同一个取数器），再开始
    const pending=suggestionRun.current;if(pending){suggestionController.current?.abort();await pending.done;}
    p.onStart({...settings,feature:multiple.plans[0].def,algorithm:multiple.plans[0].settings,algorithms:algorithmInputs(),combination,exchanges:[...exchanges],includeDuplicates,includeUsStocks});}catch(e){setError(e instanceof Error?e.message:String(e));}};
  const fresh = useMemo(() => p.signals.filter(s => s.freshCatch), [p.signals]);
  const old = useMemo(() => p.signals.filter(s => !s.freshCatch), [p.signals]);
  const btn = 'rounded border border-border/60 px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40';
  const x = p.progress;

  // 【用户要求】2026-10-19「渔界面内的内容可以上下滑动，要切换自如」：页面整体不滚动（h-screen），面板自己限高、内部滚动；
  // 顶上「时间 / 开始捕捞 / 取消」一行滚动时贴顶；鱼列表滚到头后把滚动交给面板（不卡在列表里）
  return <section className="mt-2 max-h-[65vh] min-w-0 space-y-3 overflow-y-auto overscroll-y-contain rounded-lg border border-border/60 bg-background p-3 sm:p-4" aria-label="渔" data-testid="fish-panel">
    <div className="sticky -top-3 z-10 -mx-3 -mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 bg-background px-3 pb-2 pt-3 text-[11px] sm:-top-4 sm:-mx-4 sm:-mt-4 sm:px-4 sm:pt-4" data-testid="fish-toolbar">
      <div className="flex items-center gap-1"><strong className="text-xs">渔</strong><Popover><PopoverTrigger asChild><button type="button" aria-label="捕捞说明" className="p-1 text-muted-foreground/40 hover:text-muted-foreground"><CircleHelp className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" className="max-h-[75vh] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto space-y-2 p-3 text-[11px] leading-relaxed" aria-label="捕捞说明">
        <p>算法与 Deep dig 共用定义，包含修改后的内置项和自定义项。所选序列直接与阈值比较，外面不再套 avg：要看均值，就在 Deep dig 公式里写一行（如 avg_CBI2 = avg(CBI2, 24)）再选它。「结果」= 公式最后一句，与 Deep dig 的结果相同；可选公式中的命名序列，常数不列。结果的阈值用显示单位，中间量阈值用原值。可添加最多 6 个算法，各自独立判定，只展示交集。</p>
        <p>时间按 UTC+8，留空用币安服务器当前时间。同一锚点分别向下取整至各算法周期，仅用已收盘K线。起点是所选条件连续成立的第一根收盘时刻；此前须有一根已知为假。截止未知计读数不全，回溯遇未知计起点不明。</p>
        <p>各家原生K线分页上限不同。历史超出保留期整家跳过。只有用到BTC才取参考价，参考缺根只跳过那一家（写明原因），全部取不到才整轮中止。</p>
        <p>默认排除较高优先级交易所已上线的基础币。鱼与新鱼按算法分别去重；加入信号库仍按信号库自身规则合并。设置只保存在本机，捕捞开始后锁定。</p>
        {x?.anchorMs&&<p>本轮节点：{formatUTC8(x.anchorMs)}</p>}{x?.cutoffMs&&<p>本轮阈值 {plan?.settings.direction??'>'} {x.threshold??.3}</p>}
          {(suggestion||suggestionProgress)&&<div className="space-y-1 border-l border-border/60 pl-3 text-[10px] text-muted-foreground" data-testid="fish-suggestion-detail">
      {suggestionProgress&&<p role="status">建议{suggestionProgress.status==='running'?'计算中':suggestionProgress.status==='cancelled'?'已取消':suggestionProgress.status==='aborted'?'已中止':'已完成'} · {suggestionProgress.phase==='signals'?'信号样本':'随机对照'} · {suggestionProgress.done} / {suggestionProgress.total} {suggestionProgress.current}</p>}
      {suggestion&&<><p className="whitespace-pre-wrap break-words">{fishSuggestionTitle(suggestion)}</p>{([['信号',suggestion.samples],['随机',suggestion.random]] as const).map(([label,stats])=>stats.failures.length>0&&<details key={label}><summary className="w-fit cursor-pointer">{label}跳过原因（前{stats.failures.length}项）</summary>{stats.failures.map((row,i)=><p key={i} className="break-words">{row.symbol} · {formatUTC8(row.timeMs)} · {row.reason}</p>)}</details>)}</>}
    </div>}
</PopoverContent></Popover></div>
      <label className="flex items-center gap-1 text-muted-foreground">时间（UTC+8）<input aria-label="捕捞时间（UTC+8）" placeholder="YYYY-MM-DD HH:mm:ss" className="w-44 min-w-0 max-w-full rounded border border-border/60 bg-transparent px-1.5 py-1 font-mono text-foreground" value={p.inputs.time} disabled={running} onChange={e=>{setError('');p.onInputsChange({...p.inputs,time:e.target.value});}}/></label>
      <div className="flex gap-1"><button type="button" className={btn} disabled={running||probe.busy||!!multiple.error} onClick={()=>void start()}>开始捕捞</button><button type="button" className={btn} disabled={!running} onClick={()=>p.reconstruction?.running?p.reconstruction.cancel():suggesting?suggestionController.current?.abort():p.onCancel()}>取消</button></div>
      <button type="button" aria-label="捕捞范围" aria-expanded={open.scope} title={`捕捞范围：${exchanges.map(e => EXCHANGE_NAMES[e]).join('、') || '未选交易所'}${includeDuplicates ? '（含重复币）' : ''}`} onClick={() => setOpen({ scope: !open.scope })} className={`${faint} ${open.scope ? 'text-muted-foreground' : ''}`}>
        <SlidersHorizontal className="h-3 w-3" />
      </button>
      {p.onDiagnose&&<button type="button" aria-label="查单个币" aria-expanded={open.probe} title="查单个币：按当前设置与时间，看它为什么命中 / 没命中" onClick={() => setOpen({ probe: !open.probe })} className={`${faint} ${open.probe ? 'text-muted-foreground' : ''}`} data-testid="fish-probe-toggle">
        <Search className="h-3 w-3" />
      </button>}
      {p.reconstruction&&<button type="button" className={`${faint} text-[10px]`} title={p.reconstruction.settingsError||'复原：用信号发生前的数据评估各算法，仅保存在本机'} disabled={running||probe.busy||!p.reconstruction.available} onClick={async()=>{const pending=suggestionRun.current;if(pending){suggestionController.current?.abort();await pending.done;}await p.reconstruction!.start();}}>复原</button>}
    </div>
    <div className="max-w-2xl space-y-1" data-testid="fish-algorithms">
      <FishAlgorithmCard card={{id:'first',featureId:selected,enabled:firstEnabled,pref}} defs={defs} index={1} locked={running} canDelete={extraCards.length>0} onRecalculate={()=>void calculateSuggestion('manual')} recalculateDisabled={running||probe.busy||!p.onSuggest||!suggestionCompiled||!!suggestionCompiled.unavailable} recalculating={suggestionProgress?.status==='running'&&suggestionRun.current?.target==='first'} footer={<>
      {suggestion&&<span className="text-[10px] text-muted-foreground" data-testid="fish-suggestion" title={fishSuggestionTitle(suggestion)}>{suggestion.samples.p25===null?'信号库暂无有效建议':`信号库建议 ${Number(suggestion.samples.p25.toPrecision(6))} ~ ${Number(suggestion.samples.p75!.toPrecision(6))}`}（{suggestion.samples.n} / {suggestionStale?suggestion.samples.attempted:library.length} 条）{suggestionStale?(autoSuggesting?' · 更新中':' · 已过期'):''}</span>}
      {!suggestion&&suggestionProgress?.status==='running'&&suggestionRun.current?.target==='first'&&suggestionProgress&&<span className="text-[10px] text-muted-foreground/70" data-testid="fish-suggestion-auto">信号库建议计算中 {suggestionProgress.done} / {suggestionProgress.total||library.length}</span>}
      </>}
        onChange={next=>{setFirstEnabled(next.enabled);if(next.featureId===selected&&next.pref.direction!==pref.direction){changeDirection(next.pref.direction);return;}setSelected(next.featureId);setPref(cleanPreference(next.pref));saveFishPreference(next.featureId,cleanPreference(next.pref));setError('');p.onInputsChange({...p.inputs,threshold:next.pref.threshold});}}
        onDelete={()=>{const [next,...rest]=extraCards;setSelected(next.featureId);setPref(next.pref);setFirstEnabled(next.enabled);setExtraCards(rest);}}/>
      {extraCards.map((card,i)=><FishAlgorithmCard key={card.id} card={card} defs={defs} index={i+2} locked={running} onRecalculate={()=>{const target=extraSuggest[i];if(target)void calculateSuggestion('manual',{id:target.id,plan:target.plan});}} recalculateDisabled={running||probe.busy||!p.onSuggest||!extraSuggest[i]} recalculating={suggestionProgress?.status==='running'&&suggestionRun.current?.target===card.id} suggestion={extraSuggest[i]?.cached??null} queued={!!extraSuggest[i]?.queued} librarySize={library.length} computing={suggestionProgress?.status==='running'&&suggestionRun.current?.target===card.id&&suggestionProgress?`${suggestionProgress.done} / ${suggestionProgress.total||library.length}`:''} onChange={next=>setExtraCards(cs=>cs.map(c=>c.id===next.id?next:c))} onDelete={()=>setExtraCards(cs=>cs.filter(c=>c.id!==card.id))}/>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
    <button type="button" className={btn} disabled={running||extraCards.length>=5} onClick={()=>setExtraCards(cs=>[...cs,{id:crypto.randomUUID(),featureId:def?.id??'cbi2',enabled:true,pref:structuredClone(pref)}])}>+ 算法</button>
      {extraCards.length>0&&<label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><select aria-label="多重算法合并方式" className="rounded border border-border/60 bg-background px-1 py-1 text-foreground" disabled={running} value={combination} onChange={e=>setCombination(e.target.value as 'and'|'or')}><option value="and">交集</option><option value="or">并集</option></select></label>}
    </div>
    <p className="break-words text-[11px] leading-relaxed text-muted-foreground" data-testid="fish-rule">{scanning&&x?.rule?x.rule:extraCards.length===0?fishRuleText(def,pref.direction,pref.threshold,0,pref.statistic):multiple.plans.map(p=>fishRuleText(p.def,p.settings.direction,p.settings.threshold,p.texts.length,p.settings.statistic)).join(combination==='or'?' 或 ':' 且 ')}</p>
    {open.scope && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground" aria-label="捕捞交易所">
      {AUDITED_EXCHANGES.map(exchange => <label key={exchange} className="flex items-center gap-1.5">
        <input type="checkbox" className="h-3 w-3 accent-primary" disabled={running} checked={exchanges.includes(exchange)} onChange={e => p.onSelectionChange({ ...p.selection, exchanges: AUDITED_EXCHANGES.filter(x => x === exchange ? e.target.checked : exchanges.includes(x)) })} />
        {EXCHANGE_NAMES[exchange]}
      </label>)}
      <label className="flex items-center gap-1.5"><input type="checkbox" className="h-3 w-3 accent-primary" checked={includeUsStocks} disabled={running} onChange={e=>p.onSelectionChange({...p.selection,includeUsStocks:e.target.checked})}/>美股</label>
      <label className="ml-1 flex items-center gap-1.5 border-l border-border/60 pl-4"><input type="checkbox" className="h-3 w-3 accent-primary" disabled={running} checked={includeDuplicates} onChange={e => p.onSelectionChange({ ...p.selection, includeDuplicates: e.target.checked })} />含重复币</label>
    </div>}
    {open.probe&&p.onDiagnose&&<div className="space-y-1 text-[11px]" data-testid="fish-probe">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>查单个币</span>
        <input aria-label="查单个币的标的" placeholder="如 RAVE 或 RAVEUSDT" value={probe.symbol} onChange={e=>setProbe({...probe,symbol:e.target.value})} onKeyDown={e=>{if(e.key==='Enter')void runProbe();}} className="w-40 rounded border border-border/60 bg-transparent px-2 py-1 font-mono text-foreground" />
        <select aria-label="查单个币的交易所" value={probe.exchange} onChange={e=>setProbe({...probe,exchange:e.target.value as FishExchange})} className="rounded border border-border/60 bg-background px-1.5 py-1">
          {AUDITED_EXCHANGES.map(e=><option key={e} value={e}>{EXCHANGE_NAMES[e]}</option>)}
        </select>
        <button type="button" className={btn} disabled={running||probe.busy||!probe.symbol.trim()} onClick={()=>void runProbe()}>{probe.busy?'查询中…':'查'}</button>
        <span className="text-[10.5px]">按上面的算法、阈值与时间，用与捕捞相同的取数和判定；不入库</span>
      </div>
      {probe.result&&<div className={`space-y-0.5 border-l pl-2 ${probe.result.outcome==='hit'?'border-primary/60':'border-border/60'}`} data-testid="fish-probe-result">
        {probe.result.lines.map((line,i)=><p key={i} className={i===0?'font-mono text-[10.5px] text-muted-foreground':'text-foreground/90'}>{line}</p>)}
      </div>}
    </div>}
    {(error||multiple.error) && <p role="alert" className="text-[11px] text-destructive">{error||multiple.error}</p>}
    {x && <div className="space-y-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p role="status" aria-live="polite" className="flex items-center gap-2" data-testid="fish-status" title={x.algorithmHits?.map((n,i)=>`算法 ${enabledCardNumbers[i]??i+1} 命中 ${n}`).join('；')}>
          <span>{STATUS[x.status]}</span>
          <span className="text-muted-foreground">·</span>
          <span>命中 <span className="font-mono tabular-nums font-medium text-primary">{x.counts.hit}</span></span>
          <span className="text-muted-foreground">·</span>
          <span className="font-mono tabular-nums text-muted-foreground">{x.done} / {x.total}</span>
        </p>
        {scanning && x.total > 0 && <span className="h-[3px] w-28 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className="block h-full rounded-full bg-primary/70 transition-[width] duration-300" style={{ width: `${Math.min(100, (x.done / x.total) * 100)}%` }} />
        </span>}
      </div>
      {/* 【用户要求】2026-10-19 进度旁的明细入口删掉（「没必要存在」）；整次扫描失败的报错仍直接写出来 */}
      {x.error && <p className="text-destructive">{x.error}</p>}
      {x.notice && <p className="break-words text-[10.5px] text-muted-foreground" data-testid="fish-notice">{x.notice}</p>}
    </div>}
    {p.reconstruction&&<FishReconstructionResults state={p.reconstruction}/>}
    {/* 【用户要求】2026-10-19 新鱼 = 最近一次捕捞捕到的；点开始捕捞时上一轮的新鱼归入「鱼」 */}
    <div className="space-y-2 border-t border-border/50 pt-3">
    <FishLibrary title="新鱼" testId="fish-new" signals={fresh} defaultOpen={fresh.length > 0} emptyText={scanning ? '捕捞中，捕到的会出现在这里。' : '还没有新鱼：点「开始捕捞」后，这一轮捕到的放在这里，上一轮的归入「鱼」。'}
      tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={p.onRate} onAdd={p.onAdd} />
    <FishLibrary title="鱼" testId="fish-old" signals={old} emptyText="暂无信号：每次开始捕捞时，上一轮的新鱼会归入这里。"
      tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={p.onRate} onAdd={p.onAdd} />
    </div>
  </section>;
}
