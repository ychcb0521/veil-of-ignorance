import type {ReactNode} from 'react';
import {Pencil,Plus} from 'lucide-react';
import {formatSignedUSDT} from '@/lib/formatters';
import {formatBeijingTime} from '@/lib/timeFormat';

const columns = [
  ['symbol','合约',155], ['quantity','数量',118], ['entry','开仓价格',104], ['breakeven','损益两平价',110],
  ['mark','标记价格',103], ['liquidation','强平价格',103], ['ratio','保证金比率',104], ['margin','保证金',138],
  ['pnl','盈亏（回报率）',148], ['funding','预估资金费用',124], ['close','市价 / 限价',308],
  ['reverse','反手交易',112], ['protection','仓位止盈止损',176], ['addProtection','止盈/止损',152], ['details','交易明细',224],
] as const;
const tableWidth = columns.reduce((sum,column)=>sum+column[2],0);
type Cell = typeof columns[number][0];
export type PositionTableCells = Partial<Record<Cell,ReactNode>>;

export function PositionTable({children,empty,onCloseAll}:{
  children:ReactNode; empty?:ReactNode; onCloseAll?:()=>void;
}) {
  return <div className="min-h-0 flex-1 overflow-auto scrollbar-pro" tabIndex={0} role="region" aria-label="仓位表格">
    <table className="w-full table-fixed border-separate border-spacing-0 text-left text-xs" style={{minWidth:tableWidth}} aria-label="仓位">
      <colgroup>{columns.map(([key,,width])=><col key={key} style={{width}}/>)}</colgroup>
      <thead className="sticky top-0 z-10 bg-background text-[11px] leading-4 text-muted-foreground">
        <tr>{columns.map(([key,label])=><th key={key} scope="col" className="whitespace-nowrap border-b border-border/60 px-3 py-2 font-medium">
          {key==='close' ? <div className="flex items-center gap-2">
            {onCloseAll?<button type="button" title="市价平掉列表中的模拟仓位" aria-label="一键平仓"
              className="text-[#B38518] hover:text-foreground" onClick={onCloseAll}>市价全部平仓</button>:<span>市价全部平仓</span>}
            <span className="border-l border-border pl-2">基于盈亏的全平仓</span>
          </div> : label}
        </th>)}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
    {empty}
  </div>;
}

export function PositionTableRow({long,cells,testId,label}:{
  long:boolean; cells:PositionTableCells; testId?:string; label?:string;
}) {
  return <tr data-testid={testId} aria-label={label} className="group bg-muted/25 text-foreground hover:bg-muted/50">
    {columns.map(([key,header])=><td key={key} data-column={key} aria-label={header}
      className={`relative h-[62px] border-b border-background px-3 py-1.5 align-middle ${key==='symbol'?'pl-4':'whitespace-nowrap'}`}>
      {key==='symbol'&&<span aria-hidden="true" className={`absolute inset-y-2 left-1 w-1 rounded-full ${long?'bg-trading-green':'bg-trading-red'}`}/>}
      {cells[key]??(key==='reverse'?<button type="button" disabled className="rounded bg-muted px-2 py-1.5 text-muted-foreground">反手交易</button>:'—')}
    </td>)}
  </tr>;
}

export function PositionContract({symbol,leverage,long,badge,onOpen,onLeverage}:{
  symbol:string;leverage?:number;long:boolean;badge?:ReactNode;onOpen?:()=>void;onLeverage?:()=>void;
}) {
  const leverageLabel = leverage == null ? null : leverage+'x';
  return <div className="space-y-0.5 whitespace-nowrap">
    {onOpen?<button type="button" title="查看对应盘面" className="font-semibold hover:text-primary hover:underline focus-visible:underline" onClick={onOpen}>{symbol}</button>
      :<span className="font-semibold">{symbol}</span>}
    <div className="flex items-center gap-1 text-[10px]">
      <span className="rounded bg-muted px-1">永续</span>
      {leverageLabel&&(onLeverage?<button type="button" aria-label="杠杆" title="调整杠杆" className="rounded bg-muted px-1 hover:bg-primary/10" onClick={onLeverage}>{leverageLabel}</button>
        :<span className="rounded bg-muted px-1">{leverageLabel}</span>)}
      <span className={long?'text-trading-green':'text-trading-red'}>{long?'多':'空'}</span>
      {badge}
    </div>
  </div>;
}

export function PositionPnl({pnl,roe,asset='USDT',pnlText}:{
  pnl:number|null;roe:number|null;asset?:string;pnlText?:string;
}) {
  const tone = pnl==null?'text-muted-foreground':pnl>=0?'text-trading-green':'text-trading-red';
  return <div className={`space-y-0.5 font-mono tabular-nums ${tone}`}>
    <div>{pnl==null?'—':(pnlText??formatSignedUSDT(pnl))+' '+asset}</div>
    <div>{roe==null?'—':(roe>=0?'+':'')+roe.toFixed(2)+'%'}</div>
  </div>;
}

export function PositionNumber({value,title,tone}:{
  value:string;title?:string;tone?:string;
}) {
  return <span title={title} className={`font-mono tabular-nums ${tone??''}`}>{value}</span>;
}

export function PositionOpenedAt({openedAt,text,title}:{openedAt?:number;text?:string;title?:string}) {
  return <span data-testid="position-open-time" className="block text-[10px] tabular-nums text-muted-foreground" title={title}>
    开仓时间 {text??formatBeijingTime(openedAt)}
  </span>;
}

export function PositionEditButton({label,onClick,disabled,title,testId}:{
  label:string;onClick:()=>void;disabled?:boolean;title?:string;testId?:string;
}) {
  return <button type="button" data-testid={testId} aria-label={label} title={title??label} disabled={disabled}
    className="inline-grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" onClick={onClick}>
    <Pencil aria-hidden="true" className="h-3.5 w-3.5"/>
  </button>;
}

export function PositionMarketClose({onClick,disabled,mark,quantity}:{
  onClick?:()=>void;disabled?:boolean;mark?:string;quantity?:string;
}) {
  return <div className="flex items-center gap-3">
    <button type="button" aria-label="平仓" disabled={disabled||!onClick} onClick={onClick}
      className="text-[#B38518] hover:text-foreground disabled:opacity-40">市价</button>
    <button type="button" disabled className="border-l border-border pl-3 text-muted-foreground">限价</button>
    <span className="min-w-[5rem] rounded border border-border px-2 py-1 font-mono text-muted-foreground">{mark??'价格'}</span>
    <span className="min-w-[4rem] rounded border border-border px-2 py-1 font-mono text-muted-foreground">{quantity??'数量'}</span>
  </div>;
}

export function PositionProtectionButton({onClick,disabled}:{
  onClick?:()=>void;disabled?:boolean;
}) {
  return <button type="button" aria-label="止盈/止损" disabled={disabled||!onClick} onClick={onClick}
    className="flex w-full items-center justify-center gap-1 rounded bg-muted px-3 py-1.5 font-medium hover:bg-accent disabled:opacity-40">
    <Plus aria-hidden="true" className="h-4 w-4"/>添加
  </button>;
}

export function PositionProtectionPrices({tp,sl,children}:{tp?:string;sl?:string;children?:ReactNode}) {
  return <div className="flex items-center gap-1 font-mono tabular-nums">
    <span className="text-trading-green" title="止盈">{tp??'—'}</span>
    <span className="text-muted-foreground">/</span>
    <span className="text-trading-red" title="止损">{sl??'—'}</span>
    {children}
  </div>;
}
