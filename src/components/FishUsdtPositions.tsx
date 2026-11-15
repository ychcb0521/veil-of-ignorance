import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Wallet } from 'lucide-react';
import type { useUsdtFollow } from '@/hooks/useUsdtFollow';
import { formatUTC8 } from '@/lib/timeFormat';
import { usdtMirrorKey, usdtMirrorRevision, type UsdtMirrorHistory, type UsdtMirrorSnapshot } from '@/lib/fish/usdtPositionMirror';

const time = (at:number) => formatUTC8(at)+'.'+String(at%1000).padStart(3,'0');
const actionNames = {open:'开仓',add:'加仓',reduce:'减仓'} as const;
type Follow = ReturnType<typeof useUsdtFollow>;
type Read = Pick<Follow,'readPositions'|'readPositionHistory'>;

function Positions({readPositions,readPositionHistory}:Read) {
  const [snapshot,setSnapshot]=useState<UsdtMirrorSnapshot>();
  const [histories,setHistories]=useState<ReadonlyMap<string,UsdtMirrorHistory>>(new Map());
  const [issue,setIssue]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const lifetime=new AbortController();
    const history=new Map<string,UsdtMirrorHistory>(), inFlight=new Set<string>();
    setHistories(new Map());
    let running=false;
    let revisions=new Set<string>();
    let health=true;
    const loadHistory=async (rows:UsdtMirrorSnapshot['positions'])=>{
      for(const position of rows){
        if(lifetime.signal.aborted||document.hidden||!health||inFlight.size>=2)return;
        const revision=usdtMirrorRevision(position);
        if(!revisions.has(revision)||history.has(revision)||inFlight.has(revision))continue;
        inFlight.add(revision);
        try{
          let result:UsdtMirrorHistory;
          try { result=await readPositionHistory(position,lifetime.signal); }
          catch(error) { result={fills:[],issue:error instanceof Error?error.message:'币安成交读取失败'}; }
          if(!lifetime.signal.aborted&&revisions.has(revision)){
            history.set(revision,result);setHistories(new Map(history));
          }
        }finally{inFlight.delete(revision);}
      }
    };
    const tick=async()=>{
      if(running||lifetime.signal.aborted||document.hidden)return;
      running=true;
      try{
        const current=await readPositions(lifetime.signal);
        if(lifetime.signal.aborted)return;
        setSnapshot(current);setIssue('');health=true;
        revisions=new Set(current.positions.map(usdtMirrorRevision));
        for(const key of history.keys())if(!revisions.has(key))history.delete(key);
        setHistories(new Map(history));
        void loadHistory(current.positions);
      }catch(error){
        health=false;
        if(!lifetime.signal.aborted)setIssue(error instanceof Error?error.message:'币安持仓读取失败');
      }finally{running=false;}
    };
    const schedule=()=>void tick();
    const timer=setInterval(schedule,8000);
    document.addEventListener('visibilitychange',schedule);
    schedule();
    return ()=>{lifetime.abort();clearInterval(timer);document.removeEventListener('visibilitychange',schedule);};
  },[readPositions,readPositionHistory,attempt]);
  return <div className="space-y-2 px-2 pb-2 text-[11px]">
    <div className="flex flex-wrap items-center justify-between gap-1 text-muted-foreground">
      <span>只读 · 北京时间 · {snapshot?'上次同步 '+formatUTC8(snapshot.observedAt):'从币安读取当前持仓及逐笔成交'}</span>
      <button type="button" onClick={()=>setAttempt(value=>value+1)} className="rounded px-2 py-1 hover:bg-muted">重新同步</button>
    </div>
    {issue&&<p role="alert" className="text-destructive">{issue}{snapshot?'。以下为上次成功同步的持仓。':''}</p>}
    {!snapshot&&!issue&&<p role="status">正在读取币安持仓…</p>}
    {snapshot&&!snapshot.positions.length&&<p role="status">币安 U 本位当前无持仓</p>}
    {snapshot?.positions.map(position=>{
      const evidence=histories.get(usdtMirrorRevision(position));
      return <PositionDetails key={usdtMirrorKey(position)} evidence={evidence}>
        <summary className="cursor-pointer rounded-md px-2 py-1.5 hover:bg-muted/50">
          <span className="ml-1 inline-flex flex-wrap items-baseline gap-x-3 gap-y-1 align-middle">
            <span className="font-mono font-medium">{position.symbol} · {position.direction==='long'?'多':'空'}</span>
            <span>持仓 {position.quantity}</span><span>均价 {position.entryPrice}</span>
            <span>标记价 {position.markPrice}</span><span>未实现盈亏 {position.unrealizedPnl}</span>
            <span className="font-mono text-muted-foreground">开仓 {evidence?.openedAt?time(evidence.openedAt):evidence?'未核验':'核对中…'}</span>
          </span>
        </summary>
      </PositionDetails>;
    })}
  </div>;
}

function PositionDetails({children,evidence}:{children:ReactNode;evidence?:UsdtMirrorHistory}) {
  const [open,setOpen]=useState(false);
  return <details className="rounded-md border border-border/60" onToggle={event=>setOpen(event.currentTarget.open)}>
    {children}
    {open&&<PositionFills evidence={evidence}/>}
  </details>;
}

function PositionFills({evidence}:{evidence?:UsdtMirrorHistory}) {
  const [count,setCount]=useState(100);
  if(!evidence||!evidence.fills.length)return <p className="px-3 py-2 text-muted-foreground">{evidence?.issue??'正在核对实际成交…'}</p>;
  return <div className="max-h-64 overflow-auto overscroll-contain">
    <table className="w-full whitespace-nowrap text-left text-[11px]">
      <thead className="sticky top-0 bg-muted"><tr>{['实际成交时间','动作','方向','成交价','成交数量','本仓位数量'].map(label=><th scope="col" className="px-3 py-1" key={label}>{label}</th>)}</tr></thead>
      <tbody>{evidence.fills.slice(0,count).map(fill=><tr key={fill.id} className="border-t font-mono">
        <td className="px-3 py-1">{time(fill.at)}</td><td className="px-3 py-1">{actionNames[fill.action]}</td>
        <td className="px-3 py-1">{fill.side==='BUY'?'买':'卖'}</td><td className="px-3 py-1">{fill.price}</td>
        <td className="px-3 py-1">{fill.quantity}</td><td className="px-3 py-1">{fill.positionQuantity}</td>
      </tr>)}</tbody>
    </table>
    {count<evidence.fills.length&&<button type="button" className="w-full p-2 text-center text-primary hover:bg-muted"
      onClick={()=>setCount(value=>value+100)}>显示后续成交（已显示 {count}/{evidence.fills.length}）</button>}
  </div>;
}
export function FishUsdtPositions({follow}:{follow:Follow}) {
  const [open,setOpen]=useState(false);
  return <section className="rounded-md border border-border/60" aria-label="币安实盘持仓">
    <button type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50">
      <Wallet aria-hidden className="h-3.5 w-3.5"/>币安实盘持仓<ChevronDown aria-hidden className={'h-3.5 w-3.5 '+(open?'rotate-180':'')}/>
    </button>
    {open&&(follow.positionMirror===1 ?
      <Positions readPositions={follow.readPositions} readPositionHistory={follow.readPositionHistory}/> :
      <p role="status" className="px-2 pb-2 text-[11px] text-muted-foreground">{follow.connected?'请更新 Windows 本机执行端，再同步持仓。':follow.issue||'请先连接本机 U 本位执行端。'}</p>)}
  </section>;
}
