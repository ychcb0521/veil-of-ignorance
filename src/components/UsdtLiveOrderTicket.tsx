import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usdtAmountText, usdtPositionDecimal, usdtPositionQuantityUnit, type UsdtMirrorPosition } from '@/lib/fish/usdtPositionMirror';
import { USDT_MARKET_EXIT_ORDER, type UsdtPositionControlRequest, type UsdtPositionTarget } from '@/lib/fish/usdtPositionControls';
import type { UsdtDeskOpenRequest, UsdtDeskOrderSpec, UsdtDeskOrderType, UsdtDeskQuote, UsdtDeskTimeInForce } from '@/lib/fish/usdtOrderDesk';
import type { useUsdtFollow } from '@/hooks/useUsdtFollow';

type Follow = ReturnType<typeof useUsdtFollow>;
type Direction = UsdtMirrorPosition['direction'];
type TicketRequest = { open: UsdtDeskOpenRequest } | { close: UsdtPositionControlRequest };
type Leg = { position: UsdtMirrorPosition; target?: UsdtPositionTarget };
const options = [['limit','限价'],['market','市价'],['conditional','条件委托']] as const;
const levels = [0,25,50,75,100];
const field = 'flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-xs focus-within:border-primary';
const entry = 'min-w-0 w-full bg-transparent tabular-nums outline-none';

function quantityAt(value: number, step: string) {
  const stepSize = Number(step);
  return stepSize > 0 && Number.isFinite(value) ? usdtPositionDecimal((Math.floor(value / stepSize + 1e-9) * stepSize)
    .toFixed(Math.min(18, step.split('.')[1]?.length ?? 0))) : '0';
}

export function UsdtLiveOrderTicket({ symbol, follow, legs, refresh, issue }: {
  symbol: string; follow: Follow; legs: Leg[]; refresh: () => void; issue?: string;
}) {
  const [mode,setMode] = useState<'open'|'close'>(legs.length ? 'close' : 'open');
  const [entryKind,setKind] = useState<UsdtDeskOrderType>(legs.length ? 'market' : 'limit');
  const kind = mode === 'close' ? 'market' : entryKind;
  const [quote,setQuote] = useState<UsdtDeskQuote>();
  const [quoteIssue,setQuoteIssue] = useState('');
  const [limit,setLimit] = useState('');
  const [trigger,setTrigger] = useState('');
  const [tif,setTif] = useState<UsdtDeskTimeInForce>('GTC');
  const [amount,setAmount] = useState('');
  const [percentage,setPercentage] = useState<number>();
  const [slippage,setSlippage] = useState('');
  const [bounded,setBounded] = useState(false);
  const [review,setReview] = useState<{ request:TicketRequest; label:string; quantity:string; order:UsdtDeskOrderSpec }>();
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  const submitting = useRef(false);
  const key = 'veil.usdt-desk.pending:' + follow.owner + ':' + symbol;
  const [pending,setPending] = useState<TicketRequest | undefined>(() => {
    try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined; } catch { return; }
  });
  const read = follow.readDeskQuote;
  useEffect(() => {
    const abort = new AbortController();
    let requesting = false;
    const update = async () => {
      if (requesting || document.hidden || abort.signal.aborted) return;
      requesting = true;
      try {
        const data = await read(symbol,abort.signal);
        if (abort.signal.aborted) return;
        setQuote(data);
        setQuoteIssue('');
      } catch (error) {
        if (!abort.signal.aborted) setQuoteIssue(error instanceof Error ? error.message : '币安报价暂不可用');
      } finally { requesting = false; }
    };
    void update();
    document.addEventListener('visibilitychange',update);
    const timer = window.setInterval(update,10_000);
    return () => { abort.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange',update); };
  },[read,symbol]);

  const unit = usdtPositionQuantityUnit(symbol);
  const directions = ['long','short'] as const;
  const step = (kind === 'limit' ? quote?.orderStep : quote?.marketStep) ?? '0.000001';
  const cap = (direction: Direction) => {
    if (mode === 'close') return Number(legs.find(row => row.position.direction === direction)?.position.quantity ?? 0);
    if (!quote || quoteIssue) return 0;
    const price = Number(kind === 'limit' ? limit || quote.mark : kind === 'conditional' ? trigger : direction === 'long' ? quote.ask : quote.bid);
    return price > 0 ? Math.min(Number(quote.maxQuantity), Math.min(Number(quote.available)*quote.leverage,Number(quote.maxNotional))/price) : 0;
  };
  const size = (direction:Direction) => percentage === undefined ? amount : quantityAt(cap(direction) * percentage / 100,step);
  const typed = Number(amount);
  const percent = percentage ?? (Math.min(100, Math.max(0, Math.round(typed / Math.max(...directions.map(cap), 1e-15) * 100))) || 0);
  const boundedEntry = mode === 'open' && bounded;
  const marketOrder: UsdtDeskOrderSpec = mode === 'close' ? USDT_MARKET_EXIT_ORDER : {type:'market',...(boundedEntry ? {slippage:Number(slippage)} : {})};
  const defaultPrice = quote ? quantityAt(Number(quote.mark),quote.priceTick) : '';
  const order: UsdtDeskOrderSpec = kind === 'limit' ? {type:kind,price:limit || defaultPrice,timeInForce:tif}
    : kind === 'conditional' ? {type:kind,triggerPrice:trigger} : marketOrder;
  const validTerms = kind === 'market' ? !boundedEntry || Number(slippage)>=.01 && Number(slippage)<=10
    : Number(order.type === 'limit' ? order.price : order.type === 'conditional' ? order.triggerPrice : 0)>0;
  const ready = (direction:Direction) => {
    const n = Number(size(direction));
    return !busy && !pending && validTerms && n>0 && (mode === 'close'
      ? !issue && !!legs.find(row => row.position.direction === direction)?.target && n<=cap(direction)
      : !!quote && !quoteIssue && n<=cap(direction));
  };
  function choose(next:'open'|'close') {
    setMode(next);setPercentage(undefined);setAmount('');setMessage('');
  }
  function preview(direction:Direction,label:string) {
    if (!ready(direction)) return;
    const quantity = size(direction);
    const id = crypto.randomUUID();
    if (mode === 'open') setReview({request:{open:{id,symbol,direction,quantity,order}},label,quantity,order});
    else {
      const leg = legs.find(row => row.position.direction === direction)!;
      if (!leg.target) return;
      const fraction = Number(quantity)/Number(leg.position.quantity);
      setReview({request:{close:{id,target:leg.target,action:{kind:'close',fraction,order}}},label,quantity,order});
    }
  }
  function remember(value?:TicketRequest) {
    setPending(value);
    try {
      if (value) sessionStorage.setItem(key,JSON.stringify(value));
      else sessionStorage.removeItem(key);
    } catch { /* The executor still records the original order identifier. */ }
  }
  const currentTarget = review && 'close' in review.request ? review.request.close.target : undefined;
  const targetChanged = !!currentTarget && !legs.some(row => row.target?.revision === currentTarget.revision &&
    row.target.campaignId === currentTarget.campaignId);
  async function submit(request:TicketRequest) {
    if (submitting.current) return;
    submitting.current=true;setBusy(true);setMessage('');remember(request);
    try {
      const signal = new AbortController().signal;
      const result = 'open' in request ? await follow.deskOpen(request.open,signal) : await follow.deskClose(request.close,signal);
      if (!result.pending) remember();
      setMessage(result.issue || (result.pending ? '等待币安回报，请按原编号核对' :
        result.filledQuantity ? '已成交 ' + result.filledQuantity + ' ' + unit : '币安已接收委托'));
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof DOMException)) remember();
      setMessage(error instanceof Error ? error.message : '币安委托回报暂不可用');
    } finally { setReview(undefined);setBusy(false);submitting.current=false;refresh(); }
  }
  const switchType = (next:UsdtDeskOrderType) => {
    setKind(next);
    if (next === 'limit' && !limit) setLimit(defaultPrice);
  };
  return <section aria-label="币安实盘下单" className="space-y-3 border-b border-border px-4 pb-4 pt-2 text-xs" data-testid="usdt-order-ticket">
    <div className="flex items-center justify-between gap-2">
      <div role="group" aria-label="开仓或平仓" className="grid flex-1 grid-cols-2 rounded-lg border border-border bg-background font-semibold">
        {(['open','close'] as const).map(value=><button key={value} type="button" aria-pressed={mode===value}
          className={'rounded-md px-2 py-1.5 ' + (mode===value?'bg-muted text-foreground':'text-muted-foreground')}
          onClick={()=>choose(value)}>{value==='open'?'开仓':'平仓'}</button>)}
      </div>
    </div>
    <div role="group" aria-label="委托类型" className="flex items-center gap-4 border-b border-border font-medium">
      {options.filter(([value])=>mode==='open'||value==='market').map(([value,label])=><button type="button" key={value} aria-pressed={kind===value} onClick={()=>switchType(value)}
        className={'inline-flex items-center gap-1 border-b-2 py-2 ' + (kind===value?'border-primary text-foreground':'border-transparent text-muted-foreground')}>
        {label}{value==='conditional'&&<ChevronDown className="size-3" aria-hidden/>}</button>)}
    </div>
    <div className="flex justify-between text-muted-foreground"><span>可用 <span className="font-medium text-foreground">{quote?usdtAmountText(Number(quote.available)):'—'} USDT</span></span><span>{symbol}</span></div>
    {kind!=='market'&&<label className="block space-y-1.5 text-muted-foreground">
      <span>{kind==='limit'?'委托价格':'触发价格'}</span>
      <span className="flex items-center gap-2">
        <span className={field+' flex-1 text-foreground'}><input inputMode="decimal" className={entry}
          value={kind==='limit'?limit || defaultPrice:trigger}
          onChange={event=>kind==='limit'?setLimit(event.target.value):setTrigger(event.target.value)} aria-label={kind==='limit'?'委托价格':'触发价格'}/>USDT</span>
        {kind==='limit'&&<button type="button" className={field+' text-foreground'} disabled={!quote}
          onClick={()=>quote&&setLimit(usdtPositionDecimal(mode==='close'&&legs.some(row=>row.position.direction==='long')?quote.bid:quote.ask))}>最优价</button>}
      </span>
    </label>}
    <label className="block space-y-1.5 text-muted-foreground"><span>数量</span>
      <span className={field+' text-foreground'}><input className={entry} inputMode="decimal" aria-label="数量"
        value={percentage===undefined?amount:percentage+'%'} placeholder="输入数量" onChange={event=>{
          const value=event.target.value;
          if (/^\d{0,3}%$/.test(value)) {setPercentage(Math.min(100,Number(value.slice(0,-1))));return;}
          if (/^\d*(?:\.\d*)?$/.test(value)) {setPercentage(undefined);setAmount(value);}
        }}/>{unit}</span>
    </label>
    <div className="px-2">
      <div className="relative flex h-5 items-center">
        <input type="range" min="0" max="100" step="1" value={percent} onChange={event=>setPercentage(Number(event.target.value))}
          aria-label="仓位比例" className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"/>
        <div className="relative h-px w-full bg-border">
          <div className="absolute h-px bg-foreground" style={{width:percent+'%'}}/>
          {levels.map(value=><button type="button" key={value} style={{left:value+'%'}} aria-label={value+'%'}
            onClick={()=>setPercentage(value)} className={'absolute top-1/2 z-20 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border '+
              (percent>=value?'border-foreground bg-foreground':'border-muted-foreground/50 bg-background')}/>)}
          <span className="pointer-events-none absolute top-1/2 z-30 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-foreground bg-background"
            style={{left:percent+'%'}}/>
        </div>
      </div>
    </div>
    {percentage!==undefined&&<div className="flex justify-between text-muted-foreground">
      <span>买入 {size(mode==='open'?'long':'short')} {unit}</span><span>卖出 {size(mode==='open'?'short':'long')} {unit}</span>
    </div>}
    {mode==='open'&&<div className="flex min-h-5 items-center justify-between gap-2 border-t border-border pt-2 text-muted-foreground">
      {kind==='market'&&<label className="inline-flex items-center gap-2"><input type="checkbox" checked={bounded}
        onChange={event=>{setBounded(event.target.checked);if(!slippage)setSlippage('0.5');}}/>滑点容差</label>}
      {kind==='market'&&bounded&&<label className={field+' w-24'}><input className={entry} inputMode="decimal" aria-label="滑点容差百分比"
        value={slippage} onChange={event=>setSlippage(event.target.value)}/>%</label>}
      {kind==='limit'&&<label className="flex items-center gap-2">生效时间<select value={tif} className="bg-background text-foreground"
        onChange={event=>setTif(event.target.value as UsdtDeskTimeInForce)}><option>GTC</option><option>IOC</option><option>FOK</option><option>GTX</option></select></label>}
      {kind==='conditional'&&<span>标记价格触发 · 市价执行</span>}
    </div>}
    <div className="grid grid-cols-2 gap-2">
      {directions.map(direction=>{
        const long = direction==='long', label = (mode==='open'?'开':'平')+(long?'多':'空');
        const red = mode==='open'?!long:long;
        return <div key={direction} className="min-w-0 space-y-1.5">
          <Button type="button" size="sm" disabled={!ready(direction)} onClick={()=>preview(direction,label)}
            className={'w-full rounded-lg text-sm font-semibold text-white '+(red?'bg-trading-red hover:bg-trading-red/90':'bg-trading-green hover:bg-trading-green/90')}>{label}</Button>
          <div className="text-muted-foreground">{mode==='close'?'可平量':'估算可开'} {mode==='close'?cap(direction):quantityAt(cap(direction),step)} {unit}</div>
        </div>;
      })}
    </div>
    {(message || pending || quoteIssue || issue) && <div className="space-x-2 text-muted-foreground">
      <span role="status">{message || (pending?'等待币安回报':issue || quoteIssue)}</span>
      {pending&&<button disabled={busy} type="button" className="text-primary" onClick={()=>void submit(pending)}>核对实盘回报</button>}
    </div>}
    <Dialog open={!!review} onOpenChange={open=>{if(!open&&!busy)setReview(undefined);}}>
      {review&&<DialogContent>
        <DialogHeader><DialogTitle>确认币安实盘{review.label}</DialogTitle>
          <DialogDescription>{symbol} · {review.quantity} {unit} · {options.find(([value])=>value===review.order.type)?.[1]}
            {review.order.type==='limit'?' '+review.order.price+' USDT · '+review.order.timeInForce:
              review.order.type==='conditional'?' · 触发价 '+review.order.triggerPrice+' USDT':
              review.order.slippage!==undefined?' · 滑点容差 '+review.order.slippage+'%':''}</DialogDescription></DialogHeader>
        {targetChanged&&<p role="alert" className="text-xs text-destructive">实盘仓位已变化，请关闭后重新确认。</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={()=>setReview(undefined)}>取消</Button>
          <Button type="button" disabled={busy||targetChanged} onClick={()=>void submit(review.request)}>确认提交</Button></DialogFooter>
      </DialogContent>}
    </Dialog>
  </section>;
}
