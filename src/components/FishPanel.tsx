import { useMemo, useState } from 'react';
import { AUDITED_EXCHANGES, EXCHANGE_NAMES, type FishExchange } from '@/lib/fish/exchanges';
import { ChevronRight, CircleHelp, SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TradeSignal } from '@/lib/signalLibrary';
import { parseFishSettings, type FishScanSettings, type FishProgress } from '@/lib/fishScanner';
import { formatUTC8 } from '@/lib/timeFormat';
import { FishLibrary } from '@/components/FishLibrary';

export interface FishPanelProps {
  signals: TradeSignal[]; progress: FishProgress | null;
  inputs: { time: string; threshold: string }; onInputsChange: (value: { time: string; threshold: string }) => void;
  selection: { exchanges: FishExchange[]; includeDuplicates: boolean }; onSelectionChange: (value: { exchanges: FishExchange[]; includeDuplicates: boolean }) => void;
  onStart: (settings: FishScanSettings) => void; onCancel: () => void; onAdd: (target?: string | readonly string[]) => void;
  onJump: (id: string) => void; onDelete: (id: string) => void; onRate: (id: string, value: number) => void;
  jumpingSignalId: string | null; tradedDayIndex: Set<string>; campaignDayIndex: Set<string>;
}
/**
 * 【用户要求】2026-10-19「渔这里，界面要简单一点，只用显示命中以及加载进度，其他的都折叠收起来，用非常隐形的符号做入口」：
 * 平时只有一行设置 + 一行「状态 · 命中 · 进度」；交易所勾选收在 ⚙ 型的淡色图标后，各家明细（截止时间、计数、跳过与失败原因）收在 › 后。
 * 有交易所被跳过 / 中止 / 有失败时，› 旁一个小琥珀点提示可以点开看；展开状态记在这次浏览里。
 */
const OPEN_KEY = 'veil.fish.open';
function readOpen(): { scope: boolean; detail: boolean } {
  try { const v = JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? '{}'); return { scope: !!v.scope, detail: !!v.detail }; } catch { return { scope: false, detail: false }; }
}
const faint = 'rounded p-1 text-muted-foreground/40 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const STATUS: Record<FishProgress['status'], string> = { running: '捕捞中', complete: '捕捞完成', cancelled: '已取消', aborted: '已中止', skipped: '已跳过' };

export function FishPanel(p: FishPanelProps) {
  const [error, setError] = useState('');
  const [open, setOpenState] = useState(readOpen);
  const setOpen = (patch: Partial<{ scope: boolean; detail: boolean }>) => setOpenState(o => {
    const next = { ...o, ...patch };
    try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* 记不住只是下次要再点 */ }
    return next;
  });
  const { exchanges, includeDuplicates } = p.selection;
  const start = () => {
    try { const settings = parseFishSettings(p.inputs.time, p.inputs.threshold); if (!exchanges.length) throw new Error('请至少选择一家交易所'); setError(''); p.onStart({ ...settings, exchanges: [...exchanges], includeDuplicates }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const running = p.progress?.status === 'running';
  const fresh = useMemo(() => p.signals.filter(s => s.freshCatch), [p.signals]);
  const old = useMemo(() => p.signals.filter(s => !s.freshCatch), [p.signals]);
  const btn = 'rounded border border-border/60 px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40';
  const x = p.progress;
  // 有交易所被跳过 / 中止、或有失败与读数不全时，明细入口旁亮一个小点
  const attention = !!x && (!!x.error || Object.values(x.venues ?? {}).some(v => v && (v.status === 'skipped' || v.status === 'aborted' || !!v.error || v.counts.failed > 0 || v.counts.readings > 0)));
  return <section className="mt-2 space-y-2 rounded border border-border/60 bg-background p-3" aria-label="渔" data-testid="fish-panel">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px]">
      <div className="flex items-center gap-1">
        <strong className="text-xs">渔</strong>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="捕捞说明" className="rounded p-1 text-muted-foreground/40 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <CircleHelp className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-2 p-3 text-[11px] leading-relaxed" aria-label="捕捞说明">
            <p className="font-medium text-foreground">捕捞说明</p>
            <p className="text-muted-foreground">时间按 UTC+8 输入，留空使用币安服务器当前时间作为所有交易所共同节点；历史时间向下取整至5分钟，仅使用此前2000根已收盘5m K线。标的范围为各交易所当前正在交易的 USDT 永续合约。仅币安、OKX、Bitget、Gate通过核实：OKX/Bitget/Gate按各自面值规则及逐笔成交价汇总主动金额，数据量较大，首次可能较慢。</p>
            <p className="text-muted-foreground">沿用内置 CBI-2，avg(CBI2, 24h) 严格大于所设阈值才命中。第1455根起读数可用；只记录本轮上穿起点，起点不明不入库。每家使用自己的 BTC 永续参考价，缺根只中止该家。开始前检查历史保留期，超期整家跳过；Gate 5m K线仅最近10000根（约34.7天）。</p>
            <p className="text-muted-foreground">扫描开始后锁定时间和阈值，截止之后的数据不参与计算。默认按币安 → OKX → Bitget → Gate排除基础币重复；优先级取已接入交易所的完整标的表，不依赖本轮勾选。勾选「含重复币」可分别扫描。结果累计保存在下方「鱼」，可手动加入信号库。</p>
            {x?.anchorMs && <p className="font-mono text-muted-foreground">本轮节点：{formatUTC8(x.anchorMs)}</p>}
            {x?.cutoffMs && <p className="font-mono text-muted-foreground">本轮阈值 &gt; {x.threshold ?? 0.3}</p>}
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={running} onClick={start}>开始捕捞</button>
        <button type="button" className={btn} disabled={!running} onClick={p.onCancel}>取消</button>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>时间（UTC+8）</span>
        <input className="w-48 rounded border border-border/60 bg-transparent px-2 py-1 font-mono text-foreground" aria-label="捕捞时间（UTC+8）" placeholder="YYYY-MM-DD HH:mm:ss" value={p.inputs.time} disabled={running} onChange={e => { setError(''); p.onInputsChange({ ...p.inputs, time: e.target.value }); }} />
      </label>
      <label className="flex items-center gap-2 text-muted-foreground">
        <span>阈值 &gt;</span>
        <input className="w-20 rounded border border-border/60 bg-transparent px-2 py-1 font-mono text-foreground" aria-label="捕捞阈值" type="number" min="-1" max="1" step="0.01" value={p.inputs.threshold} disabled={running} onChange={e => { setError(''); p.onInputsChange({ ...p.inputs, threshold: e.target.value }); }} />
      </label>
      <button type="button" aria-label="捕捞范围" aria-expanded={open.scope} title={`捕捞范围：${exchanges.map(e => EXCHANGE_NAMES[e]).join('、') || '未选交易所'}${includeDuplicates ? '（含重复币）' : ''}`} onClick={() => setOpen({ scope: !open.scope })} className={`${faint} ${open.scope ? 'text-muted-foreground' : ''}`}>
        <SlidersHorizontal className="h-3 w-3" />
      </button>
    </div>
    {open.scope && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground" aria-label="捕捞交易所">
      {AUDITED_EXCHANGES.map(exchange => <label key={exchange} className="flex items-center gap-1.5">
        <input type="checkbox" className="h-3 w-3 accent-primary" disabled={running} checked={exchanges.includes(exchange)} onChange={e => p.onSelectionChange({ ...p.selection, exchanges: AUDITED_EXCHANGES.filter(x => x === exchange ? e.target.checked : exchanges.includes(x)) })} />
        {EXCHANGE_NAMES[exchange]}
      </label>)}
      <label className="ml-1 flex items-center gap-1.5 border-l border-border/60 pl-4"><input type="checkbox" className="h-3 w-3 accent-primary" disabled={running} checked={includeDuplicates} onChange={e => p.onSelectionChange({ ...p.selection, includeDuplicates: e.target.checked })} />含重复币</label>
    </div>}
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
    {x && <div className="space-y-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p role="status" aria-live="polite" className="flex items-center gap-2" data-testid="fish-status">
          <span>{STATUS[x.status]}</span>
          <span className="text-muted-foreground">·</span>
          <span>命中 <span className="font-mono tabular-nums font-medium text-primary">{x.counts.hit}</span></span>
          <span className="text-muted-foreground">·</span>
          <span className="font-mono tabular-nums text-muted-foreground">{x.done} / {x.total}</span>
        </p>
        {running && x.total > 0 && <span className="h-[3px] w-28 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className="block h-full rounded-full bg-primary/70 transition-[width] duration-300" style={{ width: `${Math.min(100, (x.done / x.total) * 100)}%` }} />
        </span>}
        <button type="button" aria-label="捕捞明细" aria-expanded={open.detail} title="明细：截止时间、各交易所计数、跳过与失败原因" onClick={() => setOpen({ detail: !open.detail })} className={`${faint} relative`} data-testid="fish-detail-toggle">
          <ChevronRight className={`h-3 w-3 transition-transform ${open.detail ? 'rotate-90' : ''}`} />
          {attention && !open.detail && <span className="absolute right-0 top-0.5 h-1 w-1 rounded-full bg-[#F59E0B]" aria-hidden data-testid="fish-detail-dot" />}
        </button>
      </div>
      {/* 整次扫描在开始前就失败（没有各家明细）：直接写出来，不藏 */}
      {x.error && !Object.keys(x.venues ?? {}).length && <p className="text-destructive">{x.error}</p>}
      {open.detail && <div className="space-y-2 border-l border-border/60 pl-3" data-testid="fish-detail">
      {x.cutoffMs && <p className="font-mono text-muted-foreground">截止（UTC+8） {formatUTC8(x.cutoffMs)}</p>}
      {(Object.keys(x.venues ?? {}).length ? Object.entries(x.venues!) : [['binance',x]]).map(([venue,value]) => {
        const v = value as FishProgress;
        return <div key={venue as string} className="space-y-1">
          <p><span className="mr-2 font-medium">{EXCHANGE_NAMES[venue as FishExchange]}</span>{v.status === 'running' ? '捕捞中' : v.status === 'complete' ? '捕捞完成' : v.status === 'cancelled' ? '已取消' : v.status === 'skipped' ? '已跳过' : '已中止'} · {v.done} / {v.total}{v.current ? ` · ${v.current}` : ''}</p>
          <p className="flex flex-wrap gap-x-3 text-muted-foreground"><span>命中 {v.counts.hit}</span><span>未达标 {v.counts.below}</span><span>起点不明 {v.counts.unknown}</span><span>缺口 {v.counts.gap}</span><span>当时未上市 / 历史不足 {v.history ?? 0}</span><span>读数不全 {v.counts.readings}</span><span>请求失败 {v.counts.failed}</span></p>
          {v.skippedReason && <p className="text-muted-foreground">{v.skippedReason}</p>}
          {(['failed','readings'] as const).map(kind => !!v.failures?.[kind].length && <details key={kind} className="text-muted-foreground">
            <summary className="w-fit cursor-pointer text-[11px] hover:text-foreground">{kind === 'failed' ? '请求失败' : '读数不全'}原因（前 {v.failures![kind].length} 个币）</summary>
            <ul className="mt-1 space-y-1 border-l border-border/60 pl-3">{v.failures![kind].map(row => <li key={row.symbol} className="break-words"><span className="mr-2 font-mono text-foreground">{row.symbol}</span>{row.reason}</li>)}</ul>
          </details>)}
          {v.error && <p className="text-destructive">{v.error}</p>}
        </div>;
      })}
      {x.error && Object.keys(x.venues ?? {}).length > 0 && <p className="text-destructive">{x.error}</p>}
      </div>}
    </div>}
    {/* 【用户要求】2026-10-19 新鱼 = 最近一次捕捞捕到的；点开始捕捞时上一轮的新鱼归入「鱼」 */}
    <FishLibrary title="新鱼" testId="fish-new" signals={fresh} defaultOpen={fresh.length > 0} emptyText={running ? '捕捞中，捕到的会出现在这里。' : '还没有新鱼：点「开始捕捞」后，这一轮捕到的放在这里，上一轮的归入「鱼」。'}
      tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={p.onRate} onAdd={p.onAdd} />
    <FishLibrary title="鱼" testId="fish-old" signals={old} bare emptyText="暂无信号：每次开始捕捞时，上一轮的新鱼会归入这里。"
      tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={p.onRate} onAdd={p.onAdd} />
  </section>;
}
