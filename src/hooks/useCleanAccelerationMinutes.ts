import {useEffect,useMemo,useRef,useState} from 'react';
import {fetchResearchKlines} from '@/lib/deepRsa/marketData';
import type {InstantCampaignInput} from '@/lib/fish/instantCampaign';
import {getUserPrefix} from '@/lib/userStoragePrefix';
import {isTuringCupSymbol} from '@/lib/turingCupSymbol';
import {
  ACCELERATION_MINUTE,cleanAcceleration1116Signals,type AccelerationChartInput,type AccelerationMinute,
} from '@/lib/cleanAcceleration1116Chart';

export type AccelerationMarketSource = InstantCampaignInput['source'];

interface Coverage {
  from: number;
  through: number;
  bars: AccelerationMinute[];
}
interface Session {
  key: string;
  controller: AbortController;
  pending: boolean;
  retry?: ReturnType<typeof setTimeout>;
}
const NO_BARS: AccelerationMinute[] = [];

export function accelerationMissingRange(coverage: Pick<Coverage,'from'|'through'> | undefined, from: number, through: number) {
  if (through<=from) return;
  if (!coverage || through<=coverage.from || from>=coverage.through) return {from,through,side:'replace'} as const;
  if (through>coverage.through) return {from:coverage.through,through,side:'right'} as const;
  if (from<coverage.from) return {from,through:coverage.from,side:'left'} as const;
}

export function useCleanAccelerationMinutes(symbol: string, from: number, through: number, timezone: string, source?: AccelerationMarketSource): AccelerationChartInput {
  const key = symbol ? JSON.stringify([symbol,source?.exchange,source?.market,source?.symbol,source?.binanceSymbol,
    isTuringCupSymbol(symbol)?getUserPrefix():null]) : '';
  const sessionRef = useRef<Session>();
  const [snapshot,setSnapshot] = useState<{session:Session;coverage?:Coverage;error?:boolean}>();
  const session = sessionRef.current;
  const current = key && snapshot?.session===session && session?.key===key ? snapshot : undefined;
  const coverage = current?.coverage;

  useEffect(()=>{
    if (!key) return;
    const active: Session = {key,controller:new AbortController(),pending:false};
    sessionRef.current = active;
    return ()=>{
      active.controller.abort();
      clearTimeout(active.retry);
      sessionRef.current = undefined;
    };
  },[key]);

  useEffect(()=>{
    const active = sessionRef.current;
    if (!key || active?.key!==key || active.pending || current?.error) return;
    const range = accelerationMissingRange(coverage,from,through);
    if (!range) return;
    active.pending = true;
    const {signal} = active.controller;
    const read = async () => {
      if (source && ((source.exchange && source.exchange!=='binance') || source.market==='us_stock')) {
        const {readPageInstantCampaignCandles} = await import('@/hooks/useFish');
        return readPageInstantCampaignCandles(source,'1m',range.from,range.through,signal);
      }
      return fetchResearchKlines(symbol,range.from,range.through,undefined,signal,'1m');
    };
    void read().then(rows=>{
      if (signal.aborted) return;
      const bars = rows.filter(bar=>bar.openTime>=range.from && bar.openTime+ACCELERATION_MINUTE<=range.through)
        .map(bar=>({time:bar.openTime,open:bar.open,high:bar.high,low:bar.low,close:bar.close}));
      active.pending = false;
      const next = range.side==='left' && coverage ? {from:range.from,through:coverage.through,bars:[...bars,...coverage.bars]}
        : range.side==='right' && coverage ? {from:coverage.from,through:range.through,bars:[...coverage.bars,...bars]}
        : {from:range.from,through:range.through,bars};
      setSnapshot({session:active,coverage:next});
    }).catch(()=>{
      if (signal.aborted) return;
      active.pending = false;
      setSnapshot({session:active,coverage,error:true});
      active.retry = setTimeout(()=>{
        if (!signal.aborted) setSnapshot({session:active,coverage});
      },30_000);
    });
  },[key,symbol,source,from,through,coverage,current?.error]);

  const bars = coverage?.bars ?? NO_BARS;
  const signals = useMemo(()=>cleanAcceleration1116Signals(bars),[bars]);
  const status = !key || through<=from ? 'missing' : current?.error ? 'error'
    : accelerationMissingRange(coverage,from,through) ? 'loading'
    : bars.some(bar=>bar.time>=from && bar.time<through) ? 'ready' : 'missing';
  return useMemo(()=>({signals,through,status,timezone}),[signals,through,status,timezone]);
}
