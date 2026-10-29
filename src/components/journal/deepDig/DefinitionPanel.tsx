import { featureTemplateId, featureUsesMbi } from '@/lib/deepDig/features';
/**
 * Deep dig 特征值的定义区：平时显示定义、公式、分组标准；点「编辑定义」就地改。
 * 【用户要求】2026-10-16「每个特征值的这里都可以人为输入定义概念、公式、分组标准，然后运行的时候，就按照这里的公式提取因变量，
 * 按分组标准进行划分组别」。保存前检查公式与分组标准能否解析；分组标准即时预览本机战役各组多少场（不用跑行情）。
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FUNCTIONS } from '@/lib/deepDig/formula';
import {
  AVG_HOURS_PRESETS, avgHoursOf, barsPerAvg, barsPerHalfLife, BUILTIN_FEATURES, checkDefinition, compileGroups, DEFAULT_AVG_HOURS, DEFAULT_GROUPS, DEFAULT_HALF_LIFE_HOURS, DEFAULT_INTERVAL,
  definitionKey, FEATURE_INTERVALS, featureWindowMs, formulaParamUse, HALF_LIFE_PRESETS, halfLifeOf, INTERVAL_LABEL, intervalOf, MIN_AMOUNT_COVERAGE, PARAM_VARIABLES, previewGroups,
  SERIES_VARIABLES, SOURCE_LABEL,
  type DeepDigFeatureDef, type SampleRow, type SampleSource,
} from '@/lib/deepDig/features';
import { MetricLetterTable } from '@/components/journal/MetricLetterTable';
import { CAMPAIGN_METRIC_LETTERS, letterRanges } from '@/lib/campaignMetricLetters';
import { intervalMs, type ResearchInterval } from '@/lib/deepRsa/marketData';
import { mbiNOf, mbiZ0Of } from '@/lib/mbi';

const BTN = 'inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';
const INPUT = 'rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-foreground/40';
const RED = 'text-[#F6465D]';
const Code = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-muted px-1 py-px font-mono text-[11px] text-foreground">{children}</code>;

export interface DefinitionPanelProps {
  def: DeepDigFeatureDef;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSave: (def: DeepDigFeatureDef) => void;
  /** 内置项：恢复默认定义。 */
  onReset?: () => void;
  /** 新增项：删除这个特征值。 */
  onDelete?: () => void;
  /** 本机样本（分组标准即时预览用）：交易战役、信号库各一份；还没读完时为 null。 */
  samples: Record<SampleSource, readonly SampleRow[] | null>;
}

export function DefinitionPanel(props: DefinitionPanelProps) {
  return props.editing ? <DefinitionForm {...props} /> : <DefinitionView {...props} />;
}

function DefinitionView({ def, onEditingChange, onSave, samples }: DefinitionPanelProps) {
  return (
    <div className="space-y-2.5" data-testid="deep-dig-definition">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-medium">{def.name}</h2>
        <button type="button" onClick={() => onEditingChange(true)} data-testid="deep-dig-def-edit"
          className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground">
          <Pencil className="h-3 w-3" />编辑定义
        </button>
      </div>
      {def.definition && <p className="max-w-[720px] text-[11.5px] leading-relaxed text-muted-foreground">{def.definition}</p>}
      <div className="grid max-w-[720px] grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11.5px]">
        <span className="pt-1 text-muted-foreground">公式</span>
        <FormulaEditor def={def} onSave={onSave} />
        <span className="pt-1 text-muted-foreground">参数</span>
        <KlineSettings value={paramsOf(def)} onChange={v => onSave({ ...def, ...paramPatch(v) })} uses={formulaParamUse(def.formula)} testId="deep-dig-kline" />
        <span className="pt-px text-muted-foreground">分组</span>
        <GroupCriteria def={def} samples={samples} onSave={onSave} testId="deep-dig-def-groups" />
        <span className="text-muted-foreground">显示</span>
        <span className="font-mono tabular-nums text-muted-foreground">× {def.scale}{def.unit ? ` · ${def.unit}` : ''}</span>
      </div>
    </div>
  );
}

function DefinitionForm({ def, onEditingChange, onSave, onReset, onDelete, samples }: DefinitionPanelProps) {
  const [draft, setDraft] = useState<DeepDigFeatureDef>(def);
  const [scaleText, setScaleText] = useState(String(def.scale));
  const [tried, setTried] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [help, setHelp] = useState(false);
  const scale = Number(scaleText);
  const check = useMemo(() => checkDefinition({ ...draft, scale }), [draft, scale]);
  const builtin = BUILTIN_FEATURES.find(b => b.id === def.id);
  const modifiedFromDefault = builtin && (definitionKey(builtin) !== definitionKey(draft) || builtin.name !== draft.name || builtin.definition !== draft.definition
    || builtin.short !== draft.short || builtin.unit !== draft.unit || builtin.scale !== scale);
  const set = <K extends keyof DeepDigFeatureDef>(k: K, v: DeepDigFeatureDef[K]) => setDraft(d => ({ ...d, [k]: v }));
  const save = () => {
    setTried(true);
    if (check.formula || check.groups || check.scale || !draft.name.trim()) return;
    onSave({ ...draft, name: draft.name.trim(), short: draft.short.trim() || '特征值', scale, unit: draft.unit.trim(), groupVars: 2 });
    onEditingChange(false);
  };
  const label = 'w-[56px] shrink-0 pt-1 text-muted-foreground';

  return (
    <div className="max-w-[720px] space-y-3 text-[11.5px]" data-testid="deep-dig-def-form">
      <div className="flex gap-2">
        <span className={label}>名称</span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          <input value={draft.name} onChange={e => set('name', e.target.value)} className={cn(INPUT, 'min-w-0 flex-1')} data-testid="deep-dig-def-name" aria-label="名称" />
          <input value={draft.short} onChange={e => set('short', e.target.value)} className={cn(INPUT, 'w-[72px]')} placeholder="简称" aria-label="简称" title="简称：表头与规律里用" />
        </div>
      </div>
      {tried && !draft.name.trim() && <div className={cn('pl-[64px]', RED)}>名称不能为空</div>}
      <div className="flex gap-2">
        <span className={label}>定义</span>
        <textarea value={draft.definition} onChange={e => set('definition', e.target.value)} rows={2} className={cn(INPUT, 'min-w-0 flex-1 leading-relaxed')} aria-label="定义" placeholder="用一两句话说明这个特征值量的是什么" />
      </div>
      <div className="flex gap-2">
        <span className={label}>公式</span>
        <div className="min-w-0 flex-1 space-y-1">
          <textarea
            value={draft.formula}
            onChange={e => set('formula', e.target.value)}
            rows={Math.min(14, Math.max(4, draft.formula.split('\n').length + 1))}
            spellCheck={false}
            wrap="off"
            className={cn(INPUT, 'w-full overflow-x-auto whitespace-pre font-mono text-[11.5px] leading-relaxed')}
            data-testid="deep-dig-def-formula-input"
            aria-label="公式"
          />
          {check.formula ? <div className={RED} data-testid="deep-dig-def-formula-error">{check.formula}</div>
            : <div className="text-muted-foreground">在进场前的已收盘 K 线（上面选的周期）上逐根算，取最后一根的值作为这场的特征值。</div>}
          <button type="button" onClick={() => setHelp(h => !h)} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground" data-testid="deep-dig-def-help-toggle">
            {help ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}可用写法
          </button>
          {help && <FormulaHelp />}
        </div>
      </div>
      <div className="flex gap-2">
        <span className={label}>参数</span>
        <KlineSettings value={paramsOf(draft)} onChange={v => setDraft(d => ({ ...d, ...paramPatch(v) }))} uses={formulaParamUse(draft.formula)} testId="deep-dig-def-kline" />
      </div>
      <div className="flex gap-2">
        <span className={label}>显示</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">×</span>
          <input value={scaleText} onChange={e => setScaleText(e.target.value)} className={cn(INPUT, 'w-[84px] font-mono')} aria-label="显示倍数" />
          <input value={draft.unit} onChange={e => set('unit', e.target.value)} className={cn(INPUT, 'w-[96px]')} placeholder="单位" aria-label="单位" />
          <span className="text-muted-foreground">只换显示单位，检验用原值</span>
        </div>
      </div>
      {check.scale && <div className={cn('pl-[64px]', RED)}>{check.scale}</div>}
      <div className="flex gap-2">
        <span className={label}>分组</span>
        <GroupFields
          value={{ source: draft.source ?? 'campaigns', positive: draft.positive, control: draft.control }}
          onChange={v => setDraft(d => ({ ...d, ...v }))}
          samples={samples}
          testId="deep-dig-def"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-[64px]">
        <button type="button" className={cn(BTN, 'border-foreground/30 font-medium')} onClick={save} data-testid="deep-dig-def-save">保存</button>
        <button type="button" className={BTN} onClick={() => onEditingChange(false)}>取消</button>
        {onReset && modifiedFromDefault && builtin && (
          <button type="button" className={BTN} data-testid="deep-dig-def-reset" onClick={() => { setDraft({ ...builtin }); setScaleText(String(builtin.scale)); }}>
            <RotateCcw className="h-3 w-3" />填回默认
          </button>
        )}
        {onDelete && (confirmDelete ? (
          <button type="button" className={cn(BTN, 'border-[#F6465D]/50', RED)} onClick={onDelete} data-testid="deep-dig-def-delete-confirm">确认删除这个特征值</button>
        ) : (
          <button type="button" className={BTN} onClick={() => setConfirmDelete(true)} data-testid="deep-dig-def-delete"><Trash2 className="h-3 w-3" />删除</button>
        ))}
        <span className="text-muted-foreground">保存后点「重新运行」按新定义算</span>
      </div>
    </div>
  );
}

type Preview = ReturnType<typeof previewGroups>;
type GroupValue = { source: SampleSource; positive: string; control: string };
const B = ({ children }: { children: React.ReactNode }) => <b className="font-mono font-normal text-foreground">{children}</b>;

function groupError(v: GroupValue): string | null {
  try { compileGroups(v.positive, v.control, v.source); return null; } catch (e) { return e instanceof Error ? e.message.replace(/^第 \d+ 行：/, '') : String(e); }
}

/** 换样本来源时：原来的条件在新来源里写不通（用了另一边的字母），就换成新来源的默认条件。 */
function switchSource(v: GroupValue, source: SampleSource): GroupValue {
  if (source === v.source) return v;
  const next = { ...v, source };
  return groupError(next) ? { source, ...DEFAULT_GROUPS[source] } : next;
}

/**
 * 分组标准的输入：样本来源（交易战役 / 信号库）、两个条件、即时预览、可用字母（指标表）。
 * 【用户要求】2026-10-16「信号库中信号的评分等级、交易战役中的首仓涨幅……都只是指标而已，
 * 如果是信号库中等级评分的话，时间点是那行信号对应的时间点」。
 */
function GroupFields({ value, onChange, samples, testId, onEnter, onEscape, autoFocus }: {
  value: GroupValue;
  onChange: (v: GroupValue) => void;
  samples: Record<SampleSource, readonly SampleRow[] | null>;
  testId: string;
  onEnter?: () => void;
  onEscape?: () => void;
  autoFocus?: boolean;
}) {
  const [table, setTable] = useState(false);
  const error = useMemo(() => groupError(value), [value]);
  const rows = samples[value.source];
  const preview = useMemo(() => {
    if (error || !rows) return null;
    try { return previewGroups(rows, compileGroups(value.positive, value.control, value.source)); } catch { return null; }
  }, [error, rows, value]);
  const used = useMemo(() => {
    if (error) return new Set<string>();
    try { return compileGroups(value.positive, value.control, value.source).inputs; } catch { return new Set<string>(); }
  }, [error, value]);
  // 【用户要求】指标表补每个字母的本机范围（不进研究的样本不算）；表展开时才算
  const ranges = useMemo(() => {
    if (!table || !rows) return undefined;
    const kind = value.source === 'signals' ? 'signal' : 'campaign';
    return letterRanges(rows.filter(r => !r.excluded).map(r => r.values), CAMPAIGN_METRIC_LETTERS.filter(m => m.source === kind).map(m => m.letter));
  }, [table, rows, value.source]);
  const keys = (e: React.KeyboardEvent) => { if (e.key === 'Enter') onEnter?.(); if (e.key === 'Escape') onEscape?.(); };
  const unit = value.source === 'signals' ? '条信号' : '场战役';
  const unsupportedStocks=rows?.filter(r=>r.unsupportedReason).length??0;
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-[42px] shrink-0 text-muted-foreground">样本</span>
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border/70 bg-muted/40 p-0.5" role="group" aria-label="样本来源">
          {(['campaigns', 'signals'] as const).map(src => (
            <button key={src} type="button" aria-pressed={value.source === src} data-testid={`${testId}-source-${src}`}
              onClick={() => onChange(switchSource(value, src))}
              className={cn('h-6 whitespace-nowrap rounded-[4px] px-2 text-[11.5px] transition-colors',
                value.source === src ? 'bg-card font-medium shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:bg-accent' : 'text-muted-foreground hover:text-foreground')}>
              {SOURCE_LABEL[src]}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">{value.source === 'signals' ? '信号库里每条信号单独一个事件（时间点 = 信号时间），与交易战役无关' : '每场战役一个事件，时间点 = 进场时刻'}</span>
      </div>
      <label className="flex items-center gap-2">
        <span className="w-[42px] shrink-0 text-[#0B9F66] dark:text-[#0ECB81]">实验组</span>
        <input value={value.positive} onChange={e => onChange({ ...value, positive: e.target.value })} onKeyDown={keys} spellCheck={false} autoFocus={autoFocus}
          className={cn(INPUT, 'min-w-0 flex-1 font-mono')} data-testid={`${testId}-positive`} />
      </label>
      <label className="flex items-center gap-2">
        <span className={cn('w-[42px] shrink-0', RED)}>对照组</span>
        <input value={value.control} onChange={e => onChange({ ...value, control: e.target.value })} onKeyDown={keys} spellCheck={false}
          className={cn(INPUT, 'min-w-0 flex-1 font-mono')} data-testid={`${testId}-control`} />
      </label>
      {error ? <div className={RED} data-testid={`${testId}-error`}>{error}</div> : preview ? (
        <div className="text-muted-foreground" data-testid={`${testId}-preview`}>
          按这个标准，本机{unit.slice(1)}（去重前）：实验组 <B>{preview.positive}</B> · 对照组 <B>{preview.control}</B> · 冲突 <B>{preview.conflict}</B> · 其他 <B>{preview.other}</B>{unsupportedStocks>0&&<span> · 美股：暂不支持取行情 {unsupportedStocks} 条</span>}
        </div>
      ) : null}
      {preview && <GroupWarnings preview={preview} testId={testId} />}
      <div className="text-muted-foreground">
        直接写字母，如 {value.source === 'signals' ? <><Code>s &gt;= 4</Code>、<Code>s &lt;= 2</Code></> : <><Code>c &gt; 10 and b &gt; 2</Code>、<Code>Bₜ &lt; 0.5</Code></>}；
        可写 <Code>and or not</Code>、括号、比较。同时满足两组 → 冲突；用到的读数缺失{value.source === 'signals' ? '（没评分）' : '、战役未结算或校正未拉齐'} → 归「其他」，都不进两组比较。
        {value.source === 'signals' && '探顶区、写着事后结果的跟进记录、没有行情的信号不进样本。'}
      </div>
      <button type="button" onClick={() => setTable(t => !t)} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground" data-testid={`${testId}-letters-toggle`}>
        {table ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}指标表（可用的字母）
      </button>
      {table && (
        <MetricLetterTable sources={[value.source === 'signals' ? 'signal' : 'campaign']} highlight={used} ranges={ranges} rangeNoun={value.source === 'signals' ? '条' : '场'} className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-2" />
      )}
    </div>
  );
}

/**
 * 分组标准：平时显示样本来源与两个条件，点「改标准」就地改（不用打开整个定义表单），即时预览本机样本各组多少个。
 * 【用户要求】2026-10-16「我希望分组这里的标准也可以手动改动」：定义区与描述统计的「分组」两处都能改，改的是同一份定义。
 */
export function GroupCriteria({ def, samples, onSave, testId, resultDef }: {
  resultDef?: Pick<DeepDigFeatureDef, 'positive' | 'control' | 'source'>;
  def: DeepDigFeatureDef;
  samples: Record<SampleSource, readonly SampleRow[] | null>;
  onSave: (def: DeepDigFeatureDef) => void;
  testId: string;
}) {
  const source = def.source ?? 'campaigns';
  const [draft, setDraft] = useState<GroupValue | null>(null);
  const error = useMemo(() => (draft ? groupError(draft) : null), [draft]);

  const shown = resultDef ?? def;
  const preview = useMemo(() => {
    const rows = samples[source];
    if (!rows || resultDef) return null;
    try { return previewGroups(rows, compileGroups(def.positive, def.control, source)); } catch { return null; }
  }, [samples, source, def.positive, def.control, resultDef]);

  if (!draft) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]" data-testid={testId}>
        <span className="rounded bg-muted px-1.5 py-px text-[10.5px] text-muted-foreground" data-testid={`${testId}-source`}>{SOURCE_LABEL[shown.source ?? 'campaigns']}</span>
        {resultDef && <span className="text-muted-foreground">本次结果采用</span>}
        <span><span className="text-[#0B9F66] dark:text-[#0ECB81]">实验组</span> <Code>{shown.positive}</Code></span>
        <span><span className={RED}>对照组</span> <Code>{shown.control}</Code></span>
        <button type="button" onClick={() => setDraft({ source, positive: def.positive, control: def.control })} data-testid={`${testId}-edit`}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <Pencil className="h-3 w-3" />改标准
        </button>
        {preview && <GroupWarnings preview={preview} testId={testId} />}
      </div>
    );
  }
  const defaults = DEFAULT_GROUPS[draft.source];
  const isDefault = draft.positive.trim() === defaults.positive && draft.control.trim() === defaults.control;
  const save = () => {
    if (error) return;
    const next = { source: draft.source, positive: draft.positive.trim(), control: draft.control.trim() };
    if (next.positive !== def.positive || next.control !== def.control || next.source !== source) onSave({ ...def, ...next, groupVars: 2 });
    setDraft(null);
  };
  return (
    <div className="max-w-[680px] space-y-1.5 text-[11.5px]" data-testid={`${testId}-form`}>
      <GroupFields value={draft} onChange={setDraft} samples={samples} testId={testId} onEnter={save} onEscape={() => setDraft(null)} autoFocus />
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button type="button" className={cn(BTN, 'border-foreground/30 font-medium')} onClick={save} disabled={!!error} data-testid={`${testId}-save`}>保存</button>
        <button type="button" className={BTN} onClick={() => setDraft(null)}>取消</button>
        {!isDefault && (
          <button type="button" className={BTN} onClick={() => setDraft({ ...draft, ...defaults })} data-testid={`${testId}-default`}>
            <RotateCcw className="h-3 w-3" />填回默认
          </button>
        )}
        <span className="text-muted-foreground">保存后重新运行描述统计，按新标准分组</span>
      </div>
    </div>
  );
}

/**
 * 公式：平时显示，点「改公式」就地改（不用打开整个定义表单）。
 * 【用户要求】2026-10-16「公式也要做成能修改的」：写错时提示第几行、哪里不对，不能保存；内置项可填回默认。
 * Ctrl / ⌘ + Enter 保存，Esc 取消。
 */
export function FormulaEditor({ def, onSave }: { def: DeepDigFeatureDef; onSave: (def: DeepDigFeatureDef) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const error = useMemo(() => (draft == null ? null : checkDefinition({ ...def, formula: draft }).formula), [draft, def]);
  const builtin = BUILTIN_FEATURES.find(b => b.id === def.id);

  if (draft == null) {
    return (
      <div className="min-w-0 space-y-1">
        <pre className="overflow-x-auto whitespace-pre rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-foreground" data-testid="deep-dig-def-formula">{def.formula}</pre>
        <button type="button" onClick={() => setDraft(def.formula)} data-testid="deep-dig-def-formula-edit"
          className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground">
          <Pencil className="h-3 w-3" />改公式
        </button>
      </div>
    );
  }
  const save = () => {
    if (error) return;
    if (draft.trim() !== def.formula.trim()) onSave({ ...def, formula: draft.trim() });
    setDraft(null);
    setHelp(false);
  };
  return (
    <div className="min-w-0 space-y-1.5" data-testid="deep-dig-def-formula-form">
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') setDraft(null);
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
        }}
        rows={Math.min(16, Math.max(4, draft.split('\n').length + 1))}
        spellCheck={false}
        wrap="off"
        autoFocus
        className={cn(INPUT, 'w-full overflow-x-auto whitespace-pre font-mono text-[11.5px] leading-relaxed')}
        data-testid="deep-dig-def-formula-inline"
        aria-label="公式"
      />
      {error ? <div className={RED} data-testid="deep-dig-def-formula-inline-error">{error}</div>
        : <div className="text-muted-foreground">在进场前的已收盘 K 线（上面选的周期）上逐根算，取最后一根的值作为这场的特征值。</div>}
      <button type="button" onClick={() => setHelp(h => !h)} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground">
        {help ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}可用写法
      </button>
      {help && <FormulaHelp />}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button type="button" className={cn(BTN, 'border-foreground/30 font-medium')} onClick={save} disabled={!!error} data-testid="deep-dig-def-formula-save">保存</button>
        <button type="button" className={BTN} onClick={() => setDraft(null)}>取消</button>
        {builtin && draft.trim() !== builtin.formula.trim() && (
          <button type="button" className={BTN} onClick={() => setDraft(builtin.formula)} data-testid="deep-dig-def-formula-default">
            <RotateCcw className="h-3 w-3" />填回默认
          </button>
        )}
        <span className="text-muted-foreground">保存后重新运行描述统计，按新公式算</span>
      </div>
    </div>
  );
}

type ParamValue = { id?: string; formula?: string; chartTemplate?: string; interval: ResearchInterval; halfLifeHours: number; avgHours: number; MBI_N?: number; MBI_Z0?: number };
const paramsOf = (d: DeepDigFeatureDef): ParamValue => ({ id: d.id, formula: d.formula, chartTemplate: d.chartTemplate, interval: intervalOf(d), halfLifeHours: halfLifeOf(d), avgHours: avgHoursOf(d), ...(featureUsesMbi(d) ? { MBI_N: mbiNOf(d), MBI_Z0: mbiZ0Of(d) } : {}) });
/** 默认值不写进定义（旧定义没有这几项）。 */
const paramPatch = (v: ParamValue): Pick<DeepDigFeatureDef, 'interval' | 'halfLifeHours' | 'avgHours' | 'MBI_N' | 'MBI_Z0'> => ({
  interval: v.interval === DEFAULT_INTERVAL ? undefined : v.interval,
  halfLifeHours: v.halfLifeHours === DEFAULT_HALF_LIFE_HOURS ? undefined : v.halfLifeHours,
  avgHours: v.avgHours === DEFAULT_AVG_HOURS ? undefined : v.avgHours,
  ...(featureUsesMbi(v) ? { MBI_N: mbiNOf(v), MBI_Z0: mbiZ0Of(v) } : {}),
});
const fmtBars = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const PARAM_LABEL = 'w-[52px] shrink-0 pt-[7px] leading-none text-muted-foreground';
const SEGMENT = 'inline-flex min-w-0 flex-wrap items-center gap-0.5 rounded-md border border-border/70 bg-muted/40 p-0.5';
const chip = (active: boolean) => cn('h-6 whitespace-nowrap rounded-[4px] px-1.5 font-mono text-[11px] transition-colors',
  active ? 'bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:bg-accent' : 'text-muted-foreground hover:text-foreground');

/** 小时数：快捷选项点一下，或在「自定」里填（回车 / 移开生效，Esc 取消，乱填不改）。 */
function HoursPicker({ label, ariaLabel, presets, value, onChange, summary, unused, testId }: {
  label: string; ariaLabel: string; presets: readonly number[]; value: number; onChange: (h: number) => void;
  summary: React.ReactNode; unused: string | null; testId: string;
}) {
  const [custom, setCustom] = useState<string | null>(null);
  const preset = presets.includes(value);
  const commit = () => {
    if (custom == null) return;
    const h = Number(custom);
    if (Number.isFinite(h) && h > 0 && h <= 24 * 30) onChange(h);
    setCustom(null);
  };
  return (
    <div className="flex items-start gap-x-2">
      <span className={PARAM_LABEL}>{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <div className={SEGMENT} role="group" aria-label={ariaLabel}>
          {presets.map(h => (
            <button key={h} type="button" aria-pressed={value === h} data-testid={`${testId}-${h}`}
              onClick={() => { setCustom(null); onChange(h); }} className={chip(value === h)}>{h}h</button>
          ))}
          <input
            value={custom ?? (preset ? '' : String(value))}
            onChange={e => setCustom(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setCustom(null); }}
            placeholder="自定"
            inputMode="decimal"
            aria-label={`自定${ariaLabel}（小时）`}
            data-testid={`${testId}-custom`}
            className={cn('h-6 w-[52px] rounded-[4px] bg-transparent px-1.5 font-mono text-[11px] outline-none placeholder:text-muted-foreground/60 focus:bg-card',
              !preset && custom == null && 'bg-card font-medium shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:bg-accent')}
          />
        </div>
        <span className="text-[11px] text-muted-foreground" data-testid={`${testId}-summary`}>
          {summary}
          {unused && <span className="ml-1.5 text-muted-foreground/60" data-testid={`${testId}-unused`}>（公式里没用 {unused}）</span>}
        </span>
      </div>
    </div>
  );
}

/**
 * 公式参数：K 线周期、半衰期、平均时长，点一下就换（定义区直接保存；表单里先改草稿）。公式里写 hl / avgh 就用这里的值，也可以直接写数字。
 * 【用户要求】2026-10-16「周期这里可以做成能够自主选择的。选择哪个周期，就统计哪个周期的变量。另外半衰期也要做成可以选择的」；
 * 2026-10-17「改成过去一段时间的平均值，时间的选取就选 24 小时（并且还要满足能够修改）…既可以在公式中改、也可以手动点击选取和填写」。
 */
export function KlineSettings({ value, onChange, uses, testId }: {
  value: ParamValue;
  onChange: (v: ParamValue) => void;
  /** 公式里用到了哪些参数（没用到的旁边注一句）；公式写错时为 null，不注。 */
  uses?: { hl: boolean; avgh: boolean } | null;
  testId: string;
}) {
  const ivLabel = INTERVAL_LABEL[value.interval];
  const windowH = featureWindowMs(value) / 3_600_000;
  return (
    <div className="min-w-0 space-y-1 text-[11.5px]" data-testid={testId}>
      <div className="flex items-start gap-x-2">
        <span className={PARAM_LABEL}>周期</span>
        <div className={SEGMENT} role="group" aria-label="K 线周期">
          {(['cba-2','ctba'].includes(featureTemplateId(value)??'') ? ['5m'] as const : FEATURE_INTERVALS).map(iv => (
            <button key={iv} type="button" aria-pressed={value.interval === iv} title={INTERVAL_LABEL[iv]} data-testid={`${testId}-interval-${iv}`}
              onClick={() => onChange({ ...value, interval: iv })} className={chip(value.interval === iv)}>{iv}</button>
          ))}
        </div>
      </div>
      {featureUsesMbi(value) && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border/70 bg-muted/30 px-2 py-1.5" data-testid={`${testId}-mbi`}>
        <label className="inline-flex items-center gap-2 text-muted-foreground">衰减周期 n
          <input key={`n-${mbiNOf(value)}`} type="number" min="1" step="1" defaultValue={mbiNOf(value)} aria-label="MBI_N" className={cn(INPUT, 'w-20 font-mono')}
            onBlur={e => { const n = Number(e.target.value); if (Number.isSafeInteger(n) && n > 0) onChange({ ...value, MBI_N: n }); else e.target.value = String(mbiNOf(value)); }} />根
        </label>
        <label className="inline-flex items-center gap-2 text-muted-foreground">饱和尺度 z₀
          <input key={`z-${mbiZ0Of(value)}`} type="number" min="0.01" step="0.05" defaultValue={mbiZ0Of(value)} aria-label="MBI_Z0" className={cn(INPUT, 'w-20 font-mono')}
            onBlur={e => { const z = Number(e.target.value); if (Number.isFinite(z) && z > 0) onChange({ ...value, MBI_Z0: z }); else e.target.value = String(mbiZ0Of(value)); }} />
        </label>
        <span className="text-[11px] text-muted-foreground">α = 1/{mbiNOf(value)} · 预热 {5 * mbiNOf(value)} 根 · κ = {(mbiNOf(value) / Math.sqrt(2 * mbiNOf(value) - 1)).toFixed(6)}</span>
      </div>}
      {value.id !== 'mbi' && <HoursPicker
        label="半衰期" ariaLabel="半衰期" presets={HALF_LIFE_PRESETS} value={value.halfLifeHours} testId={`${testId}-hl`}
        onChange={h => onChange({ ...value, halfLifeHours: h })}
        summary={<>hl = {fmtBars(barsPerHalfLife(value))} 根 {ivLabel} K 线</>}
        unused={uses && !uses.hl ? 'hl' : null}
      />}
      <HoursPicker
        label={featureUsesMbi(value) ? '曲线范围' : '平均时长'} ariaLabel="平均时长" presets={AVG_HOURS_PRESETS} value={value.avgHours} testId={`${testId}-avg`}
        onChange={h => onChange({ ...value, avgHours: h })}
        summary={featureUsesMbi(value) ? <>锚点前后各 {value.avgHours} 小时；均值窗口在公式中设置</> : <>avgh = {barsPerAvg(value)} 根</>}
        unused={value.id !== 'mbi' && uses && !uses.avgh ? 'avgh' : null}
      />
      <div className="flex items-start gap-x-2">
        <span className={PARAM_LABEL} />
        <span className="text-[11px] text-muted-foreground" data-testid={`${testId}-summary`}>
          {featureUsesMbi(value) ? `取数：分析窗 + ${5 * mbiNOf(value)} 根预热，共 ${Math.round(featureWindowMs(value) / intervalMs(value.interval))} 根已收盘 ${ivLabel} K 线；预热值为空` : `观察窗：进场前 ${windowH >= 48 && windowH % 24 === 0 ? `${windowH / 24} 天` : `${Math.round(windowH)} 小时`}的已收盘 ${ivLabel} K 线`}
        </span>
      </div>
    </div>
  );
}

function FormulaHelp() {
  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed" data-testid="deep-dig-def-help">
      <div>
        <span className="text-muted-foreground">序列（每根 K 线一个值）：</span>
        {SERIES_VARIABLES.map((v, i) => <span key={v.name}>{i ? '；' : ''}<Code>{v.name}</Code> {v.label}</span>)}。
        用到 Q / B / S 时，观察窗里有成交额数据的 K 线不到 {Math.round(MIN_AMOUNT_COVERAGE * 100)}% 的那场记缺失。
        <span className="text-muted-foreground">参数：</span>{PARAM_VARIABLES.map((v, i) => <span key={v.name}>{i ? '；' : ''}<Code>{v.name}</Code> {v.label}</span>)}。
        prev / sma / sum 的根数按上面选的周期数。
      </div>
      <div>
        <span className="text-muted-foreground">运算：</span><Code>+ − × ÷ ^</Code> 比较 <Code>&gt; &lt; &gt;= &lt;= == !=</Code>（真 1 假 0），<Code>and or not</Code>，括号。
        一行一句，<Code>名字 = 式子</Code> 给中间量起名，最后一句是结果；<Code>#</Code> 后面是注释。
        算不出来（除以 0、ln 负数、开头没有前一根）记为空，空参与运算还是空。
      </div>
      <table>
        <tbody>
          {FUNCTIONS.filter(f => f.name !== 'log').map(f => (
            <tr key={f.name} className="align-top">
              <td className="whitespace-nowrap py-0.5 pr-3 font-mono text-foreground">{f.usage}</td>
              <td className="py-0.5 text-muted-foreground">{f.help}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupWarnings({ preview, testId }: { preview: ReturnType<typeof previewGroups>; testId: string }) {
  if (!preview.conflict && preview.positive && preview.control) return null;
  return <div role="status" className="basis-full rounded bg-[#F0B90B]/10 px-2 py-1 text-[#8F6B00] dark:text-[#F0B90B]" data-testid={`${testId}-warning`}>
    {preview.conflict > 0 && `有 ${preview.conflict} 个样本同时满足两组条件，会归入「其他」，不参与两组比较。`}
    {!preview.positive && '实验组没有可用样本，请检查不等号方向和条件范围。'}
    {!preview.control && '对照组没有可用样本，请检查条件范围。'}
    {'范围示例：1 < b and b < 10 表示 1 到 10 之间；1 > b 表示 b 小于 1。'}
  </div>;
}
