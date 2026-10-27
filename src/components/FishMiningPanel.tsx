/**
 * 「比较探测」的持续挖掘面板：默认探测算法（开始时冻结）从 2026-04-01 00:00 起每半天扫一档，
 * 挖到的鱼入鱼舱、进鱼质量，按固定的卖出方案评估后生成「探测比较」交易战役。
 */
import { useEffect, useState } from 'react';
import { ArrowUpRight, Pause, Pickaxe, Play, Settings2 } from 'lucide-react';
import { FishQualityInfo, FishQualityModule, qualityPauseAction, qualityPrimaryAction } from '@/components/FishQualityModule';
import type { FishMiningApi } from '@/hooks/useFishMining';
import { Popover,PopoverContent,PopoverTrigger } from '@/components/ui/popover';
import { FishMiningLibrary } from '@/components/FishMiningLibrary';
import type { TradeSignal } from '@/lib/signalLibrary';
import { currentDefaultRules, type FishMiningRule } from '@/lib/fish/mining';
import { formatUTC8 } from '@/lib/timeFormat';

const short = (t: number) => formatUTC8(t).slice(0, 16);
const RULE_NAMES: Record<string, string> = { cbi2: 'CBI-2', state: 'S', cba: 'CBA', 'drift-speed-z': 'az', bss: 'BSS' };
const ruleText = (r: FishMiningRule) => `${RULE_NAMES[r.featureId] ?? r.featureId}${r.statistic === '结果' ? '' : ` ${r.statistic.replace(/^avg_.*_2$/, 'avg₂').replace(/^avg_[^_]+$/, 'avg')}`} > ${r.threshold}`;
function MiningRuleEditor({mining,close}:{mining:FishMiningApi;close:()=>void}){
  const [draft,setDraft]=useState(()=>structuredClone(mining.state.rules.length?mining.state.rules:currentDefaultRules())),[error,setError]=useState('');
  const save=()=>{
    const invalid=draft.findIndex(rule=>!rule.threshold.trim()||!Number.isFinite(Number(rule.threshold))||!mining.ruleChoices?.find(c=>c.featureId===rule.featureId)?.statistics.some(s=>s.name===rule.statistic));
    if(invalid>=0){setError(`算法 ${invalid+1}：请选择有效统计量，并填写有限数字门槛`);return;}
    mining.configure?.(draft);close();
  };
  return <div className="space-y-3 text-[11px]"><p className="font-medium">挖掘条件 · 交集（全部同时满足）</p><p className="text-[10px] leading-relaxed text-muted-foreground">修改后从当前档继续，已挖进度和历史结果保留。命名序列读取原值；「结果」使用显示倍率，切换统计量时请核对门槛。</p>
    {draft.map((rule,i)=>{const choice=mining.ruleChoices?.find(c=>c.featureId===rule.featureId),valid=choice?.statistics.some(s=>s.name===rule.statistic);return <div key={rule.id} className="flex items-center gap-2"><span className="w-14 shrink-0">{choice?.label??rule.featureId}</span><select aria-label={`挖掘算法 ${i+1} 统计量`} className="h-7 min-w-0 flex-1 rounded bg-muted px-2" value={rule.statistic} onChange={e=>setDraft(draft.map((r,j)=>i===j?{...r,statistic:e.target.value}:r))}>{!valid&&<option value={rule.statistic}>{rule.statistic}（已失效）</option>}{choice?.statistics.map(s=><option key={s.name} value={s.name}>{s.label}</option>)}</select><span>&gt;</span><input aria-label={`挖掘算法 ${i+1} 门槛`} className="h-7 w-20 rounded bg-muted px-2 font-mono" type="number" step="any" value={rule.threshold} onChange={e=>setDraft(draft.map((r,j)=>i===j?{...r,threshold:e.target.value}:r))}/></div>;})}
    {error&&<p role="alert" className="text-destructive">{error}</p>}<button type="button" disabled={mining.running} onClick={save} className={qualityPrimaryAction}>保存并重试</button>
  </div>;
}
export function FishMiningPanel({ mining, sellFixed, campaignHref, onJump, canJump }: { mining: FishMiningApi; sellFixed: boolean; campaignHref: string; onJump?: (s: TradeSignal) => void; canJump?: (s: TradeSignal) => boolean }) {
  const { state: s, running, anchorMs, progress, waiting } = mining;
  const [target, setTarget] = useState<string | null>(null),[clock,setClock]=useState(Date.now),[settingsOpen,setSettingsOpen]=useState(false);
  useEffect(()=>{if(!s.enabled||running||!s.retryAt||s.retryAt<=Date.now())return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[s.enabled,s.retryAt,running]);
  const rules = s.rules.length ? s.rules : currentDefaultRules(), reached = s.mined >= s.target, now = Date.now();
  const caughtUp = !reached && s.cursorMs > now, share = Math.min(1, s.mined / s.target);
  const applyTarget = () => { const n = Number(target); if (Number.isInteger(n) && n > 0) mining.setTarget(n); setTarget(null); };
  const retryText=s.errorKind==='configuration'?'配置需修正后重新检查':s.retryAt?`${Math.max(0,Math.ceil((s.retryAt-clock)/1000))} 秒后原地重试（${short(s.retryAt)}）`:'2 分钟后原地重试';
  const hasStarted=!!(s.anchorsDone||s.rules.length||s.lastError);
  const status = running && anchorMs != null ? `正在挖 ${short(anchorMs)} 这一档${progress?.total ? `（${progress.done} / ${progress.total} 个标的）` : ''}`
    : !s.enabled ? (hasStarted ? `已暂停 · 继续后从 ${short(s.cursorMs)} 这一档接着挖` : '还没开始')
    : reached ? '已达目标：调高目标可继续往后挖'
    : caughtUp ? `已追上现在，下一档 ${short(s.cursorMs)} 到点自动挖`
    : waiting && /网络|正忙|标签页/.test(waiting) ? waiting
    : s.lastError ? `出错：${s.lastError}（${retryText}）`
    : waiting || `排队中：下一档 ${short(s.cursorMs)}`;
  const statusLabel = running ? '挖掘中' : !s.enabled ? hasStarted ? '已暂停' : '未开始'
    : reached ? '已达目标' : caughtUp ? '已追上现在' : s.errorKind==='configuration' ? '配置需处理' : s.lastError ? '等待重试' : waiting ? '等待中' : '排队中';
  const hasError = !!s.lastError && !running && !reached && !caughtUp;
  return <FishQualityModule title="批量挖掘" icon={Pickaxe} testId="fish-mining-panel" summary={<>
        <FishQualityInfo label="挖掘说明与进度">
          <div className="space-y-2.5">
            <div className="space-y-1"><p className="font-medium">当前进度</p><p className="font-mono tabular-nums text-muted-foreground">已挖 {s.mined} / {s.target} 条 · 已扫 {s.anchorsDone} 档{s.lastAnchorMs != null ? ` · 扫到 ${short(s.lastAnchorMs)}` : ''}</p><p className={hasError ? 'text-destructive' : 'text-muted-foreground'}>{status}</p></div>
            <div className="space-y-1 border-t border-border/50 pt-2.5"><p className="font-medium">当前挖掘算法 · 交集（全部同时满足）</p><p className="text-muted-foreground">{rules.map(ruleText).join(' · ')}</p><p className="text-muted-foreground">从 {short(s.startMs)} 起每 12 小时一档</p></div>
            <div className="space-y-1.5 border-t border-border/50 pt-2.5 text-muted-foreground">{!sellFixed && <p className="text-amber-700 dark:text-amber-400">还没固定卖出方案：挖到的鱼会入舱并加入列表，在卖出列的设置中固定一套方案后，才会按它比较各探测算法。</p>}<p>挖到的鱼直接进「鱼舱」（不算新鱼、不发邮件），同时加入鱼质量并自动勾选；点「开始过滤」或「开始监测」后，各自独立运行。</p><p>同一段持续的信号只记第一次能发现的那一档，按那一档的捕捞时刻买入。捕捞时挖掘自动让路，空闲后接着挖。</p><a href={campaignHref} className="inline-flex items-center gap-0.5 text-primary hover:underline">在交易战役查看<ArrowUpRight aria-hidden className="h-3 w-3"/></a></div>
          </div>
        </FishQualityInfo>
      </>} status={(running || hasError || s.enabled || hasStarted) &&
        <span role="status" aria-label={status} title={status} className={`inline-flex min-w-0 flex-wrap items-center gap-2 text-[10.5px] ${hasError ? 'text-destructive' : 'text-muted-foreground'}`}><span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'animate-pulse bg-primary' : hasError ? 'bg-destructive' : 'bg-muted-foreground/40'}`}/>{statusLabel}{hasError&&s.retryCount? <span>连续失败 {s.retryCount} 次{s.lastErrorAt?` · ${short(s.lastErrorAt)}`:''}</span>:null}<span className="font-mono text-muted-foreground">已挖 {s.mined}/{s.target} 条 · 已扫 {s.anchorsDone} 档</span>{!running&&<span className="basis-full break-words">{status}{hasError&&!status.includes(s.lastError)?`；上次失败：${s.lastError}`:''}</span>}{running && progress && progress.total > 0 && <span className="font-mono tabular-nums text-foreground/70" aria-label={`本档已扫 ${progress.done} / ${progress.total} 个标的`}>{progress.done}/{progress.total}</span>}</span>
      } progress={<div className="absolute inset-x-0 bottom-0 h-px overflow-hidden bg-border/60" role="progressbar" aria-label="挖掘进度" aria-valuemin={0} aria-valuemax={s.target} aria-valuenow={Math.min(s.mined, s.target)} aria-valuetext={`已挖 ${s.mined} 条，目标 ${s.target} 条`}><div className="h-full rounded-r-full bg-primary/70 transition-[width] duration-500" style={{ width: `${share * 100}%` }}/></div>}>
        {s.enabled
          ? <button type="button" onClick={mining.pause} className={qualityPauseAction}><Pause className="h-3 w-3"/>暂停</button>
          : <button type="button" onClick={mining.start} className={qualityPrimaryAction}><Play className="h-3 w-3"/>{s.anchorsDone ? '继续挖掘' : '开始挖掘'}</button>}
        {hasError&&<button type="button" disabled={running} onClick={mining.retry??mining.start} className={qualityPrimaryAction}>{s.errorKind==='configuration'?'重新检查':'立即重试'}</button>}
        {s.errorKind==='configuration'&&!running&&<><a href="/journal/deep-dig" className="text-[10.5px] text-primary hover:underline">检查算法定义</a>{mining.useCurrentScope&&<button type="button" onClick={mining.useCurrentScope} className="text-[10.5px] text-primary hover:underline" title="使用当前捕捞选择的交易所范围重新检查，保留已挖进度与原算法">更新为当前捕捞范围</button>}{mining.resetConfiguration&&<button type="button" onClick={mining.resetConfiguration} className="text-[10.5px] text-primary hover:underline" title="使用可用的默认挖掘算法和当前捕捞范围，保留已挖进度与全部历史结果">恢复默认挖掘条件</button>}</>}
        {mining.configure&&<Popover open={settingsOpen} onOpenChange={setSettingsOpen}><PopoverTrigger asChild><button type="button" disabled={running} className="inline-flex h-6 items-center gap-1 rounded px-2 text-[10.5px] text-muted-foreground hover:bg-muted disabled:opacity-40"><Settings2 className="h-3 w-3"/>挖掘条件</button></PopoverTrigger><PopoverContent align="start" className="w-[34rem] max-w-[calc(100vw-2rem)] max-h-[75vh] overflow-auto"><MiningRuleEditor key={JSON.stringify(s.rules)} mining={mining} close={()=>setSettingsOpen(false)}/></PopoverContent></Popover>}
        <label className="inline-flex h-7 items-center gap-1.5 px-2 text-[10.5px] text-muted-foreground">目标<input aria-label="挖掘目标条数" type="number" min="1" step="100" value={target ?? s.target} onChange={e => setTarget(e.target.value)} onBlur={applyTarget} onKeyDown={e => { if (e.key === 'Enter') applyTarget(); }} className="h-7 w-16 rounded-md border border-transparent bg-muted/50 px-1.5 font-mono text-[11px] tabular-nums outline-none hover:bg-muted focus-visible:border-ring/60"/>条</label>
        <FishMiningLibrary account={mining.account} holdKeys={mining.holdKeys} onJump={onJump} canJump={canJump}/>
        {s.ruleRepairs?.length ? <span className="basis-full text-[10px] text-muted-foreground" data-testid="mining-rule-repair">{s.ruleRepairs.at(-1)}</span>:null}
  </FishQualityModule>;
}
