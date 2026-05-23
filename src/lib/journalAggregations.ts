/**
 * 客户端错题集聚合（纯函数）。所有 P&L 单位为 USDT。
 */
import type {
  ErrorTagCategory,
  ErrorTagPattern,
  JournalTagAssignment,
  TradeJournal,
  TradeOutcome,
} from '@/types/journal';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface PatternClusterStats {
  occurrence_count: number;
  total_pnl: number;
  avg_pnl: number;
  avg_r_multiple: number;
  win_count: number;
  loss_count: number;
  breakeven_count: number;
  no_entry_count: number;
  avg_mental_state: number;
  last_seen_at: Date | null;
  first_seen_at: Date | null;
  last_30d_count: number;
}

export interface PatternCluster {
  pattern: ErrorTagPattern;
  category: ErrorTagCategory;
  journals: TradeJournal[];
  stats: PatternClusterStats;
  severity: Severity;
}

const DAY = 24 * 60 * 60 * 1000;

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function groupJournalsByPattern(
  journals: TradeJournal[],
  assignments: JournalTagAssignment[],
  patterns: ErrorTagPattern[],
  categories: ErrorTagCategory[],
): PatternCluster[] {
  const journalById = new Map(journals.map(j => [j.id, j]));
  const patternById = new Map(patterns.map(p => [p.id, p]));
  const catById = new Map(categories.map(c => [c.id, c]));
  const now = Date.now();

  // pattern -> set of journal ids
  const grouped = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (!patternById.has(a.pattern_id) || !journalById.has(a.journal_id)) continue;
    if (!grouped.has(a.pattern_id)) grouped.set(a.pattern_id, new Set());
    grouped.get(a.pattern_id)!.add(a.journal_id);
  }

  const raw: PatternCluster[] = [];
  for (const [pid, jids] of grouped) {
    const pattern = patternById.get(pid)!;
    const category = catById.get(pattern.category_id);
    if (!category) continue;
    const js = Array.from(jids).map(id => journalById.get(id)!).filter(Boolean);
    const pnls = js.map(j => j.post_realized_pnl ?? 0);
    const totalPnl = pnls.reduce((a, b) => a + b, 0);
    const rs = js.map(j => j.post_r_multiple).filter((v): v is number => v != null);
    const mentals = js.map(j => j.pre_mental_state).filter((v): v is number => v != null);
    const times = js.map(j => new Date(j.pre_simulated_time).getTime()).sort((a, b) => a - b);
    const last30 = js.filter(j => now - new Date(j.pre_simulated_time).getTime() <= 30 * DAY).length;
    let win = 0, loss = 0, be = 0, ne = 0;
    for (const j of js) {
      switch (j.post_outcome) {
        case 'win': win++; break;
        case 'loss': loss++; break;
        case 'breakeven': be++; break;
        case 'no_entry': ne++; break;
      }
    }
    raw.push({
      pattern, category, journals: js,
      stats: {
        occurrence_count: js.length,
        total_pnl: totalPnl,
        avg_pnl: js.length ? totalPnl / js.length : 0,
        avg_r_multiple: avg(rs),
        win_count: win, loss_count: loss, breakeven_count: be, no_entry_count: ne,
        avg_mental_state: avg(mentals),
        last_seen_at: times.length ? new Date(times[times.length - 1]) : null,
        first_seen_at: times.length ? new Date(times[0]) : null,
        last_30d_count: last30,
      },
      severity: 'low',
    });
  }

  // severity 计算需要全局 P&L 分位
  const sortedByPnl = [...raw].sort((a, b) => a.stats.total_pnl - b.stats.total_pnl);
  const q25Idx = Math.max(0, Math.floor(sortedByPnl.length * 0.25) - 1);
  const q25Threshold = sortedByPnl[q25Idx]?.stats.total_pnl ?? -Infinity;

  for (const c of raw) {
    const { last_30d_count, avg_pnl, total_pnl, occurrence_count } = c.stats;
    if (last_30d_count >= 3 && avg_pnl < 0) c.severity = 'critical';
    else if (last_30d_count >= 3 || total_pnl <= q25Threshold) c.severity = 'high';
    else if (occurrence_count >= 2) c.severity = 'medium';
    else c.severity = 'low';
  }

  const sevRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return raw.sort((a, b) => {
    if (sevRank[a.severity] !== sevRank[b.severity]) return sevRank[a.severity] - sevRank[b.severity];
    if (a.stats.last_30d_count !== b.stats.last_30d_count) return b.stats.last_30d_count - a.stats.last_30d_count;
    return a.stats.total_pnl - b.stats.total_pnl;
  });
}

export function sortClusters(
  clusters: PatternCluster[],
  by: 'severity' | 'frequency' | 'pnl' | 'recent',
): PatternCluster[] {
  const sevRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const c = [...clusters];
  switch (by) {
    case 'severity':
      return c.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.stats.last_30d_count - a.stats.last_30d_count);
    case 'frequency':
      return c.sort((a, b) => b.stats.occurrence_count - a.stats.occurrence_count);
    case 'pnl':
      return c.sort((a, b) => a.stats.total_pnl - b.stats.total_pnl);
    case 'recent':
      return c.sort((a, b) => (b.stats.last_seen_at?.getTime() ?? 0) - (a.stats.last_seen_at?.getTime() ?? 0));
  }
}

export function computeTimeDistribution(journals: TradeJournal[]) {
  const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, total_pnl: 0 }));
  for (const j of journals) {
    const h = new Date(j.pre_simulated_time).getHours();
    buckets[h].count++;
    buckets[h].total_pnl += j.post_realized_pnl ?? 0;
  }
  return buckets.map(b => ({ hour: b.hour, count: b.count, avg_pnl: b.count ? b.total_pnl / b.count : 0 }));
}

export function computeMentalStateDistribution(journals: TradeJournal[]) {
  const out: { state: 1 | 2 | 3 | 4 | 5; count: number; avg_pnl: number }[] = [];
  for (const s of [1, 2, 3, 4, 5] as const) {
    const subset = journals.filter(j => j.pre_mental_state === s);
    const pnls = subset.map(j => j.post_realized_pnl ?? 0);
    out.push({ state: s, count: subset.length, avg_pnl: pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0 });
  }
  return out;
}

export function computeSymbolDistribution(journals: TradeJournal[]) {
  const m = new Map<string, { count: number; total_pnl: number }>();
  for (const j of journals) {
    const cur = m.get(j.symbol) ?? { count: 0, total_pnl: 0 };
    cur.count++;
    cur.total_pnl += j.post_realized_pnl ?? 0;
    m.set(j.symbol, cur);
  }
  return Array.from(m.entries())
    .map(([symbol, v]) => ({ symbol, ...v }))
    .sort((a, b) => b.count - a.count);
}

export function computeOutcomeRate(journals: TradeJournal[]) {
  const n = journals.length || 1;
  let win = 0, loss = 0, be = 0, ne = 0;
  for (const j of journals) {
    switch (j.post_outcome) {
      case 'win': win++; break;
      case 'loss': loss++; break;
      case 'breakeven': be++; break;
      case 'no_entry': ne++; break;
    }
  }
  const trades = journals.filter(j => j.post_outcome && j.post_outcome !== 'no_entry');
  const rs = trades.map(j => j.post_r_multiple).filter((v): v is number => v != null);
  const expectancy = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
  return {
    win_rate: win / n,
    loss_rate: loss / n,
    breakeven_rate: be / n,
    no_entry_rate: ne / n,
    expectancy,
  };
}

export interface MetaAlertItem {
  kind: 'critical_pattern' | 'low_mental' | 'reason_rewritten';
  level: 'red' | 'yellow' | 'gray';
  message: string;
  data?: unknown;
}

export function computeMetaAlerts(
  clusters: PatternCluster[],
  journals: TradeJournal[],
): MetaAlertItem[] {
  const alerts: MetaAlertItem[] = [];
  for (const c of clusters) {
    if (c.stats.last_30d_count >= 3 && c.stats.avg_pnl < 0) {
      alerts.push({
        kind: 'critical_pattern',
        level: 'red',
        message: `⚠ 模式「${c.pattern.pattern_name}」30 天内已 ${c.stats.last_30d_count} 次且平均亏损，建议在批次 6 中转化为新规则`,
        data: c.pattern.id,
      });
    }
  }
  if (journals.length > 0) {
    const low = journals.filter(j => (j.pre_mental_state ?? 5) <= 2).length;
    const pct = Math.round((low / journals.length) * 100);
    if (pct >= 20) {
      alerts.push({
        kind: 'low_mental',
        level: 'yellow',
        message: `你有 ${pct}% 的交易在心态 ≤2 分时进行（建议阈值 ≤10%）`,
      });
    }
  }
  const rewritten = journals.filter(j => j.reason_was_rewritten);
  if (rewritten.length > 0) {
    alerts.push({
      kind: 'reason_rewritten',
      level: 'gray',
      message: `${rewritten.length} 笔交易的开仓理由在事后被修改过（结果偏差风险）`,
      data: rewritten.map(j => j.id),
    });
  }
  return alerts;
}

export type OutcomeFilter = TradeOutcome;
