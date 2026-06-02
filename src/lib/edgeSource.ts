import type { EdgeSource, TradeOutcome } from '@/types/journal';

export interface EdgeSourceOption {
  id: EdgeSource;
  label: string;
  description: string;
  /** Rendered as a caution state when this option is available in a specific flow. */
  isWarning?: boolean;
}

/**
 * Edge / 源头：这一单的不对称优势来自哪里。结构判定，不是涨幅预测。
 * 在快照时标注（属于 thesis 的一部分，避免事后归因），驱动复盘的「盈亏同源」分析。
 */
export const EDGE_SOURCE_OPTIONS: readonly EdgeSourceOption[] = [
  {
    id: 'trend_follow',
    label: '顺势',
    description: '趋势刚起还是已延伸？只在趋势刚起、还没充分释放时，才可能是干净源头。',
  },
  {
    id: 'breakout',
    label: '突破',
    description: '突破当下还是已加速远离？只在突破刚发生、结构刚被改写时，才值得占用行动力。',
  },
  {
    id: 'mean_reversion',
    label: '均值回归',
    description: '偏离够不够极端？没有足够极端的偏离，均值回归很容易只是震荡里的小机会。',
  },
] as const;

export const EDGE_SOURCE_LABELS: Record<EdgeSource, string> = {
  against_crowd: '逆拥挤',
  trend_follow: '顺势',
  structure_level: '结构位',
  breakout: '突破',
  mean_reversion: '均值回归',
  event_catalyst: '事件催化',
  no_clear_edge: '说不清 / 凭感觉',
};

export interface EdgeSourcePnlStat {
  edge: EdgeSource;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  /** Sum of realized PnL across reviewed trades on this edge. */
  netPnl: number;
  totalWinPnl: number;
  totalLossPnl: number;
}

export interface EdgeSourceJournalLite {
  pre_edge_source?: EdgeSource | null;
  post_outcome?: TradeOutcome | null;
  post_realized_pnl?: number | null;
}

/**
 * 盈亏同源：把已复盘的单子按 edge 源头聚合，算出每个源头的盈/亏分布。
 * 同一个源头既是你最大的盈利来源、又是最大的亏损来源 —— 这正是「同源」要让你看见的事实。
 */
export function aggregateEdgeSourcePnl(
  journals: readonly EdgeSourceJournalLite[],
): EdgeSourcePnlStat[] {
  const byEdge = new Map<EdgeSource, EdgeSourcePnlStat>();

  for (const j of journals) {
    const edge = j.pre_edge_source;
    if (!edge) continue;
    const outcome = j.post_outcome;
    if (outcome !== 'win' && outcome !== 'loss') continue;

    let stat = byEdge.get(edge);
    if (!stat) {
      stat = {
        edge,
        label: EDGE_SOURCE_LABELS[edge],
        trades: 0,
        wins: 0,
        losses: 0,
        netPnl: 0,
        totalWinPnl: 0,
        totalLossPnl: 0,
      };
      byEdge.set(edge, stat);
    }

    const pnl = j.post_realized_pnl ?? 0;
    stat.trades += 1;
    stat.netPnl += pnl;
    if (outcome === 'win') {
      stat.wins += 1;
      stat.totalWinPnl += pnl;
    } else {
      stat.losses += 1;
      stat.totalLossPnl += pnl;
    }
  }

  return [...byEdge.values()].sort((a, b) => b.trades - a.trades);
}

/**
 * Identify the edge that is BOTH a top winner and a top loser — the clearest
 * illustration of 盈亏同源. Returns null if no single edge dominates both sides.
 */
export function findSameSourceEdge(
  stats: readonly EdgeSourcePnlStat[],
): EdgeSource | null {
  const withWins = stats.filter((s) => s.wins > 0);
  const withLosses = stats.filter((s) => s.losses > 0);
  if (withWins.length === 0 || withLosses.length === 0) return null;

  const topWinner = [...withWins].sort((a, b) => b.totalWinPnl - a.totalWinPnl)[0];
  const topLoser = [...withLosses].sort((a, b) => a.totalLossPnl - b.totalLossPnl)[0];

  return topWinner.edge === topLoser.edge ? topWinner.edge : null;
}
