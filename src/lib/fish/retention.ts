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
export function fishRetentionReason(exchange:FishExchange,cutoffMs:number,serverMs:number):string|undefined {
  const from=cutoffMs-FISH_BARS*FISH_STEP;
  if(exchange==='okx'&&from<monthsBefore(serverMs,FISH_RETENTION.okx.months))return '历史成交只保留约 90 天（3 个月），这个时间点算不了主动买卖额';
  if(exchange==='bitget'&&from<serverMs-FISH_RETENTION.bitget.days*DAY)return '历史成交只保留约 90 天，这个时间点算不了主动买卖额';
  if(exchange==='gate'&&from<Math.floor(serverMs/FISH_STEP)*FISH_STEP-FISH_RETENTION.gate.candleBars*FISH_STEP)return '历史K线只保留最近 10000 根5m（约 34.7 天），这个时间点无法完整计算主动买卖额';
  return undefined;
}
