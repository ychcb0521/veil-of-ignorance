import type { TradeCampaign } from '@/types/journal';
import { qualityMirrorBoard, mirrorPercentText } from '@/lib/fish/qualityMirrorBoard';
import { formatUTC8 } from '@/lib/timeFormat';
import { useLayoutEffect, useRef } from 'react';

const money = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)} USDT`;
const pct = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const price = (n: number | null) => n == null ? '—' : +n.toPrecision(9);
const color = (n: number | null) => n == null || n === 0 ? '' : n > 0 ? 'text-[#0B9B66]' : 'text-[#F6465D]';

/** Visible beside the candles and included in the same chart capture for PNG exports. */
export function QualityMirrorBoard({campaign,onHeightChange}: {campaign: TradeCampaign;onHeightChange?: (height:number)=>void}) {
  const board = qualityMirrorBoard(campaign);
  const ref=useRef<HTMLElement>(null), visible=!!board;
  useLayoutEffect(()=>{
    const element=ref.current;
    if(!onHeightChange)return;
    const measure=()=>onHeightChange(element?.getBoundingClientRect().height??0);
    measure();
    const observer=element && typeof ResizeObserver!=='undefined'?new ResizeObserver(measure):null;
    if(element)observer?.observe(element);
    return ()=>observer?.disconnect();
  },[visible,onHeightChange]);
  if (!board) return null;
  const {fill} = board;
  return <section ref={ref} data-testid="quality-mirror-board" aria-label="镜像止盈成交与收益" className="shrink-0 border-b border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[11px]">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <strong className="text-[#B98500]">◆ {board.title}</strong>
      <span className="rounded border border-amber-500/25 px-1.5 py-0.5 text-[10px] text-[#B98500]">{board.status}</span>
      <span className="font-mono text-muted-foreground">{fill ? `成交分钟 ${formatUTC8(fill.at)} · ${fill.atOpen ? '开盘成交' : '分钟内触及止盈价'}` : board.rule ? `上涨 ${board.rule.gainPct}% · 卖出初始币数 ${board.rule.sellPct}%` : ''}</span>
      <span className="text-foreground/80">{board.remainingText}</span>
    </div>
    {fill ? <>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <div><div className="text-[10px] text-muted-foreground">止盈时实际涨幅</div><div data-testid="mirror-actual-gain" className={`font-mono text-[14px] font-semibold ${color(board.gainPct)}`}>{pct(board.gainPct)}</div></div>
        <div><div className="text-[10px] text-muted-foreground">开仓价 → 止盈成交价</div><div className="font-mono">{price(board.entryPrice)} → {price(fill.price)}</div></div>
        <div><div className="text-[10px] text-muted-foreground">已卖出初始币数</div><div className="font-mono">{mirrorPercentText(board.soldFraction)}%{board.quantity != null ? ` · ${+board.quantity.toPrecision(8)} 币` : ''}</div></div>
        <div><div className="text-[10px] text-muted-foreground">{board.closed ? '最终投资回报率' : '本次估值回报率'}</div><div data-testid="mirror-total-roi" className={`font-mono text-[14px] font-semibold ${color(board.returnPct)}`}>{pct(board.returnPct)}</div></div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-muted-foreground">
        <span>止盈已兑现 <b className={`font-mono ${color(board.mirrorPnl)}`}>{money(board.mirrorPnl)}</b></span><span>＋</span>
        <span>余仓{board.closed ? '已实现' : '估值'} <b className={`font-mono ${color(board.remainingPnl)}`}>{money(board.remainingPnl)}</b></span><span>＝</span>
        <span>合计 <b className={`font-mono ${color(board.totalPnl)}`}>{money(board.totalPnl)}</b></span>
        <span>· 回报率分母：开仓总金额 {board.initialNotional?.toFixed(2) ?? '—'} USDT</span>
      </div>
    </> : <p className="mt-1 text-[10px] text-muted-foreground">未触发不记作零涨幅；只以保存的实际成交确认止盈，不根据峰值或盘面 K 线推测成交。</p>}
  </section>;
}
