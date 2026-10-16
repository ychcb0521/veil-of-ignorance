/**
 * /journal/deep-dig — Deep dig：按特征值深挖（复盘中心里「规则」正下方）。
 *
 * 【用户要求】2026-10-16「“deep RSA”统一改成 “deep dig”……按照特征值来做成目录（目前我只关注多空博弈均衡点漂移速度这一个特征值），
 * 每个特征值又可以分成 3 个模块：描述统计、推断统计、规律提取……我喜欢简洁、美观」。
 *   /journal/deep-dig            目录：特征值列表，每项下面是三个模块的入口
 *   /journal/deep-dig/:feature   某个特征值：?tab= 模块，?g= 数据分组（都放网址上，从战役返回回到原处）
 * 只读研究页：不改交易逻辑，不自动实盘，不编造结果。分组取交易战役列表同一份缓存行。
 */
import { useEffect, useMemo } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { BackButton } from '@/components/journal/BackButton';
import { DEEP_DIG_TABS, DriftSpeedView, type DeepDigNote, type DeepDigTab } from '@/components/journal/deepDig/DriftSpeedView';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { useCampaignList } from '@/hooks/useCampaignList';
import { useDriftSpeed } from '@/hooks/useDriftSpeed';
import { usePersistedState } from '@/hooks/usePersistedState';
import { bp, DEEP_DIG_FEATURES, DRIFT_GROUPS, DRIFT_UNIT, pText, type DriftGroup, type DriftSpeedResult } from '@/lib/deepDig/driftSpeed';
import { buildCampaignGroupReport } from '@/lib/deepRsa/report';

const SCROLL_KEY_PREFIX = 'journal-deep-dig-scroll:';
/** 手动修改过的「规律提取」：特征 slug → 内容（跟账号走）。 */
const NOTES_KEY = 'deep_dig_notes_v1';

function parseTab(search: string): DeepDigTab {
  const t = new URLSearchParams(search).get('tab');
  return DEEP_DIG_TABS.some(x => x.key === t) ? (t as DeepDigTab) : 'describe';
}
function parseGroup(search: string): DriftGroup {
  const g = new URLSearchParams(search).get('g');
  return DRIFT_GROUPS.includes(g as DriftGroup) ? (g as DriftGroup) : 'positive';
}

export default function JournalDeepDigPage() {
  const { feature: slug } = useParams<{ feature?: string }>();
  const nav = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { tradeHistory, ordersMap, filledOrders, positionsMap } = useTradingContext();
  const { rows, complete, loaded, total } = useCampaignList(user?.id, { tradeHistory, ordersMap, filledOrders, positionsMap });
  const report = useMemo(() => (rows.length ? buildCampaignGroupReport(rows, true) : null), [rows]);
  const drift = useDriftSpeed(user?.id);
  const [notes, setNotes] = usePersistedState<Record<string, DeepDigNote>>(NOTES_KEY, {});
  const feature = DEEP_DIG_FEATURES.find(f => f.slug === slug);
  const tab = parseTab(location.search);
  const group = parseGroup(location.search);

  // 从战役返回：滚回点进去之前的位置（按这条 history 记录记的，只用一次）
  useEffect(() => {
    if (!feature || !drift.result) return;
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
  }, [feature != null, drift.result != null, location.key]);

  if (slug && !feature) return <Navigate to="/journal/deep-dig" replace />;

  /** 换分页 / 分组不新增 history 记录：返回键仍是「回到上一页」。 */
  const setParam = (key: 'tab' | 'g' | 'all', value: string, fallback: string) => {
    const params = new URLSearchParams(location.search);
    if (value === fallback) params.delete(key); else params.set(key, value);
    const search = params.toString();
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

  const blockedReason = !user ? '登录后才能运行'
    : !report || !complete ? `读取战役中… ${loaded} / ${total}`
      : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[980px] items-center gap-3 px-4 sm:px-6">
          <BackButton />
          <div className="min-w-0">
            <h1 className="text-[14px] font-medium">Deep dig</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {feature ? feature.short : '按特征值深挖'}<span className="max-sm:hidden"> · 描述统计 · 推断统计 · 规律提取</span>
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[980px] px-4 py-5 sm:px-6">
        {feature ? (
          <DriftSpeedView
            result={drift.result}
            status={drift.status}
            progress={drift.progress}
            error={drift.error}
            canRun={!blockedReason && drift.status !== 'running'}
            blockedReason={blockedReason}
            onRun={() => { if (report) void drift.run(report); }}
            onCancel={drift.cancel}
            onDownload={drift.download}
            tab={tab}
            onTabChange={t => setParam('tab', t, 'describe')}
            group={group}
            onGroupChange={g => setParam('g', g, 'positive')}
            showAll={new URLSearchParams(location.search).get('all') === '1'}
            onShowAllChange={v => setParam('all', v ? '1' : '0', '0')}
            onOpenCampaign={openCampaign}
            note={notes[feature.slug] ?? null}
            onSaveNote={next => setNotes(prev => {
              const copy = { ...prev };
              if (next) copy[feature.slug] = next; else delete copy[feature.slug];
              return copy;
            })}
          />
        ) : (
          <DeepDigDirectory result={drift.result} notes={notes} onOpen={(s, t) => nav(`/journal/deep-dig/${s}${t === 'describe' ? '' : `?tab=${t}`}`)} />
        )}
      </main>
    </div>
  );
}

function summaryOf(result: DriftSpeedResult | null): string | null {
  if (!result) return null;
  const g = Object.fromEntries(result.groups.map(s => [s.group, s]));
  const parts = [`中位数 实验组 ${bp(g.positive?.median)} · 对照组 ${bp(g.control?.median)} ${DRIFT_UNIT}`];
  if (result.tTest) parts.push(`t 检验 p ${pText(result.tTest.p)}`);
  if (result.label) parts.push(`AUC ${Number.isFinite(result.label.auc) ? result.label.auc.toFixed(2) : '—'}`);
  return parts.join(' · ');
}

export function DeepDigDirectory({ result, notes, onOpen }: {
  result: DriftSpeedResult | null;
  notes: Record<string, DeepDigNote>;
  onOpen: (slug: string, tab: DeepDigTab) => void;
}) {
  return (
    <section className="space-y-2 text-[12px]" data-testid="deep-dig-directory">
      <h2 className="text-[12.5px] font-medium">目录<span className="ml-2 text-[11px] font-normal text-muted-foreground">特征值</span></h2>
      <ol className="divide-y divide-border/60 border-y border-border/60">
        {DEEP_DIG_FEATURES.map((f, i) => (
          <li key={f.slug} className="grid grid-cols-[22px_1fr] gap-x-1 py-2.5">
            <span className="pt-px font-mono tabular-nums text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
            <div className="min-w-0 space-y-1">
              <button
                type="button"
                data-testid={`deep-dig-open-${f.slug}`}
                onClick={() => onOpen(f.slug, 'describe')}
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
                      data-testid={`deep-dig-open-${f.slug}-${t.key}`}
                      onClick={() => onOpen(f.slug, t.key)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {t.label}
                      {t.key === 'rules' && notes[f.slug] && <span className="ml-0.5 text-[10.5px] text-[#8F6B00] dark:text-[#F0B90B]">已改</span>}
                    </button>
                  </span>
                ))}
              </div>
              <div className="font-mono text-[11px] tabular-nums text-muted-foreground">{summaryOf(result) ?? <span className="font-sans">未运行</span>}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
