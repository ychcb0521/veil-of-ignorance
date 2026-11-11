import { useFishAccountSettings } from '@/hooks/useFishAccountSettings';
import { readFishAccountSettings, type FishAccountSettings } from '@/lib/fish/accountSettings';
import { FishPopoverContent as PopoverContent } from '@/components/FishPopoverContent';
import { FISH_PANEL_DEFAULTS } from './fishPanelDefaults';
import { readFishLookback, saveFishLookback, validateFishLookback, fishProgramForLookback } from '@/lib/fish/lookback';
import {fishSignalInRoundWindow} from '@/lib/fish/roundWindow';
import { downloadFishCabin } from '@/lib/fish/export';
import { toast } from 'sonner';
import { fishWickDuration, readFishDownwardWick, readLegacyFishDownwardWick } from '@/lib/fish/downwardWick';
import {readPersistedStateRaw,writePersistedStateRaw} from '@/lib/persistedStateStorage';
import { FishReconstructionResults } from './FishReconstruction';
import type { FishReconstructionState } from '@/hooks/useFishReconstruction';
import {FishAlgorithmCard,FishCheck,RECORDED_RANGES,type FishCard} from './FishAlgorithmCard';
import {getUserId,getUserPrefix} from '@/lib/userStoragePrefix';
import { useFishFeatures } from '@/hooks/useFishFeatures';
import {compileFishProgram,type FishProgram} from '@/lib/fish/algorithm';
import {fishTightenable,sameFamily} from '@/lib/fish/refilter';
import {FISH_DEFAULT_ALGORITHMS,fishCardsKey as cardsKey,readFishCards as readCards,fishDefaultCards as defaultCards,fishCombinationKey as combinationKey,readFishCombination as readCombination} from '@/lib/fish/cards';
import { FISH_MAX_ALGORITHMS, formatTurnoverWan } from '@/lib/fish/shared';
import { readCaptureTurnoverSettings } from '@/lib/fish/turnoverSettings';
import {FISH_AUTO_INTERVALS} from '@/lib/fish/autoScan';
import type {FishAutoScan} from '@/hooks/useFishAutoScan';
import type {FishNotify} from '@/hooks/useFishNotify';
import { fishEmailAlgorithm } from '@/lib/fish/notify';
import { qualityMembers } from '@/lib/fish/quality';
import { definitionKey } from '@/lib/deepDig/features';
import {FishNotifySettings} from './FishNotifySettings';
import {readFishPreference,saveFishPreference,withFishDefaultThreshold,type FishPreference} from '@/lib/fish/preferences';
import { fishRuleText } from '@/lib/fishRule';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AUDITED_EXCHANGES, EXCHANGE_NAMES, type FishExchange } from '@/lib/fish/exchanges';
import { Activity, ChevronDown, CircleHelp, Clock3, Copy, Gauge, History, ListChecks, Play, Plus, ScanSearch, Settings, ShieldAlert, Square } from 'lucide-react';
import { fishInfoTrigger, fishRail, fishSectionHeading, fishSubHeading } from './FishSection';
import { FishQualityInfo } from './FishQualityModule';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { signalChartSymbol, type TradeSignal } from '@/lib/signalLibrary';
import { fishSelectionKey, parseFishSettings, type FishScanSettings, type FishProgress } from '@/lib/fishScanner';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { formatUTC8 } from '@/lib/timeFormat';
import { FishLibrary } from '@/components/FishLibrary';
import { FishHitRateTest } from '@/components/FishHitRateTest';
import { FishHitRateSettingsForm } from '@/components/FishHitRateSettingsForm';
import { DEFAULT_FISH_HIT_RATE_WINDOW, validateFishHitRateWindow, type FishHitRateOptions } from '@/lib/fish/hitRate';
import { readSavedFishHitRateSettings, type FishHitRateSettings } from '@/lib/fish/hitRateSettings';
import { buildFishScanSettings } from '@/lib/fish/scanPlan';
import { FishWickDetails } from '@/components/FishWickDetails';
import { FishWickSettings } from '@/components/FishWickSettings';
import { FishCaptureOpenSettings } from '@/components/FishCaptureSettings';
import { FishQuality } from '@/components/FishQuality';
import { ModuleErrorBoundary } from '@/components/ModuleErrorBoundary';
import type { FishQualityState } from '@/hooks/useFishQuality';

import {fishSuggestionKey,readFishSuggestion,latestFishSuggestion,saveFishSuggestion,suggestedFishThreshold,mayFillFishThreshold,fishSuggestionTitle,type FishSuggestion,type FishSuggestionOptions,type FishSuggestionProgress} from '@/lib/fish/suggestions';

export interface FishPanelProps {
  /** TimeControl fills the remaining viewport when 渔 is expanded. */
  fillHeight?:boolean;
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
  librarySignals?: TradeSignal[];
  onSuggest?: (options:FishSuggestionOptions)=>Promise<FishSuggestion>;
  onTestHitRate?: (options: FishHitRateOptions) => Promise<void>;
  signals: TradeSignal[]; progress: FishProgress | null;
  inputs: { time: string; threshold: string }; onInputsChange: (value: { time: string; threshold: string }) => void;
  selection: { exchanges: FishExchange[]; includeDuplicates: boolean; includeUsStocks?: boolean }; onSelectionChange: (value: { exchanges: FishExchange[]; includeDuplicates: boolean; includeUsStocks?: boolean }) => void;
  onStart: (settings: FishScanSettings) => void; onCancel: () => void;
  onJumpQuality?: (source: TradeSignal) => void;
  onRateQuality?: (source:TradeSignal,value:number)=>void;
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
const catchingDefaultKey = () => `${getUserPrefix()}fish-catching-default.v1`;
type FishOpen = { settings: boolean; catching: boolean; cabin: boolean; algorithms: boolean; captureQuality: boolean; hitRate: boolean };
function readCatchingDefault() {
  try {
    const saved = localStorage.getItem(catchingDefaultKey());
    return saved === null ? FISH_PANEL_DEFAULTS.catching : saved === 'true';
  } catch { return FISH_PANEL_DEFAULTS.catching; }
}
// 本次浏览里手动切换过的面板保持该状态。
function readOpen(): FishOpen {
  const pick = (v: unknown, fallback: boolean) => typeof v === 'boolean' ? v : fallback;
  const catching = readCatchingDefault();
  try { const v = JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? '{}'); return { settings: v.settings === true, catching: pick(v.catching, catching), cabin: pick(v.cabin, FISH_PANEL_DEFAULTS.cabin), algorithms: v.algorithms !== false, captureQuality: v.captureQuality === true, hitRate: v.hitRate === true }; }
  catch { return { settings: false, catching, cabin: FISH_PANEL_DEFAULTS.cabin, algorithms: true, captureQuality: false, hitRate: false }; }
}
const STATUS: Record<FishProgress['status'], string> = { running: '捕捞中', complete: '捕捞完成', cancelled: '已取消', aborted: '已中止', skipped: '已跳过' };

export function FishPanel(p: FishPanelProps) {
  const [error,setError]=useState(''),defs=useFishFeatures();
  const [open, setOpenState] = useState(readOpen);
  const [hitRateRunning, setHitRateRunning] = useState(false);
  const setOpen = (patch: Partial<FishOpen>) => setOpenState(o => {
    const next = { ...o, ...patch };
    try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* 记不住只是下次要再点 */ }
    return next;
  });

  const owner=getUserPrefix();
  const jumpQuality = (source: TradeSignal) => p.onJumpQuality ? p.onJumpQuality(source) : p.onJump(source.id);
  const canJumpQuality = (source: TradeSignal) => !p.jumpingSignalId && !!signalChartSymbol(source)
    && (!!p.onJumpQuality || p.signals.some(signal => signal.id === source.id));
  const {settings: savedAccountSettings, save: saveAccountSettings, saveLookback, downwardWick, saveDownwardWick, turnover, saveTurnover}=useFishAccountSettings();
  const [savingParameters,setSavingParameters]=useState(false);
  const [lookbackHours,setLookbackHours]=useState(readFishLookback),[lookbackDraft,setLookbackDraft]=useState(()=>String(readFishLookback()));
  useEffect(()=>{const h=readFishLookback();setLookbackHours(h);setLookbackDraft(String(h));},[owner]);
  const applyLookback=async()=>{
    const editingOwner=owner;
    try {
      const hours=validateFishLookback(lookbackDraft);
      setLookbackHours(hours);setError('');
      await saveLookback(hours);
    } catch(e) {
      if(getUserPrefix()===editingOwner)setError(e instanceof Error?e.message:'覆盖时间无效');
    }
  };
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
  // Saving the coverage alone must preserve edits in the algorithm cards and other controls.
  const accountAlgorithmKey=JSON.stringify([savedAccountSettings?.cards,savedAccountSettings?.combination]);
  const accountLookbackHours=savedAccountSettings?.lookbackHours;
  const accountSelectionKey=JSON.stringify(savedAccountSettings?.selection);
  useEffect(()=>()=>{suggestionController.current?.abort();suggestionController.current=null;},[owner]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{cardsOwner.current=owner;setCombinationState(readCombination());const cards=loadCards();setExtraCards(cards.slice(1));setFirstEnabled(cards[0]?.enabled??true);setSelected(cards[0]?.featureId??'cbi2');setPref(cards[0]?.pref??cleanPreference(readFishPreference('cbi2')));setSuggestion(latestFishSuggestion(selected));setSuggestionProgress(null);},[owner,accountAlgorithmKey]);
  useEffect(()=>{if(accountLookbackHours===undefined)return;setLookbackHours(accountLookbackHours);setLookbackDraft(String(accountLookbackHours));},[owner,accountLookbackHours]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{if(savedAccountSettings)p.onSelectionChange(savedAccountSettings.selection);},[owner,accountSelectionKey]);
  const listedDef=defs.find(d=>d.id===selected)??defs.find(d=>d.id==='cbi2')??defs[0];
  // 【用户要求】2026-10-19「保证内在统一」：渔与 K 线图、Deep dig 读同一份定义，没有「内置 / Deep dig」之分
  const def=listedDef;
  useEffect(()=>{if(def&&selected!==def.id){setSelected(def.id);setPref(cleanPreference(readFishPreference(def.id)));}},[def?.id,selected]);
  const update=(next:FishPreference)=>{if(!def)return;setPref(next);saveFishPreference(def.id,next);setError('');};
  const [autoSuggesting,setAutoSuggesting]=useState(false);
  const {exchanges,includeDuplicates,includeUsStocks=false}=p.selection,suggesting=suggestionProgress?.status==='running'&&!autoSuggesting,running=savingParameters||p.progress?.status==='running'||suggesting||!!p.reconstruction?.running;
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
  const parameterDraft=():FishAccountSettings=>({version:1,cards:[{id:'first',featureId:selected,enabled:firstEnabled,pref:{...pref,lastSuggestion:undefined}},...extraCards.map(c=>({...c,pref:{...c.pref,lastSuggestion:undefined}}))],combination,lookbackHours:validateFishLookback(lookbackDraft),downwardWick:readLegacyFishDownwardWick(owner),selection:p.selection,...(p.auto?{auto:{mode:p.auto.mode,hours:p.auto.hours}}:{})});
  const saveParameters=async()=>{setSavingParameters(true);setError('');try{if(multiple.error)throw new Error(multiple.error);if(!p.selection.exchanges.length)throw new Error('请至少选择一家交易所');await saveAccountSettings(parameterDraft());toast.success('捕捞参数已保存到账号');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setSavingParameters(false);}};

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
    if(!targetPlan||targetPlan.unavailable||!p.onSuggest||running)return;
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
        if(mode==='auto'&&savedAccountSettings){setSuggestionProgress(null);return;}
        setExtraCards(cs=>cs.map(c=>{if(c.id!==target.id)return c;const t=suggestedFishThreshold(result,c.pref.direction);if(t===null||!mayFillFishThreshold(c.pref.threshold,c.pref.lastSuggestion))return c;return {...c,pref:{...c.pref,threshold:String(t),lastSuggestion:String(t)}};}));
        setSuggestionProgress(null);return;
      }
      const current=prefRef.current,threshold=suggestedFishThreshold(result,current.direction);
      if((mode==='manual'||!savedAccountSettings)&&threshold!==null&&mayFillFishThreshold(current.threshold,current.lastSuggestion)){const value=String(threshold);update({...current,threshold:value,lastSuggestion:value});p.onInputsChange({...inputsRef.current,threshold:value});}
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
    if(p.hasRound||!library.length||scanning||hitRateRunning||p.reconstruction?.running||suggestionRun.current)return;
    const next=queue.find(q=>!autoTried.current.has(q.key)&&!readFishSuggestion(q.key));
    if(!next)return;
    const timer=setTimeout(()=>{if(suggestionRun.current||autoTried.current.has(next.key))return;autoTried.current.add(next.key);void calculateSuggestion('auto',next.target);},800);
    return()=>clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[queueKeys,selected,firstEnabled,scanning,library.length,autoSuggesting,hitRateRunning,p.reconstruction?.running,p.hasRound]);
  // 方向一换，阈值仍是上次自动填的建议时改填另一端（> 取 P25，< 取 P75）；分布与方向无关，不用重算
  const changeDirection=(direction:'>'|'<')=>{
    const fill=suggestion&&!suggestionStale?suggestedFishThreshold(suggestion,direction):null;
    if(fill!==null&&pref.lastSuggestion!==undefined&&mayFillFishThreshold(pref.threshold,pref.lastSuggestion)){const value=String(fill);update({...pref,direction,threshold:value,lastSuggestion:value});p.onInputsChange({...inputsRef.current,threshold:value});}
    else update({...pref,direction});
  };
  const start=async()=>{try{const hours=saveFishLookback(lookbackDraft);setLookbackHours(hours);void applyLookback();const settings=parseFishSettings(p.inputs.time,String(multiple.plans[0]?.settings.threshold??0));if(!exchanges.length)throw new Error('请至少选择一家交易所');if(multiple.error&&!(p.onRecombine&&multiple.error==='请启用至少一个算法'))throw new Error(multiple.error);if(p.onRecombine&&!pool.length)throw new Error('没有有效算法');setError('');
    // 后台的建议计算给捕捞让路：先停掉、等它收尾（共用同一个取数器），再开始
    const pending=suggestionRun.current;if(pending){suggestionController.current?.abort();await pending.done;}
    const plans=p.onRecombine?pool:multiple.plans;
    const currentTurnover = readCaptureTurnoverSettings(owner);
    const turnoverFloors = currentTurnover.enabled ? currentTurnover.floors : [];
    for(const plan of plans){const checked=fishProgramForLookback(plan,hours,turnoverFloors);if(checked.unavailable)throw new Error(checked.unavailable);}
    p.onStart({...settings,lookbackHours:hours,downwardWick:readFishDownwardWick(owner),feature:plans[0].def,algorithm:plans[0].settings,algorithms:plans.map(p=>({feature:p.def,algorithm:p.settings})),retainMembers:!!p.onRecombine,displayAlgorithmKeys:p.onRecombine?selectionKeys:undefined,combination,exchanges:[...exchanges],includeDuplicates,includeUsStocks,turnoverFloors});}catch(e){setError(e instanceof Error?e.message:String(e));}};
  const windowAnchor=p.progress?.anchorMs,windowHours=p.progress?.lookbackHours;
  const scanWindow = windowAnchor != null && Number.isFinite(windowAnchor) && windowHours !== undefined
    ? { start: formatUTC8(windowAnchor - windowHours * 3_600_000), end: formatUTC8(windowAnchor) }
    : null;
  const captureHitRateSettings = (): FishHitRateSettings => ({
    version: 1,
    cards: [{ id: 'first', featureId: selected, enabled: firstEnabled, pref }, ...extraCards],
    combination, selection: { exchanges: [...exchanges], includeDuplicates, includeUsStocks },
    downwardWick: readFishDownwardWick(owner), turnover: readCaptureTurnoverSettings(owner),
    window: { ...DEFAULT_FISH_HIT_RATE_WINDOW },
  });
  const {fresh,old}=useMemo(()=>{const fresh:TradeSignal[]=[],old:TradeSignal[]=[];for(const signal of p.signals)(signal.freshCatch&&fishSignalInRoundWindow(signal,{anchorMs:windowAnchor,lookbackHours:windowHours})?fresh:old).push(signal);return {fresh,old};},[p.signals,windowAnchor,windowHours]);
  const x = p.progress, auto = p.auto;
  const ruleText = (scanning||staleRound)&&x?.rule?x.rule:extraCards.length===0?(firstEnabled?fishRuleText(def,pref.direction,pref.threshold,0,pref.statistic):''):multiple.plans.map(p=>fishRuleText(p.def,p.settings.direction,p.settings.threshold,p.texts.length,p.settings.statistic)).join(combination==='or'?' 或 ':' 且 ');
  const [captureCopyRevision, setCaptureCopyRevision] = useState(0);
  const [captureCopy, setCaptureCopy] = useState<{ owner: string; settings: FishHitRateSettings } | null>(null);
  const [copyError, setCopyError] = useState('');
  const openCaptureCopy = () => {
    try {
      setCaptureCopy({ owner, settings: readSavedFishHitRateSettings() });
      setCopyError('');
    } catch (cause) {
      setCopyError(cause instanceof Error ? cause.message : '捕捞质量设置读取失败');
    }
  };
  const saveCaptureCopy = async ({ cards, combination, selection, downwardWick, turnover, window }: FishHitRateSettings) => {
    if (running || hitRateRunning || getUserPrefix() !== owner) throw new Error('当前任务结束后可以保存设置');
    if (!getUserId()) throw new Error('请先登录后保存账号参数');
    const lookbackHours = validateFishHitRateWindow(window);
    const fixedCards = cards.map(card => ({ ...card, pref: { ...cleanPreference(card.pref), lastSuggestion: undefined } }));
    const built = buildFishScanSettings({ cards: fixedCards, defs, combination, selection, time: '', lookbackHours,
      downwardWick, turnoverFloors: turnover.enabled ? turnover.floors : [] });
    if (!built.settings) throw new Error(built.error);
    const auto = readFishAccountSettings()?.auto;
    const profile: FishAccountSettings = { version: 1, cards: fixedCards, combination, selection, lookbackHours,
      downwardWick: readLegacyFishDownwardWick(owner), ...(auto && { auto }) };
    setSavingParameters(true);
    setError('');
    try {
      const writes = [saveDownwardWick(downwardWick), saveTurnover(turnover), saveAccountSettings(profile)];
      // The save hooks stage each validated setting locally before awaiting its account acknowledgement.
      const [first, ...rest] = fixedCards;
      setSelected(first.featureId);
      setFirstEnabled(first.enabled);
      setPref(first.pref);
      setExtraCards(rest);
      setCombinationState(combination);
      setLookbackHours(lookbackHours);
      setLookbackDraft(String(lookbackHours));
      p.onSelectionChange(selection);
      setCaptureCopyRevision(value => value + 1);
      const results = await Promise.allSettled(writes);
      if (getUserPrefix() !== owner) return;
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      setCaptureCopy(null);
      toast.success('捕捞设置已保存到账号');
    } finally {
      setSavingParameters(false);
    }
  };
  const saveCaptureOpening = (expanded: boolean) => {
    localStorage.setItem(catchingDefaultKey(), String(expanded));
    setOpen({ catching: expanded, settings: false });
  };

  // 【用户要求】2026-10-19「渔界面内的内容可以上下滑动，要切换自如」：面板自己限高、内部滚动；顶栏（时间 / 捕捞 / 状态）滚动时贴顶。
  // 【用户要求】2026-10-20「渔的界面要完全按照最高级别的审美标准来设计，既简洁又美观又具备功能性」：
  // 顶栏一行操作（时间 · 主按钮 · 淡色工具），下面一行状态，底边一根细线兼作进度条；算法是一张对齐的表，合并方式用分段按钮。
  return <section className={`mt-2 ${p.fillHeight?'min-h-0 flex-1':'max-h-[65dvh]'} min-w-0 overflow-y-auto overscroll-y-contain rounded-xl border border-border/60 bg-background`} aria-label="渔" data-testid="fish-panel">
    {captureCopy?.owner === owner && <Dialog open onOpenChange={next => { if (!next && !savingParameters) setCaptureCopy(null); }}>
      <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto p-4 text-[11px] sm:p-5">
        <DialogHeader className="pr-7 text-left">
          <DialogTitle>从捕捞质量复制设置</DialogTitle>
          <DialogDescription>已载入保存的漏报测试设置。扫描覆盖时间取样本前后时长之和，保存后用于下一轮捕捞。</DialogDescription>
        </DialogHeader>
        <FishHitRateSettingsForm initial={captureCopy.settings} defs={defs} capture locked={running || hitRateRunning}
          onSave={saveCaptureCopy} onCancel={() => setCaptureCopy(null)}/>
      </DialogContent>
    </Dialog>}
    <section aria-labelledby="fish-catching-title" data-testid="fish-catching">
      <div className="flex items-center px-4 pb-1 pt-3">
        <div className="flex items-center gap-0.5 pr-1.5"><button id="fish-catching-title" type="button" aria-expanded={open.catching} aria-controls="fish-catching-content" onClick={()=>setOpen({catching:!open.catching})} className={fishSectionHeading}><Play aria-hidden className="h-3 w-3 text-muted-foreground"/><span>捕捞</span><ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open.catching?'rotate-180':''}`}/></button><Popover><PopoverTrigger asChild><button type="button" aria-label="捕捞说明" title="捕捞说明" className={fishInfoTrigger}><CircleHelp aria-hidden strokeWidth={1.4} className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" className="max-h-[min(75dvh,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto space-y-2.5 p-3.5 text-[11px] leading-relaxed" aria-label="捕捞说明">
        <p><a href="/guide#fish-catching" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">阅读完整说明 · 3.3.2 捕捞</a></p>
        {/* 【用户要求】2026-10-21「渔的使用说明点开之后，内容要改成目的、流程（以及伴随的功能介绍）。要精简、只呈现核心要义」 */}
        <section className="space-y-1"><h4 className="text-[11.5px] font-semibold text-foreground">目的</h4>
          <p className="text-muted-foreground">在全市场永续合约里，按你设定的算法找出刚出现信号的标的（鱼），供复盘与交易参考。</p></section>
        <section className="space-y-1"><h4 className="text-[11.5px] font-semibold text-foreground">流程</h4>
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground marker:text-muted-foreground/60">
            <li><b className="font-medium text-foreground">设算法</b>：每张卡选一个 Deep dig 特征值、方向与阈值（下方有信号库建议区间）；多张卡选交集（全部命中）或并集（任一命中）。</li>
            <li><b className="font-medium text-foreground">捕捞</b>：手动点「开始捕捞」（时间留空 = 现在），或切到自动、每隔所选时长捕一次。覆盖时间默认过去 1 小时，可填写任意有效小时数；只收录在该范围内出现、截止时仍满足条件的信号，每个算法分别核验。指标预热与成交额回看不受此设置缩短。排除稳定币。{turnover.enabled ? `成交额门槛 ${turnover.floors.map(floor => `${floor.hours}h ≥ ${formatTurnoverWan(floor.min)}`).join('、')} USDT，截止前与信号起点前都要满足。` : '成交额过滤已关闭。'}</li>
            <li><b className="font-medium text-foreground">看结果</b>：本轮捕到的进「新鱼」，上一轮的归入「鱼舱」；不手动删除就一直保留。交集 / 并集捕捞中也能随时切换；捕完调严阈值当场重算，不用重扫。</li>
            <li><b className="font-medium text-foreground">跟进</b>：点 → 跳到盘面，打星评分。「捕捞设置」可调整算法、市场、时间、频率、过滤和提醒。</li>
          </ol></section>
        {(x?.anchorMs||x?.cutoffMs)&&<p className="border-t border-border/50 pt-2 text-[10.5px] text-muted-foreground/80">{x?.anchorMs?`本轮节点 ${formatUTC8(x.anchorMs)}`:''}{x?.anchorMs&&x?.cutoffMs?' · ':''}{x?.cutoffMs?`本轮阈值 ${plan?.settings.direction??'>'} ${x.threshold??.3}`:''}</p>}
          {(suggestion||suggestionProgress)&&<div className="space-y-1 border-l border-border/60 pl-3 text-[10px] text-muted-foreground" data-testid="fish-suggestion-detail">
      {suggestionProgress&&<p role="status">建议{suggestionProgress.status==='running'?'计算中':suggestionProgress.status==='cancelled'?'已取消':suggestionProgress.status==='aborted'?'已中止':'已完成'} · {suggestionProgress.phase==='signals'?'信号样本':'随机对照'} · {suggestionProgress.done} / {suggestionProgress.total} {suggestionProgress.current}</p>}
      {suggestion&&<><p className="whitespace-pre-wrap break-words">{fishSuggestionTitle(suggestion)}</p>{([['信号',suggestion.samples],['随机',suggestion.random]] as const).map(([label,stats])=>stats.failures.length>0&&<details key={label}><summary className="w-fit cursor-pointer">{label}跳过原因（前{stats.failures.length}项）</summary>{stats.failures.map((row,i)=><p key={i} className="break-words">{row.symbol} · {formatUTC8(row.timeMs)} · {row.reason}</p>)}</details>)}</>}
    </div>}
</PopoverContent></Popover></div>
      </div>
      <div id="fish-catching-content" hidden={!open.catching} className="px-4 pb-4">
    <div className={`${fishRail} space-y-3`} data-testid="fish-catching-parts">
    <section aria-labelledby="fish-capture-progress-title" className="min-w-0 space-y-2">
      <header className="sticky top-0 z-10 min-w-0 bg-background" data-testid="fish-toolbar">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 pb-2 pt-1 text-[11px]">
        <h3 id="fish-capture-progress-title" className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap font-medium text-foreground/80">
          <Activity aria-hidden className="h-3 w-3 text-muted-foreground"/>捕捞进程
        </h3>

        <label className="flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-transparent bg-muted/50 px-2 transition-colors focus-within:border-ring/60 focus-within:bg-background hover:bg-muted" title={p.auto?.mode==='auto'?'自动捕捞始终按当前时间；这里的时间只用于手动点「开始捕捞」':'格式 YYYY-MM-DD HH:mm:ss（UTC+8）；留空 = 币安服务器当前时间'}>
          <Clock3 aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground/60"/>
          <input aria-label="捕捞时间（UTC+8）" autoComplete="off" spellCheck={false} placeholder="留空 = 现在" className="w-[9.5rem] min-w-0 bg-transparent pt-0.5 font-mono tabular-nums text-foreground outline-none placeholder:text-muted-foreground/50 disabled:opacity-60" value={p.inputs.time} disabled={running} onChange={e=>{setError('');p.onInputsChange({...p.inputs,time:e.target.value});}}/>
          <span className="shrink-0 text-[9px] text-muted-foreground/60">UTC+8</span>
        </label>
        <label className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-muted/50 px-2 text-muted-foreground" title="只收录起点在所选时长内、截止时仍满足条件的信号。每个勾选算法分别按此范围判定；指标计算保留必要历史。默认 1 小时；修改后按回车或离开输入框，自动随账号保存。自动捕捞间隔另行设置。">扫描过去<input aria-label="扫描覆盖时间（小时）" type="number" min="0.01" max="8784" step="any" disabled={running} value={lookbackDraft} onChange={e=>setLookbackDraft(e.target.value)} onBlur={()=>void applyLookback()} onKeyDown={e=>{if(e.key==='Enter')void applyLookback();}} className="h-6 w-12 rounded bg-transparent px-1 text-center font-mono tabular-nums text-foreground outline-none focus:bg-background disabled:opacity-40"/>小时</label>
        {running
          ?<button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-background px-3 font-medium text-foreground transition-colors hover:bg-muted" onClick={()=>p.reconstruction?.running?p.reconstruction.cancel():suggesting?suggestionController.current?.abort():p.onCancel()}><Square aria-hidden className="h-2.5 w-2.5 fill-current"/>取消</button>
          :<button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:shadow-none" disabled={running||hitRateRunning||!!multiple.error&&!(p.onRecombine&&multiple.error==='请启用至少一个算法')} onClick={()=>void start()}><Play aria-hidden className="h-2.5 w-2.5 fill-current"/>开始捕捞</button>}
        <button type="button" aria-expanded={open.settings} aria-controls="fish-capture-settings"
          onClick={() => { setCopyError(''); setOpen({ settings: !open.settings }); }}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <Settings aria-hidden className="h-3.5 w-3.5"/>捕捞设置
          <ChevronDown aria-hidden className={`h-3 w-3 transition-transform ${open.settings ? 'rotate-180' : ''}`}/>
        </button>
        {p.auto?.mode === 'auto' && <span className="text-[10.5px] text-muted-foreground" data-testid="fish-auto-next" title={p.auto.lastRunAt?`上次自动 / 手动捕捞：${formatUTC8(p.auto.lastRunAt).slice(0,16)}`:undefined}>{!p.auto.online?'等待联网':p.auto.waiting?'到点了，等当前任务结束':p.auto.nextAt!==null&&p.auto.nextAt>Date.now()?`下次 ${formatUTC8(p.auto.nextAt).slice(5,16)}`:'即将开始'}</span>}
        {x && <div className="inline-flex shrink-0 items-center gap-1.5">
          <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 whitespace-nowrap" data-testid="fish-status" title={[
            ...(x.lookbackHours !== undefined ? [`本轮覆盖过去 ${x.lookbackHours} 小时${x.counts.outside ? `，${x.counts.outside} 个起点超出范围` : ''}`] : []),
            ...(lookbackHours !== x.lookbackHours ? [`覆盖时间改为过去 ${lookbackHours} 小时，下一轮生效`] : []),
            ...(x.algorithmHits?.map((n, i) => `算法 ${enabledCardNumbers[i] ?? i+1} 命中 ${n}`) ?? []),
          ].join('\n') || undefined}>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${scanning?'animate-pulse bg-primary':x.status==='complete'?'bg-primary/60':x.status==='aborted'?'bg-destructive':'bg-muted-foreground/50'}`}/>{STATUS[x.status]}</span>
            <span aria-hidden className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground">命中 <span className="font-mono font-semibold tabular-nums text-primary">{x.counts.hit}</span></span>
            <span aria-hidden className="text-muted-foreground/40">·</span>
            <span className="font-mono tabular-nums text-muted-foreground">{x.done} / {x.total}</span>
          </p>
          {!!(x.wickSkipped || x.thin) && <FishWickDetails progress={x} onJump={p.onJumpQuality} jumpingSignalId={p.jumpingSignalId}/>}
        </div>}
        {scanWindow && <p className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1 font-mono text-[10.5px] tabular-nums text-muted-foreground"
          data-testid="fish-scan-window" title={`${scanWindow.start} ～ ${scanWindow.end}（UTC+8）`}>
          <span>{scanWindow.start}</span><span>{' ～ '}</span>
          <span>{scanWindow.start.slice(0,10) === scanWindow.end.slice(0,10) ? scanWindow.end.slice(11) : scanWindow.end}</span>
        </p>}
      </div>
      <div className="relative h-px bg-border/60">{scanning && x && x.total > 0 && <span role="progressbar" aria-label="捕捞进度" aria-valuemin={0} aria-valuemax={x.total} aria-valuenow={Math.min(x.done, x.total)} className="absolute bottom-0 left-0 h-[2px] rounded-r-full bg-primary transition-[width] duration-300" style={{ width: `${Math.min(100, (x.done / x.total) * 100)}%` }} />}</div>
      </header>
    <section id="fish-capture-settings" aria-label="捕捞设置" hidden={!open.settings}
      className="min-w-0 max-w-3xl space-y-3 rounded-lg border border-border/60 bg-background p-3 text-[11px] sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={running || hitRateRunning} onClick={openCaptureCopy}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
          <Copy aria-hidden className="h-3 w-3"/>从捕捞质量复制设置
        </button>
        {p.reconstruction && <button type="button" disabled={running || hitRateRunning || !p.reconstruction.available}
          title={p.reconstruction.settingsError || '用信号发生前的数据评估各算法'}
          onClick={async () => {
            const pending = suggestionRun.current;
            if (pending) { suggestionController.current?.abort(); await pending.done; }
            setOpen({ settings: false });
            await p.reconstruction!.start();
          }}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
          <History aria-hidden className="h-3 w-3"/>复原
        </button>}
      </div>
      {copyError && <p role="alert" className="text-destructive">{copyError}</p>}
      <div className={`grid gap-3 ${auto ? 'sm:grid-cols-2' : ''}`}>
        <fieldset className="min-w-0 rounded-md border border-border/60 px-3 pb-3">
          <legend className="px-1 font-medium">来源市场</legend>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
            {AUDITED_EXCHANGES.map(exchange => <label key={exchange} className="flex items-center gap-1.5">
              <FishCheck disabled={running} checked={exchanges.includes(exchange)} onChange={event => p.onSelectionChange({
                ...p.selection, exchanges: AUDITED_EXCHANGES.filter(id => id === exchange ? event.target.checked : exchanges.includes(id)),
              })}/>
              {EXCHANGE_NAMES[exchange]}
            </label>)}
            <label className="flex items-center gap-1.5">
              <FishCheck disabled={running} checked={includeUsStocks} onChange={event => p.onSelectionChange({ ...p.selection, includeUsStocks: event.target.checked })}/>美股
            </label>
            <label className="flex items-center gap-1.5">
              <FishCheck disabled={running} checked={includeDuplicates} onChange={event => p.onSelectionChange({ ...p.selection, includeDuplicates: event.target.checked })}/>含重复币
            </label>
          </div>
        </fieldset>
        {auto && <fieldset className="min-w-0 rounded-md border border-border/60 px-3 pb-3">
          <legend className="px-1 font-medium">模式与频率</legend>
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="捕捞模式" className="inline-flex h-7 shrink-0 items-center rounded-md bg-muted/70 p-0.5">
              {(['manual', 'auto'] as const).map(mode => <button key={mode} type="button" role="radio" aria-checked={auto.mode === mode}
                onClick={() => auto.setMode(mode)}
                className={`h-6 rounded px-2.5 transition-colors ${auto.mode === mode ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {mode === 'manual' ? '手动' : '自动'}
              </button>)}
            </div>
            {auto.mode === 'auto' && <span className="relative shrink-0">
              <select aria-label="自动捕捞间隔" value={auto.hours} onChange={event => auto.setHours(Number(event.target.value))}
                className="h-7 appearance-none rounded-md border border-transparent bg-muted/50 pl-2 pr-6 tabular-nums outline-none hover:bg-muted focus-visible:border-ring/60">
                {FISH_AUTO_INTERVALS.map(hours => <option key={hours} value={hours}>每 {hours}h</option>)}
              </select>
              <ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60"/>
            </span>}
          </div>
        </fieldset>}
      </div>
      <section className="space-y-1.5" data-testid="fish-algorithm-section">
      <div className="flex min-w-0 items-center gap-2"><button type="button" aria-expanded={open.algorithms} aria-controls="fish-algorithms-content" onClick={()=>setOpen({algorithms:!open.algorithms})} className={fishSubHeading}><ListChecks aria-hidden className="h-3 w-3 text-muted-foreground"/><span>算法</span><ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open.algorithms?'rotate-180':''}`}/></button>
      {!open.algorithms&&<span className="min-w-0 truncate text-[10.5px] text-muted-foreground" title={ruleText}>{enabledCardNumbers.length} 个启用{enabledCardNumbers.length>1?` · ${combination==='or'?'并集':'交集'}`:''}</span>}</div>
      <div id="fish-algorithms-content" hidden={!open.algorithms} className="space-y-1.5">
      <div className="min-w-0 overflow-hidden rounded-lg border border-border/60" data-testid="fish-algorithms">
      <div className="divide-y divide-border/50">
      <FishAlgorithmCard card={{id:'first',featureId:selected,enabled:firstEnabled,pref}} defs={defs} index={1} locked={running} canDelete={extraCards.length>0} onRecalculate={()=>void calculateSuggestion('manual')} recalculateDisabled={running||!p.onSuggest||!suggestionCompiled||!!suggestionCompiled.unavailable} recalculating={suggestionProgress?.status==='running'&&suggestionRun.current?.target==='first'} footer={<>
      {suggestion&&<span className="text-[10px] text-muted-foreground" data-testid="fish-suggestion" title={fishSuggestionTitle(suggestion)}>{suggestion.samples.p25===null?'信号库暂无有效建议':`信号库建议 ${Number(suggestion.samples.p25.toPrecision(6))} ~ ${Number(suggestion.samples.p75!.toPrecision(6))}`}（{suggestion.samples.n} / {suggestionStale?suggestion.samples.attempted:library.length} 条）{suggestionStale?(autoSuggesting?' · 更新中':' · 已过期'):''}</span>}
      {!suggestion&&suggestionProgress?.status==='running'&&suggestionRun.current?.target==='first'&&suggestionProgress&&<span className="text-[10px] text-muted-foreground/70" data-testid="fish-suggestion-auto">信号库建议计算中 {suggestionProgress.done} / {suggestionProgress.total||library.length}</span>}
      </>}
      onChange={next=>{setFirstEnabled(next.enabled);if(next.featureId===selected&&next.pref.direction!==pref.direction){changeDirection(next.pref.direction);return;}setSelected(next.featureId);setPref(cleanPreference(next.pref));saveFishPreference(next.featureId,cleanPreference(next.pref));setError('');p.onInputsChange({...p.inputs,threshold:next.pref.threshold});}}
      onDelete={()=>{const [next,...rest]=extraCards;setSelected(next.featureId);setPref(next.pref);setFirstEnabled(next.enabled);setExtraCards(rest);}}/>
      {extraCards.map((card,i)=><FishAlgorithmCard key={card.id} card={card} defs={defs} index={i+2} locked={running} onRecalculate={()=>{const target=extraSuggest[i];if(target)void calculateSuggestion('manual',{id:target.id,plan:target.plan});}} recalculateDisabled={running||!p.onSuggest||!extraSuggest[i]} recalculating={suggestionProgress?.status==='running'&&suggestionRun.current?.target===card.id} suggestion={extraSuggest[i]?.cached??null} queued={!!extraSuggest[i]?.queued} librarySize={library.length} computing={suggestionProgress?.status==='running'&&suggestionRun.current?.target===card.id&&suggestionProgress?`${suggestionProgress.done} / ${suggestionProgress.total||library.length}`:''} onChange={next=>setExtraCards(cs=>cs.map(c=>c.id===next.id?next:c))} onDelete={()=>setExtraCards(cs=>cs.filter(c=>c.id!==card.id))}/>)}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/50 bg-muted/20 px-2 py-1.5">
      <button type="button" disabled={running||savingParameters} onClick={()=>void saveParameters()} className="inline-flex h-6 items-center rounded border border-primary/40 px-2 text-[11px] text-primary disabled:opacity-40">{savingParameters?'保存中…':'保存参数'}</button>
      <span className="text-[10px] text-muted-foreground">保存后跟随账号，直到下次手动修改并保存</span>
      <button type="button" aria-label="+ 算法" title={`添加一个算法（最多 ${FISH_MAX_ALGORITHMS} 个）`} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40" disabled={running||extraCards.length>=FISH_MAX_ALGORITHMS-1} onClick={()=>setExtraCards(cs=>cs.length>=FISH_MAX_ALGORITHMS-1?cs:[...cs,{id:crypto.randomUUID(),featureId:def?.id??'cbi2',enabled:true,pref:structuredClone(pref)}])}><Plus aria-hidden className="h-3 w-3"/>算法</button>
      {extraCards.length>0&&<div role="radiogroup" aria-label="多重算法合并方式" className="inline-flex h-6 shrink-0 items-center rounded-md bg-muted/70 p-0.5 text-[10.5px]">
      {([['and','交集','每个算法都命中才留下'],['or','并集','任一算法命中即留下']] as const).map(([value,text,hint])=><button key={value} type="button" role="radio" aria-checked={combination===value} title={hint} disabled={running&&!(scanning&&p.onLiveCombination)} onClick={()=>{if(value===combination)return;setCombination(value);if(scanning)p.onLiveCombination?.(value);}} className={`h-5 rounded px-2 transition-colors disabled:opacity-50 ${combination===value?'bg-background font-medium text-foreground shadow-sm':'text-muted-foreground hover:text-foreground'}`}>{text}</button>)}
      </div>}
      <Popover><PopoverTrigger asChild><button type="button" aria-label="组合说明" title="组合说明" className={fishInfoTrigger}><CircleHelp aria-hidden strokeWidth={1.4} className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-2 p-3 text-[11px] leading-relaxed" aria-label="组合说明"><p className="font-medium">{combination==='or'?'并集：任一算法命中即留下':'交集：每个算法都命中才留下'}</p><p className="break-words text-muted-foreground" data-testid="fish-rule">{ruleText}</p></PopoverContent></Popover>
      </div>
      </div>
      {staleRound&&!running&&<p className="text-[10.5px] text-muted-foreground" data-testid="fish-stale-round">{staleText}</p>}
      </div>
      </section>
      <fieldset className="min-w-0 rounded-md border border-border/60 px-3 pb-3">
        <legend className="px-1 font-medium">插针与成交额</legend>
        <FishWickSettings key={`${owner}:${captureCopyRevision}`} value={downwardWick} locked={running} turnover={turnover}
          onSaveTurnover={async value => { await saveTurnover(value); toast.success('成交额设置已保存'); }}
          onSave={async value => { await saveDownwardWick(value); toast.success('插针回看设置已保存'); }}/>
      </fieldset>
      <details className="rounded-md border border-border/60 p-3">
        <summary className="cursor-pointer font-medium">默认展开</summary>
        <div className="pt-2"><FishCaptureOpenSettings value={readCatchingDefault()} onSave={saveCaptureOpening}/></div>
      </details>
      {p.notify && <details className="rounded-md border border-border/60 p-3">
        <summary className="cursor-pointer font-medium">邮件提醒</summary>
        <div className="pt-2"><FishNotifySettings notify={p.notify} algorithms={[
          ...pool.map(plan => fishEmailAlgorithm({ featureId: plan.def.id, featureShort: plan.def.short, statistic: plan.settings.statistic, definitionKey: definitionKey(plan.def) })),
          ...p.signals.flatMap(signal => qualityMembers(signal).map(fishEmailAlgorithm)),
        ].filter((a): a is NonNullable<typeof a> => Boolean(a))}/></div>
      </details>}
    </section>
    {(error||multiple.error&&!(p.onRecombine&&multiple.error==='请启用至少一个算法')) && <p role="alert" className="text-[11px] text-destructive">{error||multiple.error}</p>}
    {x?.error && <p className="text-[11px] text-destructive">{x.error}</p>}
    {p.auto?.error && <p className="text-[11px] text-destructive/80" data-testid="fish-auto-error">{p.auto.error}</p>}
    {x?.notice && <p className="break-words text-[10.5px] text-muted-foreground" data-testid="fish-notice">{x.notice}</p>}
    {p.reconstruction && <FishReconstructionResults state={p.reconstruction}/>}
    <div className={fishRail}>
      {/* 【用户要求】2026-10-19 新鱼 = 最近一次捕捞捕到的；点开始捕捞时上一轮的新鱼归入「鱼舱」 */}
      <FishLibrary key={owner+'new'} rememberViewKey={owner+'new'} level="sub" title="新鱼" testId="fish-new" signals={fresh} defaultOpen={fresh.length > 0} info={<p>最近一次捕捞捕到的鱼。下次点「开始捕捞」时，这些会归入鱼舱。</p>} emptyText={scanning ? '捕捞中，捕到的会出现在这里。' : '还没有新鱼。'}
        tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={p.onRate} />
    </div>
    </section>
    {p.onTestHitRate && <section aria-labelledby="fish-capture-quality-title" className="min-w-0 text-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        <h3>
          <button id="fish-capture-quality-title" type="button" aria-expanded={open.captureQuality} aria-controls="fish-capture-quality-content"
            onClick={() => setOpen({ captureQuality: !open.captureQuality })} className={fishSubHeading}>
            <Gauge aria-hidden className="h-3 w-3 text-muted-foreground"/>捕捞质量
            <ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open.captureQuality ? 'rotate-180' : ''}`}/>
          </button>
        </h3>
        {!open.captureQuality && hitRateRunning && <span role="status" className="text-muted-foreground">测试中</span>}
      </div>
      <div id="fish-capture-quality-content" hidden={!open.captureQuality} className="min-w-0 space-y-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <button id="fish-hit-rate-title" type="button" aria-expanded={open.hitRate} aria-controls="fish-hit-rate"
          onClick={() => setOpen({ hitRate: !open.hitRate })}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <ScanSearch aria-hidden className="h-3.5 w-3.5"/>漏报测试
          <ChevronDown aria-hidden className={`h-3 w-3 transition-transform ${open.hitRate ? 'rotate-180' : ''}`}/>
        </button>
        <button type="button" disabled className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 font-medium text-muted-foreground">
          <ShieldAlert aria-hidden className="h-3.5 w-3.5"/>误报测试<span className="text-[10px] font-normal text-muted-foreground/75">待开放</span>
        </button>
        {!open.hitRate && hitRateRunning && <span role="status" className="text-muted-foreground">测试中</span>}
      </div>
      <div id="fish-hit-rate" role="region" aria-labelledby="fish-hit-rate-title" hidden={!open.hitRate} className="min-w-0">
        <FishHitRateTest key={owner} quality={p.quality} onJump={jumpQuality} canJump={canJumpQuality} captureSettings={captureHitRateSettings} defs={defs} run={p.onTestHitRate} disabled={running} onRunningChange={setHitRateRunning}/>
      </div>
      </div>
    </section>}
    </div>
      </div>
    </section>
    <section className="min-w-0 border-t border-border/50 px-4 py-3" aria-label="鱼舱模块" data-testid="fish-cabin">
    <FishLibrary key={owner+'old'} rememberViewKey={owner+'old'} title="鱼舱" testId="fish-old" signals={old} defaultOpen={open.cabin} info={<><p><a href="/guide#fish-cabin" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">阅读完整说明 · 3.3.3 鱼舱</a></p><p>每次开始捕捞时，上一轮的新鱼归入鱼舱；不手动删除就一直保留。</p><p className="text-muted-foreground">「导出数据」导出全部鱼舱记录（列表信息、具体指标和捕获阈值），不受当前筛选影响。</p></>} onExport={()=>{try{downloadFishCabin(old);toast.success(`已导出 ${old.length} 条鱼舱记录`);}catch(error){toast.error(error instanceof Error?error.message:'导出失败');}}} emptyText="鱼舱还是空的。"
      tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={p.onRate} />
    </section>
    {p.quality && <ModuleErrorBoundary label="鱼质量" backgroundTasks><FishQuality state={p.quality} mining={p.mining} onRate={p.onRateQuality} onJump={jumpQuality} canJump={canJumpQuality}/></ModuleErrorBoundary>}
  </section>;
}
