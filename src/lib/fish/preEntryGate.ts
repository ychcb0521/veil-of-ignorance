import { createVetoHistoryReader } from './qualityVetoHistory';
import type { ResearchBar } from '../deepRsa/window';
import type { TradeSignal } from '../signalLibrary';
import { advanceChartAtr, type ChartAtrState } from '../atr';
import { compileFishProgram } from './algorithm';
import type { FishReconstructionLoader } from './reconstruction';
import { validateFishBars } from './shared';
import { qualityHistoryFrom } from './qualityInitialization';
import { activeAdditionVetoes, evaluateAdditionVetoes, fastDropHit, type AdditionVetoHit } from './qualityAdditionVeto';
import { advanceQualityHolding, holdingVetoReading, minuteDropReading, minuteDropWindow, type QualityHoldingPath } from './qualityVeto';
import { createBoxStopReader, isBoxBreak } from './qualityBoxStop';
import { preEntryConditionText, preEntryVetoes, type PreEntryConditions } from './preEntryConditions';
import { formatUTC8 } from '../timeFormat';

const M = 60000, FIVE = 5 * M;
const pricePlan = (interval: '1m' | '5m') => compileFishProgram({id:'pre-entry-price',name:'筛选价格',short:'价格',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval}, {statistic:'结果',direction:'>',threshold:0,constraints:[]});
export const preEntryGuardWarmBars = (conditions?: PreEntryConditions) => {
  const guards = activeAdditionVetoes(conditions?.entryVetoes).filter(v=>v.kind!=='fast-drop'&&v.historyHours==null);
  return guards.length ? Math.max(87, ...guards.map(v=>v.lookbackBars??0)) : 0;
};

/** Price-path state is rebuilt causally from the original scan start on resume.
 * No position, quantity, fill, profit or account data is invented. */
export function createPreEntryGate(o: { conditions: PreEntryConditions; start: number; row: TradeSignal; load: FishReconstructionLoader; signal: AbortSignal; latchHardStops?: boolean }) {
  let entry = Math.ceil(o.start / M) * M;
  const vetoes = preEntryVetoes(o.conditions), guards = activeAdditionVetoes(o.conditions.entryVetoes).filter(v=>v.historyHours==null);
  const history=createVetoHistoryReader({rules:o.conditions.entryVetoes,entry:o.start,row:o.row,load:o.load,signal:o.signal});
  const priceVetoes = vetoes.filter(v=>v.kind!=='indicator'&&v.kind!=='box-stop');
  const boxes = vetoes.filter(v=>v.kind==='box-stop');
  const boxReader = createBoxStopReader({vetoes:boxes,row:o.row,entry,since:entry,load:o.load,signal:o.signal});
  const bars: ResearchBar[] = [], atr: number[] = [], minutes: ResearchBar[] = [];
  const slowGuards = guards.filter(v=>v.kind!=='fast-drop');
  const fast = guards.filter(v=>v.kind==='fast-drop');
  const minutePlan = pricePlan('1m'), fivePlan = pricePlan('5m');
  let cursor = entry, fiveCursor = qualityHistoryFrom(o.load, Math.floor(entry/FIVE)*FIVE-preEntryGuardWarmBars(o.conditions)*FIVE, FIVE);
  let path: QualityHoldingPath | undefined, atrState: ChartAtrState | undefined;
  let fastHit: AdditionVetoHit | undefined, lockPeak: number | undefined;
  let boxHit: string | undefined, slowHit: AdditionVetoHit | undefined;
  let historicalHardStop: { at: number; reason: string } | undefined;
  const priceHit = (at: number) => {
    for (const veto of priceVetoes) {
      const n = minuteDropWindow(veto.kind);
      const reading = n ? minuteDropReading(minutes,n,entry,at)?.reading : path ? holdingVetoReading(path,veto.kind as 'static-drawdown'|'dynamic-drawdown') : undefined;
      if (reading != null && reading >= veto.threshold-1e-10) return `${veto.label.replace(/持仓/g,'筛选')}：${+reading.toFixed(6)}% ≥ ${veto.threshold}%`;
    }
  };
  const consume = async (bar: ResearchBar) => {
    if (bar.openTime !== cursor) throw Error('筛选观察区间缺少连续分钟行情，不能跳过');
    if (![bar.open,bar.high,bar.low,bar.close].every(p=>Number.isFinite(p)&&p>0)) throw Error('筛选价格无效');
    path ??= { entry:bar.open, peak:bar.open, minimum:bar.open, dynamic:0 };
    path = advanceQualityHolding(path, bar);
    minutes.push(bar);
    // Only the largest supported rolling window is needed; historical fast-drop
    // hits are latched separately, matching the original "曾出现过" condition.
    if (minutes.length > 240) minutes.shift();
    if (!fastHit) for (const rule of fast) {
      const hit = fastDropHit(rule.windows??[], minutes, entry);
      if (hit) { fastHit={kind:'fast-drop',label:'筛选期间急跌',reading:`${hit.window.minutes} 分钟跌幅 ${+hit.drop.toFixed(4)}% ≥ ${hit.window.pct}%`}; break; }
    }
    const stop = await boxReader.read(bar, { observeNativeClose: true });
    boxHit = stop?.cause?.label ? preEntryConditionText(stop.cause.label) : undefined;
    cursor += M;
    if (o.latchHardStops && !historicalHardStop) {
      const reason = boxHit ?? priceHit(cursor);
      if (reason) historicalHardStop = { at: cursor, reason };
    }
  };
  const read=async (at: number, minute?: ResearchBar): Promise<{blocked?:string;pending?:string}> => {
    if (o.signal.aborted) throw new DOMException('已暂停','AbortError');
    // The first call can be after indicator warmup or a pause. Restore the
    // reference path only through this observation, never through future bars.
    while (cursor < at) {
      if (minute?.openTime===cursor && cursor+M===at) { await consume(minute); break; }
      const to=Math.min(at,cursor+500*M);
      const prefix=await o.load(o.row,cursor,to,minutePlan,o.signal);
      validateFishBars(prefix,to,(to-cursor)/M,M);
      for (const bar of prefix) await consume(bar);
    }
    const historical=await history(at);
    let blocked = boxHit??(historical.hit?`${historical.hit.label}：${historical.hit.reading}`:undefined);
    if (historicalHardStop) blocked ??= historicalHardStop.at === at ? historicalHardStop.reason : `${historicalHardStop.reason} · 历史触发于 ${formatUTC8(historicalHardStop.at)}`;
    blocked ??= priceHit(at);
    if (fastHit) blocked??=`${fastHit.label}：${fastHit.reading}`;
    if ((priceVetoes.length||guards.length||boxes.length) && !path) return {blocked,pending:'等待筛选起点后的首根完整分钟行情'};
    if (slowGuards.length) {
      const cut=Math.floor(at/FIVE)*FIVE;
      while (fiveCursor<cut) {
        const to=Math.min(cut,fiveCursor+500*FIVE);
        const next=await o.load(o.row,fiveCursor,to,fivePlan,o.signal);
        validateFishBars(next,to,(to-fiveCursor)/FIVE,FIVE);
        for (const bar of next) {
          bars.push(bar); atrState=advanceChartAtr(atrState,bar); atr.push(atrState.value);
          if (lockPeak!=null&&bar.openTime>=entry&&bar.close>=lockPeak) lockPeak=undefined;
          slowHit=undefined;
          // Rebuild every completed observation, including historical sticky
          // locks before the indicators finish warming up or a round resumes.
          for (const rule of slowGuards) {
            const hit=evaluateAdditionVetoes([rule],bars,atr,entry);
            if (hit) {
              slowHit??=hit;
              if (bar.openTime+FIVE>entry&&hit.lockPeak!=null) lockPeak=Math.max(lockPeak??-Infinity,hit.lockPeak);
            }
          }
        }
        fiveCursor=to;
      }
      if (!(atr.at(-1)!>0) || slowGuards.some(v=>v.kind==='lower-spike'&&bars.length<2||v.kind==='volatility'&&bars.length<25)
        || slowGuards.some(v=>v.kind.startsWith('pullback'))&&!bars.some(b=>b.openTime>=entry)) return {blocked,pending:'等待否决条件所需的已收盘 5 分钟行情与 ATR'};
      if (lockPeak!=null) blocked??=`冲高回落锁定：尚未以 5 分钟收盘收复 ${lockPeak}`;
      const hit=slowHit;
      if (hit) {
        blocked??=`${hit.label.replace(/持仓/g,'筛选').replace(/不再加仓/g,'不入选')}：${hit.reading.replace(/持仓/g,'筛选')}`;
      }
    }
    const states=boxReader.states();
    if (boxes.some(v=>!isBoxBreak(v.boxStop!)&&states[v.id]?.line==null)) return {blocked,pending:'等待有效箱体 K 基准，尚不入选'};
    return {blocked,...(historical.pending?{pending:historical.pending}:{})};
  };
  // v7 only: reuse causal indicator/ATR warmup, never reload the same market
  // history for every rejection. All attempt-dependent paths and locks reset.
  return Object.assign(read,{restart(at:number){
    if(at!==cursor||at%M!==0)throw Error('重筛起点须位于已观察分钟的下一起点');
    entry=at;path=undefined;minutes.length=0;fastHit=undefined;lockPeak=undefined;slowHit=undefined;boxHit=undefined;historicalHardStop=undefined;
    boxReader.restartObservation(at);
  }});
}
