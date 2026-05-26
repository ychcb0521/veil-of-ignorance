/**
 * /journal/insights — 元监控页
 * 展示错误模式趋势（30/90 天）、alpha 时段、规则有效性。
 */
import { useEffect, useMemo, useState } from 'react';
import { BackButton } from '@/components/journal/BackButton';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  listAllCampaigns,
  listAllJournalDataForUser,
  listCounterfactuals,
  type BulkJournalData,
} from '@/lib/journalApi';
import {
  groupJournalsByPattern, computeTimeDistribution,
  computeMentalStateDistribution,
} from '@/lib/journalAggregations';
import {
  brierScore,
  formatDeltaWithCI,
  meanConfidenceInterval,
  ruleEffectNetOfBaseline,
  wilsonInterval,
} from '@/lib/insightsStats';
import { isHistoricalCampaign } from '@/types/journal';
import type { TradeCampaign, TradeJournal } from '@/types/journal';

type Range = 7 | 30 | 90;
const DAY = 24 * 3600_000;

interface CampaignEconomicStats {
  totalDeviationCost: number;
  topReasons: Array<{ reason: string; count: number; totalCost: number }>;
  unavailable?: boolean;
}

const EMPTY_CAMPAIGN_ECONOMIC: CampaignEconomicStats = {
  totalDeviationCost: 0,
  topReasons: [],
};

function parseDeductionReason(sourceDeductionId: string | null) {
  if (!sourceDeductionId) return '未命名违规';
  const parts = sourceDeductionId.split(':');
  return parts.slice(2).join(':') || parts[parts.length - 1] || '未命名违规';
}

function isClosedCampaign(campaign: TradeCampaign, sinceMs: number) {
  if (!campaign.closed_at) return false;
  if (!['closed_profit', 'closed_loss', 'closed_breakeven', 'abandoned'].includes(campaign.status)) return false;
  return new Date(campaign.closed_at).getTime() >= sinceMs;
}

function pct(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

function pctRange([low, high]: [number, number]) {
  return `${pct(low)}~${pct(high)}`;
}

async function loadCampaignEconomicStats(userId: string): Promise<CampaignEconomicStats> {
  const sinceMs = Date.now() - 30 * DAY;
  const campaignRows = (await listAllCampaigns(userId))
    .filter(campaign => isClosedCampaign(campaign, sinceMs) && !isHistoricalCampaign(campaign));
  if (campaignRows.length === 0) return EMPTY_CAMPAIGN_ECONOMIC;

  const pnlMap = new Map(campaignRows.map(item => [item.id, item.final_realized_pnl ?? 0]));
  const grouped = new Map<string, { reason: string; count: number; totalCost: number }>();
  let totalDeviationCost = 0;

  const branches = await Promise.all(campaignRows.map(campaign => listCounterfactuals(campaign.id)));
  for (const row of branches.flat().filter(branch => branch.branch_kind === 'fix_one_deviation')) {
    const actual = pnlMap.get(row.campaign_id) ?? 0;
    const branchPnl = row.result?.final_realized_pnl ?? 0;
    const cost = Math.max(0, branchPnl - actual);
    totalDeviationCost += cost;
    const reason = parseDeductionReason(row.source_deduction_id);
    const prev = grouped.get(reason) ?? { reason, count: 0, totalCost: 0 };
    prev.count += 1;
    prev.totalCost += cost;
    grouped.set(reason, prev);
  }

  return {
    totalDeviationCost,
    topReasons: [...grouped.values()]
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 3),
  };
}

export default function JournalInsightsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<BulkJournalData | null>(null);
  const [campaigns, setCampaigns] = useState<TradeCampaign[]>([]);
  const [campaignEconomic, setCampaignEconomic] = useState<CampaignEconomicStats | null>(null);
  const [range, setRange] = useState<Range>(30);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setLoading(false);
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const [d, campaignRows] = await Promise.all([
          listAllJournalDataForUser(user.id),
          listAllCampaigns(user.id),
        ]);
        if (cancelled) return;
        setData(d);
        setCampaigns(campaignRows);
        setCampaignEconomic(EMPTY_CAMPAIGN_ECONOMIC);
        setLoading(false);

        try {
          const economicStats = await loadCampaignEconomicStats(user.id);
          if (!cancelled) setCampaignEconomic(economicStats);
        } catch (e) {
          console.warn('[JournalInsightsPage] 战役经济成本暂不可用', e);
          if (!cancelled) {
            setCampaignEconomic({ ...EMPTY_CAMPAIGN_ECONOMIC, unavailable: true });
            toast.warning('战役经济成本暂不可用，元监控其他数据已正常加载');
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) {
          setLoadError(message);
          toast.error(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const stats = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const sinceMs = now - range * DAY;
    const cur = data.journals.filter(j =>
      now - new Date(j.pre_simulated_time).getTime() <= range * DAY,
    );
    const prev = data.journals.filter(j => {
      const diff = now - new Date(j.pre_simulated_time).getTime();
      return diff > range * DAY && diff <= 2 * range * DAY;
    });
    const curClusters = groupJournalsByPattern(cur, data.assignments, data.patterns, data.categories);
    const prevClusters = groupJournalsByPattern(prev, data.assignments, data.patterns, data.categories);
    const prevMap = new Map(prevClusters.map(c => [c.pattern.id, c.stats.occurrence_count]));

    const trend = curClusters.map(c => ({
      pattern: c.pattern,
      cur: c.stats.occurrence_count,
      prev: prevMap.get(c.pattern.id) ?? 0,
      delta: c.stats.occurrence_count - (prevMap.get(c.pattern.id) ?? 0),
      avg_pnl: c.stats.avg_pnl,
    })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const timeDist = computeTimeDistribution(cur);
    const mentalDist = computeMentalStateDistribution(cur);
    const closedCampaigns = campaigns.filter(campaign => isClosedCampaign(campaign, sinceMs));
    const historicalCampaigns = closedCampaigns.filter(isHistoricalCampaign);
    const curCampaigns = closedCampaigns.filter(campaign => !isHistoricalCampaign(campaign));
    const campaignWinCount = curCampaigns.filter(campaign =>
      campaign.status === 'closed_profit' || (campaign.final_realized_pnl ?? 0) > 0,
    ).length;
    const campaignWinCi = wilsonInterval(campaignWinCount, curCampaigns.length);
    const campaignRValues = curCampaigns
      .map(campaign => campaign.final_r_multiple)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const averageRelativeExpectancy = campaignRValues.length === 0
      ? 0
      : campaignRValues.reduce((sum, value) => sum + value, 0) / campaignRValues.length;
    const averageRelativeExpectancyCi = meanConfidenceInterval(campaignRValues);
    const mainOrders = cur.filter(j => j.order_kind === 'main');
    const hedgeOrders = cur.filter(j => j.order_kind === 'hedge');
    const avgR = (arr: TradeJournal[]) => {
      const withR = arr.filter(j => j.post_r_multiple != null);
      if (withR.length === 0) return 0;
      return withR.reduce((sum, j) => sum + (j.post_r_multiple ?? 0), 0) / withR.length;
    };
    const winRate = (arr: TradeJournal[]) => {
      if (arr.length === 0) return 0;
      return arr.filter(j => j.post_outcome === 'win').length / arr.length;
    };
    const crossCount = data.journals.filter(j => j.position_mode === 'cross').length;

    // Alpha 时段：avg_pnl > 0 且 count >= 3 的小时段
    const alphaHours = timeDist.filter(b => b.count >= 3 && b.avg_pnl > 0)
      .sort((a, b) => b.avg_pnl - a.avg_pnl).slice(0, 5);

    // 规则有效性：拥有规则后是否减少了对应 pattern 出现频次
    const ruleEffect = data.rules
      .filter(r => r.source_pattern_id && r.added_to_checklist && r.is_active)
      .map(r => {
        const since = new Date(r.activated_at ?? r.created_at).getTime();
        const afterEnd = Math.min(now, since + range * DAY);
        const windowMs = Math.max(0, afterEnd - since);
        const beforeStart = since - windowMs;
        const before = data.assignments.filter(a =>
          a.pattern_id === r.source_pattern_id &&
          new Date(a.created_at).getTime() < since &&
          new Date(a.created_at).getTime() >= beforeStart,
        ).length;
        const after = data.assignments.filter(a =>
          a.pattern_id === r.source_pattern_id &&
          new Date(a.created_at).getTime() >= since &&
          new Date(a.created_at).getTime() <= afterEnd,
        ).length;
        const globalBefore = data.assignments.filter(a => {
          const ts = new Date(a.created_at).getTime();
          return ts >= beforeStart && ts < since;
        }).length;
        const globalAfter = data.assignments.filter(a => {
          const ts = new Date(a.created_at).getTime();
          return ts >= since && ts <= afterEnd;
        }).length;
        const pattern = data.patterns.find(p => p.id === r.source_pattern_id);
        const ci = formatDeltaWithCI(before, after);
        const baseline = ruleEffectNetOfBaseline(before, after, globalBefore, globalAfter);
        return { rule: r, pattern, before, after, delta: after - before, ci, baseline, globalBefore, globalAfter };
      });

    const calibrationSamples = cur
      .filter(j => j.pre_calibration_win_pct != null && j.post_outcome != null && j.post_outcome !== 'no_entry')
      .map(j => ({
        predProb: Math.min(1, Math.max(0, (j.pre_calibration_win_pct ?? 0) / 100)),
        outcomeWin: j.post_outcome === 'win',
      }));
    const calibrationWins = calibrationSamples.filter(sample => sample.outcomeWin).length;
    const calibrationCi = wilsonInterval(calibrationWins, calibrationSamples.length);
    const avgPredictedWinRate = calibrationSamples.length === 0
      ? 0
      : calibrationSamples.reduce((sum, sample) => sum + sample.predProb, 0) / calibrationSamples.length;
    const calibration = {
      count: calibrationSamples.length,
      brier: brierScore(calibrationSamples),
      avgPredictedWinRate,
      actualWinRate: calibrationSamples.length === 0 ? 0 : calibrationWins / calibrationSamples.length,
      ci: calibrationCi,
    };
    const restraintCount = cur.filter(j => j.direction === 'no_entry' || j.post_outcome === 'no_entry').length;

    // 深度分析完成率：六步全填的占已评价 journal 比
    const reviewed = cur.filter(j => !!j.post_reviewed_at);
    const deepDone = reviewed.filter(j => !!j.deep_analysis_completed_at);
    const deepRate = reviewed.length === 0 ? 0 : deepDone.length / reviewed.length;

    // R 倍数口径混合：是否同时存在带 SL 的历史 journal 与不带 SL 的新 journal
    const hasLegacySl = cur.some(j => j.pre_planned_stop_loss != null);
    const hasNewMaxLoss = cur.some(j => j.pre_planned_stop_loss == null && j.pre_max_loss_usdt != null);
    const mixedRBasis = hasLegacySl && hasNewMaxLoss;

    return {
      cur, curClusters, trend, timeDist, mentalDist, alphaHours, ruleEffect, reviewed, deepDone, deepRate, mixedRBasis,
      calibration,
      restraintCount,
      campaignOutcome: {
        count: curCampaigns.length,
        winRate: curCampaigns.length === 0 ? 0 : campaignWinCount / curCampaigns.length,
        winCi: campaignWinCi,
        averageRelativeExpectancy,
        averageRelativeExpectancyCi,
        relativeSampleCount: campaignRValues.length,
        historicalExcludedCount: historicalCampaigns.length,
      },
      orderTypeStats: {
        main: { count: mainOrders.length, winRate: winRate(mainOrders), avgR: avgR(mainOrders) },
        hedge: { count: hedgeOrders.length, winRate: winRate(hedgeOrders), avgR: avgR(hedgeOrders) },
      },
      crossCount,
    };
  }, [campaigns, data, range]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-[12px] font-mono">
        加载中…
      </div>
    );
  }

  if (loadError || !data || !stats) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
          <div className="px-6 py-3 max-w-[1400px] mx-auto flex items-center gap-3">
            <BackButton />
            <h1 className="text-[14px] font-medium">元监控</h1>
          </div>
        </header>
        <main className="max-w-[720px] mx-auto px-6 py-16">
          <div className="border border-border rounded bg-card p-6 text-center">
            <div className="text-[14px] font-medium">元监控加载失败</div>
            <div className="mt-2 text-[12px] text-muted-foreground leading-6">
              {loadError ?? '暂无可用于统计的数据。'}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 h-9 px-4 rounded bg-[#F0B90B] text-black text-[12px] font-medium hover:opacity-90"
            >
              重新加载
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-3 max-w-[1400px] mx-auto flex items-center gap-3">
          <BackButton />
          <h1 className="text-[14px] font-medium">元监控</h1>
          <div className="ml-auto flex gap-1">
            {[7, 30, 90].map(r => (
              <button key={r} onClick={() => setRange(r as Range)}
                className={`h-7 px-2 text-[11px] rounded ${range === r ? 'bg-[#F0B90B] text-black' : 'bg-muted text-foreground hover:bg-[#363c45]'}`}>
                {r}d
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-4 space-y-4">
        {/* Overview */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <StatCard
            label="总战役"
            value={stats.campaignOutcome.count.toString()}
            sub={stats.campaignOutcome.historicalExcludedCount > 0
              ? `实时已结束 · 排除历史 ${stats.campaignOutcome.historicalExcludedCount}`
              : '实时已结束战役'}
          />
          <StatCard
            label="战役胜率"
            value={pct(stats.campaignOutcome.winRate)}
            accent={stats.campaignOutcome.count === 0 ? '#848E9C' : stats.campaignOutcome.winRate >= 0.5 ? '#0ECB81' : '#F6465D'}
            sub={stats.campaignOutcome.count === 0 ? '95% CI —' : `95% CI ${pctRange(stats.campaignOutcome.winCi)}`}
          />
          <StatCard
            label="平均相对期望"
            value={stats.campaignOutcome.averageRelativeExpectancy.toFixed(2)}
            accent={stats.campaignOutcome.relativeSampleCount === 0 ? '#848E9C' : stats.campaignOutcome.averageRelativeExpectancy >= 0 ? '#0ECB81' : '#F6465D'}
            sub={stats.campaignOutcome.relativeSampleCount === 0
              ? '按实时战役 R'
              : `95% CI ${stats.campaignOutcome.averageRelativeExpectancyCi[0].toFixed(2)}~${stats.campaignOutcome.averageRelativeExpectancyCi[1].toFixed(2)}`}
          />
          <StatCard label="克制记录" value={stats.restraintCount.toString()} sub="忍住没下的单" />
          <StatCard label="错误模式数" value={stats.curClusters.length.toString()} />
          <StatCard
            label="深度分析完成率"
            value={`${(stats.deepRate * 100).toFixed(0)}%`}
            accent={stats.deepRate >= 0.5 ? '#0ECB81' : stats.deepRate > 0 ? '#F0B90B' : '#848E9C'}
            sub={`${stats.deepDone.length}/${stats.reviewed.length}`}
          />
        </div>

        {/* Pattern trend */}
        <section className="border border-border rounded bg-card">
          <div className="px-3 py-2 border-b border-border text-[12px] font-medium">错误模式趋势（vs 上一个周期）</div>
          {stats.trend.length === 0 ? (
            <div className="p-6 text-center text-[11px] text-muted-foreground">暂无数据</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="text-muted-foreground bg-background">
                <tr><th className="text-left px-3 py-1.5">模式</th><th className="text-right px-3">本周期</th><th className="text-right px-3">上周期</th><th className="text-right px-3">Δ</th><th className="text-right px-3 pr-3">avg P&L</th></tr>
              </thead>
              <tbody className="font-mono">
                {stats.trend.slice(0, 12).map(t => {
                  const deltaColor = t.delta > 0 ? 'text-[#F6465D]' : t.delta < 0 ? 'text-[#0ECB81]' : 'text-muted-foreground';
                  return (
                    <tr key={t.pattern.id} className="border-t border-border">
                      <td className="px-3 py-1.5 text-foreground">{t.pattern.pattern_name}</td>
                      <td className="text-right px-3">{t.cur}</td>
                      <td className="text-right px-3 text-muted-foreground">{t.prev}</td>
                      <td className={`text-right px-3 ${deltaColor}`}>{t.delta > 0 ? '+' : ''}{t.delta}</td>
                      <td className={`text-right px-3 pr-3 ${t.avg_pnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                        {t.avg_pnl >= 0 ? '+' : ''}{t.avg_pnl.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* Alpha & mental */}
        <div className="grid md:grid-cols-2 gap-3">
          <section className="border border-border rounded bg-card p-3">
            <div className="text-[12px] font-medium mb-2">Alpha 时段 Top 5</div>
            {stats.alphaHours.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">数据不足（每个小时段至少需 3 笔交易）</div>
            ) : (
              <div className="space-y-1.5">
                {stats.alphaHours.map(h => (
                  <div key={h.hour} className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="w-8 text-muted-foreground">{String(h.hour).padStart(2, '0')}时</span>
                    <div className="flex-1 bg-background h-2 rounded overflow-hidden">
                      <div className="h-full bg-[#0ECB81]" style={{ width: `${Math.min(100, h.avg_pnl)}%` }} />
                    </div>
                    <span className="w-12 text-right text-[#0ECB81]">+{h.avg_pnl.toFixed(2)}</span>
                    <span className="w-8 text-right text-muted-foreground">{h.count}笔</span>
                  </div>
                ))}
              </div>
            )}
            {stats.mixedRBasis && (
              <div className="mt-2 text-[10px] text-muted-foreground">
                R 倍数计算基于"本次预设最大亏损"。历史 journal（使用"预设止损价"计算）的 R 数据仍可用，但口径与新 journal 略有差异。
              </div>
            )}
          </section>
          <section className="border border-border rounded bg-card p-3">
            <div className="text-[12px] font-medium mb-2">心态评分 vs 表现</div>
            <div className="space-y-1.5">
              {stats.mentalDist.map(m => (
                <div key={m.state} className="flex items-center gap-2 text-[11px] font-mono">
                  <span className="w-6 text-muted-foreground">{m.state}分</span>
                  <span className="w-10 text-muted-foreground">{m.count}笔</span>
                  <div className="flex-1 bg-background h-2 rounded overflow-hidden relative">
                    <div className={`h-full ${m.avg_pnl >= 0 ? 'bg-[#0ECB81]' : 'bg-[#F6465D]'}`}
                      style={{ width: `${Math.min(100, Math.abs(m.avg_pnl))}%` }} />
                  </div>
                  <span className={`w-16 text-right ${m.avg_pnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                    {m.avg_pnl >= 0 ? '+' : ''}{m.avg_pnl.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="border border-border rounded bg-card p-3">
          <div className="text-[12px] font-medium mb-2">Calibration 校准</div>
          {stats.calibration.count === 0 ? (
            <div className="text-[11px] text-muted-foreground">暂无带开仓胜率预测且已平仓评价的样本</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded border border-border bg-background p-2">
                <div className="text-[10px] text-muted-foreground">样本</div>
                <div className="text-[18px] font-mono">{stats.calibration.count}</div>
              </div>
              <div className="rounded border border-border bg-background p-2">
                <div className="text-[10px] text-muted-foreground">预测胜率均值</div>
                <div className="text-[18px] font-mono">{pct(stats.calibration.avgPredictedWinRate)}</div>
              </div>
              <div className="rounded border border-border bg-background p-2">
                <div className="text-[10px] text-muted-foreground">实际胜率</div>
                <div className="text-[18px] font-mono">{pct(stats.calibration.actualWinRate)}</div>
                <div className="text-[10px] text-muted-foreground font-mono">95% CI {pctRange(stats.calibration.ci)}</div>
              </div>
              <div className="rounded border border-border bg-background p-2">
                <div className="text-[10px] text-muted-foreground">Brier 分数</div>
                <div className={`text-[18px] font-mono ${stats.calibration.brier <= 0.2 ? 'text-[#0ECB81]' : stats.calibration.brier <= 0.3 ? 'text-[#F0B90B]' : 'text-[#F6465D]'}`}>
                  {stats.calibration.brier.toFixed(3)}
                </div>
                <div className="text-[10px] text-muted-foreground">越低越准</div>
              </div>
            </div>
          )}
        </section>

        <div className="grid md:grid-cols-2 gap-3">
          <section className="border border-border rounded bg-card p-3">
            <div className="text-[12px] font-medium mb-2">订单类型分布</div>
            <div className="space-y-2">
              <div className="rounded border border-border bg-background p-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-foreground">主力单</span>
                  <span className="font-mono">{stats.orderTypeStats.main.count} 笔</span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground font-mono">
                  胜率 {(stats.orderTypeStats.main.winRate * 100).toFixed(0)}% · 平均 R {stats.orderTypeStats.main.avgR.toFixed(2)}
                </div>
              </div>
              <div className="rounded border border-border bg-background p-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-foreground">对冲单</span>
                  <span className="font-mono">{stats.orderTypeStats.hedge.count} 笔</span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground font-mono">
                  胜率 {(stats.orderTypeStats.hedge.winRate * 100).toFixed(0)}% · 平均 R {stats.orderTypeStats.hedge.avgR.toFixed(2)}
                </div>
              </div>
            </div>
          </section>

          <section className="border border-border rounded bg-card p-3">
            <div className="text-[12px] font-medium mb-2">全仓笔数审计</div>
            <div className="text-[28px] font-mono leading-none">{stats.crossCount}</div>
            <div className={`mt-2 text-[11px] ${
              stats.crossCount === 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'
            }`}>
              {stats.crossCount === 0
                ? '✓ 守卫上线后无任何全仓交易'
                : `${stats.crossCount} 笔交易使用了全仓——多为守卫上线前的历史记录，请确认`}
            </div>
          </section>
        </div>

        {/* Rule effectiveness */}
        <section className="border border-border rounded bg-card">
          <div className="px-3 py-2 border-b border-border text-[12px] font-medium">规则有效性（扣除学习曲线与均值回归）</div>
          {stats.ruleEffect.length === 0 ? (
            <div className="p-6 text-center text-[11px] text-muted-foreground">尚无已生效的规则可观测</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="text-muted-foreground bg-background">
                <tr>
                  <th className="text-left px-3 py-1.5">规则</th>
                  <th className="text-left px-3">来源模式</th>
                  <th className="text-right px-3">前</th>
                  <th className="text-right px-3">后</th>
                  <th className="text-right px-3">Δ / CI</th>
                  <th className="text-left px-3 pr-3">净效应</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {stats.ruleEffect.map(e => {
                  return (
                    <tr key={e.rule.id} className="border-t border-border">
                      <td className="px-3 py-1.5 text-foreground truncate max-w-[300px]">{e.rule.rule_text}</td>
                      <td className="px-3 text-muted-foreground">{e.pattern?.pattern_name ?? '—'}</td>
                      <td className="text-right px-3">{e.before}</td>
                      <td className="text-right px-3">{e.after}</td>
                      <td className={`text-right px-3 ${e.delta < 0 ? 'text-[#0ECB81]' : e.delta > 0 ? 'text-[#F6465D]' : 'text-muted-foreground'}`}>
                        <div>{e.delta > 0 ? '+' : ''}{e.delta}</div>
                        <div className="text-[9px] text-muted-foreground">{e.ci.note}</div>
                      </td>
                      <td className={`px-3 pr-3 ${e.baseline.ruleAttributablePct < -0.1 ? 'text-[#0ECB81]' : e.baseline.ruleAttributablePct > 0.1 ? 'text-[#F6465D]' : 'text-muted-foreground'}`}>
                        <div>{e.baseline.note}</div>
                        <div className="text-[9px] text-muted-foreground">
                          全局 {e.globalBefore}→{e.globalAfter}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="border border-border rounded bg-card p-3">
          <div className="text-[12px] font-medium mb-2">战役 SOP 经济成本</div>
          <div className={`text-[34px] font-mono leading-none ${
            (campaignEconomic?.totalDeviationCost ?? 0) > 0 ? 'text-[#F6465D]' : 'text-[#0ECB81]'
          }`}>
            {campaignEconomic?.unavailable ? '—' : `${(campaignEconomic?.totalDeviationCost ?? 0).toFixed(2)} USDT`}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            {campaignEconomic?.unavailable ? '战役成本数据暂不可用' : '过去 30 天实时战役因 SOP 偏离损失的金额'}
          </div>
          <div className={`mt-2 text-[11px] ${
            (campaignEconomic?.totalDeviationCost ?? 0) > 0 ? 'text-[#F6465D]' : 'text-[#0ECB81]'
          }`}>
            {campaignEconomic?.unavailable
              ? '元监控其他数据已正常加载'
              : (campaignEconomic?.totalDeviationCost ?? 0) === 0 ? '完美执行' : 'SOP 偏离仍在持续烧钱'}
          </div>
          <div className="mt-4 space-y-2">
            {campaignEconomic?.unavailable ? (
              <div className="text-[11px] text-muted-foreground">请稍后同步战役相关数据表后再查看成本拆解</div>
            ) : (campaignEconomic?.topReasons ?? []).length === 0 ? (
              <div className="text-[11px] text-muted-foreground">暂无已结束战役的偏离代价数据</div>
            ) : (
              campaignEconomic?.topReasons.map(item => (
                <div key={item.reason} className="rounded border border-border bg-background px-3 py-2 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-foreground truncate">{item.reason}</div>
                    <div className="text-[10px] text-muted-foreground">出现 {item.count} 次</div>
                  </div>
                  <div className="text-[11px] font-mono text-[#F6465D]">{item.totalCost.toFixed(2)} USDT</div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div className="border border-border rounded bg-card p-3">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-[22px] font-mono mt-1" style={{ color: accent }}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{sub}</div>}
    </div>
  );
}
