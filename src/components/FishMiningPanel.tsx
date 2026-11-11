import type {FishDirectoryRequest} from './FishLibraryTimeDirectory';
import type {ReactNode} from 'react';
import type {FishQualityStudy} from '@/lib/fish/quality';
import { FishPopoverContent as PopoverContent } from '@/components/FishPopoverContent';
/**
 * 「比较探测」的持续挖掘面板：从所选起点逐档扫描，
 * 命中的信号入鱼舱、进鱼质量，按固定的卖出方案评估后生成「探测比较」交易战役。
 */
import { useEffect, useState } from 'react';
import { ArrowUpRight, ChevronDown, Pause, Pickaxe, Play, Plus, RotateCcw, Settings2, X } from 'lucide-react';
import { FishQualityInfo, FishQualityModule, qualityPauseAction, qualityPrimaryAction, qualitySettingsAction, qualitySplitPrimaryAction, qualitySplitPauseAction, qualitySplitMenuAction } from '@/components/FishQualityModule';
import type { FishMiningApi } from '@/hooks/useFishMining';
import { FishCheck } from './FishAlgorithmCard';
import { FishNumberField, FishScanScopeFields, FishScanWickFields } from './FishScanSettingsFields';
import { FishTurnoverSettingsFields } from './FishTurnoverSettings';
import { buildConfiguredMiningScan, continuousMiningSettings, copyCaptureToMining, copyHitRateToMining, initialMiningSettings, loadMiningSettings, readMiningSettings, saveMiningSettings, type FishMiningSettings } from '@/lib/fish/miningSettings';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FishMiningLibrary } from '@/components/FishMiningLibrary';
import type { TradeSignal } from '@/lib/signalLibrary';
import { currentDefaultRules, type FishMiningRule } from '@/lib/fish/mining';
import { formatUTC8 } from '@/lib/timeFormat';
import { parseFishSettings } from '@/lib/fishScanner';
import { FISH_MAX_ALGORITHMS } from '@/lib/fish/shared';

const short = (t: number) => formatUTC8(t).slice(0, 16);
const RULE_NAMES: Record<string, string> = { cbi2: 'CBI-2', state: 'S', cba: 'CBA', 'drift-speed': 'DSP·a', 'drift-speed-z': 'az', bss: 'BSS' };
const ruleText = (r: FishMiningRule) => `${RULE_NAMES[r.featureId] ?? r.featureId}${r.statistic === '结果' ? '' : ` ${r.statistic.replace(/^avg_.*_2$/, 'avg₂').replace(/^avg_[^_]+$/, 'avg')}`} ${r.direction ?? '>'} ${r.threshold}`;
type MiningEditorProps = { mining: FishMiningApi; close: () => void; restart?: boolean };

function MiningSettingsContent({ mining, ...editor }: MiningEditorProps) {
  const account = mining.account;
  const [load, setLoad] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; settings: FishMiningSettings }
  >({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [capture] = useState(mining.captureSelection);

  useEffect(() => {
    if (!account) return;
    const request = new AbortController();
    const timeout = setTimeout(() => request.abort(new Error('读取批量捕捞设置超时')), 15_000);
    let disposed = false;
    void loadMiningSettings(account, capture, request.signal).then(
      settings => { if (!disposed) setLoad({ status: 'ready', settings }); },
      error => { if (!disposed) setLoad({ status: 'error', message: error instanceof Error ? error.message : '读取批量捕捞设置失败' }); },
    ).finally(() => clearTimeout(timeout));
    return () => {
      disposed = true;
      request.abort();
      clearTimeout(timeout);
    };
  }, [account, attempt, capture]);

  if (!account || load.status === 'ready') {
    return <MiningRuleEditor {...editor} mining={mining} loaded={load.status === 'ready' ? load.settings : undefined}/>;
  }

  if (load.status === 'loading') {
    return <p role="status" className="px-4 py-5 text-xs text-muted-foreground">正在读取上次保存的批量捕捞设置…</p>;
  }

  const local = readMiningSettings(account);
  return <div className="space-y-3 px-4 py-5 text-xs">
    <p role="alert" className="text-destructive">{load.message}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={qualityPrimaryAction} onClick={() => {
        setLoad({ status: 'loading' });
        setAttempt(value => value + 1);
      }}>重试读取</button>
      {local && <button type="button" className={qualityPauseAction}
        onClick={() => setLoad({ status: 'ready', settings: local })}>使用本机已保存设置</button>}
    </div>
  </div>;
}

function MiningRuleEditor({ mining, close, restart = false, loaded }: MiningEditorProps & { loaded?: FishMiningSettings }) {
  const capture = mining.captureSelection;
  const [settings, setSettings] = useState(() => loaded ?? readMiningSettings() ?? initialMiningSettings(mining.state, capture));
  const [draft, setDraft] = useState(settings.rules);
  const [target, setTarget] = useState(String(settings.target));
  const [error, setError] = useState('');
  const [copiedFrom, setCopiedFrom] = useState<'捕捞' | '捕捞质量'>();
  const [startTime, setStartTime] = useState(() => short(mining.state.startMs).replace(' ', 'T'));
  const [endTime,setEndTime]=useState(()=>short(mining.state.endMs??Date.now()).replace(' ','T'));
  const copySettings = (source: '捕捞' | '捕捞质量') => {
    const current = { ...settings, rules: draft };
    try {
      const copied = source === '捕捞' ? copyCaptureToMining(current, capture) : copyHitRateToMining(current);
      setSettings(copied);
      setDraft(copied.rules);
      setCopiedFrom(source);
      setError('');
    } catch (cause) {
      setCopiedFrom(undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const choices=(mining.ruleChoices??[]).filter(c=>c.statistics.length>0);
  const save=()=>{
    const count=Number(target);if(!Number.isSafeInteger(count)||count<=0){setError('目标条数必须是正整数');return;}
    if (!draft.length || draft.length > FISH_MAX_ALGORITHMS) { setError(`请选择 1 至 ${FISH_MAX_ALGORITHMS} 个算法`); return; }
    const invalid = draft.findIndex(rule => rule.enabled !== false && (!rule.threshold.trim() || !Number.isFinite(Number(rule.threshold))
      || !choices.find(choice => choice.featureId === rule.featureId)?.statistics.some(statistic => statistic.name === rule.statistic)));
    if (invalid >= 0) { setError(`算法 ${invalid + 1}：请选择有效统计量，并填写有限数字门槛`); return; }
    let configured;
    try {
      configured = continuousMiningSettings({ ...settings, target: count, rules: draft });
      buildConfiguredMiningScan(configured, mining.defs);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    if (restart) {
      let startMs: number | undefined;
      try { startMs = parseFishSettings(startTime, '0').anchorMs; } catch { /* Show the error beside the form. */ }
      if (startMs === undefined || startMs > Date.now()) {
        setError('请选择有效且不晚于现在的扫描起点（北京时间）');
        return;
      }
      let endMs:number|undefined;
      try{endMs=parseFishSettings(endTime,'0').anchorMs;}catch{/* Keep the draft visible. */}
      if(endMs===undefined||endMs<=startMs||endMs>Date.now()){setError('请选择晚于扫描起点且不晚于现在的扫描结束时间（北京时间）');return;}
      mining.restart({ startMs, endMs, target: count, rules: draft, settings: configured });
    } else saveMiningSettings(configured, mining.account);
    close();
  };
  return <div className="flex min-h-0 flex-1 flex-col text-[11px]" data-testid="mining-rule-editor"><div className="shrink-0 space-y-3 px-4 pb-3 pt-4"><div className="flex items-center justify-between gap-2"><p className="font-medium">目标与时间</p><FishQualityInfo label="批量捕捞条件说明"><p>交集须所有启用的算法达标，并集满足任一算法即可。</p><p>新选指标只列出算法已有的原值、avg、avg_2。旧规则保存的其他指标继续保留，切换指标时请核对门槛。</p></FishQualityInfo></div>{restart && <label className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
      扫描起点（北京时间）
      <input type="datetime-local" value={startTime} max={short(Date.now()).replace(' ', 'T')} onChange={e=>setStartTime(e.target.value)} className="h-7 max-w-full rounded-md border border-border/60 bg-muted/50 px-2 font-mono"/>
    </label>}{restart&&<label className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">扫描结束（北京时间）<input type="datetime-local" aria-label="扫描结束（北京时间）" value={endTime} min={startTime} max={short(Date.now()).replace(' ','T')} onChange={e=>setEndTime(e.target.value)} className="h-7 max-w-full rounded-md border border-border/60 bg-muted/50 px-2 font-mono"/></label>}<label className="flex items-center justify-between gap-3 text-muted-foreground">目标条数<span className="inline-flex items-center gap-2"><input aria-label="批量捕捞目标条数" type="number" min="1" step="100" value={target} onChange={e=>setTarget(e.target.value)} className="h-7 w-24 rounded-md border border-border/60 bg-muted/50 px-2 font-mono tabular-nums outline-none focus-visible:border-ring"/>条</span></label></div>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-3" data-testid="mining-rule-scroll">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 font-medium">算法组合
          <select className="h-7 rounded-md border border-border/60 bg-muted/40 px-2" value={settings.scan.combination}
            onChange={event => setSettings({ ...settings, scan: { ...settings.scan, combination: event.target.value as 'and' | 'or' } })}>
            <option value="and">交集</option><option value="or">并集</option>
          </select>
        </label>
        <div role="group" aria-label="复制设置" className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="rounded-md border border-border/70 px-2 py-1 hover:bg-muted"
            onClick={() => copySettings('捕捞')}>复制已保存的捕捞条件</button>
          <button type="button" className="rounded-md border border-border/70 px-2 py-1 hover:bg-muted"
            onClick={() => copySettings('捕捞质量')}>复制捕捞质量设置</button>
        </div>
      </div>
      {copiedFrom && <p role="status" className="text-muted-foreground">
        已从{copiedFrom}填入草稿。{copiedFrom === '捕捞质量' && '每档回看使用样本前后时长之和。'}
      </p>}
    {draft.map((rule,i)=>{const choice=mining.ruleChoices?.find(c=>c.featureId===rule.featureId),valid=choice?.statistics.some(s=>s.name===rule.statistic),menu=choice?.menuStatistics??choice?.statistics??[];return <div key={rule.id} className="flex flex-wrap items-center gap-1.5">
      <FishCheck aria-label={`启用批量捕捞算法 ${i+1}`} checked={rule.enabled!==false}
        onChange={event=>setDraft(draft.map((r,j)=>i===j?{...r,enabled:event.target.checked}:r))}/>
      <select aria-label={`批量捕捞算法 ${i+1} 特征值`} className="h-7 w-28 min-w-0 rounded bg-muted px-2" value={rule.featureId} onChange={e=>{setError('');setDraft(draft.map((r,j)=>i===j?{...r,featureId:e.target.value,statistic:choices.find(c=>c.featureId===e.target.value)?.menuStatistics?.[0]?.name??'结果',threshold:''}:r));}}>
        {!choices.some(c=>c.featureId===rule.featureId)&&<option value={rule.featureId}>{rule.featureId}（已失效）</option>}{choices.map(c=><option key={c.featureId} value={c.featureId}>{c.label}</option>)}
      </select>
      <select aria-label={`批量捕捞算法 ${i+1} 统计量`} className="h-7 min-w-0 flex-1 rounded bg-muted px-2" value={rule.statistic} onChange={e=>setDraft(draft.map((r,j)=>i===j?{...r,statistic:e.target.value}:r))}>{!menu.some(s=>s.name===rule.statistic)&&<option hidden disabled value={rule.statistic}>{rule.statistic}（{valid?'已保存指标':'已失效'}）</option>}{menu.map(s=><option key={s.name} value={s.name}>{s.label}</option>)}</select><select aria-label={`批量捕捞算法 ${i+1} 方向`} className="h-7 rounded bg-muted px-1" value={rule.direction??'>'}
        onChange={event=>setDraft(draft.map((r,j)=>i===j?{...r,direction:event.target.value as '>' | '<'}:r))}>
        <option value=">">&gt;</option><option value="<">&lt;</option>
      </select><input aria-label={`批量捕捞算法 ${i+1} 门槛`} className="h-7 w-20 rounded bg-muted px-2 font-mono" type="number" step="any" value={rule.threshold} onChange={e=>setDraft(draft.map((r,j)=>i===j?{...r,threshold:e.target.value}:r))}/>
      <button type="button" aria-label={`移除批量捕捞算法 ${i+1}`} disabled={draft.length<=1} onClick={()=>setDraft(draft.filter((_,j)=>j!==i))} className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground disabled:opacity-30"><X aria-hidden className="h-3 w-3"/></button>
    </div>;})}
      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset className="min-w-0 rounded-md border border-border/60 px-3 pb-3">
          <legend className="px-1 font-medium">来源市场</legend>
          <FishScanScopeFields value={settings.selection} onChange={selection=>setSettings({...settings,selection})}/>
        </fieldset>
        <fieldset className="min-w-0 space-y-2 rounded-md border border-border/60 px-3 pb-3">
          <legend className="px-1 font-medium">连续扫描</legend>
          <FishNumberField label="每档回看（小时）" value={settings.scan.lookbackHours ?? NaN}
            onChange={hours => setSettings({ ...settings, scan: { ...settings.scan, lookbackHours: Number.isNaN(hours) ? null : hours } })}/>
          <p className="text-muted-foreground">收录回看范围内起步、截止时仍达标的信号。留空时沿用算法的历史范围。</p>
        </fieldset>
      </div>
      <fieldset className="space-y-2 rounded-md border border-border/60 px-3 pb-3">
        <legend className="px-1 font-medium">插针过滤</legend>
        <FishScanWickFields value={settings.scan.downwardWick} onChange={downwardWick=>setSettings({...settings,scan:{...settings.scan,downwardWick}})}/>
      </fieldset>
      <fieldset className="rounded-md border border-border/60 px-3 pb-3">
        <legend className="px-1 font-medium">成交额门槛 <span className="font-normal text-muted-foreground">（USDT）</span></legend>
        <FishTurnoverSettingsFields value={settings.scan.turnover} onChange={turnover=>setSettings({...settings,scan:{...settings.scan,turnover}})}/>
      </fieldset>
    </div>
    <div className="shrink-0 space-y-2 border-t border-border/50 bg-popover px-4 py-3" data-testid="mining-rule-actions">{error&&<p role="alert" className="text-destructive">{error}</p>}<div className="flex flex-wrap items-center justify-between gap-2">
    <button type="button" disabled={draft.length>=FISH_MAX_ALGORITHMS||!choices.length} onClick={()=>setDraft([...draft,{id:`mining-rule-${crypto.randomUUID()}`,featureId:choices[0].featureId,statistic:choices[0].menuStatistics?.[0]?.name??'结果',threshold:''}])} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Plus aria-hidden className="h-3 w-3"/>新增批量捕捞算法</button>
    <button type="button" onClick={()=>{setDraft(currentDefaultRules());setError('');}} className="rounded px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">恢复默认算法</button>
    <div className="ml-auto flex gap-2">
      <button type="button" onClick={close} className={qualityPauseAction}>取消</button>
      <button type="button" onClick={save} className={qualityPrimaryAction}>{restart ? '开始新一轮' : '保存设置'}</button>
    </div></div></div>
  </div>;
}
export function FishMiningPanel({ mining, sellFixed, campaignHref, onJump, canJump, onSelectInTable,renderStudy,onCopyStudy,directoryEdits,onSetHidden,openRequest,onSelectDirectory }: { openRequest?:FishDirectoryRequest;onSelectDirectory?:(id:string,s:FishQualityStudy,ids?:string[])=>Promise<boolean>;directoryEdits?:Record<string,{hidden:boolean;at:number}>;onSetHidden?:(id:string,hidden:boolean)=>Promise<boolean>;renderStudy?:(s:FishQualityStudy)=>ReactNode;onCopyStudy?:(s:FishQualityStudy)=>Promise<boolean>;mining: FishMiningApi; sellFixed: boolean; campaignHref: string; onJump?: (s: TradeSignal) => void; canJump?: (s: TradeSignal) => boolean; onSelectInTable?: (signals: readonly TradeSignal[]) => boolean }) {
  const { state: s, running, anchorMs, progress, waiting } = mining;
  const [clock,setClock]=useState(Date.now),[profileOpen,setProfileOpen]=useState(false),[restartOpen,setRestartOpen]=useState(false),[runMenuOpen,setRunMenuOpen]=useState(false);
  useEffect(()=>{if(!s.enabled||running||!s.retryAt||s.retryAt<=Date.now())return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[s.enabled,s.retryAt,running]);
  const rules = s.rules.length ? s.rules : currentDefaultRules(), reached = s.mined >= s.target, now = Date.now();
  const rangeComplete=s.endMs!=null&&s.cursorMs>s.endMs;
  const caughtUp = !reached && !rangeComplete && s.cursorMs > now, share = Math.min(1, s.mined / s.target);
  const retryText=s.errorKind==='configuration'?'配置需修正后重新检查':s.retryAt?`${Math.max(0,Math.ceil((s.retryAt-clock)/1000))} 秒后原地重试（${short(s.retryAt)}）`:'2 分钟后原地重试';
  const hasStarted=!!(s.anchorsDone||s.rules.length||s.lastError);
  const status = running && anchorMs != null ? `正在挖 ${short(anchorMs)} 这一档${progress?.total ? `（${progress.done} / ${progress.total} 个标的）` : ''}`
    : rangeComplete ? '已完成所选时间区间；历史结果已保留，重新开始可设置新的起止时间'
    : !s.enabled ? (hasStarted ? `已暂停 · 继续后从 ${short(s.cursorMs)} 这一档接着挖` : '还没开始')
    : reached ? '已达目标：可重新开始新一轮'
    : caughtUp ? `已追上现在，下一档 ${short(s.cursorMs)} 到点自动挖`
    : waiting && /网络|正忙|标签页|限频/.test(waiting) ? waiting
    : s.lastError ? `出错：${s.lastError}（${retryText}）`
    : waiting || `排队中：下一档 ${short(s.cursorMs)}`;
  const statusLabel = running ? '捕捞中' : rangeComplete?'区间已完成': !s.enabled ? hasStarted ? '已暂停' : '未开始'
    : reached ? '已达目标' : caughtUp ? '已追上现在' : s.errorKind==='configuration' ? '配置需处理' : waiting ? (/限频/.test(waiting)?'限频等待':'等待中') : s.lastError ? '等待重试' : '排队中';
  const hasError = !!s.lastError && !running && !reached && !caughtUp && !rangeComplete;
  return <FishQualityModule title="批量捕捞" icon={Pickaxe} testId="fish-mining-panel" summary={<>
        <FishQualityInfo label="批量捕捞说明与进度">
          <div className="space-y-2.5">
            <div className="space-y-1"><p className="font-medium">当前进度</p><p className="font-mono tabular-nums text-muted-foreground">已捕捞 {s.mined} / {s.target} 条 · 已扫 {s.anchorsDone} 档{s.lastAnchorMs != null ? ` · 扫到 ${short(s.lastAnchorMs)}` : ''}</p><p className={hasError ? 'text-destructive' : 'text-muted-foreground'}>{status}</p>{hasError&&s.retryCount?<p className="text-destructive">连续失败 {s.retryCount} 次{s.lastErrorAt?` · ${short(s.lastErrorAt)}`:''}</p>:null}{s.ruleRepairs?.length?<p className="text-muted-foreground" data-testid="mining-rule-repair">{s.ruleRepairs.at(-1)}</p>:null}</div>
            <div className="space-y-1 border-t border-border/50 pt-2.5"><p className="font-medium">当前批量捕捞算法 · {s.scan?.combination==='and'?'交集（全部满足）':'并集（任一满足即命中）'}</p><p className="text-muted-foreground">{rules.filter(rule=>rule.enabled!==false).map(ruleText).join(' · ')}</p><p className="text-muted-foreground">从 {short(s.startMs)} {s.endMs!=null?`至 ${short(s.endMs)}`:'起'}{s.scan?.continuous ? '连续扫描' : `每 ${s.stepMs / 3_600_000} 小时一档`}</p></div>
            <div className="space-y-1.5 border-t border-border/50 pt-2.5 text-muted-foreground">{!sellFixed && <p className="text-amber-700 dark:text-amber-400">还没固定卖出方案：命中的信号会入舱并加入列表，在卖出列的设置中固定一套方案后，才会按它比较各探测算法。</p>}<p>命中的信号直接进「鱼舱」（不算新鱼、不发邮件），同时加入鱼质量并自动勾选；点「开始过滤」或「开始监测」后，各自独立运行。</p><p>同一段持续的信号只记第一次能发现的那一档，以该档的历史时间模拟买入。普通捕捞运行时，批量捕捞会等到空闲再继续。</p><p>开始按钮右侧的 ▾ 中可选「重新开始」，设置起止时间后开始新一轮。捕捞库按 CDA、BSS、CBI-2 等算法家族分目录，目录使用组合表的形式。</p><a href={campaignHref} className="inline-flex items-center gap-0.5 text-primary hover:underline">在交易战役查看<ArrowUpRight aria-hidden className="h-3 w-3"/></a></div>
          </div>
        </FishQualityInfo>
      </>} progress={<div className="absolute inset-x-0 bottom-0 h-px overflow-hidden bg-border/60" role="progressbar" aria-label="批量捕捞进度" aria-valuemin={0} aria-valuemax={s.target} aria-valuenow={Math.min(s.mined, s.target)} aria-valuetext={`已捕捞 ${s.mined} 条，目标 ${s.target} 条`}><div className="h-full rounded-r-full bg-primary/70 transition-[width] duration-500" style={{ width: `${share * 100}%` }}/></div>}>
        <div role="group" aria-label="批量捕捞运行" className="inline-flex h-6 shrink-0 items-stretch">
          {s.enabled
            ? <button type="button" onClick={mining.pause} className={qualitySplitPauseAction}><Pause className="h-3 w-3"/>暂停</button>
            : <button type="button" disabled={rangeComplete || reached} onClick={mining.start} aria-label={rangeComplete || reached ? undefined : s.anchorsDone ? '继续批量捕捞' : '开始批量捕捞'} className={qualitySplitPrimaryAction}><Play className="h-3 w-3"/>{rangeComplete?'区间已完成':reached?'已达目标':s.anchorsDone ? '继续捕捞' : '开始捕捞'}</button>}
          <Popover open={runMenuOpen} onOpenChange={setRunMenuOpen}><PopoverTrigger asChild><button type="button" aria-label="开始批量捕捞的其他方式" className={`${qualitySplitMenuAction} ${s.enabled?'border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground':'border-primary/25 bg-primary/10 text-primary hover:border-primary/45 hover:bg-primary/20'}`}><ChevronDown aria-hidden className="h-3 w-3"/></button></PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1"><button type="button" aria-label="重新开始" className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-muted" onClick={()=>{setRunMenuOpen(false);setRestartOpen(true);}}><span className="inline-flex items-center gap-1.5 text-[11px] font-medium"><RotateCcw aria-hidden className="h-3 w-3"/>重新开始</span><span className="text-[10px] leading-relaxed text-muted-foreground">设置时间区间和条件，历史结果保留在捕捞库。</span></button></PopoverContent>
          </Popover>
        </div>
        <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
          <DialogTrigger asChild><button type="button" aria-label="批量捕捞设置" className={qualitySettingsAction}><Settings2 className="h-3 w-3"/>捕捞设置</button></DialogTrigger>
          <DialogContent className="flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
            <DialogHeader className="shrink-0 border-b border-border/50 px-4 pb-3 pt-4 pr-10 text-left">
              <DialogTitle className="text-sm">批量捕捞设置</DialogTitle>
              <DialogDescription className="text-xs">保存后用于开始新一轮。继续捕捞会从上次进度接着扫描。</DialogDescription>
            </DialogHeader>
            <MiningSettingsContent key={mining.account} mining={mining} close={()=>setProfileOpen(false)}/>
          </DialogContent>
        </Dialog>
        <Dialog open={restartOpen} onOpenChange={setRestartOpen}>
          <DialogContent className="flex max-h-[80dvh] w-[calc(100%-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
            <DialogHeader className="shrink-0 border-b border-border/50 px-4 pb-3 pt-4 pr-10 text-left">
              <DialogTitle className="text-sm">重新开始批量捕捞</DialogTitle>
              <DialogDescription className="text-xs">开始后会结束当前轮次，新一轮计数从 0 开始。到达结束时间或目标条数后停止，历史结果保留在捕捞库。</DialogDescription>
            </DialogHeader>
            <MiningSettingsContent key={mining.account} mining={mining} close={()=>setRestartOpen(false)} restart/>
          </DialogContent>
        </Dialog>
        <FishMiningLibrary openRequest={openRequest} onSelectDirectory={onSelectDirectory} directoryEdits={directoryEdits} onSetHidden={onSetHidden} renderStudy={renderStudy} onCopyStudy={onCopyStudy} account={mining.account} holdKeys={mining.holdKeys} onJump={onJump} canJump={canJump} onSelectInTable={onSelectInTable}/>
        {(running||hasError||s.enabled||hasStarted)&&<span role="status" aria-label={status} title={status} className={`ml-1 inline-flex items-center gap-2 whitespace-nowrap text-[10px] ${hasError?'text-destructive':'text-muted-foreground'}`}><span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${running?'animate-pulse bg-primary':hasError?'bg-destructive':'bg-muted-foreground/40'}`}/>{statusLabel}<span className="font-mono tabular-nums">{s.mined}/{s.target}</span>{running&&progress&&progress.total>0&&<span className="font-mono tabular-nums" aria-label={`本档已扫 ${progress.done} / ${progress.total} 个标的`}>{progress.done}/{progress.total}</span>}</span>}

        {hasError&&<button type="button" disabled={running} onClick={mining.retry??mining.start} className={qualityPrimaryAction}>{s.errorKind==='configuration'?'重新检查':'立即重试'}</button>}
        {s.errorKind==='configuration'&&!running&&<><a href="/journal/deep-dig" className="text-[10.5px] text-primary hover:underline">检查算法定义</a>{!s.scan&&mining.useCurrentScope&&<button type="button" onClick={mining.useCurrentScope} className="text-[10.5px] text-primary hover:underline" title="使用当前捕捞选择的交易所范围重新检查，保留已挖进度与原算法">更新为当前捕捞范围</button>}{!s.scan&&mining.resetConfiguration&&<button type="button" onClick={mining.resetConfiguration} className="text-[10.5px] text-primary hover:underline" title="使用可用的默认批量捕捞算法和当前捕捞范围，保留已挖进度与全部历史结果">恢复默认挖掘条件</button>}</>}
  </FishQualityModule>;
}
