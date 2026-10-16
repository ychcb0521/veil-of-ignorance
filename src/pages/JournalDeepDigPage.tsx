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
import { useEffect, useMemo } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { BackButton } from '@/components/journal/BackButton';
import { DEEP_DIG_TABS, FeatureView, type DeepDigNote, type DeepDigTab } from '@/components/journal/deepDig/FeatureView';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { useCampaignList } from '@/hooks/useCampaignList';
import { forgetDeepDigResult, loadDeepDigResults, useDeepDigRun } from '@/hooks/useDeepDigRun';
import { usePersistedState } from '@/hooks/usePersistedState';
import { applyExclusions, DEEP_DIG_GROUPS, exclusionKey, fmtValue, pText, type DeepDigData, type DeepDigInference, type DeepDigRowGroup } from '@/lib/deepDig/analysis';
import { BUILTIN_FEATURES, mergeFeatureDefs, newFeatureTemplate, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { buildCampaignGroupReport, type CampaignGroupReport } from '@/lib/deepRsa/report';

const SCROLL_KEY_PREFIX = 'journal-deep-dig-scroll:';
/** 手动修改过的「规律提取」：特征值 id → 内容（跟账号走）。 */
const NOTES_KEY = 'deep_dig_notes_v1';
/** 改过的内置特征值与新增的特征值（跟账号走）。 */
const FEATURES_KEY = 'deep_dig_features_v1';
/** 描述统计里手动删掉的行：特征值 id → 事件 id（跟账号走）。 */
const EXCLUDED_KEY = 'deep_dig_excluded_v1';

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
  const { user } = useAuth();
  const { tradeHistory, ordersMap, filledOrders, positionsMap } = useTradingContext();
  const { rows, complete, loaded, total } = useCampaignList(user?.id, { tradeHistory, ordersMap, filledOrders, positionsMap });
  const report = useMemo(() => (rows.length ? buildCampaignGroupReport(rows, true) : null), [rows]);
  const [notes, setNotes] = usePersistedState<Record<string, DeepDigNote>>(NOTES_KEY, {});
  const [savedDefs, setSavedDefs] = usePersistedState<DeepDigFeatureDef[]>(FEATURES_KEY, []);
  const [excludedMap, setExcludedMap] = usePersistedState<Record<string, string[]>>(EXCLUDED_KEY, {});
  const excludedOf = (id: string) => (Array.isArray(excludedMap?.[id]) ? excludedMap[id] : []);
  const defs = useMemo(() => mergeFeatureDefs(Array.isArray(savedDefs) ? savedDefs : []), [savedDefs]);
  const def = slug ? defs.find(d => d.id === slug) : undefined;

  const addFeature = () => {
    const created = newFeatureTemplate(Date.now());
    setSavedDefs(prev => [...(Array.isArray(prev) ? prev : []), created]);
    nav(`/journal/deep-dig/${created.id}?edit=1`);
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
        </div>
      </header>
      <main className="mx-auto max-w-[980px] px-4 py-5 sm:px-6">
        {def ? (
          <FeaturePage
            key={def.id}
            def={def}
            userId={user?.id}
            report={report}
            blockedReason={!user ? '登录后才能运行' : !report || !complete ? `读取战役中… ${loaded} / ${total}` : null}
            note={notes[def.id] ?? null}
            excluded={excludedOf(def.id)}
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
            onSaveDef={next => setSavedDefs(prev => {
              const list = (Array.isArray(prev) ? prev : []).filter(d => d.id !== next.id);
              const builtin = BUILTIN_FEATURES.find(b => b.id === next.id);
              // 内置项改回与默认完全一样时不再存覆盖
              const same = builtin && (['name', 'short', 'definition', 'formula', 'scale', 'unit', 'positive', 'control'] as const).every(k => builtin[k] === next[k]);
              return same ? list : [...list, { ...next, builtin: undefined }];
            })}
            onDeleteDef={def.builtin ? undefined : () => {
              setSavedDefs(prev => (Array.isArray(prev) ? prev : []).filter(d => d.id !== def.id));
              setNotes(prev => { const copy = { ...prev }; delete copy[def.id]; return copy; });
              setExcludedMap(prev => { const copy = { ...prev }; delete copy[def.id]; return copy; });
              forgetDeepDigResult(user?.id, def.id);
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
          />
        )}
      </main>
    </div>
  );
}

function FeaturePage({ def, userId, report, blockedReason, note, onSaveNote, onSaveDef, onDeleteDef, excluded, onExcludedChange }: {
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
      groupRows={report?.rows ?? null}
      data={run.data}
      inference={run.inference}
      describeStatus={run.describeStatus}
      describeProgress={run.describeProgress}
      describeError={run.describeError}
      canDescribe={!blockedReason && run.describeStatus !== 'running'}
      blockedReason={blockedReason}
      onDescribe={() => { if (report) void run.describe(report); }}
      onCancel={run.cancel}
      inferStatus={run.inferStatus}
      inferError={run.inferError}
      onInfer={(data, key) => { void run.infer(data, key); }}
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

function summaryOf(r: { data: DeepDigData | null; inference: DeepDigInference | null } | undefined, excluded: readonly string[]): string | null {
  if (!r?.data) return null;
  const data = applyExclusions(r.data, excluded);
  const d = data.definition;
  const g = Object.fromEntries(data.groups.map(s => [s.group, s]));
  const parts = [`中位数 实验组 ${fmtValue(d, g.positive?.median)} · 对照组 ${fmtValue(d, g.control?.median)}${d.unit ? ` ${d.unit}` : ''}`];
  const inf = r.inference;
  // 推断统计只在对应这份数据与删减时才进摘要
  if (inf && inf.dataFinishedAt === r.data.finishedAt && (inf.excludedKey ?? '') === exclusionKey(r.data, excluded)) {
    if (inf.tTest) parts.push(`t 检验 p ${pText(inf.tTest.p)}`);
    if (inf.label) parts.push(`AUC ${Number.isFinite(inf.label.auc) ? inf.label.auc.toFixed(2) : '—'}`);
  }
  return parts.join(' · ');
}

export function DeepDigDirectory({ defs, results, excluded = {}, notes, onOpen, onAdd }: {
  defs: readonly DeepDigFeatureDef[];
  results: Record<string, { data: DeepDigData | null; inference: DeepDigInference | null }>;
  excluded?: Record<string, readonly string[]>;
  notes: Record<string, DeepDigNote>;
  onOpen: (id: string, tab: DeepDigTab) => void;
  onAdd: () => void;
}) {
  return (
    <section className="space-y-2 text-[12px]" data-testid="deep-dig-directory">
      <h2 className="text-[12.5px] font-medium">目录<span className="ml-2 text-[11px] font-normal text-muted-foreground">特征值 {defs.length}</span></h2>
      <ol className="divide-y divide-border/60 border-y border-border/60">
        {defs.map((f, i) => (
          <li key={f.id} className="grid grid-cols-[22px_1fr] gap-x-1 py-2.5" data-testid="deep-dig-entry">
            <span className="pt-px font-mono tabular-nums text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
            <div className="min-w-0 space-y-1">
              <button
                type="button"
                data-testid={`deep-dig-open-${f.id}`}
                onClick={() => onOpen(f.id, 'describe')}
                className="group inline-flex items-center gap-0.5 text-left text-[13px] font-medium hover:underline"
              >
                {f.name}
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
              </button>
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
              <div className="font-mono text-[11px] tabular-nums text-muted-foreground">{summaryOf(results[f.id], excluded[f.id] ?? []) ?? <span className="font-sans">未运行</span>}</div>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={onAdd}
        data-testid="deep-dig-add"
        className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2.5 text-[12px] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />新增特征值
      </button>
    </section>
  );
}
