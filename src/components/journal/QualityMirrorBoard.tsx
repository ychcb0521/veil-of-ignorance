import type { TradeCampaign } from '@/types/journal';
import { qualityMirrorBoard, mirrorPercentText } from '@/lib/fish/qualityMirrorBoard';
import { formatUTC8 } from '@/lib/timeFormat';
import { useLayoutEffect, useRef } from 'react';
import type {KlineData} from '@/hooks/useBinanceData';
import {QualityPriceExitAudit} from './QualityPriceExitAudit';

const money = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)} USDT`;
const pct = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const price = (n: number | null) => n == null ? '—' : +n.toPrecision(9);
const color = (n: number | null) => n == null || n === 0 ? '' : n > 0 ? 'text-[#0B9B66]' : 'text-[#F6465D]';

/** Visible beside the candles and included in the same chart capture for PNG exports. */
export function QualityMirrorBoard({campaign,onHeightChange,onCompactHeightChange,klines,intervalMs}: {campaign: TradeCampaign;onHeightChange?: (height:number)=>void;onCompactHeightChange?:(height:number)=>void;klines?:readonly KlineData[];intervalMs?:number}) {
  const board = qualityMirrorBoard(campaign);
  const evidence=campaign.comparison?.sellEvidence,cause=evidence?.triggerCause;
  const hasAudit=evidence?.executedAt!=null&&evidence.confirmedAt!=null&&!!cause&&(cause.kind==='box-stop'&&!!cause.boxStopEvidence||cause.kind==='drop-1m'||cause.kind==='drop-5m');
  const ref=useRef<HTMLElement>(null), visible=!!board||hasAudit;
  useLayoutEffect(()=>{
    const element=ref.current;
    if(!onHeightChange&&!onCompactHeightChange)return;
    const measure=()=>{const height=element?.getBoundingClientRect().height??0;onHeightChange?.(height);const expansion=Array.from(element?.querySelectorAll('details')??[]).reduce((n,d)=>n+Math.max(0,d.getBoundingClientRect().height-(d.querySelector('summary')?.getBoundingClientRect().height??0)),0);onCompactHeightChange?.(Math.max(0,height-expansion));};
    measure();
    const observer=element && typeof ResizeObserver!=='undefined'?new ResizeObserver(measure):null;
    if(element)observer?.observe(element);
    return ()=>observer?.disconnect();
  },[visible,onHeightChange,onCompactHeightChange]);
  if (!visible) return null;
  const fill=board?.fill;
  return <section ref={ref} data-testid="quality-mirror-board" aria-label="镜像平衡减仓成交与收益" className="shrink-0 border-b border-amber-500/20 bg-amber-500/[0.04] text-[11px]">
    {board&&<details data-testid="quality-mirror-details">
      <summary className="flex min-h-9 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-muted-foreground hover:bg-amber-500/5">
        <strong className="font-medium text-[#B98500]">{board.title}</strong><span>{board.status}</span>
        {fill?<><span>已卖 {mirrorPercentText(board.soldFraction)}%</span><span>涨幅 <b data-testid="mirror-actual-gain" className={`font-mono font-medium ${color(board.gainPct)}`}>{pct(board.gainPct)}</b></span><span>减仓已实现 <b className={`font-mono ${color(board.mirrorPnl)}`}>{money(board.mirrorPnl)}</b></span><span>总回报 <b data-testid="mirror-total-roi" className={`font-mono ${color(board.returnPct)}`}>{pct(board.returnPct)}</b></span></>:<span>上涨 {board.rule?.gainPct}% · 卖出初始币数 {board.rule?.sellPct}%</span>}
        <span className="ml-auto shrink-0 text-[10px]">成交明细 ▾</span>
      </summary>
      <div className="space-y-1 border-t border-amber-500/15 px-3 py-2 text-[10px] text-muted-foreground">
        {fill?<><p className="font-mono">成交分钟 {formatUTC8(fill.at)} · {fill.atOpen?'开盘成交':'分钟内触及止盈价'} · 开仓价 {price(board.entryPrice)} → 成交价 {price(fill.price)} · {board.quantity!=null?`${+board.quantity.toPrecision(8)} 币`:''}</p><p>{board.remainingText}</p><p>减仓已实现 {money(board.mirrorPnl)} ＋ 余仓{board.closed?'已实现':'估值'} {money(board.remainingPnl)} ＝ 合计 {money(board.totalPnl)} · 回报率分母：{board.marginBased?'初始保证金':board.addition?'累计投入':'开仓总金额'} {board.totalInvested?.toFixed(2)??'—'} USDT</p></>:<p>只以保存的实际成交确认减仓；未触发不记作零涨幅。</p>}
      </div>
    </details>}
    <QualityPriceExitAudit campaign={campaign} klines={klines} intervalMs={intervalMs}/>
  </section>;
}
