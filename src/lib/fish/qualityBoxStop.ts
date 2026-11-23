import { evaluateOnBars, featureWindowMs, DBL5_GUARD_PLUS_DEF, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { BOX_STOP_REFERENCE_VERSION, BOX_STOP_REFERENCE_LABELS, defaultBoxStopReference, boxStopReferenceIdentity, validateBoxStopReference, createImpulse0StopReference, type BoxStopReference, type BoxStopReferenceKind } from './qualityBoxReference';
import { type Dbl5GuardPlusCheckpoint } from '@/lib/dbl5GuardPlus';
import { dbl5TickAt } from '@/lib/dbl5mMarketRules';
import { isTuringCupSymbol } from '@/lib/turingCupSymbol';
import { advanceChartAtr, type ChartAtrState } from '@/lib/atr';
import { compileFishProgram } from './algorithm';
import { freezeStructureVersions, structureDbl5Timeframe, selectStructureGuardVersion } from './boxAlgorithmVersions';
import { defaultStructureAddition, structureActiveBox, structureAdditionIdentity, structureAdditionK, selectStructureTimeframe, validateStructureAddition, type StructureAdditionRule } from './qualityAdditionStructure';
import { qualityHistoryFrom } from './qualityInitialization';
import { validateFishBars } from './shared';
import { DBL5_PROFILES, DBL5_GUARD_VERSION, dbl5GuardVersion, dbl5Parameters, type Dbl5Timeframe, type Dbl5GuardVersion, type Dbl5Checkpoint, type Dbl5Row } from '@/lib/dbl5m';
import { sbsParameters, type SbsCheckpoint } from '@/lib/sbs5m';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishReconstructionLoader } from './reconstruction';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { QualityHoldingVeto } from './qualityVeto';
import type { QualityTrigger } from './qualityIntrabar';

import { BOX_STOP_INVALID_DATA } from './qualityBoxMarketRepair';
import {POST_MIRROR_PROTECTION_LABEL} from './qualityPostMirrorProtection';
import {mirrorHardStopStageLabel} from './qualityMirrorHardStopStages';

export const BOX_STOP_KIND = 'box-stop' as const;
export const BOX_STOP_VERSION = 'holding-box-stop-v1';
export const BOX_STOP_CHANNELS_VERSION = 'holding-box-stop-independent-channels-v1';
export type BoxStopChannel = 'regular' | 'impulse';
export type BoxStopChannels = Record<BoxStopChannel,{enabled:boolean;rule:BoxStopRule}>;
export const BOX_STOP_CHANNEL_LABELS = {regular:'非急拉线',impulse:'急拉线'} as const;
export const BOX_STOP_GUARD_REGIME_VERSION = 'holding-box-stop-guard-regime-v2';
export const BOX_STOP_GUARD_REGIMES = { both: '实线和虚线', trend: '只用实线', range: '只用虚线' } as const;
export type BoxStopGuardRegime = Exclude<keyof typeof BOX_STOP_GUARD_REGIMES, 'both'>;
export const BOX_BREAK_VERSION = 'holding-support-break-v1';
export const BOX_BREAK_CHOICE = 'box-support-break';
export const BOX_SECOND_BREAK_VERSION = 'holding-support-second-break-v1';
export const BOX_SECOND_BREAK_CHOICE = 'box-support-second-break';
export const BOX_SECOND_EXIT_VERSION = 'holding-support-second-exit-v1';
export const BOX_SECOND_EXIT_CHOICE = 'box-support-second-exit';
export interface BoxStopRule {
  version: typeof BOX_STOP_VERSION | typeof BOX_STOP_GUARD_REGIME_VERSION | typeof BOX_BREAK_VERSION | typeof BOX_SECOND_BREAK_VERSION | typeof BOX_SECOND_EXIT_VERSION | typeof BOX_STOP_REFERENCE_VERSION | typeof BOX_STOP_CHANNELS_VERSION;
  channels?:BoxStopChannels;
  reference?:BoxStopReference;
  guardRegime?: BoxStopGuardRegime;
  structure: StructureAdditionRule;
  update: 'fixed' | 'raise-only' | 'follow';
  confirmation: 'touch' | 'close-1m' | `close-${Dbl5Timeframe}` | 'guard-break';
  closes: number;
}
export function selectBoxStopGuardRegime(rule: BoxStopRule, regime: keyof typeof BOX_STOP_GUARD_REGIMES): BoxStopRule {
  const { guardRegime: _previous, ...base } = rule;
  return regime === 'both' ? { ...base, version: BOX_STOP_VERSION }
    : { ...base, version: BOX_STOP_GUARD_REGIME_VERSION, guardRegime: regime };
}
export function selectBoxStopReference(rule:BoxStopRule,kind:BoxStopReferenceKind):BoxStopRule {
  const {guardRegime:_,...base}=selectBoxStopTimeframe(rule,'5m');
  const structure={...base.structure,kSource:kind==='impulse0'?'current' as const:'guard' as const};
  return freezeBoxStop({...base,version:BOX_STOP_REFERENCE_VERSION,reference:defaultBoxStopReference(kind),
    structure:kind==='impulse0'?structure:selectStructureGuardVersion(structure,DBL5_GUARD_VERSION)});
}
export function clearBoxStopReference(rule:BoxStopRule):BoxStopRule {
  if(!rule.reference)return rule;
  const {reference:_,...base}=rule;return {...base,version:BOX_STOP_VERSION};
}

export interface BoxStopState {
  line?: number; confirmedAt?: number; count: number; breakCount?:number;
  /** Legacy first-break addition lock; never set by the exit-only version. */
  firstBreakAt?:number;
  /** Exit-only count evidence, independent of any addition veto or lock. */
  firstCountedBreakAt?:number;
}
/** A first break latches across checkpoints and seller/veto stage changes. */
export function boxAdditionBlockedAt(states:Record<string,BoxStopState>|undefined, previous?:number):number|undefined {
  const times=[...(previous==null?[]:[previous]),...Object.values(states??{}).flatMap(s=>s.firstBreakAt==null?[]:[s.firstBreakAt])];
  return times.length?Math.min(...times):undefined;
}
export function freezeBoxStop(rule:BoxStopRule):BoxStopRule {
  if(rule.version===BOX_STOP_CHANNELS_VERSION&&rule.channels)return selectBoxStopChannels({regular:{...rule.channels.regular,rule:freezeBoxStop(rule.channels.regular.rule)},impulse:{...rule.channels.impulse,rule:freezeBoxStop(rule.channels.impulse.rule)}});
  const structure=freezeStructureVersions(rule.structure),d=structure.definition;
  return {...rule,structure:{...structure,definition:{...d,...(structure.algorithm==='dbl5'?{DBL5_config:dbl5Parameters(d.DBL5_config)}:{SBS5M_config:sbsParameters(d.SBS5M_config)})}}};
}
export const defaultBoxStop = (defs: readonly DeepDigFeatureDef[] = []): BoxStopRule => freezeBoxStop({version: BOX_STOP_VERSION, structure: {...defaultStructureAddition('dbl5', defs), kSource:'current'}, update:'raise-only', confirmation:'touch', closes:1});
/** Reading an old rule never upgrades it. A checkbox action explicitly creates the new wrapper. */
export function boxStopChannelSettings(rule:BoxStopRule,defs:readonly DeepDigFeatureDef[]=[]):BoxStopChannels {
  if(rule.channels)return rule.channels;
  return {regular:{enabled:!rule.reference,rule:rule.reference?defaultBoxStop(defs):rule},impulse:{enabled:!!rule.reference,rule:rule.reference?rule:selectBoxStopReference(defaultBoxStop(defs),'impulse1115')}};
}
export function selectBoxStopChannels(channels:BoxStopChannels):BoxStopRule {
  const saved=structuredClone(channels);return {...saved.regular.rule,version:BOX_STOP_CHANNELS_VERSION,channels:saved};
}
export const boxStopRuleEntries=(rule:BoxStopRule):{channel?:BoxStopChannel;enabled:boolean;rule:BoxStopRule}[]=>rule.channels
  ?(['regular','impulse'] as const).map(channel=>({channel,...rule.channels![channel]})):[{enabled:true,rule}];
const stableBoxStop=(value:unknown)=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
/** Opt-in event exit: the exact DBL-5 flag used to draw a red cross. */
export const isBoxSecondBreakExitOnly = (rule:BoxStopRule) => rule.version === BOX_SECOND_EXIT_VERSION;
export const isBoxSecondBreak = (rule:BoxStopRule) => rule.version === BOX_SECOND_BREAK_VERSION || isBoxSecondBreakExitOnly(rule);
export const isBoxBreak = (rule:BoxStopRule) => rule.version === BOX_BREAK_VERSION || isBoxSecondBreak(rule);
export const boxStopChoice = (rule:BoxStopRule) => isBoxSecondBreakExitOnly(rule)?BOX_SECOND_EXIT_CHOICE:isBoxSecondBreak(rule)?BOX_SECOND_BREAK_CHOICE:isBoxBreak(rule)?BOX_BREAK_CHOICE:BOX_STOP_KIND;
export function defaultBoxBreak(defs: readonly DeepDigFeatureDef[] = [], guardVersion?: Dbl5GuardVersion): BoxStopRule {
  const structure: StructureAdditionRule = {...defaultStructureAddition('dbl5', defs), kSource:'guard', buffer:0, bufferUnit:'atr'};
  return freezeBoxStop({
    version: BOX_BREAK_VERSION,
    structure: guardVersion ? selectStructureGuardVersion(structure, guardVersion) : structure,
    update: 'follow',
    confirmation: 'guard-break',
    closes: 1,
  });
}
export function selectBoxStopTimeframe(rule:BoxStopRule, timeframe:Dbl5Timeframe, defs:readonly DeepDigFeatureDef[]=[]) {
  if(rule.reference&&timeframe!=='5m')throw Error('急拉线 K 基准仅使用原生 5 分钟线，请先手动改选箱底或防守线');
  const oldTimeframe=structureDbl5Timeframe(rule.structure);
  if(rule.structure.algorithm!=='dbl5'||oldTimeframe===timeframe)return rule;
  const structure=selectStructureTimeframe(rule.structure,timeframe,defs);
  const confirmation=rule.confirmation===`close-${oldTimeframe}` ? `close-${timeframe}` as const : rule.confirmation;
  return {...rule,structure,confirmation} satisfies BoxStopRule;
}
export const defaultBoxSecondBreak = (defs:readonly DeepDigFeatureDef[]=[],guardVersion?:Dbl5GuardVersion):BoxStopRule => ({...defaultBoxBreak(defs,guardVersion),version:BOX_SECOND_BREAK_VERSION});
export const defaultBoxSecondExit = (defs:readonly DeepDigFeatureDef[]=[],guardVersion?:Dbl5GuardVersion):BoxStopRule => ({...defaultBoxBreak(defs,guardVersion),version:BOX_SECOND_EXIT_VERSION});
export function boxStopAlgorithmLabel(rule:BoxStopRule) {
  return rule.structure.algorithm==='dbl5'?DBL5_PROFILES[structureDbl5Timeframe(rule.structure)].label:'SBS-5M';
}
export function validateBoxStop(rule?: BoxStopRule): asserts rule is BoxStopRule {
  if(rule?.version===BOX_STOP_CHANNELS_VERSION){
    const c=rule.channels;
    if(!c||!c.regular||!c.impulse||Object.keys(c).length!==2)throw Error('请保留急拉与非急拉两路独立配置');
    for(const key of ['regular','impulse'] as const){const v=c[key];if(typeof v.enabled!=='boolean'||!v.rule||v.rule.channels||v.rule.version===BOX_STOP_CHANNELS_VERSION||isBoxBreak(v.rule))throw Error('双路止损须各自使用独立触价或收盘确认规则');validateBoxStop(v.rule);}
    if(c.regular.rule.reference||!c.impulse.rule.reference)throw Error('非急拉线与急拉线的参考不可混用');
    const {channels:_,...base}=rule;
    if(stableBoxStop({...base,version:c.regular.rule.version})!==stableBoxStop(c.regular.rule))throw Error('双路止损的常规基准与冻结参数不一致');
    return;
  }
  if(rule?.channels)throw Error('双路止损参数与执行版本不符，请保留原版');
  if (!rule || ![BOX_STOP_VERSION,BOX_STOP_GUARD_REGIME_VERSION,BOX_BREAK_VERSION,BOX_SECOND_BREAK_VERSION,BOX_SECOND_EXIT_VERSION,BOX_STOP_REFERENCE_VERSION].includes(rule.version)) throw Error('箱体硬止损版本不可用，请保留原版并新建方案');
  validateStructureAddition(rule.structure);
  const nativeConfirmation=`close-${structureDbl5Timeframe(rule.structure)}`;
  if(rule.version===BOX_STOP_REFERENCE_VERSION){
    validateBoxStopReference(rule.reference);
    if(rule.structure.algorithm!=='dbl5'||structureDbl5Timeframe(rule.structure)!=='5m'||rule.guardRegime!==undefined)throw Error('急拉线 K 基准须使用独立的原生 5 分钟执行版本');
    if(rule.reference!.kind!=='impulse0'&&(rule.structure.kSource!=='guard'||dbl5GuardVersion(rule.structure.definition.DBL5_config)!==DBL5_GUARD_VERSION))throw Error('急拉线-1115 须保留原防守线 v1 基线');
  }else if(rule.reference!==undefined)throw Error('急拉线 K 基准与执行版本不符，请保留原版并新建副本');
  if (rule.version === BOX_STOP_GUARD_REGIME_VERSION) {
    if (rule.structure.algorithm !== 'dbl5' || rule.structure.kSource !== 'guard' || !['trend', 'range'].includes(rule.guardRegime ?? '')) {
      throw Error('箱体硬止损的单一线型须使用 DBL-5 防守线并选择实线或虚线');
    }
  } else if (rule.guardRegime !== undefined) throw Error('箱体硬止损的防守线类型与执行版本不符');
  if(isBoxBreak(rule)){
    if(rule.structure.algorithm!=='dbl5'||rule.structure.kSource!=='guard'||rule.structure.buffer!==0||rule.structure.bufferUnit!=='atr'||rule.confirmation!=='guard-break'||rule.update!=='follow'||rule.closes!==1)throw Error('支撑断裂须使用 DBL-5 防守线原生红叉事件，不能添加触价冗余或另行确认');
    return;
  }
  if (!['current','guard'].includes(rule.structure.kSource ?? '') || !['fixed','raise-only','follow'].includes(rule.update)
    || !['touch','close-1m',nativeConfirmation].includes(rule.confirmation) || !Number.isInteger(rule.closes) || rule.closes<1 || rule.closes>100) throw Error('请完善箱体硬止损的基准、更新方式与确认根数（1–100）');
}
export function boxStopIdentity(r: BoxStopRule) {
  if(r.version===BOX_STOP_CHANNELS_VERSION)return [r.version,stableBoxStop(r)];
  const config = r.structure.definition.DBL5_config;
  // New rules have a stable fingerprint across the editor and JSONB field order.
  const structure = (r.version === BOX_STOP_GUARD_REGIME_VERSION || isBoxSecondBreak(r) || r.reference) && config
    ? { ...r.structure, definition: { ...r.structure.definition, DBL5_config: Object.fromEntries(Object.keys(config).sort().map(key => [key, config[key as keyof typeof config]])) } }
    : r.structure;
  return [r.version, structureAdditionIdentity(structure), r.update, r.confirmation, r.closes, ...(r.guardRegime ? [r.guardRegime] : []),...(r.reference?[boxStopReferenceIdentity(r.reference)]:[])];
}
export const boxStopLabel = (r: BoxStopRule):string => r.channels?boxStopRuleEntries(r).map(c=>`${BOX_STOP_CHANNEL_LABELS[c.channel!]}${c.enabled?'：'+boxStopLabel(c.rule):'（未启用）'}`).join('；任一路触发退出；'):isBoxSecondBreakExitOnly(r)?`${boxStopAlgorithmLabel(r)} 持仓期间二次断裂终止；首次只计数，不因本条件停加仓；第二次断裂下一分钟开盘全仓卖出`:isBoxSecondBreak(r)?`${boxStopAlgorithmLabel(r)} 首次支撑断裂停止加仓，第二次断裂下一分钟开盘全仓卖出`:isBoxBreak(r)?`${boxStopAlgorithmLabel(r)} 支撑断裂（防守线红叉确认）；下一分钟开盘全仓卖出`:`${boxStopAlgorithmLabel(r)} ${r.reference?BOX_STOP_REFERENCE_LABELS[r.reference.kind]:r.structure.kSource==='guard' ? `防守线${r.guardRegime ? `（${BOX_STOP_GUARD_REGIMES[r.guardRegime]}）` : ''}` : r.structure.kBasis==='invalidation'?'失效线':'箱底'} − ${r.structure.buffer}${r.structure.bufferUnit==='atr'?'ATR':'%'}；${({fixed:'首次有效线固定','raise-only':'只升不降',follow:'跟随最新线'})[r.update]}；${r.confirmation==='touch'?'触碰 K 立即卖出':`${r.confirmation==='close-1m'?'1 分钟':DBL5_PROFILES[structureDbl5Timeframe(r.structure)].periodLabel}连续 ${r.closes} 根收盘 ≤ K`}`;

/** Only already closed native structures can place a stop for the next minute. */
export function createBoxStopReader(o:{vetoes:readonly QualityHoldingVeto[];row:TradeSignal;entry:number;since:number;load:FishReconstructionLoader;signal:AbortSignal;previous?:Record<string,BoxStopState>;activationAt?:()=>number|undefined;ignoreExit?:(cause:QualityTrigger["cause"])=>boolean}) {
  const load = o.load.boxStopMarketLoad ?? o.load;
  let observationEntry=o.entry,observationSince=o.since;
  const rules=o.vetoes.filter(v=>v.enabled&&v.kind===BOX_STOP_KIND).flatMap(v=>{
    validateBoxStop(v.boxStop);return boxStopRuleEntries(v.boxStop).filter(c=>c.enabled).map(c=>({v:c.channel?{...v,id:v.id+':'+c.channel}:v,rule:c.rule,channel:c.channel,parentId:v.id}));
  }).map(({v,rule,channel,parentId})=>{
    const zero=rule.reference?.kind==='impulse0',plus=rule.reference&&!zero;
    if(zero&&(o.row.exchange!=null&&o.row.exchange!=='binance'||o.row.market==='us_stock'||isTuringCupSymbol(o.row.symbol)))throw Error('急拉线-0 K 基准仅支持币安真实 5 分钟量价，不能用其他市场或模拟成交额代替');
    const def:DeepDigFeatureDef=zero?{id:'box-stop-impulse0',name:'急拉线-0',short:'急拉线-0',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'5m'}:plus?{...DBL5_GUARD_PLUS_DEF,DBL5_config:rule.structure.definition.DBL5_config}:rule.structure.definition;
    const compiled=compileFishProgram(def,{statistic:'结果',direction:'>',threshold:0,constraints:[]});
    const plan=zero?{...compiled,requiresMarketEvidence:true}:compiled;
    const step=plan.step;
    const from=qualityHistoryFrom(o.load,Math.floor(o.entry/step)*step-(zero?281:Math.ceil(featureWindowMs(def)/step))*step,step);
    if(from<0)throw Error('箱体硬止损初始化历史不足');
    return {v,rule,channel,parentId,def,plan,step,from,cursor:from,dbl:undefined as Dbl5Checkpoint|undefined,sbs:undefined as SbsCheckpoint|undefined,plus:undefined as Dbl5GuardPlusCheckpoint|undefined,readZero:zero?createImpulse0StopReference():undefined,atr:undefined as ChartAtrState|undefined,latestLine:undefined as {line:number;at:number}|undefined,state:{count:0,...o.previous?.[v.id]} as BoxStopState};
  });
  const states=()=>Object.fromEntries(rules.map(r=>[r.v.id,{...r.state}]));
  const history=new Map(rules.map(r=>[r.v.id,[{at:o.since,state:{...r.state}}]]));
  const record=(id:string,at:number,state:BoxStopState)=>{const list=history.get(id)!;if(JSON.stringify(list.at(-1)!.state)!==JSON.stringify(state))list.push({at,state:{...state}});};
  const statesAt=(at:number)=>Object.fromEntries(rules.map(r=>[r.v.id,{...history.get(r.v.id)!.filter(p=>p.at<=at).at(-1)?.state}]));
  const read=async (minute:ResearchBar, options?:{observeNativeClose?:boolean;onlyActivated?:boolean}):Promise<QualityTrigger|undefined>=>{
    const candidates:QualityTrigger[]=[];
    for(const r of rules){
      const after=!!r.v.activation||r.v.mirrorStage?.stage==='after',boundary=o.activationAt?.();
      if(options?.onlyActivated&&!after)continue;
      if(r.v.mirrorStage?.stage==='before'&&boundary!=null&&minute.openTime>=boundary)continue;
      const activationAt=after?boundary:undefined;
      if(after&&(activationAt==null||minute.openTime<activationAt))continue;
      const ruleEntry=activationAt==null?observationEntry:Math.max(observationEntry,activationAt-1);
      const ruleSince=activationAt==null?observationSince:Math.max(observationSince,activationAt);
      const activationEvidence={...(r.v.activation?{activation:r.v.activation,activationAt}:{}),...(r.v.mirrorStage?{mirrorStage:r.v.mirrorStage,...(boundary!=null?{mirrorStageBoundary:boundary}:{})}:{})};
      const label=(r.channel?BOX_STOP_CHANNEL_LABELS[r.channel]+'：':'')+boxStopLabel(r.rule)+(r.v.activation?'（'+POST_MIRROR_PROTECTION_LABEL+'）':'')+(r.v.mirrorStage?'（'+mirrorHardStopStageLabel(r.v.mirrorStage)+'）':'');
      let breakAt:number|undefined,brokenBar:number|undefined;
      // Entry v4 observes the newly completed native event at this minute's
      // close. Touch stops still use only lines known before the minute opened.
      const nativeClose=options?.observeNativeClose&&isBoxBreak(r.rule);
      const observedAt=minute.openTime+(nativeClose?60000:0);
      const cut=Math.floor(observedAt/r.step)*r.step;
      while(r.cursor<cut){
        if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
        const to=Math.min(cut,r.cursor+500*r.step),bars=await load(o.row,r.cursor,to,r.plan,o.signal);
        validateFishBars(bars,to,(to-r.cursor)/r.step,r.step);
        const out=evaluateOnBars(bars,r.plan.compiled,{...r.def,DBL5_symbol:o.row.symbol,DBL5_initialization_start:r.from,DBL5_initialization_id:`box-stop:${r.from}`,DBL5_checkpoint:r.dbl,...(r.rule.reference&&r.rule.reference.kind!=='impulse0'?{DBL5P_checkpoint:r.plus,DBL5P_impulseBufferAtr:r.rule.reference.impulseBufferAtr}:{}),SBS5M_symbol:o.row.symbol,SBS5M_initialization_id:`box-stop:${r.from}`,SBS5M_checkpoint:r.sbs});
        r.dbl=out.DBL5_checkpoint;r.sbs=out.SBS5M_checkpoint;
        r.plus=out.DBL5P_checkpoint;
        const rows=r.readZero?bars.map(()=>({data_valid:true} as Dbl5Row)):r.rule.structure.algorithm==='dbl5'?out.DBL5_details:out.SBS5M_details;
        if(!rows||rows.length!==bars.length)throw Error('箱体硬止损缺少结构读数');
        rows.forEach((row,i)=>{
          if(!row.data_valid)throw Error(BOX_STOP_INVALID_DATA);
          if(r.readZero&&bars[i].DBL5_closed===false)throw Error('急拉线-0 K 基准不能读取尚未收盘的5分钟线');
          r.atr=advanceChartAtr(r.atr,bars[i]);
          const at=bars[i].openTime+r.step;
          const zero=r.readZero?.(bars[i]);
          if(isBoxSecondBreak(r.rule)){
            // Rebuild missed post-entry events on resume (including settlement gaps).
            // The native red cross is a one-shot event; a price remaining below K is not another break.
            if(at<=ruleEntry || at<=(r.state.confirmedAt??-Infinity) || (r.state.breakCount??0)>=2)return;
            if((row as Dbl5Row).darvas_5m_guard_broken){
              r.state.breakCount=(r.state.breakCount??0)+1;
              if(isBoxSecondBreakExitOnly(r.rule))r.state.firstCountedBreakAt??=at;
              else r.state.firstBreakAt??=at;
              r.state.confirmedAt=at;
              record(r.v.id,Math.max(ruleSince,at),r.state);
            }
            return;
          }
          // Older history initializes the box/ATR, never moves an already saved stop backwards.
          if(at<Math.floor(ruleSince/r.step)*r.step || (r.state.confirmedAt!=null&&at<=r.state.confirmedAt))return;
          if(isBoxBreak(r.rule)){
            // Warmup breaks are historical. An unavailable/newly absent line is not a red cross.
            if(at>ruleEntry&&at>=ruleSince&&(row as Dbl5Row).darvas_5m_guard_broken&&breakAt==null){breakAt=at;brokenBar=bars[i].openTime;r.state.confirmedAt=at;}
            return;
          }
          if (r.rule.guardRegime && (row as Dbl5Row).darvas_5m_guard_regime !== r.rule.guardRegime) return;
          const active=structureActiveBox(r.rule.structure,row);
          const reference=r.rule.reference,plus=out.DBL5P_details?.[i];
          const base=reference?reference.kind==='impulse0'?zero?.price:reference.kind==='impulse1115'?plus?.impulse_guard_value:plus?.guard_plus_value:r.rule.structure.kSource==='guard'?(row as Dbl5Row).darvas_5m_guard:r.rule.structure.kBasis==='invalidation'?active?.invalidation:active?.support;
          if(base==null)return; // Keep an existing protective K when the box subsequently breaks.
          const tick=reference?(r.readZero?dbl5TickAt(o.row.symbol,bars[i].openTime,bars[i].DBL5_tick_size??bars[i].ATI6H_tick_size??bars[i].PRS6H_tick_size,bars[i].PRS6H_data_source):(row as Dbl5Row).tick_size):undefined;
          if(reference&&tick==null)throw Error(BOX_STOP_INVALID_DATA);
          const line=reference?structureAdditionK({basePrice:base,buffer:r.rule.structure.buffer,bufferUnit:r.rule.structure.bufferUnit,tickSize:String(tick)},r.atr.value)?.k??NaN:base-(r.rule.structure.bufferUnit==='atr'?r.rule.structure.buffer*r.atr.value:base*r.rule.structure.buffer/100);
          if(!(line>0)||!Number.isFinite(line))throw Error('箱体硬止损 K 无效，请检查冗余');
          r.latestLine={line,at};
          if(r.state.line==null||r.rule.update==='follow'||r.rule.update==='raise-only'&&line>r.state.line){r.state.line=line;r.state.count=0;r.state.confirmedAt=at;}
        });
        r.cursor=to;
      }
      if(!isBoxSecondBreak(r.rule))record(r.v.id,minute.openTime,r.state);
      if(isBoxBreak(r.rule)){
        if(isBoxSecondBreak(r.rule)&&(r.state.breakCount??0)>=2){breakAt=r.state.confirmedAt;brokenBar=breakAt!-r.step;}
        if(breakAt!=null)candidates.push({at:observedAt,reading:isBoxSecondBreak(r.rule)?2:1,...(!nativeClose?{fillPrice:minute.open,fillPeak:minute.open,atOpen:true}:{}),barOpenTime:brokenBar!,cause:{id:r.v.id,label,...activationEvidence,kind:BOX_STOP_KIND,direction:'>=',threshold:isBoxSecondBreak(r.rule)?2:1,boxBreakEvidence:{version:r.rule.version,event:`darvas_${structureDbl5Timeframe(r.rule.structure)}_guard_broken`,confirmedAt:breakAt,sourceBarOpenTime:brokenBar!,...(isBoxSecondBreak(r.rule)?{breakCount:2,firstBreakAt:isBoxSecondBreakExitOnly(r.rule)?r.state.firstCountedBreakAt:r.state.firstBreakAt}:{})}}});
        continue;
      }
      const line=r.state.line;if(line==null)continue;
      const cause={id:r.parentId,label,...activationEvidence,...(r.channel?{boxStopChannel:r.channel,boxStopChannelsVersion:BOX_STOP_CHANNELS_VERSION}:{}),kind:BOX_STOP_KIND,direction:'<=' as const,threshold:line,boxStopEvidence:{version:r.rule.version,line,confirmedAt:r.state.confirmedAt!,confirmation:r.rule.confirmation,...(r.rule.guardRegime ? {guardRegime:r.rule.guardRegime} : {})}};
      if(r.rule.confirmation==='touch'){
        if(minute.low<=line*(1+1e-12)){const atOpen=minute.open<=line*(1+1e-12);candidates.push({at:minute.openTime,reading:atOpen?minute.open:line,fillPrice:atOpen?minute.open:line,fillPeak:minute.open,barOpenTime:minute.openTime,atOpen,cause});}
      }else if(r.rule.confirmation==='close-1m'||(minute.openTime+60000)%r.step===0){
        r.state.count=minute.close<=line*(1+1e-12)?r.state.count+1:0;
        record(r.v.id,minute.openTime+60000,r.state);
        if(r.state.count>=r.rule.closes)candidates.push({at:minute.openTime+60000,reading:minute.close,barOpenTime:minute.openTime,cause});
      }
    }
    candidates.sort((a,b)=>a.at-b.at||Number(!!b.atOpen)-Number(!!a.atOpen)||(b.fillPrice??0)-(a.fillPrice??0));
    const ignore = o.ignoreExit;
    return ignore ? candidates.find(trigger => !ignore(trigger.cause)) : candidates[0];
  };
  return {read,states,statesAt,deactivateBefore(boundary:number){
    for(const r of rules){if(r.v.mirrorStage?.stage!=='before')continue;
      const list=history.get(r.v.id)!,past=list.filter(p=>p.at<boundary);
      r.state={...(past.at(-1)?.state??{count:0})};
      history.set(r.v.id,past.length?past:[{at:o.since,state:{...r.state}}]);record(r.v.id,boundary,r.state);
    }
  },restartObservation(at:number){
    observationEntry=observationSince=at;
    for(const r of rules){
      r.state={count:0,...(r.latestLine?{line:r.latestLine.line,confirmedAt:r.latestLine.at}:{})};
      record(r.v.id,at,r.state);
    }
  }};
}
