import { evaluateOnBars, featureWindowMs, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { advanceChartAtr, type ChartAtrState } from '@/lib/atr';
import { compileFishProgram } from './algorithm';
import { freezeStructureVersions } from './boxAlgorithmVersions';
import { defaultStructureAddition, structureActiveBox, structureAdditionIdentity, validateStructureAddition, type StructureAdditionRule } from './qualityAdditionStructure';
import { qualityHistoryFrom } from './qualityInitialization';
import { validateFishBars } from './shared';
import { dbl5Parameters, type Dbl5Checkpoint, type Dbl5Row } from '@/lib/dbl5m';
import { sbsParameters, type SbsCheckpoint } from '@/lib/sbs5m';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishReconstructionLoader } from './reconstruction';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { QualityHoldingVeto } from './qualityVeto';
import type { QualityTrigger } from './qualityIntrabar';

export const BOX_STOP_KIND = 'box-stop' as const;
export const BOX_STOP_VERSION = 'holding-box-stop-v1';
export const BOX_BREAK_VERSION = 'holding-support-break-v1';
export const BOX_BREAK_CHOICE = 'box-support-break';
export interface BoxStopRule {
  version: typeof BOX_STOP_VERSION | typeof BOX_BREAK_VERSION;
  structure: StructureAdditionRule;
  update: 'fixed' | 'raise-only' | 'follow';
  confirmation: 'touch' | 'close-1m' | 'close-5m' | 'guard-break';
  closes: number;
}
export interface BoxStopState { line?: number; confirmedAt?: number; count: number }
export function freezeBoxStop(rule:BoxStopRule):BoxStopRule {
  const structure=freezeStructureVersions(rule.structure),d=structure.definition;
  return {...rule,structure:{...structure,definition:{...d,...(structure.algorithm==='dbl5'?{DBL5_config:dbl5Parameters(d.DBL5_config)}:{SBS5M_config:sbsParameters(d.SBS5M_config)})}}};
}
export const defaultBoxStop = (defs: readonly DeepDigFeatureDef[] = []): BoxStopRule => freezeBoxStop({version: BOX_STOP_VERSION, structure: {...defaultStructureAddition('dbl5', defs), kSource:'current'}, update:'raise-only', confirmation:'touch', closes:1});
/** Opt-in event exit: the exact DBL-5 flag used to draw a red cross. */
export const isBoxBreak = (rule:BoxStopRule) => rule.version === BOX_BREAK_VERSION;
export const defaultBoxBreak = (defs:readonly DeepDigFeatureDef[]=[]):BoxStopRule => freezeBoxStop({version:BOX_BREAK_VERSION,structure:{...defaultStructureAddition('dbl5',defs),kSource:'guard',buffer:0,bufferUnit:'atr'},update:'follow',confirmation:'guard-break',closes:1});
export function validateBoxStop(rule?: BoxStopRule): asserts rule is BoxStopRule {
  if (!rule || ![BOX_STOP_VERSION,BOX_BREAK_VERSION].includes(rule.version)) throw Error('箱体硬止损版本不可用，请保留原版并新建方案');
  validateStructureAddition(rule.structure);
  if(isBoxBreak(rule)){
    if(rule.structure.algorithm!=='dbl5'||rule.structure.kSource!=='guard'||rule.structure.buffer!==0||rule.structure.bufferUnit!=='atr'||rule.confirmation!=='guard-break'||rule.update!=='follow'||rule.closes!==1)throw Error('支撑断裂须使用 DBL-5 防守线原生红叉事件，不能添加触价冗余或另行确认');
    return;
  }
  if (!['current','guard'].includes(rule.structure.kSource ?? '') || !['fixed','raise-only','follow'].includes(rule.update)
    || !['touch','close-1m','close-5m'].includes(rule.confirmation) || !Number.isInteger(rule.closes) || rule.closes<1 || rule.closes>100) throw Error('请完善箱体硬止损的基准、更新方式与确认根数（1–100）');
}
export const boxStopIdentity = (r: BoxStopRule) => [r.version,structureAdditionIdentity(r.structure),r.update,r.confirmation,r.closes];
export const boxStopLabel = (r: BoxStopRule) => isBoxBreak(r)?'DBL-5 支撑断裂（防守线红叉确认）；下一分钟开盘全仓卖出':`${r.structure.algorithm==='dbl5'?'DBL-5':'SBS-5M'} ${r.structure.kSource==='guard'?'防守线':r.structure.kBasis==='invalidation'?'失效线':'箱底'} − ${r.structure.buffer}${r.structure.bufferUnit==='atr'?'ATR':'%'}；${({fixed:'首次有效线固定','raise-only':'只升不降',follow:'跟随最新线'})[r.update]}；${r.confirmation==='touch'?'触碰 K 立即卖出':`${r.confirmation==='close-1m'?'1':'5'} 分钟连续 ${r.closes} 根收盘 ≤ K`}`;

/** Only already closed native 5m structures can place a stop for the next minute. */
export function createBoxStopReader(o:{vetoes:readonly QualityHoldingVeto[];row:TradeSignal;entry:number;since:number;load:FishReconstructionLoader;signal:AbortSignal;previous?:Record<string,BoxStopState>}) {
  const rules=o.vetoes.filter(v=>v.enabled&&v.kind===BOX_STOP_KIND).map(v=>{
    validateBoxStop(v.boxStop);
    const rule=v.boxStop,def=rule.structure.definition,plan=compileFishProgram(def,{statistic:'结果',direction:'>',threshold:0,constraints:[]});
    const from=qualityHistoryFrom(o.load,Math.floor(o.entry/300000)*300000-Math.ceil(featureWindowMs(def)/300000)*300000,300000);
    if(from<0)throw Error('箱体硬止损初始化历史不足');
    return {v,rule,def,plan,from,cursor:from,dbl:undefined as Dbl5Checkpoint|undefined,sbs:undefined as SbsCheckpoint|undefined,atr:undefined as ChartAtrState|undefined,state:{count:0,...o.previous?.[v.id]} as BoxStopState};
  });
  const states=()=>Object.fromEntries(rules.map(r=>[r.v.id,{...r.state}]));
  const history=new Map(rules.map(r=>[r.v.id,[{at:o.since,state:{...r.state}}]]));
  const record=(id:string,at:number,state:BoxStopState)=>{const list=history.get(id)!;if(JSON.stringify(list.at(-1)!.state)!==JSON.stringify(state))list.push({at,state:{...state}});};
  const statesAt=(at:number)=>Object.fromEntries(rules.map(r=>[r.v.id,{...history.get(r.v.id)!.filter(p=>p.at<=at).at(-1)?.state}]));
  const read=async (minute:ResearchBar, options?:{observeNativeClose?:boolean}):Promise<QualityTrigger|undefined>=>{
    const candidates:QualityTrigger[]=[];
    for(const r of rules){
      let breakAt:number|undefined,brokenBar:number|undefined;
      // Entry v4 observes the newly completed native event at this minute's
      // close. Touch stops still use only lines known before the minute opened.
      const nativeClose=options?.observeNativeClose&&isBoxBreak(r.rule);
      const observedAt=minute.openTime+(nativeClose?60000:0);
      const cut=Math.floor(observedAt/300000)*300000;
      while(r.cursor<cut){
        if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
        const to=Math.min(cut,r.cursor+500*300000),bars=await o.load(o.row,r.cursor,to,r.plan,o.signal);
        validateFishBars(bars,to,(to-r.cursor)/300000,300000);
        const out=evaluateOnBars(bars,r.plan.compiled,{...r.def,DBL5_symbol:o.row.symbol,DBL5_initialization_start:r.from,DBL5_initialization_id:`box-stop:${r.from}`,DBL5_checkpoint:r.dbl,SBS5M_symbol:o.row.symbol,SBS5M_initialization_id:`box-stop:${r.from}`,SBS5M_checkpoint:r.sbs});
        r.dbl=out.DBL5_checkpoint;r.sbs=out.SBS5M_checkpoint;
        const rows=r.rule.structure.algorithm==='dbl5'?out.DBL5_details:out.SBS5M_details;
        if(!rows||rows.length!==bars.length)throw Error('箱体硬止损缺少结构读数');
        rows.forEach((row,i)=>{
          if(!row.data_valid)throw Error('箱体硬止损行情或报价精度无效，不能跳过缺口');
          r.atr=advanceChartAtr(r.atr,bars[i]);
          const at=bars[i].openTime+300000;
          // Older history initializes the box/ATR, never moves an already saved stop backwards.
          if(at<Math.floor(o.since/300000)*300000 || (r.state.confirmedAt!=null&&at<=r.state.confirmedAt))return;
          if(isBoxBreak(r.rule)){
            // Warmup breaks are historical. An unavailable/newly absent line is not a red cross.
            if(at>o.entry&&at>=o.since&&(row as Dbl5Row).darvas_5m_guard_broken&&breakAt==null){breakAt=at;brokenBar=bars[i].openTime;r.state.confirmedAt=at;}
            return;
          }
          const active=structureActiveBox(r.rule.structure,row);
          const base=r.rule.structure.kSource==='guard'?(row as Dbl5Row).darvas_5m_guard:r.rule.structure.kBasis==='invalidation'?active?.invalidation:active?.support;
          if(base==null)return; // Keep an existing protective K when the box subsequently breaks.
          const line=base-(r.rule.structure.bufferUnit==='atr'?r.rule.structure.buffer*r.atr.value:base*r.rule.structure.buffer/100);
          if(!(line>0)||!Number.isFinite(line))throw Error('箱体硬止损 K 无效，请检查冗余');
          if(r.state.line==null||r.rule.update==='follow'||r.rule.update==='raise-only'&&line>r.state.line){r.state.line=line;r.state.count=0;r.state.confirmedAt=at;}
        });
        r.cursor=to;
      }
      record(r.v.id,minute.openTime,r.state);
      if(isBoxBreak(r.rule)){
        if(breakAt!=null)candidates.push({at:observedAt,reading:1,...(!nativeClose?{fillPrice:minute.open,fillPeak:minute.open,atOpen:true}:{}),barOpenTime:brokenBar!,cause:{id:r.v.id,label:boxStopLabel(r.rule),kind:BOX_STOP_KIND,direction:'>=',threshold:1,boxBreakEvidence:{version:BOX_BREAK_VERSION,event:'darvas_5m_guard_broken',confirmedAt:breakAt,sourceBarOpenTime:brokenBar!}}});
        continue;
      }
      const line=r.state.line;if(line==null)continue;
      const cause={id:r.v.id,label:boxStopLabel(r.rule),kind:BOX_STOP_KIND,direction:'<=' as const,threshold:line,boxStopEvidence:{version:BOX_STOP_VERSION,line,confirmedAt:r.state.confirmedAt!,confirmation:r.rule.confirmation}};
      if(r.rule.confirmation==='touch'){
        if(minute.low<=line*(1+1e-12)){const atOpen=minute.open<=line*(1+1e-12);candidates.push({at:minute.openTime,reading:atOpen?minute.open:line,fillPrice:atOpen?minute.open:line,fillPeak:minute.open,barOpenTime:minute.openTime,atOpen,cause});}
      }else if(r.rule.confirmation==='close-1m'||(minute.openTime+60000)%300000===0){
        r.state.count=minute.close<=line*(1+1e-12)?r.state.count+1:0;
        record(r.v.id,minute.openTime+60000,r.state);
        if(r.state.count>=r.rule.closes)candidates.push({at:minute.openTime+60000,reading:minute.close,barOpenTime:minute.openTime,cause});
      }
    }
    return candidates.sort((a,b)=>a.at-b.at||Number(!!b.atOpen)-Number(!!a.atOpen)||(b.fillPrice??0)-(a.fillPrice??0))[0];
  };
  return {read,states,statesAt};
}
