import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, CandlestickChart, ChevronDown, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { fishWickDuration, type FishWickRejection } from '@/lib/fish/downwardWick';
import { FISH_STEP, type FishProgress } from '@/lib/fishScanner';
import { signalChartSymbol, type TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import { FishTurnoverThresholds } from './FishTurnoverThresholds';
import { FishTurnoverDetails } from './FishTurnoverDetails';

const identity = (r: FishWickRejection) => `${r.exchange}|${r.market ?? 'crypto'}|${r.symbol}|${r.cutoffMs}|${r.openTime}`;
const price = (n: number) => Number.isFinite(n) ? Number(n.toPrecision(9)).toString() : '—';
const percent = (r: FishWickRejection) => `${(100 * r.drop / r.open).toFixed(2)}%`;
const multiple = (r: FishWickRejection) => r.atr > 0 ? `${(r.drop / r.atr).toFixed(2)}×` : 'ATR 为 0';
const sourceOf = (r: FishWickRejection): TradeSignal => ({
  id: `wick-chart:${identity(r)}`, symbol:r.symbol, exchange:r.exchange, market:r.market, underlying:r.underlying,
  binanceSymbol:r.binanceSymbol, timeMs:r.openTime + FISH_STEP, timeLabel:formatUTC8(r.openTime + FISH_STEP), fallbackZone:'',
});

/** Uses the frozen original-venue candles; opening it never fetches or starts another scan. */
function WickChart({ row }: { row: FishWickRejection }) {
  const bars = row.candles, width=900, height=230, left=85, right=15, top=20, bottom=35;
  const min=Math.min(...bars.map(b=>b.low)), max=Math.max(...bars.map(b=>b.high));
  const focusAt=bars.findIndex(b=>b.openTime===row.openTime);
  const padding=Math.max((max-min)*.08,max*.0001), lo=min-padding, hi=max+padding;
  const y=(v:number)=>top+(hi-v)/(hi-lo)*(height-top-bottom), dx=(width-left-right)/Math.max(1,bars.length);
  return <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[540px]" role="img" aria-label={`${row.symbol} ${EXCHANGE_NAMES[row.exchange]} 原始 5 分钟 K 线，突出显示过滤触发线`}>
    {[0,.5,1].map(t=>{const v=lo+(hi-lo)*t;return <g key={t}><line x1={left} x2={width-right} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-border/60"/><text x={left-10} y={y(v)+4} textAnchor="end" fontSize="11" fill="currentColor" className="text-muted-foreground">{price(v)}</text></g>;})}
    {bars.map((b,i)=>{
      const x=left+(i+.5)*dx, focus=b.openTime===row.openTime, color=b.close>=b.open?'#0ECB81':'#F6465D';
      return <g key={b.openTime}>
        <title>{formatUTC8(b.openTime)} · 开 {price(b.open)} · 高 {price(b.high)} · 低 {price(b.low)} · 收 {price(b.close)}{focus?' · 触发过滤':''}</title>
        {focus&&<rect x={x-dx*.46} y={top-6} width={dx*.92} height={height-top-bottom+12} fill="#E5A000" fillOpacity=".12" stroke="#E5A000" strokeOpacity=".55" rx="3"/>}
        <line x1={x} x2={x} y1={y(b.high)} y2={y(b.low)} stroke={color} strokeWidth="1.4"/>
        <rect x={x-dx*.24} y={Math.min(y(b.open),y(b.close))} width={dx*.48} height={Math.max(1,Math.abs(y(b.open)-y(b.close)))} fill={color}/>
        {(focus||(i===0&&focusAt>4)||(i===bars.length-1&&i-focusAt>4))&&<text x={x} y={height-12} textAnchor={i===0?'start':i===bars.length-1?'end':'middle'} fontSize="11" fill="currentColor" className={focus?'text-primary':'text-muted-foreground'}>{formatUTC8(b.openTime).slice(11,16)}{focus?' · 触发':''}</text>}
      </g>;
    })}
  </svg>;
}

export function FishWickEvidence({ row }: { row: FishWickRejection }) {
  const threshold = row.atr * row.rule.atrMultiple;
  const values = [
    ['触发 K 线开盘（北京时间）', formatUTC8(row.openTime)],
    ['插针回看截止（北京时间）', formatUTC8(row.cutoffMs)],
    ['开盘价 → 最低价', `${price(row.open)} → ${price(row.low)}`],
    ['开盘至最低跌幅', `${price(row.drop)}（${percent(row)}）`],
    ['此前 ATR(14)', price(row.atr)],
    ['实际 / 门槛倍数', `${multiple(row)} / ${row.rule.atrMultiple}×`],
  ];

  return <div className="space-y-2">
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-md bg-muted/35 p-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {values.map(([label, value]) => <div key={label}>
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="font-mono tabular-nums">{value}</dd>
      </div>)}
    </dl>
    <p className="leading-relaxed text-muted-foreground">本次回看 {fishWickDuration(row.rule.hours)}。实际跌幅 {price(row.drop)} &gt; 此前 ATR(14) × {row.rule.atrMultiple} = {price(threshold)}，触发过滤。ATR 取触发前 14 根已收盘 K 线。</p>
    <div className="overflow-x-auto"><WickChart row={row}/></div>
  </div>;
}

export function FishWickDetails({ progress, onJump, jumpingSignalId }: {
  progress: FishProgress; onJump?: (source: TradeSignal) => void; jumpingSignalId: string | null;
}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[page,setPage]=useState(0),[selected,setSelected]=useState<string|null>(null);
  const rows=useMemo(()=>[...(progress.wickDetails??[])].sort((a,b)=>b.openTime-a.openTime||a.symbol.localeCompare(b.symbol)),[progress.wickDetails]);
  const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return rows.filter(r=>`${r.symbol} ${EXCHANGE_NAMES[r.exchange]}`.toLowerCase().includes(q));},[rows,query]);
  const pages=Math.max(1,Math.ceil(filtered.length/50)),at=Math.min(page,pages-1),shown=filtered.slice(at*50,(at+1)*50);
  const active=rows.find(r=>identity(r)===selected), source=active?sourceOf(active):null;
  const [thresholdsOpen, setThresholdsOpen] = useState(false);
  const [tab, setTab] = useState<'wick' | 'turnover'>('wick');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const turnoverCount = progress.thin ?? 0;
  const wickCount = progress.wickSkipped ?? 0;
  const sections = [
    { key:'wick', label:'插针过滤', count:wickCount },
    { key:'turnover', label:'成交额过滤', count:turnoverCount },
  ] as const;
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [tab]);
  const thresholdsId = useId();
  const rule = active?.rule ?? rows[0]?.rule;
  const incomplete=Math.max(0,(progress.wickSkipped??0)-rows.length);
  const cutoff=rows[0]?.cutoffMs??progress.cutoffMs;
  useEffect(()=>{if(selected&&open)document.getElementById('fish-wick-chart')?.scrollIntoView?.({behavior:'smooth',block:'nearest'});},[selected,open]);
  return <Dialog open={open} onOpenChange={next => { setOpen(next); if (!next) setThresholdsOpen(false); }}>
    {sections.filter(section => section.count > 0).map(section => <span key={section.key} className="inline-flex items-center gap-2">
      <span aria-hidden className="text-muted-foreground/40">·</span>
      <button type="button" aria-haspopup="dialog" data-testid={section.key === 'wick' ? 'fish-wick-skipped' : 'fish-turnover-skipped'}
        aria-label={`查看${section.label}详情（${section.count} 个）`}
        onClick={event => { triggerRef.current = event.currentTarget; setTab(section.key); setOpen(true); }}
        className="rounded-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        {section.label} {section.count}
      </button>
    </span>)}
    <DialogContent
      className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0"
      onCloseAutoFocus={event => { if (triggerRef.current?.isConnected) { event.preventDefault(); triggerRef.current.focus(); } }}
    >
      <DialogHeader className="shrink-0 border-b border-border/60 px-5 pb-4 pt-5 text-left">
        <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
          <DialogTitle className="text-sm">{tab === "wick" ? "插针过滤" : "成交额过滤"} · 详情</DialogTitle>
          <button
            type="button"
            aria-expanded={thresholdsOpen}
            aria-controls={thresholdsId}
            onClick={() => setThresholdsOpen(current => !current)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border/70 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            过滤门槛
            <ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground transition-transform ${thresholdsOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
        <DialogDescription className="text-xs leading-relaxed">
          {tab === 'wick' ? <>本轮已过滤 {wickCount} 个标的{cutoff != null ? ` · 截止 ${formatUTC8(cutoff)}（UTC+8）` : ''}。每个标的记首根触发的已收盘 5 分钟 K 线。</> : <>本轮 {turnoverCount} 个标的出现成交额未达标。相同检查合并显示，检查时点不同会分行列出。并集里，其他算法达标仍可入库。</>}
          {progress.status === 'running' && ' 扫描中，明细持续更新。'}
        </DialogDescription>
        <div role="group" aria-label="过滤类型" className="mt-2 inline-flex w-fit flex-wrap gap-1 rounded-md bg-muted/60 p-0.5">
          {sections.map(section => <button key={section.key} type="button" aria-pressed={tab === section.key} onClick={() => setTab(section.key)}
            className={`inline-flex h-6 items-center gap-1.5 rounded px-2 text-[11px] transition-colors ${tab === section.key ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {section.label}<span className="tabular-nums text-muted-foreground">{section.count}</span>
          </button>)}
        </div>
      </DialogHeader>
      <div ref={bodyRef} className="min-h-0 space-y-4 overflow-y-auto px-5 py-4 text-xs">
        {thresholdsOpen && <section id={thresholdsId} aria-label="过滤门槛" className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3.5 py-2.5">
          <ul aria-label="插针门槛" className="divide-y divide-border/50 text-[11px]">
            <li className="flex flex-wrap justify-between gap-x-3 py-1.5">
              <span className="text-muted-foreground">插针回看</span>
              <span className="font-medium">{rule ? `本轮回看 ${fishWickDuration(rule.hours)}，只看已收盘 5 分钟 K 线` : '使用已收盘 5 分钟 K 线，本轮时长未保存'}</span>
            </li>
            <li className="flex flex-wrap justify-between gap-x-3 py-1.5">
              <span className="text-muted-foreground">插针幅度</span>
              <span className="font-medium">开盘价 − 最低价 &gt; ATR(14) × {rule?.atrMultiple ?? '所设倍数'}</span>
            </li>
          </ul>
          <p className="pb-1 text-[11px] leading-relaxed text-muted-foreground">ATR 取触发前 14 根的平均真实波幅。任一根超线，整只标的跳过。</p>
          <FishTurnoverThresholds />
        </section>}
        {tab === 'turnover' ? <FishTurnoverDetails rows={progress.turnoverDetails} rejected={turnoverCount} /> : <>
        {incomplete>0&&<p role="note" className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-muted-foreground" data-testid="fish-wick-legacy">{incomplete} 条旧版记录仅保存了过滤数量，未保存触发时间和价格。重新捕捞后可查看完整明细。</p>}
        {wickCount === 0 && rows.length === 0 && <p className="py-8 text-center text-muted-foreground">本轮暂无插针过滤记录。</p>}
        {rows.length>0&&<>
          <label className="flex h-8 items-center gap-2 rounded-md bg-muted/50 px-2.5 text-muted-foreground"><Search aria-hidden className="h-3.5 w-3.5"/><input aria-label="搜索插针过滤标的或交易所" placeholder="搜索标的或交易所…" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} className="min-w-0 flex-1 bg-transparent text-foreground outline-none"/></label>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full whitespace-nowrap text-left text-[11px]" aria-label="插针过滤明细">
              <thead className="bg-muted/40 text-muted-foreground"><tr>{['标的 / 交易所','触发时间 · UTC+8','开盘 → 最低','跌幅','ATR(14)','实际 / 门槛',''].map((h,i)=><th key={i} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>{shown.map(r=><tr key={identity(r)} className={`border-t border-border/50 ${selected===identity(r)?'bg-primary/5':'hover:bg-muted/25'}`}>
                <td className="px-3 py-2.5"><span className="font-mono font-medium">{r.symbol}</span><span className="ml-2 text-muted-foreground">{EXCHANGE_NAMES[r.exchange]}{r.market==='us_stock'?' · 美股':''}</span></td>
                <td className="px-3 py-2.5 font-mono tabular-nums">{formatUTC8(r.openTime)}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums">{price(r.open)} → {price(r.low)}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums text-destructive">−{percent(r)}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums">{price(r.atr)}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums">{multiple(r)} <span className="text-muted-foreground">/ &gt; {r.rule.atrMultiple}×</span></td>
                <td className="px-3 py-2.5"><button type="button" aria-label={`查看 ${r.symbol} ${EXCHANGE_NAMES[r.exchange]} 的触发 K 线`} aria-expanded={selected===identity(r)} aria-controls="fish-wick-chart" onClick={()=>setSelected(identity(r))} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><CandlestickChart aria-hidden className="h-3.5 w-3.5"/>查看 K 线</button></td>
              </tr>)}</tbody>
            </table>
            {!filtered.length&&<p className="py-8 text-center text-muted-foreground">没有匹配的记录</p>}
          </div>
          {pages>1&&<div className="flex items-center justify-between text-muted-foreground"><span>共 {filtered.length} 条 · {at+1} / {pages} 页</span><div className="flex gap-4"><button disabled={at===0} onClick={()=>setPage(at-1)} className="disabled:opacity-40">上一页</button><button disabled={at===pages-1} onClick={()=>setPage(at+1)} className="disabled:opacity-40">下一页</button></div></div>}
        </>}
        {active&&source&&<section id="fish-wick-chart" className="rounded-lg border border-border/60 bg-muted/15 p-3.5" aria-label="触发 K 线详情">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">{active.symbol} <span className="font-normal text-muted-foreground">· {EXCHANGE_NAMES[active.exchange]} · 5m 原始快照</span></h3><p className="mt-1 text-[11px] text-muted-foreground">{formatUTC8(active.openTime)}（UTC+8）· 金色框为触发线 · 悬停查看 OHLC</p></div>
            {onJump&&signalChartSymbol(source)&&<button type="button" disabled={!!jumpingSignalId} onClick={()=>onJump(source)} className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-primary hover:bg-muted disabled:opacity-40"><ArrowUpRight aria-hidden className="h-3.5 w-3.5"/>{jumpingSignalId===source.id?'正在打开…':active.exchange==='binance'?'打开历史盘面':'打开币安参考盘面'}</button>}
          </div>
          <div className="mt-3 overflow-x-auto"><WickChart row={active}/></div>
          <p className="mt-2 leading-relaxed text-muted-foreground" data-testid="fish-wick-reason">当轮回看 {active.rule.hours}h；开盘至最低价跌幅 {price(active.drop)}（{percent(active)}），严格大于此前 ATR(14) {price(active.atr)} × {active.rule.atrMultiple} = {price(active.atr*active.rule.atrMultiple)}，因此过滤。ATR 不包含触发线。</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">快照仅含本轮截止前已收盘线。历史盘面定位到触发线收盘时刻，保留主盘面当前周期。{active.exchange!=='binance'?' 原始快照来自该交易所；币安参考盘面价格可能不同。':''}{!signalChartSymbol(source)?' 此标的暂无可用的币安盘面，可查看上方原始快照。':''}</p>
        </section>}
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}
