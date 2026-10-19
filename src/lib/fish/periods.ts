import type { ResearchInterval } from '@/lib/deepRsa/marketData';
import type { FishExchange } from './exchanges';
/** Missing native intervals are composed from contiguous smaller closed candles, never interpolated. */
export function nativeFishInterval(exchange:FishExchange,interval:ResearchInterval):ResearchInterval {
  if(exchange==='gate')return ({'3m':'1m','2h':'1h','6h':'1h','12h':'4h'} as Partial<Record<ResearchInterval,ResearchInterval>>)[interval]??interval;
  if(exchange==='bitget'&&interval==='2h')return '1h';
  return interval;
}
export function fishBarLabel(exchange:FishExchange,interval:ResearchInterval):string {
  if(exchange==='okx'||exchange==='bitget')return interval==='1d'?'1Dutc':interval==='6h'?'6Hutc':interval==='12h'?'12Hutc':interval.replace('h','H');
  return interval;
}
