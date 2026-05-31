/**
 * /journal/insights — 元监控页
 * 展示错误模式趋势（30/90 天）、alpha 时段、规则有效性。
 */
import { useEffect, useMemo, useState } from 'react';
import { BackButton } from '@/components/journal/BackButton';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { computeBiasSpectrum } from '@/lib/biasSpectrum';
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
import { computeTooHardBasketStats, type TooHardBasketStats } from '@/lib/noTradeHypothetical';
import { HEDGE_BOUNDARY_STANCE_LABELS, HEDGE_WORTH_IT_SCORE } from '@/lib/hedgeTypes';
import { isHistoricalCampaign, PAIN_TAG_LABELS, PRINCIPLE_EVOLUTION_LEVEL_LABELS } from '@/types/journal';
import type { HedgeBoundaryStance, PainTag, PrincipleEvolutionLevel, TradeCampaign, TradeJournal } from '@/types/journal';

type Range = 7 | 30 | 90;
const DAY = 24 * 3600_000;

interface CampaignEconomicStats {
  totalDeviationCost: number;
  topReasons: Array<{ reason: string; count: number; totalCost: number }>;
  unavailable?: boolean;
}

interface CalibrationSample {
  predProb: number;
  outcomeWin: boolean;
}

interface CalibrationBin {
  label: string;
  lower: number;
  upper: number;
  count: number;
  wins: number;
  avgPredicted: number;
  actualRate: number;
  diff: number;
}

interface HedgeCalibrationSample {
  predProb: number;
  worthScore: number;
}

interface HedgeCalibrationBin {
  label: string;
  lower: number;
  upper: number;
  count: number;
  avgPredicted: number;
  actualWorthRate: number;
  diff: number;
}

interface CalibrationDrillCandidate {
  id: string;
  symbol: string;
  direction: string;
  simulatedTime: string;
  entryReason: string;
  positiveExpectancy: string | null;
  preMortem: string | null;
  originalProbability: number;
  outcomeWin: boolean;
  rMultiple: number | null;
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

function buildCalibrationBins(samples: CalibrationSample[]): CalibrationBin[] {
  const ranges = [
    { label: '0-20%', lower: 0, upper: 0.2 },
    { label: '20-40%', lower: 0.2, upper: 0.4 },
    { label: '40-60%', lower: 0.4, upper: 0.6 },
    { label: '60-80%', lower: 0.6, upper: 0.8 },
    { label: '80-100%', lower: 0.8, upper: 1 },
  ];
  return ranges.map(range => {
    const rows = samples.filter(sample =>
      range.upper === 1
        ? sample.predProb >= range.lower && sample.predProb <= range.upper
        : sample.predProb >= range.lower && sample.predProb < range.upper,
    );
    const wins = rows.filter(sample => sample.outcomeWin).length;
    const avgPredicted = rows.length === 0
      ? 0
      : rows.reduce((sum, sample) => sum + sample.predProb, 0) / rows.length;
    const actualRate = rows.length === 0 ? 0 : wins / rows.length;
    return {
      ...range,
      count: rows.length,
      wins,
      avgPredicted,
      actualRate,
      diff: avgPredicted - actualRate,
    };
  });
}

function calibrationTarget(bins: CalibrationBin[], sampleCount: number) {
  if (sampleCount < 30) {
    return {
      label: '先积累 30 条揭晓预测',
      detail: `还差 ${30 - sampleCount} 条样本。样本不足时不急着给结论。`,
      accent: '#848E9C',
    };
  }
  const target = [...bins]
    .filter(bin => bin.count >= 3)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
  if (!target) {
    return {
      label: '每个档位样本仍偏少',
      detail: '继续积累不同置信档位的预测，不要只集中在 50-60%。',
      accent: '#F0B90B',
    };
  }
  if (target.diff > 0.08) {
    return {
      label: `${target.label} 档偏过度自信`,
      detail: `该档预测 ${pct(target.avgPredicted)}，实际 ${pct(target.actualRate)}。下次进入此档先下调置信度。`,
      accent: '#F6465D',
    };
  }
  if (target.diff < -0.08) {
    return {
      label: `${target.label} 档偏保守`,
      detail: `该档预测 ${pct(target.avgPredicted)}，实际 ${pct(target.actualRate)}。下次遇到同类 setup 可以提高置信度。`,
      accent: '#F0B90B',
    };
  }
  return {
    label: '各档位暂无明显偏差',
    detail: '继续扩大样本，重点观察高置信档位是否稳定。',
    accent: '#0ECB81',
  };
}

function buildHedgeCalibrationBins(samples: HedgeCalibrationSample[]): HedgeCalibrationBin[] {
  const ranges = [
    { label: '0-20%', lower: 0, upper: 0.2 },
    { label: '20-40%', lower: 0.2, upper: 0.4 },
    { label: '40-60%', lower: 0.4, upper: 0.6 },
    { label: '60-80%', lower: 0.6, upper: 0.8 },
    { label: '80-100%', lower: 0.8, upper: 1 },
  ];
  return ranges.map(range => {
    const rows = samples.filter(sample =>
      range.upper === 1
        ? sample.predProb >= range.lower && sample.predProb <= range.upper
        : sample.predProb >= range.lower && sample.predProb < range.upper,
    );
    const avgPredicted = rows.length === 0
      ? 0
      : rows.reduce((sum, sample) => sum + sample.predProb, 0) / rows.length;
    const actualWorthRate = rows.length === 0
      ? 0
      : rows.reduce((sum, sample) => sum + sample.worthScore, 0) / rows.length;
    return {
      ...range,
      count: rows.length,
      avgPredicted,
      actualWorthRate,
      diff: avgPredicted - actualWorthRate,
    };
  });
}

function opportunityCostConclusion(distribution: Record<HedgeBoundaryStance, number>, total: number) {
  if (total === 0) {
    return '数据积累中。先记录更多对冲边界，再看你究竟偏早、贴着交叉点，还是总在偏晚才保护。';
  }
  const earlyRate = distribution.early / total;
  const lateRate = distribution.late / total;
  if (earlyRate >= Math.max(distribution.at_crossover / total, lateRate) && earlyRate >= 0.4) {
    return '你在用机会富裕者的方式对冲：保守，但这正是敢下重注的前提。';
  }
  if (lateRate >= Math.max(distribution.at_crossover / total, earlyRate) && lateRate >= 0.4) {
    return `你 ${(lateRate * 100).toFixed(0)}% 的对冲放得偏晚：你自认的纪律，手上却是赌徒打法。`;
  }
  return '你的对冲边界大多贴着交叉点，本质上是在让机会和风险大致打平时才把保险接上。';
}

function decisionQualityScore(journal: TradeJournal): number {
  if (journal.pre_thesis_why_right || journal.pre_premortem_failure_reason || journal.pre_falsification_signal) {
    const checks = [
      !!journal.pre_thesis_why_right?.trim(),
      !!journal.pre_premortem_failure_reason?.trim(),
      !!journal.pre_falsification_signal?.trim(),
      journal.pre_calibration_win_pct != null,
      journal.pre_max_loss_usdt != null && journal.pre_max_loss_usdt > 0,
      journal.pre_checklist_passed === true,
      journal.pre_mental_state >= 3,
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }
  const checks = [
    !!journal.pre_positive_expectancy?.trim(),
    !!journal.pre_mortem_text?.trim(),
    !!journal.pre_invalidation_condition?.trim(),
    !!journal.pre_info_kline_facts?.trim(),
    !!journal.pre_info_macro_facts?.trim(),
    !!journal.pre_info_rule_advice?.trim(),
    !!journal.pre_info_intuition?.trim(),
    !!journal.pre_info_designer_view?.trim(),
    (journal.pre_opponent_statement?.trim().length ?? 0) >= 30,
    (journal.pre_pain_tags?.length ?? 0) > 0,
    !!journal.pre_executor_self?.trim(),
    !!journal.pre_designer_self?.trim(),
    journal.pre_calibration_win_pct != null,
    journal.pre_confidence_interval_low_pct != null,
    journal.pre_confidence_interval_high_pct != null,
    !!journal.pre_calibration_reference_class?.trim(),
    !!journal.pre_calibration_competence_basis?.trim(),
    !!journal.pre_calibration_update_signal?.trim(),
    journal.pre_checklist_passed === true,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
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
  const [tooHardStats, setTooHardStats] = useState<TooHardBasketStats | null>(null);
  const [tooHardLoading, setTooHardLoading] = useState(false);
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

  useEffect(() => {
    if (!data) {
      setTooHardStats(null);
      return;
    }
    let cancelled = false;
    setTooHardLoading(true);
    computeTooHardBasketStats(data.journals, { days: 90 })
      .then(result => {
        if (!cancelled) setTooHardStats(result);
      })
      .catch(error => {
        console.warn('[JournalInsightsPage] 太难篮子统计失败', error);
        if (!cancelled) setTooHardStats(null);
      })
      .finally(() => {
        if (!cancelled) setTooHardLoading(false);
      });
    return () => { cancelled = true; };
  }, [data]);

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
    const curTrades = cur.filter(j => (j.journal_kind ?? 'trade') === 'trade');
    const prevTrades = prev.filter(j => (j.journal_kind ?? 'trade') === 'trade');
    const curClusters = groupJournalsByPattern(curTrades, data.assignments, data.patterns, data.categories);
    const prevClusters = groupJournalsByPattern(prevTrades, data.assignments, data.patterns, data.categories);
    const prevMap = new Map(prevClusters.map(c => [c.pattern.id, c.stats.occurrence_count]));

    const trend = curClusters.map(c => ({
      pattern: c.pattern,
      cur: c.stats.occurrence_count,
      prev: prevMap.get(c.pattern.id) ?? 0,
      delta: c.stats.occurrence_count - (prevMap.get(c.pattern.id) ?? 0),
      avg_pnl: c.stats.avg_pnl,
    })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const timeDist = computeTimeDistribution(curTrades);
    const mentalDist = computeMentalStateDistribution(curTrades);
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
    const mainOrders = curTrades.filter(j => j.order_kind === 'main');
    const hedgeOrders = curTrades.filter(j => j.order_kind === 'hedge');
    const avgR = (arr: TradeJournal[]) => {
      const withR = arr.filter(j => j.post_r_multiple != null);
      if (withR.length === 0) return 0;
      return withR.reduce((sum, j) => sum + (j.post_r_multiple ?? 0), 0) / withR.length;
    };
    const winRate = (arr: TradeJournal[]) => {
      if (arr.length === 0) return 0;
      return arr.filter(j => j.post_outcome === 'win').length / arr.length;
    };
    const crossCount = data.journals.filter(j => (j.journal_kind ?? 'trade') === 'trade' && j.position_mode === 'cross').length;

    // Alpha 时段：avg_pnl > 0 且 count >= 3 的小时段
    const alphaHours = timeDist.filter(b => b.count >= 3 && b.avg_pnl > 0)
      .sort((a, b) => b.avg_pnl - a.avg_pnl).slice(0, 5);

    // 规则有效性：拥有规则后是否减少了对应 pattern 出现频次
    const ruleEffect = data.rules
      .filter(r =>
        r.source_pattern_id &&
        r.is_active &&
        (r.rule_category === 'hard' || r.rule_category === 'core' || r.added_to_checklist),
      )
      .sort((a, b) =>
        (b.weight ?? 0) - (a.weight ?? 0) ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )
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

    const calibrationRows = curTrades.filter(j =>
      j.pre_calibration_win_pct != null &&
      j.post_outcome != null &&
      j.post_outcome !== 'no_entry',
    );
    const calibrationSamples = calibrationRows
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
    const calibrationBins = buildCalibrationBins(calibrationSamples);
    const calibrationDrillCandidates: CalibrationDrillCandidate[] = calibrationRows
      .map(j => {
        const entryReason = j.pre_thesis_why_right?.trim() || j.pre_entry_reason?.trim() || '';
        return {
          id: j.id,
          symbol: j.symbol,
          direction: j.direction,
          simulatedTime: j.pre_simulated_time,
          entryReason,
          positiveExpectancy: j.pre_thesis_why_right ?? j.pre_positive_expectancy ?? null,
          preMortem: j.pre_premortem_failure_reason ?? j.pre_mortem_text ?? null,
          originalProbability: Math.min(100, Math.max(0, j.pre_calibration_win_pct ?? 0)),
          outcomeWin: j.post_outcome === 'win',
          rMultiple: j.post_r_multiple ?? null,
        };
      })
      .filter(j => j.entryReason.trim());
    const calibrationTraining = {
      bins: calibrationBins,
      target: calibrationTarget(calibrationBins, calibration.count),
      drillCandidates: calibrationDrillCandidates,
    };
    const reviewedHedges = curTrades.filter(j =>
      j.order_kind === 'hedge'
      && typeof j.hedge_conviction_pct === 'number'
      && j.hedge_worth_it != null
      && j.hedge_worth_it in HEDGE_WORTH_IT_SCORE,
    );
    const hedgeCalibrationSamples = reviewedHedges.map(j => ({
      predProb: Math.min(1, Math.max(0, (j.hedge_conviction_pct ?? 0) / 100)),
      worthScore: HEDGE_WORTH_IT_SCORE[j.hedge_worth_it!],
    }));
    const hedgeCalibration = {
      count: hedgeCalibrationSamples.length,
      avgPredicted: hedgeCalibrationSamples.length === 0
        ? 0
        : hedgeCalibrationSamples.reduce((sum, sample) => sum + sample.predProb, 0) / hedgeCalibrationSamples.length,
      actualWorthRate: hedgeCalibrationSamples.length === 0
        ? 0
        : hedgeCalibrationSamples.reduce((sum, sample) => sum + sample.worthScore, 0) / hedgeCalibrationSamples.length,
      bins: buildHedgeCalibrationBins(hedgeCalibrationSamples),
    };
    const hedgeMethodRows = hedgeOrders.filter(j => j.hedge_order_method != null);
    const marketChaseCount = hedgeMethodRows.filter(j => j.hedge_order_method === 'market_chase').length;
    const panicHedgeCount = hedgeOrders.filter(j =>
      (j.hedge_conviction_pct ?? 100) < 40 && (j.hedge_necessity_pct ?? 0) > 60,
    ).length;
    const hedgeDiscipline = {
      count: hedgeOrders.length,
      methodSampleCount: hedgeMethodRows.length,
      marketChaseCount,
      marketChaseRate: hedgeMethodRows.length === 0 ? 0 : marketChaseCount / hedgeMethodRows.length,
      panicHedgeCount,
    };
    const boundaryStanceRows = hedgeOrders.filter((j): j is TradeJournal & { hedge_boundary_stance: HedgeBoundaryStance } =>
      j.hedge_boundary_stance === 'early' || j.hedge_boundary_stance === 'at_crossover' || j.hedge_boundary_stance === 'late',
    );
    const stanceDistribution = boundaryStanceRows.reduce<Record<HedgeBoundaryStance, number>>((acc, journal) => {
      acc[journal.hedge_boundary_stance] += 1;
      return acc;
    }, {
      early: 0,
      at_crossover: 0,
      late: 0,
    });
    const opportunityCostProfile = {
      count: boundaryStanceRows.length,
      distribution: stanceDistribution,
      conclusion: opportunityCostConclusion(stanceDistribution, boundaryStanceRows.length),
    };
    const restraintCount = curTrades.filter(j => j.direction === 'no_entry' || j.post_outcome === 'no_entry').length;

    const reviewedMain = curTrades.filter(j => j.order_kind === 'main' && j.post_reviewed_at && j.post_outcome && j.post_outcome !== 'no_entry');
    const directionWins = reviewedMain.filter(j => j.post_outcome === 'win').length;
    const goodDecisionCount = reviewedMain.filter(j => j.post_decision_quality === 'good').length;
    const opponentSamples = reviewedMain.filter(j => typeof j.post_opponent_was_right === 'boolean');
    const opponentHits = opponentSamples.filter(j => j.post_opponent_was_right === true).length;
    const snapshotComplete = reviewedMain.filter(j => decisionQualityScore(j) >= 80).length;
    const credibilityVector = [
      {
        label: '方向判断',
        count: reviewedMain.length,
        score: reviewedMain.length === 0 ? 0 : directionWins / reviewedMain.length,
        ci: wilsonInterval(directionWins, reviewedMain.length),
        note: '按已评价主力单胜率近似',
      },
      {
        label: '决策质量',
        count: reviewedMain.length,
        score: reviewedMain.length === 0 ? 0 : goodDecisionCount / reviewedMain.length,
        ci: wilsonInterval(goodDecisionCount, reviewedMain.length),
        note: '按当时信息的好决策占比',
      },
      {
        label: '反对者命中',
        count: opponentSamples.length,
        score: opponentSamples.length === 0 ? 0 : opponentHits / opponentSamples.length,
        ci: wilsonInterval(opponentHits, opponentSamples.length),
        note: '反对意见是否事后被验证',
      },
      {
        label: '快照完整度',
        count: reviewedMain.length,
        score: reviewedMain.length === 0 ? 0 : snapshotComplete / reviewedMain.length,
        ci: wilsonInterval(snapshotComplete, reviewedMain.length),
        note: 'D-score ≥80 的样本占比',
      },
      {
        label: '校准能力',
        count: calibration.count,
        score: calibration.count === 0 ? 0 : Math.max(0, 1 - calibration.brier),
        ci: calibration.ci,
        note: '1 - Brier，仅作方向性镜子',
      },
    ];

    const decisionScatter = reviewedMain
      .filter(j => typeof j.post_r_multiple === 'number' && Number.isFinite(j.post_r_multiple))
      .map(j => ({
        id: j.id,
        symbol: j.symbol,
        score: decisionQualityScore(j),
        r: j.post_r_multiple ?? 0,
        quality: j.post_decision_quality ?? 'mixed',
      }));

    const painStats = (Object.keys(PAIN_TAG_LABELS) as PainTag[])
      .map(tag => {
        const rows = curTrades.filter(j => j.pre_pain_tags?.includes(tag));
        const withR = rows.filter(j => typeof j.post_r_multiple === 'number');
        const avg = withR.length === 0 ? 0 : withR.reduce((sum, j) => sum + (j.post_r_multiple ?? 0), 0) / withR.length;
        return { tag, count: rows.length, avgR: avg };
      })
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count);

    const evolutionMap = [0, 1, 2, 3, 4, 5].map(level => ({
      level: level as PrincipleEvolutionLevel,
      count: data.rules.filter(rule => (rule.evolution_level ?? 3) === level).length,
    }));

    // 深度分析完成率：六步全填的占已评价 journal 比
    const reviewed = curTrades.filter(j => !!j.post_reviewed_at);
    const deepDone = reviewed.filter(j => !!j.deep_analysis_completed_at);
    const deepRate = reviewed.length === 0 ? 0 : deepDone.length / reviewed.length;

    // R 倍数口径混合：是否同时存在带 SL 的历史 journal 与不带 SL 的新 journal
    const hasLegacySl = cur.some(j => j.pre_planned_stop_loss != null);
    const hasNewMaxLoss = cur.some(j => j.pre_planned_stop_loss == null && j.pre_max_loss_usdt != null);
    const mixedRBasis = hasLegacySl && hasNewMaxLoss;

    return {
      cur, curClusters, trend, timeDist, mentalDist, alphaHours, ruleEffect, reviewed, deepDone, deepRate, mixedRBasis,
      calibration,
      calibrationTraining,
      hedgeCalibration,
      hedgeDiscipline,
      opportunityCostProfile,
      credibilityVector,
      decisionScatter,
      painStats,
      evolutionMap,
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

  const biasSpectrum = useMemo(
    () => computeBiasSpectrum(data?.journals ?? [], 90),
    [data],
  );

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

        <div className="grid md:grid-cols-2 gap-3">
          <section className="border border-border rounded bg-card p-3">
            <div className="text-[12px] font-medium">个人偏差光谱 · 过去 90 天</div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              超级预测者的核心实践：知道自己的偏差光谱。
            </div>
            {biasSpectrum.labeledTradeCount < 5 ? (
              <div className="mt-4 text-[11px] text-muted-foreground">
                数据积累中——记录更多带标签的交易后，这里会显示你的偏差光谱。
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {biasSpectrum.items.map(item => (
                  <div key={item.id} className="rounded border border-border bg-background px-3 py-2">
                    <div className="flex items-center justify-between gap-3 text-[11px]">
                      <div>
                        {item.rank}. {item.label} {item.is_biggest_gap ? <span className="text-[#F0B90B]">#1</span> : null}
                      </div>
                      <div className="font-mono text-muted-foreground">
                        {item.occurrences} 次（其中 {item.loss_count} 次以亏损收场）
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 rounded bg-card overflow-hidden">
                      <div
                        className="h-full"
                        style={{
                          width: `${Math.max(8, item.loss_ratio * 100)}%`,
                          background: item.loss_ratio >= 0.66 ? '#F6465D' : item.loss_ratio >= 0.4 ? '#F0B90B' : '#0ECB81',
                        }}
                      />
                    </div>
                  </div>
                ))}
                {biasSpectrum.items[0] && (
                  <div className="rounded border border-[#F0B90B]/30 bg-[#F0B90B]/10 px-3 py-2 text-[11px] text-[#F0B90B]">
                    → 你的最大单一漏洞：{biasSpectrum.items[0].label}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="border border-border rounded bg-card p-3">
            <div className="text-[12px] font-medium">太难篮子 · 过去 90 天</div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              芒格的第三个篮子：进、出、太难。跳过不是空白，而是被尊重的记录。
            </div>
            {tooHardLoading ? (
              <div className="mt-4 text-[11px] text-muted-foreground">计算中…</div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded border border-border bg-background p-2">
                    <div className="text-[10px] text-muted-foreground">跳过次数</div>
                    <div className="text-[18px] font-mono">{tooHardStats?.skipCount ?? 0}</div>
                  </div>
                  <div className="rounded border border-border bg-background p-2">
                    <div className="text-[10px] text-muted-foreground">跳过率</div>
                    <div className="text-[18px] font-mono">{pct(tooHardStats?.skipRate ?? 0)}</div>
                  </div>
                  <div className="rounded border border-border bg-background p-2">
                    <div className="text-[10px] text-muted-foreground">+7d 平均盈亏</div>
                    <div className={`text-[18px] font-mono ${
                      (tooHardStats?.avgPnl7d ?? 0) < 0 ? 'text-[#0ECB81]' : (tooHardStats?.avgPnl7d ?? 0) > 0 ? 'text-[#F0B90B]' : 'text-muted-foreground'
                    }`}>
                      {tooHardStats?.avgPnl7d == null ? '—' : `${tooHardStats.avgPnl7d >= 0 ? '+' : ''}${tooHardStats.avgPnl7d.toFixed(2)}%`}
                    </div>
                  </div>
                </div>
                <div className={`text-[11px] ${
                  tooHardStats?.avgPnl7d == null
                    ? 'text-muted-foreground'
                    : tooHardStats.avgPnl7d < 0
                      ? 'text-[#0ECB81]'
                      : tooHardStats.avgPnl7d > 0
                        ? 'text-[#F0B90B]'
                        : 'text-muted-foreground'
                }`}>
                  {tooHardStats?.avgPnl7d == null
                    ? '部分太难记录尚未到期，+7d 假想盈亏暂不足以给结论。'
                    : tooHardStats.avgPnl7d < 0
                      ? "你跳过的多数是亏损单——'太难'用得好"
                      : tooHardStats.avgPnl7d > 0
                        ? '你跳过的多数会盈利——可能过度保守，复查能力圈边界'
                        : '目前看，你的“太难”筛选没有明显偏向。'}
                </div>
              </div>
            )}
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
          <div className="mt-3 grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded border border-border bg-background p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-[12px] font-medium">概率档位校准</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    每个档位直接比较“当时预测均值”和“实际胜率”。
                  </div>
                </div>
                <div className="shrink-0 rounded border border-border bg-card px-2 py-1 sm:text-right">
                  <div className="text-[10px] text-muted-foreground">训练目标</div>
                  <div className="text-[13px] font-mono" style={{ color: stats.calibrationTraining.target.accent }}>
                    {stats.calibrationTraining.target.label}
                  </div>
                  <div className="text-[9px] text-muted-foreground max-w-[260px]">{stats.calibrationTraining.target.detail}</div>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {stats.calibrationTraining.bins.map(bin => (
                  <div key={bin.label} className="grid grid-cols-[58px_1fr_64px] items-center gap-2 text-[10px]">
                    <div className="font-mono text-muted-foreground">{bin.label}</div>
                    <div className="space-y-1">
                      <div className="h-2 rounded bg-card overflow-hidden">
                        <div className="h-full bg-[#F0B90B]" style={{ width: `${bin.avgPredicted * 100}%` }} />
                      </div>
                      <div className="h-2 rounded bg-card overflow-hidden">
                        <div className="h-full bg-[#0ECB81]" style={{ width: `${bin.actualRate * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-right font-mono text-muted-foreground">
                      n={bin.count}
                      <div className={bin.diff > 0.08 ? 'text-[#F6465D]' : bin.diff < -0.08 ? 'text-[#F0B90B]' : 'text-[#0ECB81]'}>
                        {bin.count === 0 ? '—' : `${bin.diff >= 0 ? '+' : ''}${(bin.diff * 100).toFixed(0)}pp`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-4 text-[9px] text-muted-foreground">
                <span><span className="inline-block h-2 w-4 rounded bg-[#F0B90B] mr-1" />预测均值</span>
                <span><span className="inline-block h-2 w-4 rounded bg-[#0ECB81] mr-1" />实际胜率</span>
              </div>
            </div>
            <CalibrationDrillCard candidates={stats.calibrationTraining.drillCandidates} />
          </div>
        </section>

        <section className="border border-border rounded bg-card p-3">
          <div className="text-[12px] font-medium mb-2">对冲校准与纪律</div>
          <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[12px] font-medium">对冲校准曲线</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    回答的是：我打 80% 把握的那些对冲，后来真有 80% 值回成本吗？
                  </div>
                </div>
                <div className="rounded border border-border bg-card px-2 py-1 text-right">
                  <div className="text-[10px] text-muted-foreground">样本</div>
                  <div className="text-[14px] font-mono">{stats.hedgeCalibration.count}</div>
                </div>
              </div>
              {stats.hedgeCalibration.count < 10 ? (
                <div className="mt-6 text-[11px] text-muted-foreground">
                  数据积累中。至少需要 10 笔已平仓且已判定“值 / 部分 / 不值”的对冲样本。
                </div>
              ) : (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded border border-border bg-card p-2">
                      <div className="text-muted-foreground">平均输入把握性</div>
                      <div className="mt-1 text-[16px] font-mono">{pct(stats.hedgeCalibration.avgPredicted)}</div>
                    </div>
                    <div className="rounded border border-border bg-card p-2">
                      <div className="text-muted-foreground">实际值回率</div>
                      <div className="mt-1 text-[16px] font-mono">{pct(stats.hedgeCalibration.actualWorthRate)}</div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {stats.hedgeCalibration.bins.map(bin => (
                      <div key={bin.label} className="grid grid-cols-[58px_1fr_64px] items-center gap-2 text-[10px]">
                        <div className="font-mono text-muted-foreground">{bin.label}</div>
                        <div className="space-y-1">
                          <div className="h-2 rounded bg-card overflow-hidden">
                            <div className="h-full bg-[#F0B90B]" style={{ width: `${bin.avgPredicted * 100}%` }} />
                          </div>
                          <div className="h-2 rounded bg-card overflow-hidden">
                            <div className="h-full bg-[#0ECB81]" style={{ width: `${bin.actualWorthRate * 100}%` }} />
                          </div>
                        </div>
                        <div className="text-right font-mono text-muted-foreground">
                          n={bin.count}
                          <div className={bin.diff > 0.08 ? 'text-[#F6465D]' : bin.diff < -0.08 ? 'text-[#F0B90B]' : 'text-[#0ECB81]'}>
                            {bin.count === 0 ? '—' : `${bin.diff >= 0 ? '+' : ''}${(bin.diff * 100).toFixed(0)}pp`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-4 text-[9px] text-muted-foreground">
                    <span><span className="inline-block h-2 w-4 rounded bg-[#F0B90B] mr-1" />输入把握性</span>
                    <span><span className="inline-block h-2 w-4 rounded bg-[#0ECB81] mr-1" />实际值回率</span>
                  </div>
                </>
              )}
            </div>

            <div className="rounded border border-border bg-background p-3">
              <div className="text-[12px] font-medium">对冲纪律</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                只看纪律痕迹，不把方向输赢重新塞回对冲评估。
              </div>
              {stats.hedgeDiscipline.count === 0 ? (
                <div className="mt-6 text-[11px] text-muted-foreground">当前周期暂无对冲单。</div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-border bg-card p-2">
                      <div className="text-[10px] text-muted-foreground">对冲总数</div>
                      <div className="text-[18px] font-mono">{stats.hedgeDiscipline.count}</div>
                    </div>
                    <div className="rounded border border-border bg-card p-2">
                      <div className="text-[10px] text-muted-foreground">恐慌对冲计数</div>
                      <div className={`text-[18px] font-mono ${stats.hedgeDiscipline.panicHedgeCount > 0 ? 'text-[#F0B90B]' : 'text-[#0ECB81]'}`}>
                        {stats.hedgeDiscipline.panicHedgeCount}
                      </div>
                    </div>
                  </div>
                  <div className="rounded border border-border bg-card p-2">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>市价追占比</span>
                      <span className="font-mono">
                        {stats.hedgeDiscipline.methodSampleCount === 0
                          ? '—'
                          : `${(stats.hedgeDiscipline.marketChaseRate * 100).toFixed(0)}%`}
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded bg-background overflow-hidden">
                      <div
                        className="h-full bg-[#F0B90B]"
                        style={{ width: `${stats.hedgeDiscipline.methodSampleCount === 0 ? 0 : stats.hedgeDiscipline.marketChaseRate * 100}%` }}
                      />
                    </div>
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      {stats.hedgeDiscipline.methodSampleCount === 0
                        ? '还没有足够的下单方式样本。'
                        : `已记录 ${stats.hedgeDiscipline.methodSampleCount} 笔对冲下单方式，其中市价追 ${stats.hedgeDiscipline.marketChaseCount} 笔。`}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 rounded border border-border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[12px] font-medium">机会成本自画像</div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  这面镜子照的是：你到底是巴菲特型，还是没得选的将就型。
                </div>
              </div>
              <div className="rounded border border-border bg-card px-2 py-1 text-right">
                <div className="text-[10px] text-muted-foreground">样本</div>
                <div className="text-[14px] font-mono">{stats.opportunityCostProfile.count}</div>
              </div>
            </div>
            {stats.opportunityCostProfile.count === 0 ? (
              <div className="mt-4 text-[11px] text-muted-foreground">
                数据积累中。先在对冲快照里多记录几次“偏早 / 交叉点 / 偏晚”。
              </div>
            ) : (
              <>
                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  {(['early', 'at_crossover', 'late'] as const).map(key => {
                    const count = stats.opportunityCostProfile.distribution[key];
                    const rate = count / stats.opportunityCostProfile.count;
                    return (
                      <div key={key} className="rounded border border-border bg-card p-2">
                        <div className="text-[10px] text-muted-foreground">{HEDGE_BOUNDARY_STANCE_LABELS[key]}</div>
                        <div className="mt-1 text-[18px] font-mono">{(rate * 100).toFixed(0)}%</div>
                        <div className="text-[9px] text-muted-foreground">{count} 笔</div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 rounded border border-[#F0B90B]/30 bg-[#F0B90B]/10 px-3 py-2 text-[11px] leading-relaxed text-foreground">
                  {stats.opportunityCostProfile.conclusion}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="border border-border rounded bg-card p-3">
          <div className="text-[12px] font-medium mb-2">可信度向量</div>
          <div className="grid md:grid-cols-5 gap-2">
            {stats.credibilityVector.map(item => (
              <div key={item.label} className="rounded border border-border bg-background p-2">
                <div className="text-[10px] text-muted-foreground">{item.label}</div>
                <div className={`text-[18px] font-mono ${
                  item.count === 0 ? 'text-muted-foreground' : item.score >= 0.6 ? 'text-[#0ECB81]' : item.score >= 0.45 ? 'text-[#F0B90B]' : 'text-[#F6465D]'
                }`}>
                  {pct(item.score)}
                </div>
                <div className="text-[9px] text-muted-foreground font-mono">
                  n={item.count} · CI {item.count === 0 ? '—' : pctRange(item.ci)}
                </div>
                <div className="text-[9px] text-muted-foreground mt-1">{item.note}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid md:grid-cols-2 gap-3">
          <section className="border border-border rounded bg-card p-3">
            <div className="text-[12px] font-medium mb-2">决策质量 vs 结果</div>
            <DecisionScatterPlot points={stats.decisionScatter} />
            <div className="mt-2 text-[10px] text-muted-foreground">
              横轴 D-score，纵轴 R。坏结果不自动等于坏决策；真正要看的是长期相关性。
            </div>
          </section>
          <section className="border border-border rounded bg-card p-3">
            <div className="text-[12px] font-medium mb-2">痛苦日志</div>
            {stats.painStats.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">暂无带痛苦标签的样本</div>
            ) : (
              <div className="space-y-1.5">
                {stats.painStats.map(item => (
                  <div key={item.tag} className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="w-28 text-muted-foreground">{PAIN_TAG_LABELS[item.tag]}</span>
                    <span className="w-10 text-right">{item.count}次</span>
                    <div className="flex-1 bg-background h-2 rounded overflow-hidden">
                      <div
                        className={item.avgR >= 0 ? 'h-full bg-[#0ECB81]' : 'h-full bg-[#F6465D]'}
                        style={{ width: `${Math.min(100, Math.abs(item.avgR) * 40 + 8)}%` }}
                      />
                    </div>
                    <span className={item.avgR >= 0 ? 'w-16 text-right text-[#0ECB81]' : 'w-16 text-right text-[#F6465D]'}>
                      {item.avgR >= 0 ? '+' : ''}{item.avgR.toFixed(2)}R
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="border border-border rounded bg-card p-3">
          <div className="text-[12px] font-medium mb-2">规则演化地图</div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {stats.evolutionMap.map(item => (
              <div key={item.level} className="rounded border border-border bg-background p-2">
                <div className="text-[10px] text-muted-foreground">L{item.level}</div>
                <div className="text-[18px] font-mono">{item.count}</div>
                <div className="text-[9px] text-muted-foreground">
                  {PRINCIPLE_EVOLUTION_LEVEL_LABELS[item.level]}
                </div>
              </div>
            ))}
          </div>
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
                  <th className="text-left px-3">类型/权重</th>
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
                      <td className="px-3 text-muted-foreground">
                        {e.rule.rule_category === 'hard' ? '硬' : e.rule.rule_category === 'core' ? '核心' : '观察'} · {e.rule.weight ?? 0}
                      </td>
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

function CalibrationDrillCard({ candidates }: { candidates: CalibrationDrillCandidate[] }) {
  const [index, setIndex] = useState(0);
  const [estimate, setEstimate] = useState(50);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setIndex(0);
    setEstimate(50);
    setRevealed(false);
  }, [candidates.length]);

  if (candidates.length === 0) {
    return (
      <div className="rounded border border-border bg-background p-3">
        <div className="text-[12px] font-medium">历史快照校准训练</div>
        <div className="mt-6 text-center text-[11px] text-muted-foreground">
          暂无可训练样本。需要先有“已预测胜率 + 已平仓评价”的交易。
        </div>
      </div>
    );
  }

  const current = candidates[index % candidates.length];
  const actual = current.outcomeWin ? 1 : 0;
  const brier = Math.pow(estimate / 100 - actual, 2);
  const simulatedDate = current.simulatedTime
    ? current.simulatedTime.slice(0, 16).replace('T', ' ')
    : '—';
  const next = () => {
    setIndex(prev => (prev + 1) % candidates.length);
    setEstimate(50);
    setRevealed(false);
  };

  return (
    <div className="rounded border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium">历史快照校准训练</div>
          <div className="mt-1 text-[10px] text-muted-foreground">先隐藏结果，只按当时快照重新估概率。</div>
        </div>
        <button
          type="button"
          onClick={next}
          className="h-7 rounded bg-muted px-2 text-[10px] text-foreground hover:bg-[#363c45]"
        >
          下一题
        </button>
      </div>

      <div className="mt-3 rounded border border-border bg-card p-2">
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-muted-foreground">
          <span>{current.symbol}</span>
          <span>{current.direction.toUpperCase()}</span>
          <span>{simulatedDate}</span>
        </div>
        <div className="mt-2 text-[11px] leading-relaxed text-foreground line-clamp-3">
          {current.entryReason}
        </div>
        {current.positiveExpectancy && (
          <div className="mt-2 text-[10px] leading-relaxed text-muted-foreground line-clamp-2">
            正期望：{current.positiveExpectancy}
          </div>
        )}
        {current.preMortem && (
          <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground line-clamp-2">
            可能错因：{current.preMortem}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">你现在估计这笔最终盈利概率</span>
          <span className="font-mono text-[16px] text-foreground">{estimate}%</span>
        </div>
        <Slider
          value={[estimate]}
          min={0}
          max={100}
          step={1}
          onValueChange={value => setEstimate(value[0] ?? estimate)}
          className="py-1"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground">
          <span>0%</span>
          <span>100%</span>
        </div>
      </div>

      {revealed ? (
        <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
          <div className="rounded border border-border bg-card p-2">
            <div className="text-muted-foreground">实际结果</div>
            <div className={`mt-1 font-mono text-[13px] ${current.outcomeWin ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
              {current.outcomeWin ? 'WIN' : 'LOSS'}
            </div>
          </div>
          <div className="rounded border border-border bg-card p-2">
            <div className="text-muted-foreground">原始预测</div>
            <div className="mt-1 font-mono text-[13px]">{current.originalProbability.toFixed(0)}%</div>
          </div>
          <div className="rounded border border-border bg-card p-2">
            <div className="text-muted-foreground">本次 Brier</div>
            <div className={`mt-1 font-mono text-[13px] ${brier <= 0.2 ? 'text-[#0ECB81]' : brier <= 0.3 ? 'text-[#F0B90B]' : 'text-[#F6465D]'}`}>
              {brier.toFixed(3)}
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="mt-3 h-8 w-full rounded bg-[#F0B90B] text-[11px] font-medium text-black hover:opacity-90"
        >
          揭晓结果并计算误差
        </button>
      )}
    </div>
  );
}

function DecisionScatterPlot({
  points,
}: {
  points: Array<{ id: string; symbol: string; score: number; r: number; quality: string | null }>;
}) {
  if (points.length === 0) {
    return <div className="h-[220px] flex items-center justify-center text-[11px] text-muted-foreground">暂无可绘制样本</div>;
  }
  const minR = Math.min(-2, ...points.map(point => point.r));
  const maxR = Math.max(2, ...points.map(point => point.r));
  const yFor = (r: number) => 190 - ((r - minR) / Math.max(0.01, maxR - minR)) * 160;
  return (
    <svg viewBox="0 0 360 220" className="w-full h-[220px] rounded border border-border bg-background">
      <line x1="35" y1="190" x2="340" y2="190" stroke="currentColor" className="text-border" />
      <line x1="35" y1="30" x2="35" y2="190" stroke="currentColor" className="text-border" />
      <line x1="35" y1={yFor(0)} x2="340" y2={yFor(0)} stroke="currentColor" className="text-muted-foreground/40" strokeDasharray="4 4" />
      <text x="35" y="208" className="fill-muted-foreground text-[9px]">0</text>
      <text x="175" y="208" className="fill-muted-foreground text-[9px]">D-score</text>
      <text x="320" y="208" className="fill-muted-foreground text-[9px]">100</text>
      <text x="5" y="35" className="fill-muted-foreground text-[9px]">R</text>
      {points.slice(0, 160).map(point => {
        const x = 35 + (point.score / 100) * 305;
        const y = yFor(point.r);
        const fill = point.quality === 'good' ? '#0ECB81' : point.quality === 'bad' ? '#F6465D' : '#F0B90B';
        return (
          <circle key={point.id} cx={x} cy={y} r="4" fill={fill}>
            <title>{point.symbol} · D {point.score} · {point.r.toFixed(2)}R</title>
          </circle>
        );
      })}
    </svg>
  );
}
