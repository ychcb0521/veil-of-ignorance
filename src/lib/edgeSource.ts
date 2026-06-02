import type { EdgeSource, TradeOutcome } from '@/types/journal';

export interface EdgeSourceOption {
  id: EdgeSource;
  label: string;
  description: string;
  entryPrinciple: string;
  goodLocation: string;
  badLocation: string;
  /** Rendered as a caution state when this option is available in a specific flow. */
  isWarning?: boolean;
}

/**
 * Edge / 源头：这笔交易靠什么赚钱。这里只识别市场机制，不判断是否值得下注。
 * 在快照时标注（属于 thesis 的一部分，避免事后归因），驱动复盘的「盈亏同源」分析。
 */
export const EDGE_SOURCE_OPTIONS: readonly EdgeSourceOption[] = [
  {
    id: 'trend_follow',
    label: '顺势延续',
    description: '趋势已经成立，靠惯性继续释放空间。',
    entryPrinciple: '用低成本支点参与尚未结束的方向惯性。',
    goodLocation: '趋势未破，回调到支点，止损近，后续空间仍在。',
    badLocation: '趋势已经释放很远后追价。',
  },
  {
    id: 'breakout',
    label: '突破扩张',
    description: '关键结构被打开，靠波动率扩张赚钱。',
    entryPrinciple: '在旧结构失效、新空间打开，但价格还没充分释放时入场。',
    goodLocation: '旧区间被突破，市场接受新价格，失败成本清楚。',
    badLocation: '只是价格越线，没有接受，或突破后追太晚。',
  },
  {
    id: 'mean_reversion',
    label: '均值回归',
    description: '偏离过度，靠价格回到合理区间赚钱。',
    entryPrinciple: '等过度偏离后的边际动能衰竭，再用短止损博修复。',
    goodLocation: '偏离极端，动能减弱，情绪释放充分，回归目标清楚。',
    badLocation: '跌多就买、涨多就空，太早逆势接刀。',
  },
  {
    id: 'squeeze_release',
    label: '挤压释放',
    description: '多空一方过度拥挤，靠被迫平仓推动行情。',
    entryPrinciple: '站在被迫交易流的上游，而不是情绪释放后的末端。',
    goodLocation: '一方仓位拥挤，关键触发位临近，突破后会引发止损/爆仓/回补。',
    badLocation: '等挤压已经完成才追，买到流动性尾巴。',
  },
  {
    id: 'no_clear_edge',
    label: '无明确 edge',
    description: '看不出来源，只是想交易。',
    entryPrinciple: '没有机会源头，就没有入场资格。',
    goodLocation: '能说清楚为什么有优势。',
    badLocation: '只是想交易、怕错过、看起来要动。',
    isWarning: true,
  },
] as const;

export const EDGE_SOURCE_LABELS: Record<EdgeSource, string> = {
  trend_follow: '顺势延续',
  breakout: '突破扩张',
  mean_reversion: '均值回归',
  squeeze_release: '挤压释放',
  no_clear_edge: '无明确 edge',
  against_crowd: '逆拥挤（旧）',
  structure_level: '结构位',
  event_catalyst: '事件催化',
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
