import type { EdgeSource, EntryStage, MarketRegime, StopQuality } from '@/types/journal';

/**
 * 市场结构层 — 快照第 0 步「先判断当前是什么结构」。
 *
 * 核心第一性原理（《数字货币交易盈利策略》）：同一个动作，换个结构就改变性质。
 *   追涨在单边里是对的、在震荡里是致命的；
 *   止损放在结构位是保护、放在噪音里是送钱。
 * 顺势 = 单边、均值回归 = 震荡、突破 / 挤压 = 转换点。
 *
 * 这里只识别市场结构，不预测涨跌幅度，也不阻塞提交——只在结构与打法不自洽时给软提示。
 */

export interface MarketRegimeOption {
  id: MarketRegime;
  label: string;
  description: string;
  /** 这种结构里有效的打法口诀。 */
  worksWith: string;
  /** 这种结构里致命的打法。 */
  killsWith: string;
}

export const MARKET_REGIME_OPTIONS: readonly MarketRegimeOption[] = [
  {
    id: 'trending',
    label: '单边趋势',
    description: '方向明确、惯性强，价格持续朝一个方向推进。',
    worksWith: '顺势回调进场、突破加仓——参与还没结束的惯性。',
    killsWith: '逆势接刀 / 越涨越空——趋势会一路把你碾过去。',
  },
  {
    id: 'ranging',
    label: '震荡市',
    description: '区间来回、无持续方向，上下都有边界。',
    worksWith: '均值回归：在边界附近高抛低吸，止损放区间外。',
    killsWith: '追涨杀跌：在区间里追价 = 每次都买在要回头的地方。',
  },
  {
    id: 'transition',
    label: '转换中',
    description: '结构正在切换——突破临界、挤压释放，旧结构将破未破。',
    worksWith: '突破 / 挤压释放：等旧结构被市场确认失效再进。',
    killsWith: '把未确认的突破当成已成立的趋势去追。',
  },
] as const;

export const MARKET_REGIME_LABELS: Record<MarketRegime, string> = {
  trending: '单边趋势',
  ranging: '震荡市',
  transition: '转换中',
};

export interface EntryStageOption {
  id: EntryStage;
  label: string;
  description: string;
}

export const ENTRY_STAGE_OPTIONS: readonly EntryStageOption[] = [
  {
    id: 'early',
    label: '起步段',
    description: '刚启动 / 刚突破，剩余空间最厚、止损最近、容错最大。',
  },
  {
    id: 'middle',
    label: '中段',
    description: '方向已确认、已释放一部分空间，仍有结构支撑。',
  },
  {
    id: 'late',
    label: '末端',
    description: '情绪高潮 / 已释放很远，剩余空间最薄、止损最尴尬。',
  },
] as const;

export const ENTRY_STAGE_LABELS: Record<EntryStage, string> = {
  early: '起步段',
  middle: '中段',
  late: '末端',
};

export interface StopQualityOption {
  id: StopQuality;
  label: string;
  description: string;
  /** true = 健康（结构位），false = 警示（拍脑袋）。 */
  healthy: boolean;
}

export const STOP_QUALITY_OPTIONS: readonly StopQualityOption[] = [
  {
    id: 'structural',
    label: '结构失效位',
    description: '跌破它，这一单的论点就错了——止损是保护。',
    healthy: true,
  },
  {
    id: 'arbitrary',
    label: '按百分比 / 资金拍的',
    description: '与结构无关，只是「我只想亏这么多」——容易被噪音正好扫到。',
    healthy: false,
  },
] as const;

export const STOP_QUALITY_LABELS: Record<StopQuality, string> = {
  structural: '结构失效位',
  arbitrary: '拍脑袋百分比',
};

/**
 * edge 源头通常出现在哪种 regime（顺势=单边、均值回归=震荡、突破/挤压=转换）。
 * no_clear_edge 与旧版 edge 不参与校验。
 */
const EDGE_EXPECTED_REGIME: Partial<Record<EdgeSource, MarketRegime>> = {
  trend_follow: 'trending',
  mean_reversion: 'ranging',
  breakout: 'transition',
  squeeze_release: 'transition',
};

/**
 * 结构 ↔ 源头自洽校验。返回一句软提示（结构与打法不自洽时），否则 null。
 * 绝不阻塞提交，只让你看见「这个动作在这个结构里会变成什么」。
 */
export function regimeEdgeMismatchHint(
  regime: MarketRegime | null | undefined,
  edge: EdgeSource | null | undefined,
): string | null {
  if (!regime || !edge) return null;
  const expected = EDGE_EXPECTED_REGIME[edge];
  if (!expected || expected === regime) return null;

  if (edge === 'trend_follow' && regime === 'ranging') {
    return '震荡里顺势追价：追涨在单边里对、在震荡里致命。震荡更适合在边界做均值回归，而不是追价。';
  }
  if (edge === 'trend_follow' && regime === 'transition') {
    return '结构尚未确认为单边，顺势的惯性可能还没真正建立——容易把假突破当成趋势。';
  }
  if (edge === 'mean_reversion' && regime === 'trending') {
    return '单边里逆势接刀：趋势仍在释放惯性，均值回归很容易被一路碾过。';
  }
  if (edge === 'mean_reversion' && regime === 'transition') {
    return '结构在转换，均值的中枢可能正在移动，回归目标不稳。';
  }
  if (edge === 'breakout' && regime === 'ranging') {
    return '区间内的「突破」多为假突破：要等旧结构被市场接受为失效，而不是一越线就追。';
  }
  if (edge === 'breakout' && regime === 'trending') {
    return '趋势已成立后再做突破，往往已是中段 / 末端的追价，注意剩余空间。';
  }
  if (edge === 'squeeze_release' && regime === 'ranging') {
    return '挤压释放需要拥挤仓位与触发位；纯震荡里可能只是区间来回扫。';
  }
  if (edge === 'squeeze_release' && regime === 'trending') {
    return '趋势中段的挤压多已释放，注意别买在被迫交易流的尾巴。';
  }
  return `源头与当前结构不太自洽：${MARKET_REGIME_LABELS[expected]} 才是「${edge}」常见的土壤。`;
}

/**
 * 入场阶段警示：末端 + 顺势 / 突破 = 空间最薄、止损最尴尬的位置，最容易死在追价上。
 * 返回软提示或 null。
 */
export function entryStageWarning(
  stage: EntryStage | null | undefined,
  edge: EdgeSource | null | undefined,
): string | null {
  if (stage !== 'late') return null;
  if (edge === 'trend_follow' || edge === 'breakout' || edge === 'squeeze_release') {
    return '末端入场 + 顺势 / 突破：剩余空间最薄、止损最尴尬。追涨杀跌最容易死在这个位置——要么等回调到起步段，要么直接放过。';
  }
  return '末端入场：行情已经释放很远，剩余空间薄、容错小。确认这不是「怕错过」而追的最后一棒。';
}
