import {getUserPrefix} from '@/lib/userStoragePrefix';
import { useFishFeatures } from '@/hooks/useFishFeatures';
import {compileFishProgram,parseFishConstraint,FISH_PRESETS,type FishConstraint} from '@/lib/fish/algorithm';
import {readFishPreference,saveFishPreference,type FishPreference} from '@/lib/fish/preferences';
import { fishRuleText } from '@/lib/fishRule';
import { useEffect, useMemo, useState } from 'react';
import { AUDITED_EXCHANGES, EXCHANGE_NAMES, type FishExchange } from '@/lib/fish/exchanges';
import { CircleHelp, Search, SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TradeSignal } from '@/lib/signalLibrary';
import { parseFishSettings, type FishScanSettings, type FishProgress, type FishDiagnosis } from '@/lib/fishScanner';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { FishAlgorithmSettings } from '@/lib/fish/algorithm';
import { formatUTC8 } from '@/lib/timeFormat';
import { FishLibrary } from '@/components/FishLibrary';

export interface FishPanelProps {
  /** 查单个币：与捕捞同一套取数与判定，说明命中 / 没命中的原因。 */
  onDiagnose?: (options: { symbol: string; exchange?: FishExchange; anchorMs?: number; feature?: DeepDigFeatureDef; algorithm?: FishAlgorithmSettings; signal: AbortSignal }) => Promise<FishDiagnosis>;
  signals: TradeSignal[]; progress: FishProgress | null;
  inputs: { time: string; threshold: string }; onInputsChange: (value: { time: string; threshold: string }) => void;
  selection: { exchanges: FishExchange[]; includeDuplicates: boolean; includeUsStocks?: boolean }; onSelectionChange: (value: { exchanges: FishExchange[]; includeDuplicates: boolean; includeUsStocks?: boolean }) => void;
  onStart: (settings: FishScanSettings) => void; onCancel: () => void; onAdd: (target?: string | readonly string[]) => void;
  onJump: (id: string) => void; onDelete: (id: string) => void; onRate: (id: string, value: number) => void;
  jumpingSignalId: string | null; tradedDayIndex: Set<string>; campaignDayIndex: Set<string>;
}
/**
 * 【用户要求】2026-10-19「渔这里，界面要简单一点，只用显示命中以及加载进度，其他的都折叠收起来，用非常隐形的符号做入口」：
 * 平时只有一行设置 + 一行「状态 · 命中 · 进度」；交易所勾选收在淡色滑杆图标后（展开状态记在这次浏览里）。
 * 2026-10-19 用户又要求删掉进度旁的「›」明细入口：各家计数与跳过原因不再显示，只在整次扫描失败时写出报错。
 */
const OPEN_KEY = 'veil.fish.open';
function readOpen(): { scope: boolean; detail: boolean; probe: boolean } {
  try { const v = JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? '{}'); return { scope: !!v.scope, detail: !!v.detail, probe: !!v.probe }; } catch { return { scope: false, detail: false, probe: false }; }
}
const faint = 'rounded p-1 text-muted-foreground/40 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const STATUS: Record<FishProgress['status'], string> = { running: '捕捞中', complete: '捕捞完成', cancelled: '已取消', aborted: '已中止', skipped: '已跳过' };

export function FishPanel(p: FishPanelProps) {
  const [error,setError]=useState(''),defs=useFishFeatures();
  const [open, setOpenState] = useState(readOpen);
  const setOpen = (patch: Partial<{ scope: boolean; detail: boolean; probe: boolean }>) => setOpenState(o => {
    const next = { ...o, ...patch };
    try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* 记不住只是下次要再点 */ }
    return next;
  });

  const owner=getUserPrefix();
  useEffect(()=>setPref(readFishPreference(selected)),[owner]);
  const [selected,setSelected]=useState('cbi2'),[pref,setPref]=useState<FishPreference>(()=>readFishPreference('cbi2'));
  const [constraintsOpen,setConstraintsOpen]=useState(false);
  const listedDef=defs.find(d=>d.id===selected)??defs.find(d=>d.id==='cbi2')??defs[0];
  // 【用户要求】2026-10-19「保证内在统一」：渔与 K 线图、Deep dig 读同一份定义，没有「内置 / Deep dig」之分
  const def=listedDef;
  const [probe,setProbe]=useState<{symbol:string;exchange:FishExchange;busy:boolean;result:FishDiagnosis|null}>({symbol:'',exchange:'binance',busy:false,result:null});
  useEffect(()=>{if(def&&selected!==def.id){setSelected(def.id);setPref(readFishPreference(def.id));}},[def?.id,selected]);
  const update=(next:FishPreference)=>{if(!def)return;setPref(next);saveFishPreference(def.id,next);setError('');};
  const {exchanges,includeDuplicates,includeUsStocks=true}=p.selection,running=p.progress?.status==='running';
  const options=useMemo(()=>defs.map(d=>{try{const x=compileFishProgram(d,{H:24,direction:'>',threshold:d.id==='cbi2'?.3:0,constraints:[]});return {def:d,reason:x.unavailable};}catch(e){return {def:d,reason:e instanceof Error?e.message:String(e)};}}),[defs]);
  const compiled=useMemo(()=>{try{if(!def)throw new Error('Deep dig 里没有可用特征值');const plan=compileFishProgram(def,{H:pref.H.trim()?Number(pref.H):NaN,direction:pref.direction,threshold:pref.threshold.trim()?Number(pref.threshold):NaN,constraints:pref.constraints});return {plan,error:plan.unavailable??''};}catch(e){return {plan:null,error:e instanceof Error?e.message:String(e)};}},[def,pref]);
  const runProbe=async()=>{
    if(!p.onDiagnose||!probe.symbol.trim())return;
    let anchorMs:number|undefined;
    try{anchorMs=parseFishSettings(p.inputs.time,pref.threshold||'0').anchorMs;}catch(e){setProbe(v=>({...v,result:{outcome:'failed',lines:[e instanceof Error?e.message:String(e)]}}));return;}
    if(!compiled.plan||compiled.error){setProbe(v=>({...v,result:{outcome:'failed',lines:[compiled.error||'算法设置有误']}}));return;}
    setProbe(v=>({...v,busy:true,result:null}));
    try{const result=await p.onDiagnose({symbol:probe.symbol,exchange:probe.exchange,anchorMs,feature:compiled.plan.def,algorithm:compiled.plan.settings,signal:new AbortController().signal});setProbe(v=>({...v,busy:false,result}));}
    catch(e){setProbe(v=>({...v,busy:false,result:{outcome:'failed',lines:[e instanceof TypeError?'浏览器拦截（网络 / 跨域）':e instanceof Error?e.message:String(e)]}}));}
  };
  const rowErrors=useMemo(()=>pref.constraints.map(c=>{try{if(def)parseFishConstraint(def,c.text);return '';}catch(e){return e instanceof Error?e.message:String(e);}}),[def,pref.constraints]);
  const active=pref.constraints.filter(c=>c.enabled),plan=compiled.plan;
  const start=()=>{try{const settings=parseFishSettings(p.inputs.time,pref.threshold);if(!exchanges.length)throw new Error('请至少选择一家交易所');if(!plan||compiled.error)throw new Error(compiled.error);setError('');p.onStart({...settings,feature:plan.def,algorithm:plan.settings,exchanges:[...exchanges],includeDuplicates,includeUsStocks});}catch(e){setError(e instanceof Error?e.message:String(e));}};
  const changeConstraint=(i:number,patch:Partial<FishConstraint>)=>update({...pref,constraints:pref.constraints.map((c,j)=>j===i?{...c,...patch}:c)});
  const addConstraints=(lines:string[])=>{update({...pref,constraints:[...pref.constraints,...lines.map((text,i)=>({id:`${Date.now()}-${pref.constraints.length+i}`,text,enabled:true}))]});setConstraintsOpen(true);};
  const fresh = useMemo(() => p.signals.filter(s => s.freshCatch), [p.signals]);
  const old = useMemo(() => p.signals.filter(s => !s.freshCatch), [p.signals]);
  const btn = 'rounded border border-border/60 px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40';
  const x = p.progress;

  return <section className="mt-2 space-y-2 rounded border border-border/60 bg-background p-3" aria-label="渔" data-testid="fish-panel">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px]">
      <div className="flex items-center gap-1"><strong className="text-xs">渔</strong><Popover><PopoverTrigger asChild><button type="button" aria-label="捕捞说明" className="p-1 text-muted-foreground/40 hover:text-muted-foreground"><CircleHelp className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] space-y-2 p-3 text-[11px] leading-relaxed" aria-label="捕捞说明">
        <p>算法与 Deep dig 共用定义，包含修改后的内置项和自定义项。avg 的 H 按小时；阈值和 X 用显示单位，其余公式变量保持原值。只扫本轮选定的一种算法。</p>
        <p>时间按 UTC+8，留空用币安服务器当前时间。共同截止向下取整至特征值周期，仅用已收盘K线。起点是主条件和全部启用约束同时连续成立的第一根收盘时刻；此前须有一根已知为假。截止未知计读数不全，回溯遇未知计起点不明。</p>
        <p>预计耗时按币安每分钟1200权重估算K线请求，不含其它交易所逐笔分页；各家原生K线分页上限不同。历史超出保留期整家跳过。只有用到BTC才取参考价，参考缺根则整轮中止。</p>
        <p>默认排除较高优先级交易所已上线的基础币。鱼与新鱼按算法分别去重；加入信号库仍按信号库自身规则合并。设置只保存在本机，捕捞开始后锁定。</p>
        {x?.anchorMs&&<p>本轮节点：{formatUTC8(x.anchorMs)}</p>}{x?.cutoffMs&&<p>本轮阈值 {plan?.settings.direction??'>'} {x.threshold??.3}</p>}
      </PopoverContent></Popover></div>
      <select aria-label="捕捞算法" className="max-w-[19rem] rounded border border-border/60 bg-background px-1.5 py-1" disabled={running} value={def?.id??''} onChange={e=>{setSelected(e.target.value);setPref(readFishPreference(e.target.value));setError('');}}>{options.map(o=><option key={o.def.id} value={o.def.id} disabled={!!o.reason}>{o.def.short} · {o.def.name}{o.reason?`（${o.reason}）`:''}</option>)}</select>
      <label className="flex items-center gap-1">avg<input aria-label="捕捞平均时长" type="number" min="0" step="any" className="w-14 rounded border border-border/60 bg-transparent px-1.5 py-1 font-mono" disabled={running} value={pref.H} onChange={e=>update({...pref,H:e.target.value})}/>h</label>
      <label className="flex items-center gap-1">阈值<select aria-label="捕捞方向" className="rounded border border-border/60 bg-background px-1 py-1" disabled={running} value={pref.direction} onChange={e=>update({...pref,direction:e.target.value as '>'|'<'})}><option value=">">&gt;</option><option value="<">&lt;</option></select><input aria-label="捕捞阈值" type="number" step="any" className="w-20 rounded border border-border/60 bg-transparent px-1.5 py-1 font-mono" value={pref.threshold} disabled={running} onChange={e=>{update({...pref,threshold:e.target.value});p.onInputsChange({...p.inputs,threshold:e.target.value});}}/>{def?.unit}</label>
      <label className="flex items-center gap-1 text-muted-foreground">时间（UTC+8）<input aria-label="捕捞时间（UTC+8）" placeholder="YYYY-MM-DD HH:mm:ss" className="w-44 rounded border border-border/60 bg-transparent px-1.5 py-1 font-mono text-foreground" value={p.inputs.time} disabled={running} onChange={e=>{setError('');p.onInputsChange({...p.inputs,time:e.target.value});}}/></label>
      <div className="flex gap-1"><button type="button" className={btn} disabled={running||!!compiled.error} onClick={start}>开始捕捞</button><button type="button" className={btn} disabled={!running} onClick={p.onCancel}>取消</button></div>
      <button type="button" aria-label="捕捞范围" aria-expanded={open.scope} title={`捕捞范围：${exchanges.map(e => EXCHANGE_NAMES[e]).join('、') || '未选交易所'}${includeDuplicates ? '（含重复币）' : ''}`} onClick={() => setOpen({ scope: !open.scope })} className={`${faint} ${open.scope ? 'text-muted-foreground' : ''}`}>
        <SlidersHorizontal className="h-3 w-3" />
      </button>
      {p.onDiagnose&&<button type="button" aria-label="查单个币" aria-expanded={open.probe} title="查单个币：按当前设置与时间，看它为什么命中 / 没命中" onClick={() => setOpen({ probe: !open.probe })} className={`${faint} ${open.probe ? 'text-muted-foreground' : ''}`} data-testid="fish-probe-toggle">
        <Search className="h-3 w-3" />
      </button>}
    </div>
    <div className="text-[11px]"><button type="button" className="text-muted-foreground hover:text-foreground" aria-expanded={constraintsOpen} onClick={()=>setConstraintsOpen(v=>!v)}>附加约束 {active.length} {constraintsOpen?'⌃':'⌄'}</button>{constraintsOpen&&<div className="mt-2 max-w-4xl space-y-2">
      {pref.constraints.map((c,i)=><div key={c.id}><div className="flex items-center gap-2"><input aria-label={`启用约束 ${i+1}`} type="checkbox" checked={c.enabled} disabled={running} onChange={e=>changeConstraint(i,{enabled:e.target.checked})}/><input aria-label={`约束 ${i+1}`} className={`min-w-0 flex-1 rounded border bg-transparent px-2 py-1 font-mono ${rowErrors[i]?'border-destructive/50':'border-border/60'} ${c.enabled?'':'opacity-50'}`} value={c.text} disabled={running} onChange={e=>changeConstraint(i,{text:e.target.value})}/><button type="button" className={btn} disabled={running} aria-label={`删除约束 ${i+1}`} onClick={()=>update({...pref,constraints:pref.constraints.filter((_,j)=>j!==i)})}>删除</button></div>{rowErrors[i]&&<p className="ml-5 mt-1 text-destructive">{rowErrors[i]}{c.enabled?'':'（已停用，本轮忽略）'}</p>}</div>)}
      <div className="flex gap-2"><select aria-label="添加约束预设" className="rounded border border-border/60 bg-background px-2 py-1" disabled={running} value="" onChange={e=>{if(e.target.value!=='')addConstraints(FISH_PRESETS[Number(e.target.value)].lines);}}><option value="">+ 预设 ▾</option>{FISH_PRESETS.map((v,i)=><option key={v.name} value={i}>{v.name}</option>)}</select><button type="button" className={btn} disabled={running} onClick={()=>addConstraints([''])}>+ 自定义</button></div>
    </div>}</div>
    <p className="text-[11px] text-muted-foreground" data-testid="fish-rule">{running&&x?.rule?x.rule:fishRuleText(def,pref.H,pref.direction,pref.threshold,active.length)}</p>
    {open.scope && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground" aria-label="捕捞交易所">
      {AUDITED_EXCHANGES.map(exchange => <label key={exchange} className="flex items-center gap-1.5">
        <input type="checkbox" className="h-3 w-3 accent-primary" disabled={running} checked={exchanges.includes(exchange)} onChange={e => p.onSelectionChange({ ...p.selection, exchanges: AUDITED_EXCHANGES.filter(x => x === exchange ? e.target.checked : exchanges.includes(x)) })} />
        {EXCHANGE_NAMES[exchange]}
      </label>)}
      <label className="flex items-center gap-1.5"><input type="checkbox" className="h-3 w-3 accent-primary" checked={includeUsStocks} disabled={running} onChange={e=>p.onSelectionChange({...p.selection,includeUsStocks:e.target.checked})}/>美股</label>
      <label className="ml-1 flex items-center gap-1.5 border-l border-border/60 pl-4"><input type="checkbox" className="h-3 w-3 accent-primary" disabled={running} checked={includeDuplicates} onChange={e => p.onSelectionChange({ ...p.selection, includeDuplicates: e.target.checked })} />含重复币</label>
    </div>}
    {open.probe&&p.onDiagnose&&<div className="space-y-1 text-[11px]" data-testid="fish-probe">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>查单个币</span>
        <input aria-label="查单个币的标的" placeholder="如 RAVE 或 RAVEUSDT" value={probe.symbol} onChange={e=>setProbe({...probe,symbol:e.target.value})} onKeyDown={e=>{if(e.key==='Enter')void runProbe();}} className="w-40 rounded border border-border/60 bg-transparent px-2 py-1 font-mono text-foreground" />
        <select aria-label="查单个币的交易所" value={probe.exchange} onChange={e=>setProbe({...probe,exchange:e.target.value as FishExchange})} className="rounded border border-border/60 bg-background px-1.5 py-1">
          {AUDITED_EXCHANGES.map(e=><option key={e} value={e}>{EXCHANGE_NAMES[e]}</option>)}
        </select>
        <button type="button" className={btn} disabled={probe.busy||!probe.symbol.trim()} onClick={()=>void runProbe()}>{probe.busy?'查询中…':'查'}</button>
        <span className="text-[10.5px]">按上面的算法、阈值与时间，用与捕捞相同的取数和判定；不入库</span>
      </div>
      {probe.result&&<div className={`space-y-0.5 border-l pl-2 ${probe.result.outcome==='hit'?'border-primary/60':'border-border/60'}`} data-testid="fish-probe-result">
        {probe.result.lines.map((line,i)=><p key={i} className={i===0?'font-mono text-[10.5px] text-muted-foreground':'text-foreground/90'}>{line}</p>)}
      </div>}
    </div>}
    {(error||compiled.error) && <p role="alert" className="text-[11px] text-destructive">{error||compiled.error}</p>}
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
      </div>
      {/* 【用户要求】2026-10-19 进度旁的明细入口删掉（「没必要存在」）；整次扫描失败的报错仍直接写出来 */}
      {x.error && <p className="text-destructive">{x.error}</p>}
    </div>}
    {/* 【用户要求】2026-10-19 新鱼 = 最近一次捕捞捕到的；点开始捕捞时上一轮的新鱼归入「鱼」 */}
    <FishLibrary title="新鱼" testId="fish-new" signals={fresh} defaultOpen={fresh.length > 0} emptyText={running ? '捕捞中，捕到的会出现在这里。' : '还没有新鱼：点「开始捕捞」后，这一轮捕到的放在这里，上一轮的归入「鱼」。'}
      tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={p.onRate} onAdd={p.onAdd} />
    <FishLibrary title="鱼" testId="fish-old" signals={old} bare emptyText="暂无信号：每次开始捕捞时，上一轮的新鱼会归入这里。"
      tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={p.onRate} onAdd={p.onAdd} />
  </section>;
}
