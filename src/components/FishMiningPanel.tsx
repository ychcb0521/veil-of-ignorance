/**
 * 「比较探测」的持续挖掘面板：默认探测算法（开始时冻结）从 2026-04-01 00:00 起每半天扫一档，
 * 挖到的鱼入鱼舱、进鱼质量，按固定的卖出方案评估后生成「探测比较」交易战役。
 */
import { useState } from 'react';
import { Pause, Pickaxe, Play } from 'lucide-react';
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
    : !s.enabled ? (s.anchorsDone ? '已暂停' : '还没开始')
    : reached ? '已达目标：调高目标可继续往后挖'
    : caughtUp ? `已追上现在，下一档 ${short(s.cursorMs)} 到点自动挖`
    : s.lastError ? `出错：${s.lastError}（2 分钟后原地重试）`
    : waiting || `排队中：下一档 ${short(s.cursorMs)}`;
  return <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-2.5" data-testid="fish-mining-panel">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2 text-[11px]">
        <Pickaxe aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground"/>
        <span className="shrink-0 whitespace-nowrap font-medium">持续挖掘</span>
        <span className="truncate text-[10.5px] text-muted-foreground" title={rules.map(ruleText).join('；')}>默认算法并集 · {rules.map(ruleText).join(' · ')} · 从 {short(s.startMs)} 起每 12 小时一档</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <label className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">目标<input aria-label="挖掘目标条数" type="number" min="1" step="100" value={target ?? s.target} onChange={e => setTarget(e.target.value)} onBlur={applyTarget} onKeyDown={e => { if (e.key === 'Enter') applyTarget(); }} className="h-7 w-20 rounded-md border border-transparent bg-muted/50 px-2 font-mono text-[11px] tabular-nums outline-none hover:bg-muted focus-visible:border-ring/60"/>条</label>
        {s.enabled
          ? <button type="button" onClick={mining.pause} className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 px-2.5 text-[11px] hover:bg-muted"><Pause className="h-3 w-3"/>暂停</button>
          : <button type="button" onClick={mining.start} className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground hover:bg-primary/90"><Play className="h-3 w-3"/>{s.anchorsDone ? '继续挖掘' : '开始挖掘'}</button>}
      </div>
    </div>
    <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="挖掘进度" aria-valuemin={0} aria-valuemax={s.target} aria-valuenow={s.mined}><div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${share * 100}%` }}/></div>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10.5px] text-muted-foreground">
      <span className="font-mono tabular-nums text-foreground/80">已挖 {s.mined} / {s.target} 条 · 已扫 {s.anchorsDone} 档{s.lastAnchorMs != null ? ` · 扫到 ${short(s.lastAnchorMs)}` : ''}</span>
      <span role="status" className={s.lastError && !running ? 'text-destructive' : ''}>{status}</span>
    </div>
    {!sellFixed && <p className="text-[10.5px] text-amber-700 dark:text-amber-400">还没固定卖出方案：挖到的鱼会入舱并加入评估，但要在「1 · 比较卖出」里固定一套卖出方案后，才会生成探测比较战役。</p>}
    <p className="text-[10px] leading-relaxed text-muted-foreground">挖到的鱼直接进「鱼舱」（不算新鱼、不发邮件），同时加入鱼质量并自动勾选，按固定的卖出方案评估；同一段持续的信号只记第一次能发现的那一档，按那一档的捕捞时刻买入。捕捞时挖掘自动让路，空闲后接着挖。<a href={campaignHref} className="ml-1 whitespace-nowrap text-primary hover:underline">在交易战役查看探测比较 →</a></p>
  </div>;
}
