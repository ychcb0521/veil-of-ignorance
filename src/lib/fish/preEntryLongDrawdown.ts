import {compileFishProgram} from './algorithm';
import {validateFishBars} from './shared';
import type {FishReconstructionLoader} from './reconstruction';
import type {ResearchBar} from '../deepRsa/window';
import type {TradeSignal} from '../signalLibrary';
import type {EntryConditionReading} from './preEntryMarketReader';
export interface EntryLongDrawdown {enabled:boolean;hours:number;pct:number;mode:'current'|'maximum'}
interface EntryLongDrawdownResult {pending?:string;blocked?:string;reading?:EntryConditionReading&{label:string;value:number;threshold:number;direction:'>=';role:'veto'}}
type Summary={high:number;low:number;drawdown:number};
const combine=(a:Summary|undefined,b:Summary|undefined):Summary|undefined=>!a?b:!b?a:{high:Math.max(a.high,b.high),low:Math.min(a.low,b.low),drawdown:Math.max(a.drawdown,b.drawdown,(a.high-b.low)/a.high*100)};
/** Sliding aggregate queue: chronological peak-to-trough drawdown, O(1)
 * amortized work per bar, with no rescans of a multi-day window per minute. */
export class EntryDrawdownWindow {
 private left:{at:number;one:Summary;all:Summary}[]=[];
 private right:{at:number;one:Summary;all:Summary}[]=[];
 push(bar:ResearchBar){if(![bar.open,bar.high,bar.low,bar.close].every(p=>Number.isFinite(p)&&p>0)||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close))throw Error('长周期回撤行情价格无效');const one={high:bar.high,low:bar.low,drawdown:(bar.high-bar.low)/bar.high*100};this.right.push({at:bar.openTime,one,all:combine(this.right.at(-1)?.all,one)!});}
 trim(from:number){for(;;){if(!this.left.length)while(this.right.length){const item=this.right.pop()!;this.left.push({...item,all:combine(item.one,this.left.at(-1)?.all)!});}if(!this.left.length||this.left.at(-1)!.at>=from)return;this.left.pop();}}
 reading(close:number,mode:EntryLongDrawdown['mode']){const all=combine(this.left.at(-1)?.all,this.right.at(-1)?.all);return all?Math.max(0,mode==='maximum'?all.drawdown:(all.high-close)/all.high*100):undefined;}
}
export function createEntryLongDrawdownReader(o:{condition:EntryLongDrawdown;row:TradeSignal;load:FishReconstructionLoader;signal:AbortSignal;availableStart?:number}){
 const c=o.condition,window=c.hours*3600000,M=60000,queue=new EntryDrawdownWindow();
 const plan=compileFishProgram({id:'pre-entry-long-drawdown',name:'长周期回撤',short:'长回撤',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'1m'},{statistic:'结果',direction:'>',threshold:0,constraints:[]});
 let cursor:number|undefined;
 return async(at:number,minute:ResearchBar):Promise<EntryLongDrawdownResult>=>{
  const from=Math.ceil((at-window)/M)*M;
  if(o.availableStart!=null&&from<o.availableStart)return {pending:'长周期回撤：历史不足完整回看时长，尚不准入'};
  cursor??=from;
  if(cursor>at)throw Error('长周期回撤观察时间不能倒退');
  while(cursor<at){
   if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
   if(cursor===minute.openTime&&cursor+M===at){validateFishBars([minute],at,1,M);queue.push(minute);cursor=at;break;}
   const cut=Math.min(minute.openTime,cursor+500*M),bars=await o.load(o.row,cursor,cut,plan,o.signal);
   validateFishBars(bars,cut,(cut-cursor)/M,M);for(const bar of bars)queue.push(bar);cursor=cut;
  }
  queue.trim(from);
  const value=queue.reading(minute.close,c.mode);
  if(value==null||!Number.isFinite(value))return {pending:'长周期回撤：等待读数，尚不准入'};
  const label=c.mode==='maximum'?'窗口内最大回撤':'当前距窗口高点回撤',hit=value>=c.pct-1e-10;
  return {reading:{id:'long-drawdown-v1',label:`长周期 ${c.hours} 小时 · ${label}`,at,value,met:hit,threshold:c.pct,direction:'>=',role:'veto' as const},...(hit?{blocked:`长周期回撤否决：${c.hours} 小时${label} ${+value.toFixed(4)}% ≥ ${c.pct}%`}:{})};
 };
}
