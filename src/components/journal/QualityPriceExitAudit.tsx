import type {KlineData} from '@/hooks/useBinanceData';
import type {TradeCampaign} from '@/types/journal';
import {formatUTC8} from '@/lib/timeFormat';

/** Display frozen execution evidence beside the candles; never recalculate a sale. */
export function QualityPriceExitAudit({campaign,klines=[],intervalMs=300000}:{campaign:TradeCampaign;klines?:readonly KlineData[];intervalMs?:number}){
 const e=campaign.comparison?.sellEvidence,c=e?.triggerCause;
 if(!e||!c||e.executedAt==null||e.confirmedAt==null)return null;
 const box=c.kind==='box-stop'&&c.boxStopEvidence,drop=c.kind==='drop-1m'||c.kind==='drop-5m';
 if(!box&&!drop)return null;
 const touch=box&&box.confirmation==='touch',observed=e.confirmedAt-(touch?0:1);
 const candle=intervalMs>0?klines.find(b=>b.time<=observed&&observed<b.time+intervalMs):undefined;
 const price=(n:number)=>Number(n.toPrecision(12)).toString();
 return <details data-testid="quality-price-exit-audit" className="border-t border-border/50 px-3 py-2 text-[11px] text-muted-foreground">
  <summary className="flex cursor-pointer list-none flex-wrap gap-x-3 gap-y-1">
   <b className="font-medium text-foreground">{box?'箱体止损价核对':'滚动跌幅核对'}</b>
   {box?<span className="font-mono">执行 K {price(box.line)}</span>:<span className="font-mono">{c.kind==='drop-5m'?'滚动 5 分钟':'滚动 1 分钟'}跌幅 {e.reading?.toFixed(8)??'—'}% {c.direction} {c.threshold}%</span>}
   <span>{formatUTC8(e.confirmedAt)} {touch?'触价分钟':'收盘确认'}</span>
   {candle&&<span className="font-mono">本图 {intervalMs/60000}m K 线{box?`最低价 ${price(candle.low)}`:`实体跌幅 ${((candle.open-candle.close)/candle.open*100).toFixed(2)}%`}</span>}
   <span className="ml-auto">核对说明 ▾</span>
  </summary>
  <div className="mt-1 space-y-1">
   {box?<><p>执行 K 使用本次冻结的箱体规则，包含额外冗余和 K 更新设置；图中结构线与执行 K 不一定同价。{c.label.includes('DBL-5')&&'蓝线表示盘面防守线，抬高的竖段是连线，不是价格 K 线，可能与下影线重叠。'}</p><p>{touch?(e.triggerAtOpen?'当分钟开盘已越过 K，按开盘价成交。':'分钟内触及 K，按止损价模拟成交；分钟内具体秒数不可确定。'):'按方案设置的收盘条件确认，再按下一分钟开盘价模拟成交。'}</p></>:<><p>滚动窗口 {e.barOpenAt==null?'未保存起点':formatUTC8(e.barOpenAt)} → {formatUTC8(e.confirmedAt)}：起点分钟开盘价与末尾分钟收盘价比较，每分钟检查一次，不要求与图上 5 分钟 K 线边界对齐。</p><p>图上整根 K 线可能包含触发之后的反弹；实体跌幅不能代替滚动窗口跌幅。成交按 {formatUTC8(e.executedAt)} 的分钟开盘价。</p></>}
   {candle&&<p className="font-mono">显示 K 线起点 {formatUTC8(candle.time)} · 开 {price(candle.open)} · 高 {price(candle.high)} · 低 {price(candle.low)} · 收 {price(candle.close)}。整根显示 K 线仅供核对，不用于重算历史成交。</p>}
  </div>
 </details>;
}
