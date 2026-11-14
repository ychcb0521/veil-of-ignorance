import type { TradeCampaign } from '@/types/journal';
import { qualityMirrorBoard, mirrorPercentText } from '@/lib/fish/qualityMirrorBoard';
import { formatUTC8 } from '@/lib/timeFormat';
import { useLayoutEffect, useRef } from 'react';
import type {KlineData} from '@/hooks/useBinanceData';
import {QualityPriceExitAudit} from './QualityPriceExitAudit';
import {campaignLimitedDrawdownText} from '@/lib/fish/qualityCampaignRisk';
import {STATIC_DRAWDOWN_SELL_LABEL} from '@/lib/fish/qualityStaticDrawdownSell';
import {FREE_STATIC_DRAWDOWN_LABEL} from '@/lib/fish/qualityVeto';
import {instantManualReason} from '@/lib/fish/instantManualExecution';

const money = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)} USDT`;
const pct = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const price = (n: number | null) => n == null ? '—' : +n.toPrecision(9);
const color = (n: number | null) => n == null || n === 0 ? '' : n > 0 ? 'text-[#0B9B66]' : 'text-[#F6465D]';

/** Visible beside the candles and included in the same chart capture for PNG exports. */
export function QualityMirrorBoard({campaign,onHeightChange,onCompactHeightChange,klines,intervalMs}: {campaign: TradeCampaign;onHeightChange?: (height:number)=>void;onCompactHeightChange?:(height:number)=>void;klines?:readonly KlineData[];intervalMs?:number}) {
  const board = qualityMirrorBoard(campaign);
  const evidence=campaign.comparison?.sellEvidence,cause=evidence?.triggerCause;
  const limitedDrawdown = campaignLimitedDrawdownText(campaign, true);
  const manual = campaign.comparison?.instant?.manual;
  const manualFills = manual?.fills ?? [];
  const staticExit = cause?.kind === 'sell-static-drawdown' ? STATIC_DRAWDOWN_SELL_LABEL
    : cause?.kind === 'static-drawdown' ? FREE_STATIC_DRAWDOWN_LABEL : undefined;
  const showStaticStop = limitedDrawdown !== '—' || !!staticExit;
  const hasAudit=evidence?.executedAt!=null&&evidence.confirmedAt!=null&&!!cause&&(cause.kind==='box-stop'&&!!cause.boxStopEvidence||cause.kind==='drop-1m'||cause.kind==='drop-5m');
  const fill=board?.fill;
  const ref=useRef<HTMLElement>(null), visible=!!fill||hasAudit||showStaticStop||!!manual;
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
  return <section ref={ref} data-testid="quality-mirror-board" aria-label="持仓监测盘面信息" className="shrink-0 border-b border-amber-500/20 bg-amber-500/[0.04] text-[11px]">
    {manual && <div className="px-3 py-2 text-muted-foreground" data-testid="instant-manual-chart">
      <span>手动接管 · {formatUTC8(manual.startedAt)}</span>
      {manual.orders?.tp != null && <span className="ml-3">止盈 {price(manual.orders.tp)}</span>}
      {manual.orders?.sl != null && <span className="ml-3">止损 {price(manual.orders.sl)}</span>}
      {manualFills.length > 0 && <details className="mt-1">
        <summary className="cursor-pointer">手动成交 {manualFills.length} 笔</summary>
        {manualFills.map((fill, i) => <p key={i}>{formatUTC8(fill.at)} · {instantManualReason(fill.reason)} · {mirrorPercentText(fill.fraction)}% @ {price(fill.price)}</p>)}
      </details>}
    </div>}
    {showStaticStop && <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2" data-testid="quality-chart-static-stop">
      {limitedDrawdown !== '—' && <span>{STATIC_DRAWDOWN_SELL_LABEL} <b className="font-mono font-medium">{limitedDrawdown}</b></span>}
      {staticExit && <span className="text-muted-foreground">{staticExit}触发 · 阈值 {cause!.threshold}%{evidence?.triggerAtOpen && ' · 跳空按开盘价成交'}</span>}
    </div>}
    {board&&fill&&<details data-testid="quality-mirror-details">
      <summary className="flex min-h-9 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-muted-foreground hover:bg-amber-500/5">
        <strong className="font-medium text-[#B98500]">{board.title}</strong><span>{board.status}</span>
        <span>已卖 {mirrorPercentText(board.soldFraction)}%</span><span>涨幅 <b data-testid="mirror-actual-gain" className={`font-mono font-medium ${color(board.gainPct)}`}>{pct(board.gainPct)}</b></span><span>减仓已实现 <b className={`font-mono ${color(board.mirrorPnl)}`}>{money(board.mirrorPnl)}</b></span><span>总回报 <b data-testid="mirror-total-roi" className={`font-mono ${color(board.returnPct)}`}>{pct(board.returnPct)}</b></span>
        <span className="ml-auto shrink-0 text-[10px]">成交明细 ▾</span>
      </summary>
      <div className="space-y-1 border-t border-amber-500/15 px-3 py-2 text-[10px] text-muted-foreground">
        <p className="font-mono">成交分钟 {formatUTC8(fill.at)} · {fill.atOpen?'开盘成交':'分钟内触及止盈价'} · 开仓价 {price(board.entryPrice)} → 成交价 {price(fill.price)} · {board.quantity!=null?`${+board.quantity.toPrecision(8)} 币`:''}</p><p>{board.remainingText}</p><p>减仓已实现 {money(board.mirrorPnl)} ＋ 余仓{board.closed?'已实现':'估值'} {money(board.remainingPnl)} ＝ 合计 {money(board.totalPnl)} · 回报率分母：{board.marginBased?'初始保证金':board.addition?'累计投入':'开仓总金额'} {board.totalInvested?.toFixed(2)??'—'} USDT</p>
      </div>
    </details>}
    <QualityPriceExitAudit campaign={campaign} klines={klines} intervalMs={intervalMs}/>
  </section>;
}
