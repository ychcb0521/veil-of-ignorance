/** Re-scan closed detector observations after entry. Formula warm-up never counts as a new hit. */
import { compileFishProgram, evaluateFishProgram, type FishProgram } from './algorithm';
import type { FishReconstructionLoader } from './reconstruction';
import type { TradeSignal } from '@/lib/signalLibrary';
import { fishDelay, validateFishBars } from './shared';
import type { QualityAdditionFill } from './qualityAddition';
export interface AdditionCandidate { plan: FishProgram; scale: number; threshold: number; direction: '<' | '>'; metric: string; label: string; featureId?: string; definitionKey?: string }
const MINUTE=60000;
export async function findQualityAdditionTrigger(o: { candidates: AdditionCandidate[]; row: TradeSignal; entry: number; end: number; notional?: number; quantity?: number; after?:number;priceAt?:ReadonlyMap<number,number>; load: FishReconstructionLoader; signal: AbortSignal }): Promise<Omit<QualityAdditionFill,'quantity'|'notional'>|undefined> {
  let best: Omit<QualityAdditionFill,'price'|'quantity'|'notional'> | undefined;
  for (const candidate of o.candidates) {
    const {plan}=candidate, start=Math.floor(Math.max(o.entry,o.after??o.entry)/plan.step)*plan.step, first=Math.floor(o.entry/plan.step)*plan.step+plan.step;
    if (plan.unavailable) throw new Error(plan.unavailable);
    let cursor=start;
    const stop=Math.floor(Math.min(o.end,best?.at ?? Infinity)/plan.step)*plan.step;
    while(cursor<stop) {
      if(o.signal.aborted) throw new DOMException('已暂停','AbortError');
      const cut=Math.min(stop,cursor+500*plan.step),from=cursor-plan.warm*plan.step;
      if(from<0) throw new Error('加仓探测公式预热历史不足');
      const bars=await o.load(o.row,from,cut,plan,o.signal);
      validateFishBars(bars,cut,(cut-from)/plan.step,plan.step);
      const values=evaluateFishProgram(bars,plan);
      for(let i=0;i<bars.length;i++) {
        const at=bars[i].openTime+plan.step;
        if(at<=o.entry || at<=(o.after??-Infinity) || at<=cursor || at>=o.end || best && at>=best.at) continue;
        const reading=values.average[i]*candidate.scale;
        if(!Number.isFinite(reading) || values.constraints.some(c=>!Number.isFinite(c[i]))) throw new Error('加仓探测存在缺失读数，不能越过缺口判断加仓');
        if(!(candidate.direction==='>'?reading>candidate.threshold:reading<candidate.threshold) || values.constraints.some(c=>!c[i])) continue;
        // S's duration gate must be proven wholly after entry, including every closed reading in the route.
        if(plan.stateHold && !(plan.stateHoldAlternatives??[plan.stateHold]).some(route=>at>=first+(route.samples-1)*plan.step && i>=route.samples-1 && values.average.subarray(i-route.samples+1,i+1).every(v=>Number.isFinite(v)&&v>route.threshold))) continue;
        best={at,scanFrom:o.entry,reading,threshold:candidate.threshold,direction:candidate.direction,metric:candidate.metric,label:candidate.label,
          featureId:candidate.featureId,definitionKey:candidate.definitionKey,barOpenTime:bars[i].openTime};
        break;
      }
      if(best && best.at<=cut) break;
      cursor=cut; await fishDelay(0,o.signal);
    }
  }
  if(!best) return;
  const known=o.priceAt?.get(best.at);if(known!=null&&known>0&&Number.isFinite(known))return {...best,price:known};
  const price=compileFishProgram({id:'add-price',name:'加仓成交价',short:'价格',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'1m'}, {statistic:'结果',direction:'>',threshold:0,constraints:[]});
  const bars=await o.load(o.row,best.at,best.at+MINUTE,price,o.signal);
  validateFishBars(bars,best.at+MINUTE,1,MINUTE);
  if(!(bars[0].open>0) || !Number.isFinite(bars[0].open)) throw new Error('缺少有效加仓成交价格');
  return {...best,price:bars[0].open};
}
export async function findQualityAddition(o:Parameters<typeof findQualityAdditionTrigger>[0]):Promise<QualityAdditionFill|undefined>{
 const trigger=await findQualityAdditionTrigger(o);if(!trigger)return;
 const quantity=o.quantity??o.notional!/trigger.price,notional=o.quantity==null?o.notional!:quantity*trigger.price;
 if(!(quantity>0)||!Number.isFinite(quantity)||!(notional>0)||!Number.isFinite(notional))throw new Error('加仓数量或成交金额超出可计算范围');
 return {...trigger,quantity,notional};
}
