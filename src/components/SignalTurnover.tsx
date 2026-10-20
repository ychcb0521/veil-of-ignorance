/**
 * 信号库工具条上的「成交额」：每个信号前 24 小时的 USDT 成交额，汇总成区间、分位数和分布。
 * 【用户要求】2026-10-20「检查历史信号库中所有信号在当时信号出现时的成交量，汇总看区间范围，用 USDT」。
 * 在浏览器里逐个取 K 线（与「渔」的建议区间同一套取数），结果存在本机；关掉对话框不会中断，信号库变了会提示过期。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Download, RotateCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { TradeSignal } from '@/lib/signalLibrary';
import { fishSignalFingerprint } from '@/lib/fish/suggestions';
import { TURNOVER_BUCKETS, bucketTurnover, formatUsdtCn, readSignalTurnover, signalTurnoverCsv, type SignalTurnoverOptions, type SignalTurnoverProgress, type SignalTurnoverResult } from '@/lib/signalTurnover';

export function SignalTurnoverButton({ signals, run, busyReason }: { signals: readonly TradeSignal[]; run?: (options: SignalTurnoverOptions) => Promise<SignalTurnoverResult>; busyReason?: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SignalTurnoverResult | null>(readSignalTurnover);
  const [progress, setProgress] = useState<SignalTurnoverProgress | null>(null);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const fingerprint = useMemo(() => fishSignalFingerprint(signals), [signals]);
  const stale = !!result && result.fingerprint !== fingerprint;
  const running = progress?.status === 'running';
  const start = async () => {
    if (!run || running) return;
    const mine = new AbortController(); controller.current = mine; setError('');
    try { const r = await run({ signals, signal: mine.signal, onProgress: p => { if (controller.current === mine) setProgress(p); } }); if (controller.current === mine) setResult(r); }
    catch (e) { if (controller.current === mine && !mine.signal.aborted) setError(e instanceof TypeError ? '浏览器拦截（网络 / 跨域）' : e instanceof Error ? e.message : String(e)); }
    finally { if (controller.current === mine) controller.current = null; }
  };
  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([signalTurnoverCsv(result)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `信号成交额-${new Date(result.createdAt).toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const values = useMemo(() => result?.rows.flatMap(r => r.turnover === null ? [] : [r.turnover]) ?? [], [result]);
  const buckets = useMemo(() => bucketTurnover(values), [values]);
  const failures = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of result?.rows ?? []) if (r.turnover === null) { const k = (r.reason ?? '未知原因').replace(/ [A-Z0-9]+USDT /, ' … '); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [result]);
  const s = result?.stats;
  const pct = (n: number) => values.length ? Math.round((n / values.length) * 1000) / 10 : 0;
  const peak = Math.max(1, ...buckets);
  // 分布只画实际覆盖到的档（两头空档不画），中间的空档保留，才看得出断层
  const first = buckets.findIndex(n => n > 0), last = buckets.length - 1 - [...buckets].reverse().findIndex(n => n > 0);
  const shown = first < 0 ? [] : TURNOVER_BUCKETS.map((b, i) => ({ b, i })).slice(first, last + 1);

  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label="信号成交额" title="成交额：每个信号前 24 小时的 USDT 成交额，汇总成区间"
      className={`flex h-[22px] shrink-0 items-center gap-1 rounded px-1.5 text-[11px] transition-colors ${running ? 'text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
      <BarChart3 className="h-3 w-3" />{running && progress ? <span className="font-mono tabular-nums">{progress.done}/{progress.total}</span> : null}
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto p-5" data-testid="signal-turnover-dialog">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-sm font-semibold">信号成交额</DialogTitle>
          <DialogDescription className="text-[11px] leading-relaxed">每个信号前 24 小时的 USDT 成交额（截至信号所在那根 5 分钟 K 线之前，即当时盘口的「24h 成交额」）· 共 {signals.length} 个信号</DialogDescription>
        </DialogHeader>

        {running && progress && <div className="space-y-1.5" role="status">
          <div className="flex items-center gap-2 text-[11px]"><span>统计中</span><span className="font-mono tabular-nums text-muted-foreground">{progress.done} / {progress.total}</span><span className="truncate font-mono text-muted-foreground/70">{progress.current}</span>
            <button type="button" className="ml-auto rounded-md border border-border/70 px-2 py-0.5 text-[11px] hover:bg-muted" onClick={() => controller.current?.abort()}>取消</button></div>
          <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
        </div>}

        {!running && !result && <div className="space-y-3 text-[11px] leading-relaxed text-muted-foreground">
          <p>在你的浏览器里逐个向交易所取信号前 24 小时的 5 分钟 K 线（每个信号一次请求，约几分钟），算完存在本机，下次打开直接看。</p>
          <button type="button" disabled={!run || !!busyReason || !signals.length} onClick={() => void start()} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40">开始统计</button>
          {busyReason && <p className="text-[10.5px]">{busyReason}</p>}
        </div>}

        {error && <p className="text-[11px] text-destructive">{error}</p>}

        {result && s && <div className="space-y-4" data-testid="signal-turnover-result">
          {stale && <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-[10.5px] text-muted-foreground">信号库有改动，这份结果是按改动前的 {result.total} 个信号算的。</p>}
          <div>
            <div className="text-[10.5px] text-muted-foreground">区间（最小 ~ 最大）</div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono tabular-nums"><span className="text-lg font-semibold">{formatUsdtCn(s.min)} ~ {formatUsdtCn(s.max)}</span><span className="text-[11px] text-muted-foreground">USDT</span></div>
            <div className="mt-1 text-[11px] text-muted-foreground">中间 80% 的信号在 <span className="font-mono tabular-nums text-foreground">{formatUsdtCn(s.p10)} ~ {formatUsdtCn(s.p90)}</span>，中间一半在 <span className="font-mono tabular-nums text-foreground">{formatUsdtCn(s.p25)} ~ {formatUsdtCn(s.p75)}</span></div>
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-6">
            {([['P10', s.p10], ['P25', s.p25], ['中位数', s.p50], ['P75', s.p75], ['P90', s.p90], ['平均', s.mean]] as const).map(([label, v]) => <div key={label}><div className="text-[10px] text-muted-foreground">{label}</div><div className="font-mono text-[12px] font-medium tabular-nums">{formatUsdtCn(v)}</div></div>)}
          </div>
          <div className="space-y-1" aria-label="成交额分布">
            <div className="text-[10.5px] text-muted-foreground">分布</div>
            {shown.map(({ b, i }) => <div key={b.label} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-2 text-[11px]">
              <span className="text-muted-foreground">{b.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted/60"><span className="block h-full rounded-full bg-primary/80" style={{ width: `${(buckets[i] / peak) * 100}%` }} /></span>
              <span className="font-mono tabular-nums">{buckets[i]}<span className="ml-1 text-muted-foreground">{pct(buckets[i])}%</span></span>
            </div>)}
          </div>
          <div className="space-y-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
            <p>统计了 <span className="font-mono tabular-nums text-foreground">{s.n}</span> / {result.total} 个信号{result.complete ? '' : '（中途取消，只算到已取到的）'}；{result.partial > 0 && <>其中 {result.partial} 个上市不足 24 小时，按上市以来的成交额计；</>}算于 {new Date(result.createdAt).toLocaleString('zh-CN', { hour12: false })}。</p>
            {failures.length > 0 && <details><summary className="w-fit cursor-pointer">取不到的 {result.rows.filter(r => r.turnover === null).length} 个</summary>{failures.slice(0, 8).map(([reason, n]) => <p key={reason} className="break-words">{n} 个 · {reason}</p>)}</details>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={download} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 px-3 text-[11px] font-medium hover:bg-muted"><Download className="h-3 w-3" />下载明细 CSV</button>
            <button type="button" disabled={!run || running || !!busyReason} onClick={() => void start()} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><RotateCw className="h-3 w-3" />重新统计</button>
          </div>
        </div>}
        {result && !s && !running && <p className="text-[11px] text-muted-foreground">上次没有取到任何信号的成交额。<button type="button" className="ml-1 underline" onClick={() => void start()}>重新统计</button></p>}
      </DialogContent>
    </Dialog>
  </>;
}
