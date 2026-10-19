import {nativeFishInterval} from './periods';
import {intervalMs,type ResearchInterval} from '@/lib/deepRsa/marketData';
import type { FishExchange } from './exchanges';
import { FISH_BARS,FISH_STEP } from './shared';
const DAY=86400000;
/** Official public history limits, checked 2026-10-19. Never confuse private fills with public market trades. */
export const FISH_RETENTION = {
  okx:{months:3,days:90,source:'https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-trades-history'},
  bitget:{days:90,source:'https://www.bitget.com/docs/catalog/classic-contract-market/classic-contract-market#get-history-transactions'},
  // Gate public trades: official API has no documented fixed day cutoff; May 26 trades still returned on Oct 19.
  // The limiting endpoint is instead candlesticks: live API explicitly rejects data older than 10000 bars.
  gate:{candleBars:10000,source:'https://www.gate.com/docs/developers/apiv4/en/futures/#futures-market-k-line-chart',verifiedAt:'2026-10-19'},
} as const;
/** Calendar subtraction, clamping the day: three months is not always exactly 90 days. */
export function monthsBefore(ms:number,months:number):number {
  const d=new Date(ms),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-months);
  const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return d.getTime();
}
export function fishRetentionReason(exchange:FishExchange,cutoffMs:number,serverMs:number,count=FISH_BARS,step=FISH_STEP,usesAmounts=true,interval:ResearchInterval='5m'):string|undefined {
  const from=cutoffMs-count*step;
  if(exchange==='okx'&&usesAmounts&&from<monthsBefore(serverMs,FISH_RETENTION.okx.months))return '历史成交只保留约 90 天（3 个月），这个时间点算不了主动买卖额';
  if(exchange==='bitget'&&usesAmounts&&from<serverMs-FISH_RETENTION.bitget.days*DAY)return '历史成交只保留约 90 天，这个时间点算不了主动买卖额';
  const nativeStep=intervalMs(nativeFishInterval(exchange,interval));
  if(exchange==='gate'&&from<Math.floor(serverMs/nativeStep)*nativeStep-FISH_RETENTION.gate.candleBars*nativeStep)return `历史K线只保留最近 10000 根原生周期（约 ${(10000*nativeStep/86400000).toFixed(1)} 天），这个时间点无法完整计算`;
  return undefined;
}
