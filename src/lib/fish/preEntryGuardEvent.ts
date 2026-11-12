import { compileFishProgram, shortFishHash } from './algorithm';
import { evaluateOnBars, featureWindowMs } from '../deepDig/features';
import { dbl5GuardVersion, type Dbl5Checkpoint, type Dbl5Row } from '../dbl5m';
import type { TradeSignal } from '../signalLibrary';
import type { FishReconstructionLoader } from './reconstruction';
import { qualityHistoryFrom } from './qualityInitialization';
import { validateFishBars } from './shared';
import { stableEntryJson, type PreEntryThreeStage } from './preEntryThreeStage';

const FIVE=300000;
export interface EntryGuardEvent {
  id:string; at:number; kind:'first'|'rebuild'|'raise'|'lower'|'type-change';
  price:number; regime:'trend'|'range'; previousPrice:number|null; previousRegime:'trend'|'range'|null;
  boxId:string|null; segment:number; broken:boolean;
  tickSize:string|null; algorithmVersion:string; guardVersion:string; parameters:unknown;
  initializationStart:number; initializationId:string; dataChecksum:string;
}
/** Price is already quantized by the native engine. No screen rounding or epsilon. */
export function nativeGuardEvent(previous:Dbl5Row|undefined, row:Dbl5Row, scanStart:number):EntryGuardEvent|undefined {
  const price=row.darvas_5m_guard,regime=row.darvas_5m_guard_regime;
  if (!row.data_valid || row.at<=scanStart || price==null || !(price>0) || !regime) return;
  const before=previous?.darvas_5m_guard??null, oldRegime=previous?.darvas_5m_guard_regime??null;
  const rebuilt=row.darvas_5m_guard_broken || previous!=null && row.darvas_5m_guard_segment!==previous.darvas_5m_guard_segment;
  if (!rebuilt && before===price && oldRegime===regime) return;
  const kind:EntryGuardEvent['kind']=rebuilt?'rebuild':before==null?(row.darvas_5m_guard_segment!>0?'rebuild':'first'):oldRegime!==regime?'type-change':price>before?'raise':'lower';
  const evidence={at:row.at,kind,price,regime,previousPrice:before,previousRegime:oldRegime,boxId:row.box_id,segment:row.darvas_5m_guard_segment??0,broken:!!row.darvas_5m_guard_broken,
    tickSize:row.tick_size,algorithmVersion:row.algorithm_version,guardVersion:dbl5GuardVersion(row.effective_parameters),parameters:row.effective_parameters,
    initializationStart:row.initialization_start!,initializationId:row.initialization_id,dataChecksum:row.data_checksum};
  return {id:'entry-guard-'+shortFishHash(stableEntryJson(evidence)),...evidence};
}
/** Read-only adapter; checkpoints, parameters and initialization follow the original native engine. */
export function createPreEntryGuardReader(o:{config:PreEntryThreeStage;row:TradeSignal;start:number;load:FishReconstructionLoader;signal:AbortSignal}) {
  const def=o.config.guard.rule.structure.definition,plan=compileFishProgram(def,{statistic:'结果',direction:'>',threshold:0,constraints:[]});
  const from=qualityHistoryFrom(o.load,Math.floor(o.start/FIVE)*FIVE-Math.ceil(featureWindowMs(def)/FIVE)*FIVE,FIVE);
  if(from<0)throw Error('三阶防守线初始化历史不足');
  let cursor=from,checkpoint:Dbl5Checkpoint|undefined,previous:Dbl5Row|undefined;
  return async(at:number):Promise<{event?:EntryGuardEvent;line?:number;regime?:string;broken:boolean}>=>{
    let event:EntryGuardEvent|undefined,broken=false;
    const cut=Math.floor(at/FIVE)*FIVE;
    while(cursor<cut){
      if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
      const to=Math.min(cut,cursor+500*FIVE),bars=await o.load(o.row,cursor,to,plan,o.signal);
      validateFishBars(bars,to,(to-cursor)/FIVE,FIVE);
      const out=evaluateOnBars(bars,plan.compiled,{...def,DBL5_symbol:o.row.symbol,DBL5_initialization_start:from,DBL5_initialization_id:'entry-guard:'+from,DBL5_checkpoint:checkpoint});
      const rows=out.DBL5_details;
      if(!rows||rows.length!==bars.length)throw Error('三阶防守线缺少原生结构读数');
      checkpoint=out.DBL5_checkpoint;
      for(const row of rows){
        if(!row.data_valid)throw Error('三阶防守线行情或报价精度无效，不能跳过缺口');
        // Historical warmup initializes state only. An event must belong to t.
        if(row.at===at){event=nativeGuardEvent(previous,row,o.start);broken=!!row.darvas_5m_guard_broken;}
        previous=row;
      }
      cursor=to;
    }
    return {event,line:previous?.darvas_5m_guard??undefined,regime:previous?.darvas_5m_guard_regime??undefined,broken};
  };
}
