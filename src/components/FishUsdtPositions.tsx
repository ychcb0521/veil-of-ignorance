import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Wallet } from 'lucide-react';
import type { useUsdtFollow } from '@/hooks/useUsdtFollow';
import type { useUsdtLiveTrading } from '@/hooks/useUsdtLiveTrading';
import type { useBinanceManualMonitor } from '@/hooks/useBinanceManualMonitor';
import { formatUTC8 } from '@/lib/timeFormat';
import { usdtMirrorKey, usdtMirrorRevision, usdtPositionDecimal, usdtPositionQuantityUnit, usdtPositionValue, usdtSettlementAsset, type UsdtMirrorHistory, type UsdtMirrorPosition } from '@/lib/fish/usdtPositionMirror';
import { fishSubHeading } from './FishSection';

const time = (at:number) => formatUTC8(at)+'.'+String(at%1000).padStart(3,'0');
const actionNames = {open:'开仓',add:'加仓',reduce:'减仓'} as const;
type Follow = ReturnType<typeof useUsdtFollow>;
type Live = ReturnType<typeof useUsdtLiveTrading> & { management?: ReturnType<typeof useBinanceManualMonitor> };

export function UsdtPositionRows({live, positions = live.snapshot?.positions ?? []}:{
  live: Live;
  positions?: readonly UsdtMirrorPosition[];
}) {
  const { snapshot, issue, histories } = live;
  return <div className="space-y-2 rounded-md border border-border/60 bg-card/60 px-2.5 pb-2.5 pt-1.5 text-[10px]">
    <div className="flex flex-wrap items-center justify-between gap-1.5 text-muted-foreground">
      <span>{snapshot ? '同步于 ' + formatUTC8(snapshot.observedAt) + '（北京）' : '北京时间'}</span>
      <button type="button" onClick={live.retryPositions}
        className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted focus-visible:outline focus-visible:outline-1"><RefreshCw aria-hidden className="h-3 w-3"/>重新同步</button>
    </div>
    {issue&&<p role="alert" className="text-destructive">{issue}{snapshot?'。以下为上次成功同步的持仓。':''}</p>}
    {live.management?.issue && <p role="status" className="text-muted-foreground">{live.management.issue}</p>}
    {!snapshot&&!issue&&<p role="status">正在读取币安持仓…</p>}
    {snapshot&&!positions.length&&!issue&&<p role="status" className="py-1 text-muted-foreground">当前无实盘持仓</p>}
    {positions.map(position=>{
      const evidence=histories.get(usdtMirrorRevision(position));
      const managed=live.management?.positions.find(({ position: row }) => row.anchor.symbol === position.symbol &&
        row.anchor.positionSide === position.positionSide && row.anchor.openedAt === evidence?.openedAt);
      const asset = usdtSettlementAsset(position.symbol), unit = usdtPositionQuantityUnit(position.symbol);
      const pnl = Number(position.unrealizedPnl);
      return <PositionDetails key={usdtMirrorKey(position)} evidence={evidence} asset={asset} unit={unit}>
        <summary className="cursor-pointer list-none rounded-md px-2 py-1.5 hover:bg-muted/50 focus-visible:outline focus-visible:outline-1 [&::-webkit-details-marker]:hidden">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <ChevronRight aria-hidden className="h-3 w-3 text-muted-foreground group-open:rotate-90"/>
              <span className="font-mono text-[11px] font-semibold">{position.symbol}</span>
              <span className={position.direction==='long'?'text-[var(--chart-profit)]':'text-[var(--chart-loss)]'}>{position.direction==='long'?'多':'空'}</span>
            </span>
            <span title="币安持仓数量 × 当前标记价" className="font-mono text-[11px] font-semibold">名义仓位 {usdtPositionValue(position.quantity,position.markPrice)} {asset}</span>
            <span className="font-mono">数量 {usdtPositionDecimal(position.quantity)} {unit}</span>
            <span className="font-mono text-muted-foreground">未实现 <span className={pnl > 0 ? 'text-[var(--chart-profit)]' : pnl < 0 ? 'text-[var(--chart-loss)]' : ''}>{pnl > 0 ? '+' : ''}{pnl===0?'0':usdtPositionDecimal(position.unrealizedPnl)} {asset}</span></span>
            {managed && <span className={managed.status.state === 'blocked' ? 'text-destructive' : 'font-medium text-primary'}>
              {managed.status.state === 'blocked' ? '托管待核对' : managed.position.pending ? '等待成交回报' : '策略托管中'}
            </span>}
          </span>
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-[18px] font-mono text-muted-foreground">
            <span>均价 {position.entryPrice}</span><span>标记价 {position.markPrice}</span>
            <span>剩余成本 {usdtPositionValue(position.quantity,position.entryPrice)} {asset}</span>
            <span title={evidence?.issue}>开仓 {evidence?.openedAt?time(evidence.openedAt):evidence?'未核验':'核对中…'}</span>
            {managed && <span>持仓模板 {managed.position.monitor.name}{managed.status.issue ? ' · ' + managed.status.issue : ''}</span>}
          </span>
        </summary>
      </PositionDetails>;
    })}
  </div>;
}

function PositionDetails({children,evidence,asset,unit}:{children:ReactNode;evidence?:UsdtMirrorHistory;asset:string;unit:string}) {
  const [open,setOpen]=useState(false);
  return <details className="group rounded-md border border-border/60" onToggle={event=>setOpen(event.currentTarget.open)}>
    {children}
    {open&&<PositionFills evidence={evidence} asset={asset} unit={unit}/>}
  </details>;
}

function PositionFills({evidence,asset,unit}:{evidence?:UsdtMirrorHistory;asset:string;unit:string}) {
  const [count,setCount]=useState(100);
  if(!evidence||!evidence.fills.length)return <p className="px-3 py-2 text-muted-foreground">{evidence?.issue??'正在核对实际成交…'}</p>;
  const openOrder = evidence.fills[0]?.orderId;
  return <div className="max-h-64 overflow-auto overscroll-contain">
    <table className="w-full whitespace-nowrap text-left text-[10px]">
      <thead className="sticky top-0 bg-muted"><tr>{['实际成交时间','动作','方向','成交价','仓位数量（'+unit+'）','成交金额（'+asset+'）'].map(label=><th scope="col" className="px-3 py-1" key={label}>{label}</th>)}</tr></thead>
      <tbody>{evidence.fills.slice(0,count).map(fill=><tr key={fill.id} className="border-t font-mono">
        <td className="px-3 py-1">{time(fill.at)}</td><td className="px-3 py-1">{actionNames[fill.action==='add'&&fill.orderId===openOrder?'open':fill.action]}</td>
        <td className="px-3 py-1">{fill.side==='BUY'?'买':'卖'}</td><td className="px-3 py-1">{fill.price}</td>
        <td className="px-3 py-1">{usdtPositionDecimal(fill.positionQuantity)}</td>
        <td className="px-3 py-1">{usdtPositionValue(fill.positionQuantity,fill.price)}</td>
      </tr>)}</tbody>
    </table>
    {count<evidence.fills.length&&<button type="button" className="w-full p-2 text-center text-primary hover:bg-muted"
      onClick={()=>setCount(value=>value+100)}>显示后续成交（已显示 {count}/{evidence.fills.length}）</button>}
  </div>;
}
export function FishUsdtPositions({follow,live}:{follow:Follow;live?:Live}) {
  const count=follow.connected?live?.snapshot?.positions.length??0:0;
  const hasPosition=count>0;
  const [open,setOpen]=useState(hasPosition);
  useEffect(()=>{if(hasPosition)setOpen(true);},[hasPosition]);
  const id = useId();
  return <section aria-label="币安实盘持仓">
    <h5><button type="button" aria-controls={id} aria-expanded={open} onClick={()=>setOpen(value=>!value)} className={fishSubHeading}>
      <Wallet aria-hidden className="h-3.5 w-3.5 text-muted-foreground"/>币安实盘持仓{hasPosition&&<span className="rounded bg-muted px-1.5 font-mono text-[10px]" aria-label={count+' 笔实盘持仓'}>{count}</span>}<ChevronDown aria-hidden className={'h-3 w-3 text-muted-foreground/70 '+(open?'rotate-180':'')}/>
    </button></h5>
    <div id={id} hidden={!open}>
      {open && (follow.connected && follow.positionMirror === 1 && live ?
        <>
          <UsdtPositionRows live={live}/>
          {!follow.campaignMirror && <p className="px-2 pb-1 text-[10px] text-muted-foreground">更新本机执行端后可同步实盘战役。</p>}
        </> :
        <p role="status" className="px-2 pb-2 text-[10px] text-muted-foreground">{follow.connected?'请更新 Windows 本机执行端，再同步持仓。':follow.issue||'请先连接本机 U 本位执行端。'}</p>)}
    </div>
  </section>;
}
