/**
 * 错题集 · 错误类型聚合层。
 *
 * 旧模型按「一笔交易」排列，错误只是挂在交易上的标签，你滚动的是交易。
 * 这一层把单位翻转成「错误类型」：每一类错误聚合你所有交易里它的频率、代价、趋势，
 * 具体交易退到每类错误下面当证据。错题集因此变成一本「错误类型目录」——
 * 你滚动的是错误，看见的是「我这一类错犯了多少次、在变好还是变坏」。
 *
 * 全部信号由现有 TradeJournal 字段派生，不依赖任何数据库改动。
 * 纯函数、无副作用，便于测试。
 */
import type { PainTag, TradeJournal } from '@/types/journal';
import { EMOTION_TAG_META, PAIN_TAG_LABELS } from '@/types/journal';

/** 错误维度（与「快照 → 平仓」之间产生的错误种类对应）。 */
export type ErrorFamily =
  | 'calibration'   // 预测差值
  | 'premortem'     // 反
  | 'falsification' // 止
  | 'structure'     // 结构
  | 'discipline'    // 纪律
  | 'mindset';      // 心态-行为

export interface ErrorFamilyMeta {
  label: string;
  hint: string;
}

export const ERROR_FAMILY_META: Record<ErrorFamily, ErrorFamilyMeta> = {
  calibration:   { label: '预测差值', hint: '你的预测 vs 真实结果' },
  premortem:     { label: '反 · 预想',  hint: '杀死你的东西在不在预案里' },
  falsification: { label: '止 · 证伪',  hint: '看见信号有没有动手' },
  structure:     { label: '结构',       hint: '市场结构 / 入场位置 / 止损质量' },
  discipline:    { label: '纪律',       hint: '规则有没有被执行' },
  mindset:       { label: '心态-行为',  hint: '情绪与动作匹不匹配' },
};

export type CostUnit = 'R' | 'pp' | 'USDT';

export interface ErrorInstance {
  journal: TradeJournal;
  /** 这一笔在该错误类型下的关键事实短句。 */
  detail: string;
  /** 该笔的代价贡献（单位见所属类型的 costUnit）；无法量化为 null。 */
  cost: number | null;
}

export interface ErrorTypeAggregate {
  id: string;
  family: ErrorFamily;
  title: string;
  /** 操作定义：什么算这一类错误。 */
  definition: string;
  /** 命中次数。 */
  count: number;
  /** 可检测该错误的样本数（分母）。 */
  applicable: number;
  /** count / applicable（0–1）；分母为 0 时 null。 */
  rate: number | null;
  /** 趋势：新半段命中率 − 旧半段命中率（小数）；样本 < 4 为 null。正 = 在变差。 */
  trend: number | null;
  /** 代价合计（同号相加，方向即损害方向）；无可量化代价时 null。 */
  totalCost: number | null;
  costUnit: CostUnit | null;
  /** 命中的交易，按时间倒序（最近在前）。 */
  instances: ErrorInstance[];
  /** 排序用影响分（越大越该先消除）。 */
  impactScore: number;
  /** 仅「死法不在预案内」为 true：视图据此渲染「加入盲区」。 */
  blindSpotSource: boolean;
}

// ===== 内部：错误类型描述符 =====
interface ErrorTypeDef {
  id: string;
  family: ErrorFamily;
  title: string;
  definition: string;
  /** 严重度权重（沿用旧 errorScore 的相对量级）。 */
  severity: number;
  costUnit: CostUnit | null;
  /** 这笔是否进入该错误的分母（字段是否被记录 / 是否适用）。 */
  applicable: (j: TradeJournal) => boolean;
  /** 这笔是否命中该错误。 */
  detect: (j: TradeJournal) => boolean;
  /** 命中时的事实短句。 */
  detail: (j: TradeJournal) => string;
  /** 该笔代价贡献。 */
  cost?: (j: TradeJournal) => number | null;
  blindSpotSource?: boolean;
}

const fmtR = (r: number | null | undefined): string =>
  r == null ? '—' : `${r >= 0 ? '+' : ''}${r.toFixed(1)}R`;

/** 已复盘的真实主力单（错误类型分母的统一底座；不强制 win/loss）。 */
export function isReviewedMainTrade(j: TradeJournal): boolean {
  return (j.journal_kind ?? 'trade') === 'trade'
    && (j.order_kind ?? 'main') !== 'hedge'
    && !!j.post_reviewed_at;
}

/** v2 快照标记：避免对没有该字段的旧快照误判「缺失类」错误。 */
function isV2Snapshot(j: TradeJournal): boolean {
  return j.pre_thesis_why_right != null
    || j.pre_calibration_win_pct != null
    || j.pre_odds_structure != null;
}

const ODDS_TARGET_R: Record<string, number> = { r1_easy: 1, r2_supported: 2, r3_open: 3 };
const oddsTargetR = (j: TradeJournal): number | null => {
  const k = j.pre_odds_structure;
  if (!k) return null;
  const v = ODDS_TARGET_R[k];
  return v == null ? null : v;
};

const isWinLoss = (j: TradeJournal): boolean =>
  j.post_outcome === 'win' || j.post_outcome === 'loss';
/** 亏损时的 R（用作代价贡献）；非亏损或无数据为 null。 */
const lossR = (j: TradeJournal): number | null =>
  j.post_outcome === 'loss' && typeof j.post_r_multiple === 'number' ? j.post_r_multiple : null;

const MISSED_LABEL: Record<string, string> = {
  missed: '厚结构空仓踏空',
  under_sized: '该重没重',
  late_chase: '错过后追票',
};
const DRAG_LABEL: Record<string, string> = {
  attention_only: '占用注意力 / 心力',
  missed_bigger: '钝化敏感度、错过更大机会',
  chain_reaction: '引发后续连锁乱做',
};

const ERROR_TYPE_DEFS: ErrorTypeDef[] = [
  // ===== 预测差值 =====
  {
    id: 'overconfident',
    family: 'calibration',
    title: '过度自信',
    definition: '预测胜率 ≥ 60% 却以亏损收场',
    severity: 50,
    costUnit: 'R',
    applicable: j => j.pre_calibration_win_pct != null && isWinLoss(j),
    detect: j => (j.pre_calibration_win_pct ?? 0) >= 60 && j.post_outcome === 'loss',
    detail: j => `预测 ${Math.round(j.pre_calibration_win_pct ?? 0)}% 却亏 ${fmtR(j.post_r_multiple)}`,
    cost: lossR,
  },
  {
    id: 'r_shortfall',
    family: 'calibration',
    title: 'R 目标落空',
    definition: '实际 R 比快照时给自己定的目标 R 低 0.5R 以上',
    severity: 20,
    costUnit: 'R',
    applicable: j => oddsTargetR(j) != null && typeof j.post_r_multiple === 'number',
    detect: j => {
      const t = oddsTargetR(j);
      return t != null && typeof j.post_r_multiple === 'number' && t - j.post_r_multiple > 0.5;
    },
    detail: j => `目标 ${oddsTargetR(j)}R → 实际 ${fmtR(j.post_r_multiple)}`,
    cost: j => {
      const t = oddsTargetR(j);
      // 正值 = 未兑现的 R（缺口）。
      return t != null && typeof j.post_r_multiple === 'number' ? t - j.post_r_multiple : null;
    },
  },
  // ===== 反 · 预想 =====
  {
    id: 'death_not_in_plan',
    family: 'premortem',
    title: '死法不在预案内',
    definition: '亏损了，但杀死你的东西不在你盯的证伪信号里',
    severity: 50,
    costUnit: 'R',
    blindSpotSource: true,
    applicable: j => j.post_outcome === 'loss' && j.exit_falsification_status != null,
    detect: j => j.exit_falsification_status === 'not_triggered',
    detail: j => `${fmtR(j.post_r_multiple)} · 证伪信号从未触发`,
    cost: lossR,
  },
  {
    id: 'opponent_was_right',
    family: 'premortem',
    title: '对手是对的',
    definition: '复盘判定：你预想到的反方才是对的，却没有听它',
    severity: 30,
    costUnit: 'R',
    applicable: j => j.post_opponent_was_right != null,
    detect: j => j.post_opponent_was_right === true,
    detail: j =>
      `预想到了反方却没听${j.post_outcome === 'loss' ? ` · ${fmtR(j.post_r_multiple)}` : ''}`,
    cost: lossR,
  },
  // ===== 止 · 证伪 =====
  {
    id: 'falsification_late',
    family: 'falsification',
    title: '看见了却晚动',
    definition: '证伪信号触发了，但你反应晚了',
    severity: 40,
    costUnit: 'R',
    applicable: j => j.exit_falsification_status != null,
    detect: j => j.exit_falsification_status === 'triggered_late',
    detail: j =>
      `信号触发后反应晚了${j.post_outcome === 'loss' ? ` · ${fmtR(j.post_r_multiple)}` : ''}`,
    cost: lossR,
  },
  {
    id: 'no_falsification_set',
    family: 'falsification',
    title: '没设可证伪信号就下单',
    definition: '快照里没写下任何「证明我错了」的信号 —— 等于没装退出开关',
    severity: 25,
    costUnit: null,
    applicable: isV2Snapshot,
    detect: j => !(j.pre_falsification_signal && j.pre_falsification_signal.trim()),
    detail: () => '入场时未设定证伪 / 退出信号',
  },
  // ===== 结构 =====
  {
    id: 'late_stage_chase',
    family: 'structure',
    title: '末端追价',
    definition: '在行情末端入场 —— 空间最薄、止损最尴尬的位置',
    severity: 20,
    costUnit: 'R',
    applicable: j => j.pre_entry_stage != null,
    detect: j => j.pre_entry_stage === 'late',
    detail: j => `末端入场${j.post_outcome === 'loss' ? ` · ${fmtR(j.post_r_multiple)}` : ''}`,
    cost: lossR,
  },
  {
    id: 'arbitrary_stop',
    family: 'structure',
    title: '拍脑袋止损',
    definition: '止损按百分比 / 资金量拍的，与结构无关 —— 在噪音里送钱',
    severity: 25,
    costUnit: null,
    applicable: j => j.pre_stop_quality != null,
    detect: j => j.pre_stop_quality === 'arbitrary',
    detail: () => '止损与结构失效位无关',
  },
  {
    id: 'chop_chase',
    family: 'structure',
    title: '震荡里追涨',
    definition: '市场是震荡结构，却用顺势 / 突破打法 —— 结构与打法错配',
    severity: 30,
    costUnit: 'R',
    applicable: j => j.pre_market_regime != null && j.pre_edge_source != null,
    detect: j =>
      j.pre_market_regime === 'ranging'
      && (j.pre_edge_source === 'trend_follow' || j.pre_edge_source === 'breakout'),
    detail: j =>
      `震荡市用${j.pre_edge_source === 'breakout' ? '突破' : '顺势'}打法${j.post_outcome === 'loss' ? ` · ${fmtR(j.post_r_multiple)}` : ''}`,
    cost: lossR,
  },
  // ===== 纪律 =====
  {
    id: 'checklist_violation',
    family: 'discipline',
    title: '清单未过仍下单',
    definition: '开仓清单没全过，仍然下了单',
    severity: 35,
    costUnit: null,
    applicable: j => j.pre_checklist_passed != null,
    detect: j => j.pre_checklist_passed === false,
    detail: () => '清单未通过仍下单',
  },
  {
    id: 'chase_after_close',
    family: 'discipline',
    title: '刚平就开',
    definition: '上一单刚平仓，立刻又开新单（持单 = 耐心）',
    severity: 25,
    costUnit: null,
    applicable: j => j.pre_chase_after_close != null,
    detect: j => j.pre_chase_after_close === true,
    detail: () => '刚平仓就追开新单',
  },
  {
    id: 'missed_high_odds',
    family: 'discipline',
    title: '该做没做 / 该重没重',
    definition: '厚结构出现时没上、上轻、或错过后才追票',
    severity: 25,
    costUnit: null,
    applicable: j => j.post_missed_high_odds_state != null,
    detect: j => !!j.post_missed_high_odds_state && j.post_missed_high_odds_state !== 'none',
    detail: j => MISSED_LABEL[j.post_missed_high_odds_state as string] ?? '踏空高盈亏比结构',
  },
  {
    id: 'small_position_drag',
    family: 'discipline',
    title: '小机会仓位拖累',
    definition: '持有小机会仓位损耗了行动力（比空仓更差的一等负向状态）',
    severity: 20,
    costUnit: null,
    applicable: j => j.post_small_position_drag != null,
    detect: j => !!j.post_small_position_drag && j.post_small_position_drag !== 'none',
    detail: j => DRAG_LABEL[j.post_small_position_drag as string] ?? '小机会仓位拖累',
  },
  // ===== 心态-行为不匹配 =====
  {
    id: 'negative_emotion_entry',
    family: 'mindset',
    title: '带负面情绪入场',
    definition: '快照时已标记负向情绪，却仍然开了仓',
    severity: 30,
    costUnit: null,
    applicable: j => Array.isArray(j.pre_pain_tags),
    detect: j => (j.pre_pain_tags ?? []).some(t => EMOTION_TAG_META[t]?.valence === 'negative'),
    detail: j => {
      const neg = (j.pre_pain_tags ?? []).filter(t => EMOTION_TAG_META[t]?.valence === 'negative');
      const labels = neg.slice(0, 2).map(t => EMOTION_TAG_META[t]?.label ?? t).join('、');
      return neg.length > 2 ? `${labels} 等 ${neg.length} 项` : labels;
    },
  },
  {
    id: 'cognitive_bias_flagged',
    family: 'mindset',
    title: '认知偏差自检命中',
    definition: '下单前认知偏差自检不是「无」—— 带着已知偏差行动',
    severity: 25,
    costUnit: null,
    applicable: j => Array.isArray(j.pre_cognitive_bias_tags),
    detect: j => (j.pre_cognitive_bias_tags ?? []).filter(t => t && t !== 'none').length > 0,
    detail: j => {
      const tags = (j.pre_cognitive_bias_tags ?? []).filter(t => t && t !== 'none');
      const labels = tags.slice(0, 2).map(t => PAIN_TAG_LABELS[t as PainTag] ?? t).join('、');
      return tags.length > 2 ? `${labels} 等 ${tags.length} 项` : labels;
    },
  },
  {
    id: 'agony_trade',
    family: 'mindset',
    title: '煎熬交易',
    definition: '过程纠结度 ≤ 2 —— 交易最重要的是轻松，煎熬本身就是错误信号',
    severity: 15,
    costUnit: null,
    applicable: j => j.post_struggle_level != null,
    detect: j => (j.post_struggle_level ?? 5) <= 2,
    detail: j => `纠结度 ${j.post_struggle_level}/5${j.post_outcome === 'win' ? ' · 却赢了' : ''}`,
  },
  {
    id: 'lucky_bad_decision',
    family: 'mindset',
    title: '危险的幸运',
    definition: '坏决策却赢了 —— 运气在强化错误行为，最该警惕',
    severity: 30,
    costUnit: null,
    applicable: j => j.post_decision_quality != null && isWinLoss(j),
    detect: j => j.post_decision_quality === 'bad' && j.post_outcome === 'win',
    detail: () => '坏决策却赢 · 别学这次',
  },
];

function tsOf(j: TradeJournal): number {
  const s = j.post_reviewed_at ?? j.pre_real_time ?? j.created_at;
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** 趋势：把适用样本按时间排序、对半切，新半段命中率 − 旧半段命中率。样本 < 4 为 null。 */
function computeTrend(
  applicable: TradeJournal[],
  detect: (j: TradeJournal) => boolean,
): number | null {
  if (applicable.length < 4) return null;
  const sorted = [...applicable].sort((a, b) => tsOf(a) - tsOf(b));
  const mid = Math.floor(sorted.length / 2);
  const older = sorted.slice(0, mid);
  const newer = sorted.slice(mid);
  const rate = (arr: TradeJournal[]) => arr.filter(detect).length / arr.length;
  return rate(newer) - rate(older);
}

/**
 * 把每笔交易的错误信号聚合成「错误类型目录」。
 * 返回所有「可测量」的类型（applicable > 0）：命中过的 count > 0；没命中但
 * 有样本可判的记为 count 0（视图据此显示 0/N · 0%，即「守住了」）；完全没有
 * 样本可判（applicable = 0）的类型省略。按影响分从大到小排序，count = 0 的
 * 类型影响分为 0、自然沉到末尾。
 */
export function aggregateErrorTypes(journals: TradeJournal[]): ErrorTypeAggregate[] {
  const base = journals.filter(isReviewedMainTrade);
  const out: ErrorTypeAggregate[] = [];

  for (const def of ERROR_TYPE_DEFS) {
    const applicable = base.filter(def.applicable);
    // 没有任何样本可判定 → 无从记 0，省略；有样本但未命中 → 记为 count 0。
    if (applicable.length === 0) continue;
    const hits = applicable.filter(def.detect);

    const instances: ErrorInstance[] = hits
      .map(j => ({
        journal: j,
        detail: def.detail(j),
        cost: def.cost ? def.cost(j) : null,
      }))
      .sort((a, b) => tsOf(b.journal) - tsOf(a.journal));

    const costs = instances.map(i => i.cost).filter((c): c is number => c != null);
    const totalCost = costs.length ? costs.reduce((a, b) => a + b, 0) : null;
    const rate = applicable.length ? hits.length / applicable.length : null;
    const trend = computeTrend(applicable, def.detect);

    const costMag = totalCost != null ? Math.min(Math.abs(totalCost), 50) : 0;
    const trendBoost = trend != null && trend > 0 ? 1 + trend : 1;
    const impactScore = hits.length * def.severity * trendBoost + costMag;

    out.push({
      id: def.id,
      family: def.family,
      title: def.title,
      definition: def.definition,
      count: hits.length,
      applicable: applicable.length,
      rate,
      trend,
      totalCost,
      costUnit: def.costUnit,
      instances,
      impactScore,
      blindSpotSource: !!def.blindSpotSource,
    });
  }

  return out.sort((a, b) => b.impactScore - a.impactScore);
}
