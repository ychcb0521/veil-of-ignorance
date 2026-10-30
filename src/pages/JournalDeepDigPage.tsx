import { groupDeepDigFeatures } from '@/lib/customIndicatorGroups';
/**
 * /journal/deep-dig — Deep dig：按特征值深挖（复盘中心里「规则」正下方）。
 *
 * 【用户要求】2026-10-16「“deep RSA”统一改成 “deep dig”……按照特征值来做成目录……每个特征值又可以分成 3 个模块：
 * 描述统计、推断统计、规律提取……我喜欢简洁、美观」；「每个特征值……都可以人为输入定义概念、公式、分组标准」；
 * 「这里需要增加可以新增特征值的入口」。
 *   /journal/deep-dig            目录：特征值列表（每项下面是三个模块的入口）+「新增特征值」
 *   /journal/deep-dig/:feature   某个特征值：?tab= 模块，?g= 数据分组，?all=1 展开全部，?edit=1 打开定义编辑
 *                                 （都放网址上，从战役返回回到原处）
 * 特征值定义（改过的内置项 + 新增项）与手动修改的规律跟账号走；运行结果按特征值存在本机。
 * 只读研究页：不改交易逻辑，不自动实盘，不编造结果。分组取交易战役列表同一份缓存行。
 */
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Copy, Plus, X as XIcon } from 'lucide-react';
import { BackButton } from '@/components/journal/BackButton';
import { FeatureCreationTime } from '@/components/journal/deepDig/FeatureCreationTime';
import { DEEP_DIG_TABS, FeatureView, type DeepDigNote, type DeepDigTab } from '@/components/journal/deepDig/FeatureView';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { useCampaignList } from '@/hooks/useCampaignList';
import { forgetDeepDigResult, loadDeepDigResults, useDeepDigRun } from '@/hooks/useDeepDigRun';
import { usePersistedState } from '@/hooks/usePersistedState';
import { DEEP_DIG_GROUPS, type DeepDigData, type DeepDigInference, type DeepDigRowGroup } from '@/lib/deepDig/analysis';
import { defaultFeatureCommands } from '@/lib/deepDig/commands';
import { campaignSample, signalSample, type SampleRow, type SampleSource } from '@/lib/deepDig/features';
import { readCachedCampaignPricePath } from '@/hooks/useCampaignPricePaths';
import { loadSignals, type TradeSignal } from '@/lib/signalLibrary';
import { FEATURES_KEY, ensureFeatureCopies, mergeFeatureDefs, newFeatureTemplate, copyFeatureDefinition, saveFeatureDefinition, removedBuiltins, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { buildCampaignGroupReport, type CampaignGroupReport } from '@/lib/deepRsa/report';

const SCROLL_KEY_PREFIX = 'journal-deep-dig-scroll:';
/** 样本是信号时不需要战役：给流水线一个空的战役汇总（事件行由信号给）。 */
const EMPTY_REPORT: CampaignGroupReport = buildCampaignGroupReport([], true);
/** 手动修改过的「规律提取」：特征值 id → 内容（跟账号走）。 */
const NOTES_KEY = 'deep_dig_notes_v1';
/** 描述统计里手动删掉的行：特征值 id → 事件 id（跟账号走）。 */
const EXCLUDED_KEY = 'deep_dig_excluded_v1';
/** 推断统计的命令：特征值 id → 命令原文（跟账号走）。 */
const COMMANDS_KEY = 'deep_dig_commands_v1';

function parseTab(search: string): DeepDigTab {
  const t = new URLSearchParams(search).get('tab');
  return DEEP_DIG_TABS.some(x => x.key === t) ? (t as DeepDigTab) : 'describe';
}
function parseGroup(search: string): DeepDigRowGroup {
  const g = new URLSearchParams(search).get('g');
  return DEEP_DIG_GROUPS.includes(g as DeepDigRowGroup) ? (g as DeepDigRowGroup) : 'positive';
}

export default function JournalDeepDigPage() {
  const { feature: slug } = useParams<{ feature?: string }>();
  const nav = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (slug === 'drift-speed-down-z') nav(`/journal/deep-dig/seller-control${location.search}`, { replace: true });
    else if (slug === 'seller-push') nav('/journal/deep-dig', { replace: true });
  }, [slug, location.search, nav]);
  const { user } = useAuth();
  const { tradeHistory, ordersMap, filledOrders, positionsMap } = useTradingContext();
  const { rows, complete, loaded, total } = useCampaignList(user?.id, { tradeHistory, ordersMap, filledOrders, positionsMap });
  // 峰值涨幅 / 动态最大回撤（字母 h、D、z）取交易战役列表算过的缓存，不另拉 K 线
  const enrichedRows = useMemo(() => (user?.id ? rows.map(r => {
    const cached = readCachedCampaignPricePath(r, user.id);
    return cached ? { ...r, peakPriceChangePct: cached.peak, dynamicMaxDrawdownPct: cached.drawdown, staticMaxDrawdownPct: cached.staticDrawdown } : r;
  }) : rows), [rows, user?.id]);
  const report = useMemo(() => (enrichedRows.length ? buildCampaignGroupReport(enrichedRows, true) : null), [enrichedRows]);
  // 【用户要求】信号库的信号也可以作样本：时间点 = 那条信号的时间，读数 s = 星级
  const signals = useMemo(() => loadSignals(), []);
  const samples = useMemo<Record<SampleSource, SampleRow[] | null>>(() => ({
    campaigns: report && complete ? report.rows.map(campaignSample) : null,
    signals: signals.map(signalSample),
  }), [report, complete, signals]);
  const [notes, setNotes] = usePersistedState<Record<string, DeepDigNote>>(NOTES_KEY, {});
  const [savedDefs, setSavedDefs] = usePersistedState<DeepDigFeatureDef[]>(FEATURES_KEY, []);
  const [excludedMap, setExcludedMap] = usePersistedState<Record<string, string[]>>(EXCLUDED_KEY, {});
  const excludedOf = (id: string) => (Array.isArray(excludedMap?.[id]) ? excludedMap[id] : []);
  const [commandsMap, setCommandsMap] = usePersistedState<Record<string, string>>(COMMANDS_KEY, {});
  const defs = useMemo(() => mergeFeatureDefs(Array.isArray(savedDefs) ? savedDefs : []), [savedDefs]);
  useEffect(()=>{setSavedDefs(prev=>ensureFeatureCopies(Array.isArray(prev)?prev:[]));},[setSavedDefs]);
  const def = slug ? defs.find(d => d.id === slug) : undefined;

  /**
   * 【用户要求】2026-10-16「特征值也做成可删减的，只是要非常隐形」：新增项连同规律、删减、本机结果一起删；
   * 内置项只是隐藏（定义与结果都留着），目录底部可以恢复。
   */
  const deleteFeature = (target: DeepDigFeatureDef) => {
    if (target.builtin) {
      setSavedDefs(prev => {
        const list = Array.isArray(prev) ? prev : [];
        const current = list.find(d => d.id === target.id);
        return [...list.filter(d => d.id !== target.id), { ...(current ?? { ...target, builtin: undefined }), removed: true, visibilityVersion: target.visibilityVersion }];
      });
      return;
    }
    setSavedDefs(prev => (Array.isArray(prev) ? prev : []).filter(d => d.id !== target.id));
    setNotes(prev => { const copy = { ...prev }; delete copy[target.id]; return copy; });
    setExcludedMap(prev => { const copy = { ...prev }; delete copy[target.id]; return copy; });
    setCommandsMap(prev => { const copy = { ...prev }; delete copy[target.id]; return copy; });
    forgetDeepDigResult(user?.id, target.id);
  };
  const restoreFeature = (id: string) => setSavedDefs(prev => {
    const list = Array.isArray(prev) ? prev : [];
    const current = list.find(d => d.id === id);
    if (!current) return list;
    const { removed: _removed, ...rest } = current;
    return list.map(d => (d.id === id ? rest : d));
  });

  const addFeature = () => {
    const created = newFeatureTemplate(Date.now());
    setSavedDefs(prev => [...(Array.isArray(prev) ? prev : []), created]);
    nav(`/journal/deep-dig/${created.id}?edit=1`);
  };

  const copyFeature = (source: DeepDigFeatureDef) => {
    const copied = copyFeatureDefinition(source, [...defs, ...(Array.isArray(savedDefs) ? savedDefs : [])]);
    setSavedDefs(prev => saveFeatureDefinition(Array.isArray(prev) ? prev : [], copied));
    nav('/journal/deep-dig/' + copied.id + '?edit=1');
  };

  if (slug && !def) return <Navigate to="/journal/deep-dig" replace />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[980px] items-center gap-3 px-4 sm:px-6">
          <BackButton />
          <div className="min-w-0">
            <h1 className="text-[14px] font-medium">Deep dig</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {def ? def.name : '按特征值深挖'}<span className="max-sm:hidden"> · 描述统计 · 推断统计 · 规律提取</span>
            </p>
          </div>
          {def && <button type="button" onClick={() => copyFeature(def)} aria-label="复制特征值" title="复制为独立的新特征值" className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" />复制</button>}
        </div>
      </header>
      <main className="mx-auto max-w-[980px] px-4 py-5 sm:px-6">
        {def ? (
          <FeaturePage
            key={def.id}
            def={def}
            userId={user?.id}
            report={report}
            blockedReason={!user ? '登录后才能运行'
              : (def.source ?? 'campaigns') === 'signals' ? (signals.length ? null : '信号库是空的')
                : !report || !complete ? `读取战役中… ${loaded} / ${total}` : null}
            samples={samples}
            signals={signals}
            note={notes[def.id] ?? null}
            excluded={excludedOf(def.id)}
            commands={typeof commandsMap?.[def.id] === 'string' ? commandsMap[def.id] : defaultFeatureCommands(def.id)}
            onCommandsChange={text => setCommandsMap(prev => {
              const copy = { ...prev };
              if (text === defaultFeatureCommands(def.id)) delete copy[def.id]; else copy[def.id] = text;
              return copy;
            })}
            onExcludedChange={ids => setExcludedMap(prev => {
              const copy = { ...prev };
              if (ids.length) copy[def.id] = ids; else delete copy[def.id];
              return copy;
            })}
            onSaveNote={next => setNotes(prev => {
              const copy = { ...prev };
              if (next) copy[def.id] = next; else delete copy[def.id];
              return copy;
            })}
            onSaveDef={next => setSavedDefs(prev => saveFeatureDefinition(Array.isArray(prev) ? prev : [], next))}
            onDeleteDef={def.builtin ? undefined : () => {
              deleteFeature(def);
              nav('/journal/deep-dig', { replace: true });
            }}
          />
        ) : (
          <DeepDigDirectory
            defs={defs}
            results={Object.fromEntries(defs.map(d => [d.id, loadDeepDigResults(user?.id, d.id)]))}
            excluded={Object.fromEntries(defs.map(d => [d.id, excludedOf(d.id)]))}
            notes={notes}
            onOpen={(s, t) => nav(`/journal/deep-dig/${s}${t === 'describe' ? '' : `?tab=${t}`}`)}
            onAdd={addFeature}
            onCopy={copyFeature}
            onDelete={deleteFeature}
            removed={removedBuiltins(Array.isArray(savedDefs) ? savedDefs : [])}
            onRestore={restoreFeature}
          />
        )}
      </main>
    </div>
  );
}

function FeaturePage({ def, userId, report, samples, signals, blockedReason, note, onSaveNote, onSaveDef, onDeleteDef, excluded, onExcludedChange, commands, onCommandsChange }: {
  commands: string;
  onCommandsChange: (text: string) => void;
  samples: Record<SampleSource, SampleRow[] | null>;
  signals: TradeSignal[];
  excluded: string[];
  onExcludedChange: (ids: string[]) => void;
  def: DeepDigFeatureDef;
  userId: string | undefined;
  report: CampaignGroupReport | null;
  blockedReason: string | null;
  note: DeepDigNote | null;
  onSaveNote: (note: DeepDigNote | null) => void;
  onSaveDef: (def: DeepDigFeatureDef) => void;
  onDeleteDef?: () => void;
}) {
  const nav = useNavigate();
  const location = useLocation();
  const run = useDeepDigRun(userId, def);
  const params = new URLSearchParams(location.search);

  // 从战役返回：滚回点进去之前的位置（按这条 history 记录记的，只用一次）
  useEffect(() => {
    if (!run.data) return;
    const storageKey = `${SCROLL_KEY_PREFIX}${location.key}`;
    let saved: number;
    try {
      saved = Number(sessionStorage.getItem(storageKey));
      sessionStorage.removeItem(storageKey);
    } catch {
      return;
    }
    if (!Number.isFinite(saved) || saved <= 0) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: saved }));
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.data != null, location.key]);

  /** 换分页 / 分组 / 编辑状态不新增 history 记录：返回键仍是「回到上一页」。 */
  const setParam = (key: 'tab' | 'g' | 'all' | 'edit', value: string, fallback: string) => {
    const next = new URLSearchParams(location.search);
    if (value === fallback) next.delete(key); else next.set(key, value);
    const search = next.toString();
    nav({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  };

  const openCampaign = (campaignId: string) => {
    try {
      sessionStorage.setItem(`${SCROLL_KEY_PREFIX}${location.key}`, String(window.scrollY));
    } catch {
      // 存不了也照样跳，只是回来时不回到原位置
    }
    // 详情页对 fromCampaignList 的处理是退回上一条 history 记录，正好回到这一页的原样
    nav(`/journal/campaigns/${campaignId}`, { state: { fromCampaignList: true } });
  };

  return (
    <FeatureView
      def={def}
      editing={params.get('edit') === '1'}
      onEditingChange={v => setParam('edit', v ? '1' : '0', '0')}
      onSaveDef={onSaveDef}
      onResetDef={def.builtin ? () => {} : undefined}
      onDeleteDef={onDeleteDef}
      samples={samples}
      data={run.data}
      series={run.series}
      inference={run.inference}
      describeStatus={run.describeStatus}
      describeProgress={run.describeProgress}
      describeError={run.describeError}
      canDescribe={!blockedReason && run.describeStatus !== 'running'}
      blockedReason={blockedReason}
      onDescribe={() => { if (report || (def.source ?? 'campaigns') === 'signals') void run.describe(report ?? EMPTY_REPORT, signals); }}
      onCancel={run.cancel}
      inferStatus={run.inferStatus}
      inferError={run.inferError}
      onInfer={(data, key) => { void run.infer(data, key, commands); }}
      commands={commands}
      onCommandsChange={onCommandsChange}
      onDownload={run.download}
      excluded={excluded}
      onExcludedChange={onExcludedChange}
      tab={parseTab(location.search)}
      onTabChange={t => setParam('tab', t, 'describe')}
      group={parseGroup(location.search)}
      onGroupChange={g => setParam('g', g, 'positive')}
      showAll={params.get('all') === '1'}
      onShowAllChange={v => setParam('all', v ? '1' : '0', '0')}
      onOpenCampaign={openCampaign}
      note={note}
      onSaveNote={onSaveNote}
    />
  );
}

export function DeepDigDirectory({ defs, results, excluded = {}, notes, onOpen, onAdd, onCopy, onDelete, removed = [], onRestore }: {
  onDelete?: (def: DeepDigFeatureDef) => void;
  onCopy?: (def: DeepDigFeatureDef) => void;
  removed?: readonly DeepDigFeatureDef[];
  onRestore?: (id: string) => void;
  defs: readonly DeepDigFeatureDef[];
  results: Record<string, { data: DeepDigData | null; inference: DeepDigInference | null }>;
  excluded?: Record<string, readonly string[]>;
  notes: Record<string, DeepDigNote>;
  onOpen: (id: string, tab: DeepDigTab) => void;
  onAdd: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const groups = groupDeepDigFeatures(defs);
  let ordinal = 0;
  return (
    <section className="space-y-2 text-[12px]" data-testid="deep-dig-directory">
      <h2 className="text-[12.5px] font-medium">目录<span className="ml-2 text-[11px] font-normal text-muted-foreground">特征值 {defs.length}</span></h2>
      <div className="space-y-5 pt-1">
        {groups.map(group => <section key={group.key} aria-label={group.title} data-testid={`deep-dig-group-${group.key}`}>
          <h3 className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/50 px-3 py-2 text-[11.5px] font-medium text-foreground/85">
            {group.title}<span className="font-mono text-[10px] font-normal tabular-nums text-muted-foreground">{group.items.length}</span>
          </h3>
          <ol className="mt-1 divide-y divide-border/50 px-3" start={ordinal+1}>
        {group.items.map(f => (
          <li key={f.id} className="group/entry grid grid-cols-[22px_1fr] gap-x-1 py-2.5" data-testid="deep-dig-entry" onMouseLeave={() => setConfirming(c => (c === f.id ? null : c))}>
            <span className="pt-px font-mono tabular-nums text-muted-foreground">{String(++ordinal).padStart(2, '0')}</span>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <button
                  type="button"
                  data-testid={`deep-dig-open-${f.id}`}
                  onClick={() => onOpen(f.id, 'describe')}
                  className="group inline-flex items-center gap-0.5 text-left text-[13px] font-medium hover:underline"
                >
                  {f.name}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
                </button>
                {onCopy && <button type="button" aria-label={'复制 ' + f.name} title="复制为独立的新特征值" data-testid={'deep-dig-copy-' + f.id} onClick={() => onCopy(f)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/entry:opacity-100 max-sm:opacity-60"><Copy className="h-3 w-3" /></button>}
                {/* 不常用：平时看不见，鼠标移到这一项上才淡淡出现；点了还要再确认一次 */}
                {onDelete && (confirming === f.id ? (
                  <span className="inline-flex items-center gap-2 text-[11px]">
                    <button type="button" onClick={() => { onDelete(f); setConfirming(null); }} data-testid={`deep-dig-delete-confirm-${f.id}`} className="text-[#F6465D] hover:underline">
                      {f.builtin ? '从目录删掉（可恢复）' : '删除这个特征值'}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className="text-muted-foreground hover:text-foreground">取消</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label="删除特征值"
                    title="删除特征值"
                    data-testid={`deep-dig-delete-${f.id}`}
                    onClick={() => setConfirming(f.id)}
                    className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:text-[#F6465D] focus-visible:opacity-100 group-hover/entry:opacity-100 max-sm:opacity-30"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                ))}
                <FeatureCreationTime def={f} />
              </div>
              <div className="flex flex-wrap items-center gap-x-1 text-[11.5px]">
                {DEEP_DIG_TABS.map((t, k) => (
                  <span key={t.key} className="inline-flex items-center gap-1">
                    {k > 0 && <span className="text-border">·</span>}
                    <button
                      type="button"
                      data-testid={`deep-dig-open-${f.id}-${t.key}`}
                      onClick={() => onOpen(f.id, t.key)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {t.label}
                      {t.key === 'rules' && notes[f.id] && <span className="ml-0.5 text-[10.5px] text-[#8F6B00] dark:text-[#F0B90B]">已改</span>}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </li>
        ))}
          </ol>
        </section>)}
      </div>
      <button
        type="button"
        onClick={onAdd}
        data-testid="deep-dig-add"
        className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2.5 text-[12px] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />新增特征值
      </button>
      {removed.length > 0 && onRestore && (
        <div className="text-[11px] text-muted-foreground/60" data-testid="deep-dig-removed-features">
          已删：{removed.map((f, k) => (
            <span key={f.id}>{k ? '、' : ''}{f.name} <button type="button" onClick={() => onRestore(f.id)} data-testid={`deep-dig-restore-${f.id}`} className="underline-offset-2 hover:text-foreground hover:underline">恢复</button></span>
          ))}
        </div>
      )}
    </section>
  );
}
