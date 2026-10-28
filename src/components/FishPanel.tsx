import { readFishLookback, saveFishLookback, validateFishLookback, fishProgramForLookback } from '@/lib/fish/lookback';
import { downloadFishCabin } from '@/lib/fish/export';
import { toast } from 'sonner';
import { readFishDownwardWick, saveFishDownwardWick, FISH_WICK_HOURS, FISH_WICK_ATR_MULTIPLES, type FishDownwardWick } from '@/lib/fish/downwardWick';
import {readPersistedStateRaw,writePersistedStateRaw} from '@/lib/persistedStateStorage';
import { FishReconstructionResults } from './FishReconstruction';
import type { FishReconstructionState } from '@/hooks/useFishReconstruction';
import {FishAlgorithmCard,FishCheck,RECORDED_RANGES,type FishCard} from './FishAlgorithmCard';
import {getUserPrefix} from '@/lib/userStoragePrefix';
import { useFishFeatures } from '@/hooks/useFishFeatures';
import {compileFishProgram,type FishProgram} from '@/lib/fish/algorithm';
import {fishTightenable,sameFamily} from '@/lib/fish/refilter';
import {FISH_DEFAULT_ALGORITHMS,fishCardsKey as cardsKey,readFishCards as readCards,fishDefaultCards as defaultCards,fishCombinationKey as combinationKey,readFishCombination as readCombination} from '@/lib/fish/cards';
import {FISH_TURNOVER_FLOORS,FISH_MAX_ALGORITHMS} from '@/lib/fish/shared';
import {FISH_AUTO_INTERVALS} from '@/lib/fish/autoScan';
import type {FishAutoScan} from '@/hooks/useFishAutoScan';
import type {FishNotify} from '@/hooks/useFishNotify';
import {FishNotifySettings} from './FishNotifySettings';
import {readFishPreference,saveFishPreference,withFishDefaultThreshold,type FishPreference} from '@/lib/fish/preferences';
import { fishRuleText } from '@/lib/fishRule';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AUDITED_EXCHANGES, EXCHANGE_NAMES, type FishExchange } from '@/lib/fish/exchanges';
import { ChevronDown, CircleHelp, Clock3, History, ListChecks, Mail, MoreHorizontal, Play, Plus, Search, SlidersHorizontal, Square } from 'lucide-react';
import { fishInfoTrigger, fishRail, fishSectionHeading, fishSubHeading } from './FishSection';
import { FishQualityInfo } from './FishQualityModule';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { signalChartSymbol, type TradeSignal } from '@/lib/signalLibrary';
import { fishSelectionKey, parseFishSettings, type FishScanSettings, type FishProgress, type FishDiagnosis } from '@/lib/fishScanner';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { FishAlgorithmSettings } from '@/lib/fish/algorithm';
import { formatUTC8 } from '@/lib/timeFormat';
import { FishLibrary } from '@/components/FishLibrary';
import { FishQuality } from '@/components/FishQuality';
import { ModuleErrorBoundary } from '@/components/ModuleErrorBoundary';
import type { FishQualityState } from '@/hooks/useFishQuality';

import {fishSuggestionKey,readFishSuggestion,latestFishSuggestion,saveFishSuggestion,suggestedFishThreshold,mayFillFishThreshold,fishSuggestionTitle,type FishSuggestion,type FishSuggestionOptions,type FishSuggestionProgress} from '@/lib/fish/suggestions';

export interface FishPanelProps {
  quality?: FishQualityState;
  /** 比较探测的持续挖掘（TimeControl 里调度）。 */
  mining?: import('@/hooks/useFishMining').FishMiningApi;
  reconstruction?: FishReconstructionState;
  hasRound?: boolean;
  /** 扫完后切换交集 / 并集：用上一轮的逐币结论直接重新合并（算法设置没变时）。 */
  onRecombine?: (mode: 'and' | 'or', algorithmKeys: readonly string[], plans?: readonly FishProgram[]) => boolean;
  /** 捕捞中切换交集 / 并集（2026-10-21「捕捞运行的过程中，我也可以灵活切换到并集」）。 */
  onLiveCombination?: (mode: 'and' | 'or') => boolean;
  /** 新鱼邮件提醒（收件邮箱可添加多个）；不给就不显示邮件入口。 */
  notify?: FishNotify;
  /** 定时自动捕捞（手动 / 自动 + 间隔）；不给就只有手动。 */
  auto?: FishAutoScan;
  /** 本轮实际扫过的算法（含当时阈值），用来说明改动为什么要重新捕捞。 */
  roundPlans?: readonly FishProgram[] | null;
  /** 每次打开恢复指定算法的顺序与勾选；相同算法的不同序列分别保存。 */
  defaultAlgorithms?: readonly string[];
  /** 查单个币：与捕捞同一套取数与判定，说明命中 / 没命中的原因。 */
  onDiagnose?: (options: { lookbackHours?:number; downwardWick?: FishDownwardWick; turnoverFloors?: readonly import('@/lib/fish/shared').FishTurnoverFloor[]; symbol: string; exchange?: FishExchange; anchorMs?: number; feature?: DeepDigFeatureDef; algorithm?: FishAlgorithmSettings; algorithms?: import('@/lib/fish/intersection').FishAlgorithmInput[]; combination?: 'and'|'or'; signal: AbortSignal }) => Promise<FishDiagnosis>;
  librarySignals?: TradeSignal[];
  onSuggest?: (options:FishSuggestionOptions)=>Promise<FishSuggestion>;
  signals: TradeSignal[]; progress: FishProgress | null;
  inputs: { time: string; threshold: string }; onInputsChange: (value: { time: string; threshold: string }) => void;
  selection: { exchanges: FishExchange[]; includeDuplicates: boolean; includeUsStocks?: boolean }; onSelectionChange: (value: { exchanges: FishExchange[]; includeDuplicates: boolean; includeUsStocks?: boolean }) => void;
  onStart: (settings: FishScanSettings) => void; onCancel: () => void;
  onJumpQuality?: (source: TradeSignal) => void;
  onJump: (id: string) => void; onDelete: (id: string) => void; onRate: (id: string, value: number) => void;
  jumpingSignalId: string | null; tradedDayIndex: Set<string>; campaignDayIndex: Set<string>;
}
/**
 * 【用户要求】2026-10-19「渔这里，界面要简单一点，只用显示命中以及加载进度，其他的都折叠收起来，用非常隐形的符号做入口」：
 * 平时只有一行设置 + 一行「状态 · 命中 · 进度」；交易所勾选收在淡色滑杆图标后（展开状态记在这次浏览里）。
 * 2026-10-19 用户又要求删掉进度旁的「›」明细入口：各家计数与跳过原因不再显示，只在整次扫描失败时写出报错。
 */
// 卡片的读写与默认算法放在 lib/fish/cards.ts：定时自动捕捞也读同一份
export {FISH_DEFAULT_ALGORITHMS};
const cleanPreference=(p:FishPreference):FishPreference=>({...p,constraints:[]});
const OPEN_KEY = 'veil.fish.open';
type FishOpen = { scope: boolean; detail: boolean; probe: boolean; notify: boolean; catching: boolean; algorithms: boolean };
function readOpen(): FishOpen {
  try { const v = JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? '{}'); return { scope: !!v.scope, detail: !!v.detail, probe: !!v.probe, notify: !!v.notify, catching: v.catching !== false, algorithms: v.algorithms !== false }; } catch { return { scope: false, detail: false, probe: false, notify: false, catching: true, algorithms: true }; }
}
const STATUS: Record<FishProgress['status'], string> = { running: '捕捞中', complete: '捕捞完成', cancelled: '已取消', aborted: '已中止', skipped: '已跳过' };

export function FishPanel(p: FishPanelProps) {
  const [error,setError]=useState(''),defs=useFishFeatures();
  const [open, setOpenState] = useState(readOpen);
  const setOpen = (patch: Partial<FishOpen>) => setOpenState(o => {
    const next = { ...o, ...patch };
    try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* 记不住只是下次要再点 */ }
    return next;
  });

  const owner=getUserPrefix();
  const [lookbackHours,setLookbackHours]=useState(readFishLookback),[lookbackDraft,setLookbackDraft]=useState(()=>String(readFishLookback()));
  useEffect(()=>{const h=readFishLookback();setLookbackHours(h);setLookbackDraft(String(h));},[owner]);
  const applyLookback=()=>{try{const h=saveFishLookback(lookbackDraft);setLookbackHours(h);setError('');}catch(e){setError(e instanceof Error?e.message:'覆盖时间无效');}};
  const [downwardWick,setDownwardWick]=useState(readFishDownwardWick);
  const [wickChanged,setWickChanged]=useState(false);
  useEffect(()=>{setDownwardWick(readFishDownwardWick());setWickChanged(false);},[owner]);
  const updateWick=(patch:Partial<FishDownwardWick>)=>{const next={...downwardWick,...patch};setDownwardWick(next);saveFishDownwardWick(next);setWickChanged(true);};


  const loadCards=()=>{const cards=p.defaultAlgorithms?defaultCards(p.defaultAlgorithms,defs.map(d=>d.id)):[];return cards.length?cards:readCards();};
  const [initialCards]=useState(loadCards);
  const [extraCards,setExtraCards]=useState<FishCard[]>(()=>initialCards.slice(1));
  // 【用户要求】2026-10-19「多重选择除了交集，再增加一种并集（只要符合其中一个算法的，都留下）」：合并方式跟账号记在本机
  const [combination,setCombinationState]=useState<'and'|'or'>(readCombination);
  const setCombination=(v:'and'|'or')=>{setCombinationState(v);try{writePersistedStateRaw(combinationKey(),v);}catch{/* 记不住只是下次要再选 */}};
  const [firstEnabled,setFirstEnabled]=useState(()=>initialCards[0]?.enabled??true);
  const [selected,setSelected]=useState(()=>initialCards[0]?.featureId??'cbi2'),[pref,setPref]=useState<FishPreference>(()=>initialCards[0]?.pref??cleanPreference(readFishPreference('cbi2')));
  const cardsOwner=useRef(owner);
  useEffect(()=>{p.reconstruction?.onCardsChange([{id:'first',featureId:selected,enabled:firstEnabled,pref},...extraCards]);},[selected,firstEnabled,pref,extraCards,p.reconstruction?.onCardsChange]);
  useEffect(()=>{if(cardsOwner.current!==owner)return;try{writePersistedStateRaw(cardsKey(),JSON.stringify([{id:'first',featureId:selected,enabled:firstEnabled,pref},...extraCards]));}catch{/* Local storage may be full or disabled. */}},[selected,pref,firstEnabled,extraCards,owner]);
  const [suggestion,setSuggestion]=useState<FishSuggestion|null>(()=>latestFishSuggestion('cbi2'));
  const [suggestionProgress,setSuggestionProgress]=useState<FishSuggestionProgress|null>(null);
  const suggestionController=useRef<AbortController|null>(null);
  /** 正在算的这一次：auto = 打开时后台自动算（不锁设置，开始捕捞时让路）；manual = 点计算图标（锁定，可取消）。 */
  const suggestionRun=useRef<{mode:'auto'|'manual';key:string;done:Promise<void>;target?:string}|null>(null);
  const autoTried=useRef(new Set<string>());
  useEffect(()=>{cardsOwner.current=owner;setCombinationState(readCombination());const cards=loadCards();setExtraCards(cards.slice(1));setFirstEnabled(cards[0]?.enabled??true);setSelected(cards[0]?.featureId??'cbi2');setPref(cards[0]?.pref??cleanPreference(readFishPreference('cbi2')));setSuggestion(latestFishSuggestion(selected));setSuggestionProgress(null);return()=>{suggestionController.current?.abort();suggestionController.current=null;};},[owner]);
  const listedDef=defs.find(d=>d.id===selected)??defs.find(d=>d.id==='cbi2')??defs[0];
  // 【用户要求】2026-10-19「保证内在统一」：渔与 K 线图、Deep dig 读同一份定义，没有「内置 / Deep dig」之分
  const def=listedDef;
  const [probe,setProbe]=useState<{symbol:string;exchange:FishExchange;busy:boolean;result:FishDiagnosis|null}>({symbol:'',exchange:'binance',busy:false,result:null});
  useEffect(()=>{if(def&&selected!==def.id){setSelected(def.id);setPref(cleanPreference(readFishPreference(def.id)));}},[def?.id,selected]);
  const update=(next:FishPreference)=>{if(!def)return;setPref(next);saveFishPreference(def.id,next);setError('');};
  const [autoSuggesting,setAutoSuggesting]=useState(false);
  const {exchanges,includeDuplicates,includeUsStocks=false}=p.selection,suggesting=suggestionProgress?.status==='running'&&!autoSuggesting,running=p.progress?.status==='running'||suggesting||!!p.reconstruction?.running;
  const compiled=useMemo(()=>{try{if(!def)throw new Error('Deep dig 里没有可用特征值');const plan=compileFishProgram(def,{statistic:pref.statistic??'结果',direction:pref.direction,threshold:pref.threshold.trim()?Number(pref.threshold):NaN,constraints:[]});return {plan,error:plan.unavailable??''};}catch(e){return {plan:null,error:e instanceof Error?e.message:String(e)};}},[def,pref]);
  const multiple=useMemo(()=>{
    const plans=[];let error='';
    const cards=[{id:'first',featureId:selected,enabled:firstEnabled,pref},...extraCards];
    for(const [i,c] of cards.entries())if(c.enabled)try{if(i===0){if(!compiled.plan||compiled.error)throw Error(compiled.error);plans.push(compiled.plan);continue;}const d=defs.find(d=>d.id===c.featureId);if(!d)throw Error('特征值已不存在');const plan=compileFishProgram(d,{statistic:c.pref.statistic,direction:c.pref.direction,threshold:c.pref.threshold.trim()?Number(c.pref.threshold):NaN,constraints:[]});if(plan.unavailable)throw Error(plan.unavailable);plans.push(plan);}catch(e){error=`算法 ${i+1}：${e instanceof Error?e.message:String(e)}`;}
    return {plans,error:error||(!plans.length?'请启用至少一个算法':'')};
  },[selected,firstEnabled,pref,extraCards,defs,compiled]);
  const pool=useMemo(()=>[{featureId:selected,pref},...extraCards].flatMap(c=>{try{const d=defs.find(d=>d.id===c.featureId);if(!d)return [];const plan=compileFishProgram(d,{statistic:c.pref.statistic,direction:c.pref.direction,threshold:c.pref.threshold.trim()?Number(c.pref.threshold):NaN,constraints:[]});return plan.unavailable?[]:[plan];}catch{return [];}}),[selected,pref,extraCards,defs]);
  const selectionKeys=multiple.plans.map(fishSelectionKey),selectionSignature=JSON.stringify(selectionKeys);
  const [staleRound,setStaleRound]=useState(false);
  // 只有用户自己改了勾选 / 合并方式 / 阈值才重新合并本轮结果；刚出现一轮（扫完或刷新后恢复）时不动它——
  // 默认卡升级或重新打开时不重新合并上一轮，保留已有新鱼。
  const recombineArmed=useRef(false);
  useEffect(()=>{if(!p.hasRound||running){recombineArmed.current=false;return;}if(!recombineArmed.current){recombineArmed.current=true;setStaleRound(false);return;}if(multiple.error&&multiple.error!=='请启用至少一个算法'){setStaleRound(true);return;}setStaleRound(!p.onRecombine?.(combination,selectionKeys,multiple.plans));},[selectionSignature,multiple.error,combination,p.hasRound,running,p.onRecombine]);
  // 进度悬停里的「算法 n」用卡片上的编号（停用的卡不参与，编号不顺延）
  const enabledCardNumbers=[firstEnabled,...extraCards.map(c=>c.enabled)].flatMap((on,i)=>on?[i+1]:[]);
  // 对不上本轮时说清楚原因：只是阈值放宽了，就告诉本轮按多少扫的、往哪边调能即时过滤
  const staleText=useMemo(()=>{
    for(const [j,plan] of multiple.plans.entries()){
      const bases=(p.roundPlans??[]).filter(b=>sameFamily(b,plan));
      if(!bases.length||bases.some(b=>fishTightenable(b,plan)))continue;
      const d=plan.settings.direction,edge=d==='>'?Math.min(...bases.map(b=>b.settings.threshold)):Math.max(...bases.map(b=>b.settings.threshold));
      return `算法 ${enabledCardNumbers[j]??j+1} 本轮按 ${d} ${edge} 扫过：阈值${d==='>'?'调大':'调小'}（${d==='>'?'≥':'≤'} ${edge}）可即时过滤，${d==='>'?'调小':'调大'}要重新捕捞。下面仍是上一轮的结果。`;
    }
    return '刚改的设置上一轮没算过，下面仍是上一轮的结果；点「开始捕捞」按新设置重算。';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selectionSignature,p.roundPlans]);
  const algorithmInputs=()=>multiple.plans.map(p=>({feature:p.def,algorithm:p.settings}));
  const runProbe=async()=>{
    if(!p.onDiagnose||!probe.symbol.trim()||running)return;
    let anchorMs:number|undefined;
    try{anchorMs=parseFishSettings(p.inputs.time,pref.threshold||'0').anchorMs;validateFishLookback(lookbackDraft);}catch(e){setProbe(v=>({...v,result:{outcome:'failed',lines:[e instanceof Error?e.message:String(e)]}}));return;}
    if(multiple.error){setProbe(v=>({...v,result:{outcome:'failed',lines:[multiple.error||'算法设置有误']}}));return;}
    setProbe(v=>({...v,busy:true,result:null}));
    try{const result=await p.onDiagnose({lookbackHours:validateFishLookback(lookbackDraft),downwardWick,turnoverFloors:FISH_TURNOVER_FLOORS,symbol:probe.symbol,exchange:probe.exchange,anchorMs,algorithms:algorithmInputs(),combination,signal:new AbortController().signal});setProbe(v=>({...v,busy:false,result}));}
    catch(e){setProbe(v=>({...v,busy:false,result:{outcome:'failed',lines:[e instanceof TypeError?'浏览器拦截（网络 / 跨域）':e instanceof Error?e.message:String(e)]}}));}
  };
  const suggestionCompiled=useMemo(()=>{try{if(!def)return null;return compileFishProgram(def,{statistic:pref.statistic??'结果',direction:pref.direction,threshold:pref.threshold.trim()?Number(pref.threshold):0,constraints:[]});}catch{return null;}},[def,pref]);
  const library=p.librarySignals??[],suggestionKey=suggestionCompiled?fishSuggestionKey(suggestionCompiled,library):'';
  useEffect(()=>{const cached=readFishSuggestion(suggestionKey);setSuggestion(previous=>previous?.key===suggestionKey?previous:cached?{...cached,cacheHit:true}:previous?.featureId===def?.id?previous:def?latestFishSuggestion(def.id):null);},[suggestionKey,def?.id,owner]);
  const plan=compiled.plan??suggestionCompiled;
  const suggestionStale=!!suggestion&&suggestion.key!==suggestionKey;
  const prefRef=useRef(pref);prefRef.current=pref;
  // 异步算完再写回输入时用最新的那份：用闭包里的旧值会把之后才填的「时间」冲回去（2026-10-20 交集「捕不到」的根因之一）
  const inputsRef=useRef(p.inputs);inputsRef.current=p.inputs;
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
      if(threshold!==null&&mayFillFishThreshold(current.threshold,current.lastSuggestion)){const value=String(threshold);update({...current,threshold:value,lastSuggestion:value});p.onInputsChange({...inputsRef.current,threshold:value});}
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
    if(p.hasRound||!library.length||scanning||p.reconstruction?.running||suggestionRun.current)return;
    const next=queue.find(q=>!autoTried.current.has(q.key)&&!readFishSuggestion(q.key));
    if(!next)return;
    const timer=setTimeout(()=>{if(suggestionRun.current||autoTried.current.has(next.key))return;autoTried.current.add(next.key);void calculateSuggestion('auto',next.target);},800);
    return()=>clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[queueKeys,selected,firstEnabled,scanning,library.length,autoSuggesting,p.reconstruction?.running,p.hasRound]);
  // 方向一换，阈值仍是上次自动填的建议时改填另一端（> 取 P25，< 取 P75）；分布与方向无关，不用重算
  const changeDirection=(direction:'>'|'<')=>{
    const fill=suggestion&&!suggestionStale?suggestedFishThreshold(suggestion,direction):null;
    if(fill!==null&&pref.lastSuggestion!==undefined&&mayFillFishThreshold(pref.threshold,pref.lastSuggestion)){const value=String(fill);update({...pref,direction,threshold:value,lastSuggestion:value});p.onInputsChange({...inputsRef.current,threshold:value});}
    else update({...pref,direction});
  };
  const start=async()=>{try{const hours=saveFishLookback(lookbackDraft);setLookbackHours(hours);const settings=parseFishSettings(p.inputs.time,String(multiple.plans[0]?.settings.threshold??0));if(!exchanges.length)throw new Error('请至少选择一家交易所');if(multiple.error&&!(p.onRecombine&&multiple.error==='请启用至少一个算法'))throw new Error(multiple.error);if(p.onRecombine&&!pool.length)throw new Error('没有有效算法');setError('');
    // 后台的建议计算给捕捞让路：先停掉、等它收尾（共用同一个取数器），再开始
    const pending=suggestionRun.current;if(pending){suggestionController.current?.abort();await pending.done;}
    const plans=p.onRecombine?pool:multiple.plans;
    for(const plan of plans){const checked=fishProgramForLookback(plan,hours,FISH_TURNOVER_FLOORS);if(checked.unavailable)throw new Error(checked.unavailable);}
    setWickChanged(false);
    p.onStart({...settings,lookbackHours:hours,downwardWick,feature:plans[0].def,algorithm:plans[0].settings,algorithms:plans.map(p=>({feature:p.def,algorithm:p.settings})),retainMembers:!!p.onRecombine,displayAlgorithmKeys:p.onRecombine?selectionKeys:undefined,combination,exchanges:[...exchanges],includeDuplicates,includeUsStocks,turnoverFloors:FISH_TURNOVER_FLOORS});}catch(e){setError(e instanceof Error?e.message:String(e));}};
  const fresh = useMemo(() => p.signals.filter(s => s.freshCatch), [p.signals]);
  const old = useMemo(() => p.signals.filter(s => !s.freshCatch), [p.signals]);
  const x = p.progress;
  const ruleText = (scanning||staleRound)&&x?.rule?x.rule:extraCards.length===0?(firstEnabled?fishRuleText(def,pref.direction,pref.threshold,0,pref.statistic):''):multiple.plans.map(p=>fishRuleText(p.def,p.settings.direction,p.settings.threshold,p.texts.length,p.settings.statistic)).join(combination==='or'?' 或 ':' 且 ');
  const [menuOpen,setMenuOpen]=useState(false);
  const iconBtn = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

  // 【用户要求】2026-10-19「渔界面内的内容可以上下滑动，要切换自如」：面板自己限高、内部滚动；顶栏（时间 / 捕捞 / 状态）滚动时贴顶。
  // 【用户要求】2026-10-20「渔的界面要完全按照最高级别的审美标准来设计，既简洁又美观又具备功能性」：
  // 顶栏一行操作（时间 · 主按钮 · 淡色工具），下面一行状态，底边一根细线兼作进度条；算法是一张对齐的表，合并方式用分段按钮。
  return <section className="mt-2 max-h-[65vh] min-w-0 overflow-y-auto overscroll-y-contain rounded-xl border border-border/60 bg-background" aria-label="渔" data-testid="fish-panel">
    <section aria-labelledby="fish-catching-title" data-testid="fish-catching">
      <div className="flex items-center px-4 pb-1 pt-3">
        <div className="flex items-center gap-0.5 pr-1.5"><button id="fish-catching-title" type="button" aria-expanded={open.catching} aria-controls="fish-catching-content" onClick={()=>setOpen({catching:!open.catching})} className={fishSectionHeading}><Play aria-hidden className="h-3 w-3 text-muted-foreground"/><span>捕捞</span><ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open.catching?'rotate-180':''}`}/></button><Popover><PopoverTrigger asChild><button type="button" aria-label="捕捞说明" title="捕捞说明" className={fishInfoTrigger}><CircleHelp aria-hidden strokeWidth={1.4} className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" className="max-h-[75vh] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto space-y-2.5 p-3.5 text-[11px] leading-relaxed" aria-label="捕捞说明">
        {/* 【用户要求】2026-10-21「渔的使用说明点开之后，内容要改成目的、流程（以及伴随的功能介绍）。要精简、只呈现核心要义」 */}
        <section className="space-y-1"><h4 className="text-[11.5px] font-semibold text-foreground">目的</h4>
          <p className="text-muted-foreground">在全市场永续合约里，按你设定的算法找出刚出现信号的标的（鱼），供复盘与交易参考。</p></section>
        <section className="space-y-1"><h4 className="text-[11.5px] font-semibold text-foreground">流程</h4>
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground marker:text-muted-foreground/60">
            <li><b className="font-medium text-foreground">设算法</b>：每张卡选一个 Deep dig 特征值、方向与阈值（下方有信号库建议区间）；多张卡选交集（全部命中）或并集（任一命中）。</li>
            <li><b className="font-medium text-foreground">捕捞</b>：手动点「开始捕捞」（时间留空 = 现在），或切到自动、每隔所选时长捕一次。覆盖时间默认过去 1 小时，可填写任意有效小时数；只收录在该范围内出现、截止时仍满足条件的信号，每个算法分别核验。指标预热与成交额回看不受此设置缩短。只看成交额达标的非稳定币：1h ≥ 100 万、12h ≥ 800 万、24h ≥ 1000 万 USDT，截止前与信号起点前都要满足。</li>
            <li><b className="font-medium text-foreground">看结果</b>：本轮捕到的进「新鱼」，上一轮的归入「鱼舱」；不手动删除就一直保留。交集 / 并集捕捞中也能随时切换；捕完调严阈值当场重算，不用重扫。</li>
            <li><b className="font-medium text-foreground">跟进</b>：点 → 跳到盘面，打星评分。「⋯」里有捕捞范围（交易所）、查单个币（为什么命中 / 没命中）、邮件提醒（新鱼有变化就发到邮箱）、复原（用历史信号评估算法）。</li>
          </ol></section>
        {(x?.anchorMs||x?.cutoffMs)&&<p className="border-t border-border/50 pt-2 text-[10.5px] text-muted-foreground/80">{x?.anchorMs?`本轮节点 ${formatUTC8(x.anchorMs)}`:''}{x?.anchorMs&&x?.cutoffMs?' · ':''}{x?.cutoffMs?`本轮阈值 ${plan?.settings.direction??'>'} ${x.threshold??.3}`:''}</p>}
          {(suggestion||suggestionProgress)&&<div className="space-y-1 border-l border-border/60 pl-3 text-[10px] text-muted-foreground" data-testid="fish-suggestion-detail">
      {suggestionProgress&&<p role="status">建议{suggestionProgress.status==='running'?'计算中':suggestionProgress.status==='cancelled'?'已取消':suggestionProgress.status==='aborted'?'已中止':'已完成'} · {suggestionProgress.phase==='signals'?'信号样本':'随机对照'} · {suggestionProgress.done} / {suggestionProgress.total} {suggestionProgress.current}</p>}
      {suggestion&&<><p className="whitespace-pre-wrap break-words">{fishSuggestionTitle(suggestion)}</p>{([['信号',suggestion.samples],['随机',suggestion.random]] as const).map(([label,stats])=>stats.failures.length>0&&<details key={label}><summary className="w-fit cursor-pointer">{label}跳过原因（前{stats.failures.length}项）</summary>{stats.failures.map((row,i)=><p key={i} className="break-words">{row.symbol} · {formatUTC8(row.timeMs)} · {row.reason}</p>)}</details>)}</>}
    </div>}
</PopoverContent></Popover></div>
      </div>
      <div id="fish-catching-content" hidden={!open.catching}>
    <header className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85" data-testid="fish-toolbar">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 px-4 pb-2.5 pt-1 text-[11px]">

        <label className="flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-transparent bg-muted/50 px-2 transition-colors focus-within:border-ring/60 focus-within:bg-background hover:bg-muted" title={p.auto?.mode==='auto'?'自动捕捞始终按当前时间；这里的时间只用于手动点「开始捕捞」':'格式 YYYY-MM-DD HH:mm:ss（UTC+8）；留空 = 币安服务器当前时间'}>
          <Clock3 aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground/60"/>
          <input aria-label="捕捞时间（UTC+8）" autoComplete="off" spellCheck={false} placeholder="留空 = 现在" className="w-[9.5rem] min-w-0 bg-transparent pt-0.5 font-mono tabular-nums text-foreground outline-none placeholder:text-muted-foreground/50 disabled:opacity-60" value={p.inputs.time} disabled={running} onChange={e=>{setError('');p.onInputsChange({...p.inputs,time:e.target.value});}}/>
          <span className="shrink-0 text-[9px] text-muted-foreground/60">UTC+8</span>
        </label>
        <label className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-muted/50 px-2 text-muted-foreground" title="只收录起点在所选时长内、截止时仍满足条件的信号。每个勾选算法分别按此范围判定；指标计算保留必要历史。自动捕捞间隔另行设置。">扫描过去<input aria-label="扫描覆盖时间（小时）" type="number" min="0.01" max="8784" step="any" disabled={running} value={lookbackDraft} onChange={e=>setLookbackDraft(e.target.value)} onBlur={applyLookback} onKeyDown={e=>{if(e.key==='Enter')applyLookback();}} className="h-6 w-12 rounded bg-transparent px-1 text-center font-mono tabular-nums text-foreground outline-none focus:bg-background disabled:opacity-40"/>小时</label>
        {running
          ?<button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-background px-3 font-medium text-foreground transition-colors hover:bg-muted" onClick={()=>p.reconstruction?.running?p.reconstruction.cancel():suggesting?suggestionController.current?.abort():p.onCancel()}><Square aria-hidden className="h-2.5 w-2.5 fill-current"/>取消</button>
          :<button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:shadow-none" disabled={running||probe.busy||!!multiple.error&&!(p.onRecombine&&multiple.error==='请启用至少一个算法')} onClick={()=>void start()}><Play aria-hidden className="h-2.5 w-2.5 fill-current"/>开始捕捞</button>}
        {/* 【用户要求】2026-10-21「这几个符号可以放在同一个隐形的菜单中。界面显示要简洁、不要视觉冗余」：
            捕捞范围 / 查单个币 / 邮件提醒 / 复原收进一个淡色「⋯」 */}
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild><button type="button" aria-label="更多" title="捕捞范围 · 查单个币 · 邮件提醒 · 复原" className={`${iconBtn} ${menuOpen||open.scope||open.probe||open.notify?'bg-muted text-foreground':''}`} data-testid="fish-more"><MoreHorizontal className="h-4 w-4"/></button></PopoverTrigger>
          <PopoverContent align="start" sideOffset={4} className="w-56 p-1 text-[11.5px]" data-testid="fish-more-menu">
            {([
              {key:'scope',icon:SlidersHorizontal,label:'捕捞范围',hint:exchanges.map(e=>EXCHANGE_NAMES[e]).join('、')||'未选交易所',active:open.scope,onClick:()=>setOpen({scope:!open.scope}),show:true},
              {key:'probe',icon:Search,label:'查单个币',hint:'',active:open.probe,onClick:()=>setOpen({probe:!open.probe}),show:!!p.onDiagnose,testId:'fish-probe-toggle'},
              {key:'notify',icon:Mail,label:'邮件提醒',hint:p.notify?.config.enabled?`已开启 · ${p.notify.config.emails.length} 个邮箱`:'未开启',active:open.notify,onClick:()=>setOpen({notify:!open.notify}),show:!!p.notify,testId:'fish-notify-toggle'},
              {key:'recon',icon:History,label:'复原',hint:'',active:false,onClick:async()=>{const pending=suggestionRun.current;if(pending){suggestionController.current?.abort();await pending.done;}await p.reconstruction!.start();},show:!!p.reconstruction,disabled:running||probe.busy||!p.reconstruction?.available,title:p.reconstruction?.settingsError||'复原：用信号发生前的数据评估各算法，仅保存在本机'},
            ] as const).filter(i=>i.show).map(i=>{const Icon=i.icon;return <button key={i.key} type="button" aria-label={i.label} aria-expanded={i.key==='recon'?undefined:i.active} title={'title' in i?i.title:undefined} disabled={'disabled' in i?i.disabled:false} data-testid={'testId' in i?i.testId:undefined}
              onClick={()=>{setMenuOpen(false);void i.onClick();}}
              className={`flex h-8 w-full items-center gap-2 rounded px-2 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40 ${i.active?'bg-muted/70 text-foreground':'text-foreground/85'}`}>
              <Icon aria-hidden className={`h-3.5 w-3.5 shrink-0 ${i.key==='notify'&&p.notify?.config.enabled?'text-primary/80':'text-muted-foreground'}`}/><span className="shrink-0">{i.label}</span>
              {i.hint&&<span className="ml-auto min-w-0 truncate pl-2 text-[10.5px] text-muted-foreground/70">{i.hint}</span>}
            </button>;})}
          </PopoverContent>
        </Popover>
        {p.auto&&<>
          {/* 【用户要求】2026-10-21「渔这里增设一个定时自动（& 手动）捕捉的功能」：手动 = 与原来一样；自动 = 每隔所选时长自动捕一次（时间 = 现在） */}
          <div role="radiogroup" aria-label="捕捞模式" className="inline-flex h-7 shrink-0 items-center rounded-md bg-muted/70 p-0.5 text-[11px]">
            {(['manual','auto'] as const).map(m=><button key={m} type="button" role="radio" aria-checked={p.auto!.mode===m} title={m==='manual'?'手动：点「开始捕捞」才捕':'自动：网站开着就每隔所选时长自动捕一次（按当前时间）'} onClick={()=>p.auto!.setMode(m)} className={`h-6 rounded px-2.5 transition-colors ${p.auto!.mode===m?'bg-background font-medium text-foreground shadow-sm':'text-muted-foreground hover:text-foreground'}`}>{m==='manual'?'手动':'自动'}</button>)}
          </div>
          {p.auto.mode==='auto'&&<>
            <span className="relative shrink-0"><select aria-label="自动捕捞间隔" value={p.auto.hours} onChange={e=>p.auto!.setHours(Number(e.target.value))} className="h-7 appearance-none rounded-md border border-transparent bg-muted/50 pl-2 pr-6 text-[11px] tabular-nums text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring/60">{FISH_AUTO_INTERVALS.map(h=><option key={h} value={h}>每 {h}h</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60"/></span>
            <span className="text-[10.5px] text-muted-foreground" data-testid="fish-auto-next" title={p.auto.lastRunAt?`上次自动 / 手动捕捞：${formatUTC8(p.auto.lastRunAt).slice(0,16)}`:undefined}>{!p.auto.online?'等待联网':p.auto.waiting?'到点了，等当前任务结束':p.auto.nextAt!==null&&p.auto.nextAt>Date.now()?`下次 ${formatUTC8(p.auto.nextAt).slice(5,16)}`:'即将开始'}</span>
          </>}
        </>}
      </div>
      {x&&lookbackHours!==x.lookbackHours&&<p className="px-4 pb-2 text-[10.5px] text-muted-foreground" data-testid="fish-lookback-changed">覆盖时间改为过去 {lookbackHours} 小时，下一轮生效；以下仍是过去 {x.lookbackHours} 小时的结果。</p>}
      {x && <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-2.5 text-[11px]">
        <p role="status" aria-live="polite" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5" data-testid="fish-status" title={[...(x.lookbackHours!==undefined?[`本轮覆盖过去 ${x.lookbackHours} 小时${x.counts.outside?`，${x.counts.outside} 个起点超出范围`:''}`]:[]),...(x.algorithmHits?.map((n,i)=>`算法 ${enabledCardNumbers[i]??i+1} 命中 ${n}`)??[]),...(x.wickSkipped?[`向下大插针已过滤 ${x.wickSkipped} 个`]:[]),...(x.thin?[`成交额不够（截止前或信号前 1h < 100 万、12h < 800 万或 24h < 1000 万）、跳过 ${x.thin} 个`]:[])].join('；')||undefined}>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${scanning?'animate-pulse bg-primary':x.status==='complete'?'bg-primary/60':x.status==='aborted'?'bg-destructive':'bg-muted-foreground/50'}`}/>{STATUS[x.status]}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-muted-foreground">命中 <span className="font-mono text-[12px] font-semibold tabular-nums text-primary">{x.counts.hit}</span></span>
          <span className="text-muted-foreground/40">·</span>
          <span className="font-mono tabular-nums text-muted-foreground">{x.done} / {x.total}</span>
          {!!x.wickSkipped&&<><span className="text-muted-foreground/40">·</span><span className="text-muted-foreground" data-testid="fish-wick-skipped">插针过滤 {x.wickSkipped}</span></>}
          {x.cutoffMs!=null&&<><span className="text-muted-foreground/40">·</span><span className="font-mono tabular-nums text-muted-foreground" data-testid="fish-cutoff" title="本轮实际使用的截止时刻（时间留空 = 币安服务器当前时间）">截止 {formatUTC8(x.cutoffMs).slice(0,16)}</span></>}
        </p>
      </div>}
      <div className="relative h-px bg-border/60" aria-hidden>{scanning && x && x.total > 0 && <span className="absolute bottom-0 left-0 h-[2px] rounded-r-full bg-primary transition-[width] duration-300" style={{ width: `${Math.min(100, (x.done / x.total) * 100)}%` }} />}</div>
    </header>
    <div className="min-w-0 space-y-3 px-4 pb-4 pt-3">
    {open.notify&&p.notify&&<FishNotifySettings notify={p.notify}/>}
    {open.scope && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground" aria-label="捕捞交易所">
      {AUDITED_EXCHANGES.map(exchange => <label key={exchange} className="flex items-center gap-1.5">
        <FishCheck disabled={running} checked={exchanges.includes(exchange)} onChange={e => p.onSelectionChange({ ...p.selection, exchanges: AUDITED_EXCHANGES.filter(x => x === exchange ? e.target.checked : exchanges.includes(x)) })} />
        {EXCHANGE_NAMES[exchange]}
      </label>)}
      <label className="flex items-center gap-1.5"><FishCheck checked={includeUsStocks} disabled={running} onChange={e=>p.onSelectionChange({...p.selection,includeUsStocks:e.target.checked})}/>美股</label>
      <label className="ml-1 flex items-center gap-1.5 border-l border-border/60 pl-4"><FishCheck disabled={running} checked={includeDuplicates} onChange={e => p.onSelectionChange({ ...p.selection, includeDuplicates: e.target.checked })} />含重复币</label>
    </div>}
    {open.scope&&<div className="space-y-1.5 rounded-lg bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground" data-testid="fish-wick-settings">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5"><FishCheck aria-label="过滤向下大插针" checked={downwardWick.enabled} disabled={running||probe.busy} onChange={e=>updateWick({enabled:e.target.checked})}/>过滤向下大插针</label>
        <label className="flex items-center gap-1.5">回看<select aria-label="插针回看时长" className="h-6 rounded border border-border/60 bg-background px-1.5 text-foreground disabled:opacity-40" value={downwardWick.hours} disabled={running||probe.busy||!downwardWick.enabled} onChange={e=>updateWick({hours:Number(e.target.value)})}>{FISH_WICK_HOURS.map(h=><option key={h} value={h}>{h}h</option>)}</select></label>
        <label className="flex items-center gap-1.5">开盘至最低价跌幅 &gt; ATR(14) ×<select aria-label="插针 ATR 倍数" className="h-6 rounded border border-border/60 bg-background px-1.5 text-foreground disabled:opacity-40" value={downwardWick.atrMultiple} disabled={running||probe.busy||!downwardWick.enabled} onChange={e=>updateWick({atrMultiple:Number(e.target.value)})}>{FISH_WICK_ATR_MULTIPLES.map(n=><option key={n} value={n}>{n}</option>)}</select></label>
        <FishQualityInfo label="插针过滤说明"><p className="text-muted-foreground">只看已收盘 5m K 线，以开盘价减最低价计跌幅，包含大阴线和下影线；严格大于所选 ATR 倍数即过滤，不限制实体或下影占比。ATR(14) 取该根之前 14 根真实波幅的均值，不含该根和之后的数据。手动、自动及单币查询共用。</p></FishQualityInfo>
      </div>
      {wickChanged&&<p className="text-[10px] text-primary">过滤设置将在下次捕捞生效，下面仍是已保存的结果。</p>}
    </div>}
    {open.probe&&p.onDiagnose&&<div className="space-y-1.5 rounded-lg bg-muted/30 px-3 py-2 text-[11px]" data-testid="fish-probe">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>查单个币</span>
        <input aria-label="查单个币的标的" placeholder="如 RAVE 或 RAVEUSDT" value={probe.symbol} onChange={e=>setProbe({...probe,symbol:e.target.value})} onKeyDown={e=>{if(e.key==='Enter')void runProbe();}} className="h-7 w-40 rounded-md border border-transparent bg-background px-2 pt-0.5 font-mono text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus-visible:border-ring/60" />
        <span className="relative"><select aria-label="查单个币的交易所" value={probe.exchange} onChange={e=>setProbe({...probe,exchange:e.target.value as FishExchange})} className="h-7 appearance-none rounded-md border border-transparent bg-background pl-2 pr-6 text-foreground outline-none focus-visible:border-ring/60">
          {AUDITED_EXCHANGES.map(e=><option key={e} value={e}>{EXCHANGE_NAMES[e]}</option>)}
        </select><ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60"/></span>
        <button type="button" className="h-7 rounded-md border border-border/70 bg-background px-3 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40" disabled={running||probe.busy||!probe.symbol.trim()} onClick={()=>void runProbe()}>{probe.busy?'查询中…':'查'}</button>
        <FishQualityInfo label="查单个币说明"><p className="text-muted-foreground">按上面的算法、阈值与时间，用与捕捞相同的取数和判定，说明命中或没命中的原因；结果不入库。</p></FishQualityInfo>
      </div>
      {probe.result&&<div className={`space-y-0.5 border-l pl-2 ${probe.result.outcome==='hit'?'border-primary/60':'border-border/60'}`} data-testid="fish-probe-result">
        {probe.result.lines.map((line,i)=><p key={i} className={i===0?'font-mono text-[10.5px] text-muted-foreground':'text-foreground/90'}>{line}</p>)}
      </div>}
    </div>}
    {(error||multiple.error&&!(p.onRecombine&&multiple.error==='请启用至少一个算法')) && <p role="alert" className="text-[11px] text-destructive">{error||multiple.error}</p>}
    {x?.error && <p className="text-[11px] text-destructive">{x.error}</p>}
    {p.auto?.error && <p className="text-[11px] text-destructive/80" data-testid="fish-auto-error">{p.auto.error}</p>}
    {x?.notice && <p className="break-words text-[10.5px] text-muted-foreground" data-testid="fish-notice">{x.notice}</p>}
    {/* 【用户要求】2026-10-28「三个模块各自领域内的隶属关系要清晰显示」：算法与新鱼是捕捞的组成部分，收在左侧竖线里、标题小一级（与鱼质量的挖掘 / 过滤 / 监测同一种样式） */}
    <div className={`${fishRail} space-y-2`} data-testid="fish-catching-parts">
    <section className="space-y-1.5" data-testid="fish-algorithm-section">
      <div className="flex min-w-0 items-center gap-2"><button type="button" aria-expanded={open.algorithms} aria-controls="fish-algorithms-content" onClick={()=>setOpen({algorithms:!open.algorithms})} className={fishSubHeading}><ListChecks aria-hidden className="h-3 w-3 text-muted-foreground"/><span>算法</span><ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open.algorithms?'rotate-180':''}`}/></button>
        {!open.algorithms&&<span className="min-w-0 truncate text-[10.5px] text-muted-foreground" title={ruleText}>{enabledCardNumbers.length} 个启用{enabledCardNumbers.length>1?` · ${combination==='or'?'并集':'交集'}`:''}</span>}</div>
      <div id="fish-algorithms-content" hidden={!open.algorithms} className="space-y-1.5">
    <div className="w-fit min-w-0 max-w-full overflow-hidden rounded-lg border border-border/60" data-testid="fish-algorithms">
      <div className="divide-y divide-border/50">
      <FishAlgorithmCard card={{id:'first',featureId:selected,enabled:firstEnabled,pref}} defs={defs} index={1} locked={running} canDelete={extraCards.length>0} onRecalculate={()=>void calculateSuggestion('manual')} recalculateDisabled={running||probe.busy||!p.onSuggest||!suggestionCompiled||!!suggestionCompiled.unavailable} recalculating={suggestionProgress?.status==='running'&&suggestionRun.current?.target==='first'} footer={<>
      {suggestion&&<span className="text-[10px] text-muted-foreground" data-testid="fish-suggestion" title={fishSuggestionTitle(suggestion)}>{suggestion.samples.p25===null?'信号库暂无有效建议':`信号库建议 ${Number(suggestion.samples.p25.toPrecision(6))} ~ ${Number(suggestion.samples.p75!.toPrecision(6))}`}（{suggestion.samples.n} / {suggestionStale?suggestion.samples.attempted:library.length} 条）{suggestionStale?(autoSuggesting?' · 更新中':' · 已过期'):''}</span>}
      {!suggestion&&suggestionProgress?.status==='running'&&suggestionRun.current?.target==='first'&&suggestionProgress&&<span className="text-[10px] text-muted-foreground/70" data-testid="fish-suggestion-auto">信号库建议计算中 {suggestionProgress.done} / {suggestionProgress.total||library.length}</span>}
      </>}
        onChange={next=>{setFirstEnabled(next.enabled);if(next.featureId===selected&&next.pref.direction!==pref.direction){changeDirection(next.pref.direction);return;}setSelected(next.featureId);setPref(cleanPreference(next.pref));saveFishPreference(next.featureId,cleanPreference(next.pref));setError('');p.onInputsChange({...p.inputs,threshold:next.pref.threshold});}}
        onDelete={()=>{const [next,...rest]=extraCards;setSelected(next.featureId);setPref(next.pref);setFirstEnabled(next.enabled);setExtraCards(rest);}}/>
      {extraCards.map((card,i)=><FishAlgorithmCard key={card.id} card={card} defs={defs} index={i+2} locked={running} onRecalculate={()=>{const target=extraSuggest[i];if(target)void calculateSuggestion('manual',{id:target.id,plan:target.plan});}} recalculateDisabled={running||probe.busy||!p.onSuggest||!extraSuggest[i]} recalculating={suggestionProgress?.status==='running'&&suggestionRun.current?.target===card.id} suggestion={extraSuggest[i]?.cached??null} queued={!!extraSuggest[i]?.queued} librarySize={library.length} computing={suggestionProgress?.status==='running'&&suggestionRun.current?.target===card.id&&suggestionProgress?`${suggestionProgress.done} / ${suggestionProgress.total||library.length}`:''} onChange={next=>setExtraCards(cs=>cs.map(c=>c.id===next.id?next:c))} onDelete={()=>setExtraCards(cs=>cs.filter(c=>c.id!==card.id))}/>)}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/50 bg-muted/20 px-2 py-1.5">
        <button type="button" aria-label="+ 算法" title={`添加一个算法（最多 ${FISH_MAX_ALGORITHMS} 个）`} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40" disabled={running||extraCards.length>=FISH_MAX_ALGORITHMS-1} onClick={()=>setExtraCards(cs=>cs.length>=FISH_MAX_ALGORITHMS-1?cs:[...cs,{id:crypto.randomUUID(),featureId:def?.id??'cbi2',enabled:true,pref:structuredClone(pref)}])}><Plus aria-hidden className="h-3 w-3"/>算法</button>
        {extraCards.length>0&&<div role="radiogroup" aria-label="多重算法合并方式" className="inline-flex h-6 shrink-0 items-center rounded-md bg-muted/70 p-0.5 text-[10.5px]">
          {([['and','交集','每个算法都命中才留下'],['or','并集','任一算法命中即留下']] as const).map(([value,text,hint])=><button key={value} type="button" role="radio" aria-checked={combination===value} title={hint} disabled={running&&!(scanning&&p.onLiveCombination)} onClick={()=>{if(value===combination)return;setCombination(value);if(scanning)p.onLiveCombination?.(value);}} className={`h-5 rounded px-2 transition-colors disabled:opacity-50 ${combination===value?'bg-background font-medium text-foreground shadow-sm':'text-muted-foreground hover:text-foreground'}`}>{text}</button>)}
        </div>}
        <Popover><PopoverTrigger asChild><button type="button" aria-label="组合说明" title="组合说明" className={fishInfoTrigger}><CircleHelp aria-hidden strokeWidth={1.4} className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-2 p-3 text-[11px] leading-relaxed" aria-label="组合说明"><p className="font-medium">{combination==='or'?'并集：任一算法命中即留下':'交集：每个算法都命中才留下'}</p><p className="break-words text-muted-foreground" data-testid="fish-rule">{ruleText}</p></PopoverContent></Popover>
      </div>
    </div>
    {staleRound&&!running&&<p className="text-[10.5px] text-muted-foreground" data-testid="fish-stale-round">{staleText}</p>}
    {p.reconstruction&&<FishReconstructionResults state={p.reconstruction}/>}
      </div>
    </section>
    {/* 【用户要求】2026-10-19 新鱼 = 最近一次捕捞捕到的；点开始捕捞时上一轮的新鱼归入「鱼舱」 */}
    <FishLibrary key={owner+'new'} rememberViewKey={owner+'new'} level="sub" title="新鱼" testId="fish-new" signals={fresh} defaultOpen={fresh.length > 0} info={<p>最近一次捕捞捕到的鱼。下次点「开始捕捞」时，这些会归入鱼舱。</p>} emptyText={scanning ? '捕捞中，捕到的会出现在这里。' : '还没有新鱼。'}
      tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={p.onRate} />
    </div>
    </div>
      </div>
    </section>
    <section className="min-w-0 border-t border-border/50 px-4 py-3" aria-label="鱼舱模块" data-testid="fish-cabin">
    <FishLibrary key={owner+'old'} rememberViewKey={owner+'old'} title="鱼舱" testId="fish-old" signals={old} defaultOpen info={<><p>每次开始捕捞时，上一轮的新鱼归入鱼舱；不手动删除就一直保留。</p><p className="text-muted-foreground">「导出数据」导出全部鱼舱记录（列表信息、具体指标和捕获阈值），不受当前筛选影响。</p></>} onExport={()=>{try{downloadFishCabin(old);toast.success(`已导出 ${old.length} 条鱼舱记录`);}catch(error){toast.error(error instanceof Error?error.message:'导出失败');}}} emptyText="鱼舱还是空的。"
      tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={p.onRate} />
    </section>
    {p.quality && <ModuleErrorBoundary label="鱼质量" backgroundTasks><FishQuality state={p.quality} mining={p.mining} onJump={source => p.onJumpQuality ? p.onJumpQuality(source) : p.onJump(source.id)} canJump={source => !p.jumpingSignalId && !!signalChartSymbol(source) && (!!p.onJumpQuality || p.signals.some(s => s.id === source.id))}/></ModuleErrorBoundary>}
  </section>;
}
