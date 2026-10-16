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
  BUILTIN_FEATURES, CAMPAIGN_VARIABLES, checkDefinition, compileGroups, definitionKey, MIN_AMOUNT_COVERAGE, previewGroups, SERIES_VARIABLES,
  type DeepDigFeatureDef,
} from '@/lib/deepDig/features';
import type { CampaignGroupRow } from '@/lib/deepRsa/report';

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
  /** 本机战役（分组标准即时预览用）；还没读完时为 null。 */
  groupRows: readonly CampaignGroupRow[] | null;
}

export function DefinitionPanel(props: DefinitionPanelProps) {
  return props.editing ? <DefinitionForm {...props} /> : <DefinitionView {...props} />;
}

function DefinitionView({ def, onEditingChange }: DefinitionPanelProps) {
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
        <pre className="overflow-x-auto whitespace-pre rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-foreground" data-testid="deep-dig-def-formula">{def.formula}</pre>
        <span className="text-muted-foreground">分组</span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="deep-dig-def-groups">
          <span><span className="text-[#0B9F66] dark:text-[#0ECB81]">实验组</span> <Code>{def.positive}</Code></span>
          <span><span className={RED}>对照组</span> <Code>{def.control}</Code></span>
        </div>
        <span className="text-muted-foreground">显示</span>
        <span className="font-mono tabular-nums text-muted-foreground">× {def.scale}{def.unit ? ` · ${def.unit}` : ''}</span>
      </div>
    </div>
  );
}

function DefinitionForm({ def, onEditingChange, onSave, onReset, onDelete, groupRows }: DefinitionPanelProps) {
  const [draft, setDraft] = useState<DeepDigFeatureDef>(def);
  const [scaleText, setScaleText] = useState(String(def.scale));
  const [tried, setTried] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [help, setHelp] = useState(false);
  const scale = Number(scaleText);
  const check = useMemo(() => checkDefinition({ ...draft, scale }), [draft, scale]);
  const preview = useMemo(() => {
    if (check.groups || !groupRows) return null;
    try { return previewGroups(groupRows, compileGroups(draft.positive, draft.control)); } catch { return null; }
  }, [check.groups, groupRows, draft.positive, draft.control]);
  const builtin = BUILTIN_FEATURES.find(b => b.id === def.id);
  const modifiedFromDefault = builtin && (definitionKey(builtin) !== definitionKey(draft) || builtin.name !== draft.name || builtin.definition !== draft.definition
    || builtin.short !== draft.short || builtin.unit !== draft.unit || builtin.scale !== scale);
  const set = <K extends keyof DeepDigFeatureDef>(k: K, v: DeepDigFeatureDef[K]) => setDraft(d => ({ ...d, [k]: v }));
  const save = () => {
    setTried(true);
    if (check.formula || check.groups || check.scale || !draft.name.trim()) return;
    onSave({ ...draft, name: draft.name.trim(), short: draft.short.trim() || '特征值', scale, unit: draft.unit.trim() });
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
            : <div className="text-muted-foreground">在进场前 48 小时的已收盘 5m K 线上逐根算，取最后一根的值作为这场的特征值。</div>}
          <button type="button" onClick={() => setHelp(h => !h)} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground" data-testid="deep-dig-def-help-toggle">
            {help ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}可用写法
          </button>
          {help && <FormulaHelp />}
        </div>
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
        <div className="min-w-0 flex-1 space-y-1.5">
          <label className="flex items-center gap-2">
            <span className="w-[42px] shrink-0 text-[#0B9F66] dark:text-[#0ECB81]">实验组</span>
            <input value={draft.positive} onChange={e => set('positive', e.target.value)} spellCheck={false} className={cn(INPUT, 'min-w-0 flex-1 font-mono')} data-testid="deep-dig-def-positive" />
          </label>
          <label className="flex items-center gap-2">
            <span className={cn('w-[42px] shrink-0', RED)}>对照组</span>
            <input value={draft.control} onChange={e => set('control', e.target.value)} spellCheck={false} className={cn(INPUT, 'min-w-0 flex-1 font-mono')} data-testid="deep-dig-def-control" />
          </label>
          {check.groups ? <div className={RED} data-testid="deep-dig-def-groups-error">{check.groups.replace(/^第 \d+ 行：/, '')}</div> : preview ? (
            <div className="text-muted-foreground" data-testid="deep-dig-def-preview">
              按这个标准，本机战役（去重前）：实验组 <b className="font-mono font-normal text-foreground">{preview.positive}</b> · 对照组 <b className="font-mono font-normal text-foreground">{preview.control}</b> · 冲突 <b className="font-mono font-normal text-foreground">{preview.conflict}</b> · 其他 <b className="font-mono font-normal text-foreground">{preview.other}</b>
            </div>
          ) : null}
          <div className="text-muted-foreground">
            可用读数：{CAMPAIGN_VARIABLES.map((v, i) => <span key={v.name}>{i ? '；' : ''}<Code>{v.name}</Code> {v.label}</span>)}。
            同时满足两组 → 冲突；用到的读数缺失、战役未结算或校正未拉齐 → 归「其他战役」，都不进两组比较。
          </div>
        </div>
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

function FormulaHelp() {
  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed" data-testid="deep-dig-def-help">
      <div>
        <span className="text-muted-foreground">序列（每根 K 线一个值）：</span>
        {SERIES_VARIABLES.map((v, i) => <span key={v.name}>{i ? '；' : ''}<Code>{v.name}</Code> {v.label}</span>)}。
        用到 Q / B / S 时，观察窗里有成交额数据的 K 线不到 {Math.round(MIN_AMOUNT_COVERAGE * 100)}% 的那场记缺失。
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
