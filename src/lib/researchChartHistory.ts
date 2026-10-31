/** Hidden, symbol-isolated prehistory for chart indicator warmup. Never adds visible candles. */
import type { KLineData } from 'klinecharts';
import { fetchResearchKlines, RESEARCH_INTERVALS, intervalMs, type ResearchInterval } from '@/lib/deepRsa/marketData';

interface Entry { from: number; desiredFrom:number; bars: KLineData[]; pending: boolean; retryAt: number; views:Map<number,KLineData[]> }
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
export const researchHistoryVersion = () => version;
export function subscribeResearchHistory(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function resetResearchHistory() { entries.clear(); version++; }

export function chartPrehistory(data: KLineData[], bars: number, step: number, namespace?:string): KLineData[] {
  const symbol = data[0]?.researchSymbol;
  const interval = RESEARCH_INTERVALS.find(i => intervalMs(i) === step) as ResearchInterval | undefined;
  if (typeof symbol !== 'string' || !interval || !data.length || !Number.isFinite(bars) || bars <= 0) return [];
  const to = data[0].timestamp, from = Math.max(0, to - Math.ceil(bars) * step);
  const key = `${namespace?namespace+'|':''}${symbol}|${interval}|${to}`;
  let entry = entries.get(key);
  if (!entry) {
    entry = { from: to, desiredFrom:from,bars: [], pending: false, retryAt: 0, views:new Map() };
    entries.set(key, entry);
    // Pending requests retain their own entry; evicted results cannot notify a different chart.
    if (entries.size > 24) entries.delete(entries.keys().next().value!);
  }
  entry.desiredFrom=Math.min(entry.desiredFrom,from);
  if (entry.from > from && !entry.pending && Date.now() >= entry.retryAt) {
    const current = entry;
    current.pending = true;
    // Collect every selected indicator's demand in this render before fetching.
    // Otherwise each larger window forces all formulas to restart once again.
    queueMicrotask(async()=>{try{do{const target=current.desiredFrom;
      const result=await fetchResearchKlines(symbol,target,to,undefined,undefined,interval,['ati6h','prs6h','sbs_5m','darvas_5m_lower'].includes(namespace??''));
      if(entries.get(key)!==current)return;
      current.from=target;
      current.bars=result.filter(b => b.openTime < to).map(b => ({ timestamp: b.openTime,
        ...(['ati6h','prs6h','sbs_5m','darvas_5m_lower'].includes(namespace??'')?{researchSymbol:symbol}:{}), ...(b.DBL5_prices?{DBL5_prices:b.DBL5_prices}:{}), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? Number.NaN,
        ...(b.quoteVolume != null ? { turnover: b.quoteVolume } : {}),
        ...(b.takerBuyQuoteVolume != null ? { takerBuyTurnover: b.takerBuyQuoteVolume } : {}),
      }));
      current.views.clear();
      }while(current.desiredFrom<current.from);
      current.pending = false;
      version++;
      for (const fn of listeners) fn();
    }catch{current.pending=false;current.retryAt=Date.now()+30_000;}});
  }
  if(!namespace)return entry.bars;
  // A stable slice is part of the worker channel identity. Re-filtering on every
  // redraw discards completed results before a namespaced indicator can paint.
  let view=entry.views.get(from);
  if(!view){view=entry.bars.filter(b=>b.timestamp>=from);entry.views.set(from,view);}
  return view;
}

/** An exact-state feature must wait for the complete requested prefix, not publish a provisional origin. */
export function chartPrehistoryReady(data:KLineData[],bars:number,step:number,namespace?:string):boolean {
 if(bars<=0)return true;const interval=RESEARCH_INTERVALS.find(i=>intervalMs(i)===step),to=data[0]?.timestamp,symbol=data[0]?.researchSymbol;
 const entry=entries.get(`${namespace?namespace+'|':''}${symbol}|${interval}|${to}`);return !!entry&&!entry.pending&&entry.from<=Math.max(0,to-Math.ceil(bars)*step);
}
