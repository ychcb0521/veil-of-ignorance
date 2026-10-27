/**
 * 「比较探测」的持续挖掘面板：默认探测算法（开始时冻结）从 2026-04-01 00:00 起每半天扫一档，
 * 挖到的鱼入鱼舱、进鱼质量，按固定的卖出方案评估后生成「探测比较」交易战役。
 */
import { useState } from 'react';
import { ArrowUpRight, CircleHelp, Pause, Pickaxe, Play } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FishQualityModule } from '@/components/FishQualityModule';
import type { FishMiningApi } from '@/hooks/useFishMining';
import { currentDefaultRules, type FishMiningRule } from '@/lib/fish/mining';
import { formatUTC8 } from '@/lib/timeFormat';

const short = (t: number) => formatUTC8(t).slice(0, 16);
const RULE_NAMES: Record<string, string> = { cbi2: 'CBI-2', state: 'S', cba: 'CBA', 'drift-speed-z': 'az', bss: 'BSS' };
const ruleText = (r: FishMiningRule) => `${RULE_NAMES[r.featureId] ?? r.featureId}${r.statistic === '结果' ? '' : ` ${r.statistic.replace(/^avg_.*_2$/, 'avg₂')}`} > ${r.threshold}`;
export function FishMiningPanel({ mining, sellFixed, campaignHref }: { mining: FishMiningApi; sellFixed: boolean; campaignHref: string }) {
  const { state: s, running, anchorMs, progress, waiting } = mining;
  const [target, setTarget] = useState<string | null>(null);
  const rules = s.rules.length ? s.rules : currentDefaultRules(), reached = s.mined >= s.target, now = Date.now();
  const caughtUp = !reached && s.cursorMs > now, share = Math.min(1, s.mined / s.target);
  const applyTarget = () => { const n = Number(target); if (Number.isInteger(n) && n > 0) mining.setTarget(n); setTarget(null); };
  const status = running && anchorMs != null ? `正在挖 ${short(anchorMs)} 这一档${progress?.total ? `（${progress.done} / ${progress.total} 个标的）` : ''}`
    : !s.enabled ? (s.anchorsDone ? `已暂停 · 继续后从 ${short(s.cursorMs)} 这一档接着挖` : '还没开始')
    : reached ? '已达目标：调高目标可继续往后挖'
    : caughtUp ? `已追上现在，下一档 ${short(s.cursorMs)} 到点自动挖`
    : s.lastError ? `出错：${s.lastError}（2 分钟后原地重试）`
    : waiting || `排队中：下一档 ${short(s.cursorMs)}`;
  const statusLabel = running ? '挖掘中' : !s.enabled ? s.anchorsDone ? '已暂停' : '未开始'
    : reached ? '已达目标' : caughtUp ? '已追上现在' : s.lastError ? '等待重试' : waiting ? '等待中' : '排队中';
  const hasError = !!s.lastError && !running && s.enabled && !reached && !caughtUp;
  return <FishQualityModule title="批量挖掘" icon={Pickaxe} testId="fish-mining-panel" summary={<>
        <span className="whitespace-nowrap font-mono tabular-nums text-foreground/80" aria-label={`已挖 ${s.mined} 条，目标 ${s.target} 条`}>{s.mined} <span className="text-muted-foreground/50">/ {s.target}</span></span>
        <Popover><PopoverTrigger asChild><button type="button" aria-label="挖掘说明与进度" title="挖掘说明与进度" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/35 transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><CircleHelp aria-hidden strokeWidth={1.4} className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" collisionPadding={12} aria-label="持续挖掘说明" className="w-80 max-w-[calc(100vw-1.5rem)] max-h-[min(80vh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain p-3 text-[11px] leading-relaxed">
          <div className="space-y-2.5">
            <div className="space-y-1"><p className="font-medium">当前进度</p><p className="font-mono tabular-nums text-muted-foreground">已挖 {s.mined} / {s.target} 条 · 已扫 {s.anchorsDone} 档{s.lastAnchorMs != null ? ` · 扫到 ${short(s.lastAnchorMs)}` : ''}</p><p className={hasError ? 'text-destructive' : 'text-muted-foreground'}>{status}</p></div>
            <div className="space-y-1 border-t border-border/50 pt-2.5"><p className="font-medium">默认算法 · 并集</p><p className="text-muted-foreground">{rules.map(ruleText).join(' · ')}</p><p className="text-muted-foreground">从 {short(s.startMs)} 起每 12 小时一档</p></div>
            <div className="space-y-1.5 border-t border-border/50 pt-2.5 text-muted-foreground">{!sellFixed && <p className="text-amber-700 dark:text-amber-400">还没固定卖出方案：挖到的鱼会入舱并加入列表，在卖出列的设置中固定一套方案后，才会按它比较各探测算法。</p>}<p>挖到的鱼直接进「鱼舱」（不算新鱼、不发邮件），同时加入鱼质量并自动勾选；点「开始过滤」或「开始监测」后，各自独立运行。</p><p>同一段持续的信号只记第一次能发现的那一档，按那一档的捕捞时刻买入。捕捞时挖掘自动让路，空闲后接着挖。</p><a href={campaignHref} className="inline-flex items-center gap-0.5 text-primary hover:underline">在交易战役查看<ArrowUpRight aria-hidden className="h-3 w-3"/></a></div>
          </div>
        </PopoverContent></Popover>
      </>} status={
        <span role="status" aria-label={status} title={status} className={`inline-flex min-w-0 flex-wrap items-center gap-1 text-[10px] ${hasError ? 'text-destructive' : 'text-muted-foreground'}`}><span aria-hidden className={`h-1 w-1 shrink-0 rounded-full ${running ? 'animate-pulse bg-primary' : hasError ? 'bg-destructive' : 'bg-muted-foreground/40'}`}/>{statusLabel}{running && progress && progress.total > 0 && <span className="font-mono tabular-nums text-foreground/70" aria-label={`本档已扫 ${progress.done} / ${progress.total} 个标的`}>{progress.done}/{progress.total}</span>}</span>
      } progress={<div className="mt-1 h-px overflow-hidden bg-border/60" role="progressbar" aria-label="挖掘进度" aria-valuemin={0} aria-valuemax={s.target} aria-valuenow={Math.min(s.mined, s.target)} aria-valuetext={`已挖 ${s.mined} 条，目标 ${s.target} 条`}><div className="h-full rounded-r-full bg-primary/70 transition-[width] duration-500" style={{ width: `${share * 100}%` }}/></div>}>
        <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">目标<input aria-label="挖掘目标条数" type="number" min="1" step="100" value={target ?? s.target} onChange={e => setTarget(e.target.value)} onBlur={applyTarget} onKeyDown={e => { if (e.key === 'Enter') applyTarget(); }} className="h-7 w-16 rounded-md border border-transparent bg-muted/50 px-1.5 font-mono text-[11px] tabular-nums outline-none hover:bg-muted focus-visible:border-ring/60"/>条</label>
        {s.enabled
          ? <button type="button" onClick={mining.pause} className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 px-2.5 text-[11px] hover:bg-muted"><Pause className="h-3 w-3"/>暂停</button>
          : <button type="button" onClick={mining.start} className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground hover:bg-primary/90"><Play className="h-3 w-3"/>{s.anchorsDone ? '继续挖掘' : '开始挖掘'}</button>}
  </FishQualityModule>;
}
