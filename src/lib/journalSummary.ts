/**
 * 错题集「汇总」视图的聚合逻辑。
 * 思路：把"开仓快照 / 平仓评价"里每个问题做成一行可展开，展开后看的不是单笔，
 * 而是历史全部单子在这个问题上的答案分布 / 列表 / 数值统计。
 *
 * 设计成 declarative spec + generic aggregator：
 *   每个字段一行 { key, label, type, optionLabels }，
 *   渲染层根据 type 选不同组件，不在 UI 里写 switch。
 */

import type { TradeJournal } from '@/types/journal';
import { MENTAL_STATE_LABELS, PAIN_TAG_LABELS } from '@/types/journal';
import { COGNITIVE_BIAS_LABELS } from '@/lib/cognitiveBiasTags';
import { EDGE_SOURCE_LABELS } from '@/lib/edgeSource';
import {
  MARKET_REGIME_LABELS, ENTRY_STAGE_LABELS, STOP_QUALITY_LABELS,
} from '@/lib/snapshotStructure';
import { ODDS_STRUCTURE_LABELS } from '@/lib/oddsStructure';
import { SMALL_POSITION_DRAG_LABELS, STRUGGLE_LEVEL_LABELS } from '@/lib/structureResult';
import { MAIN_STONE_META, type MainStoneTag } from '@/lib/mainStoneTags';
import { getCloseReviewAuditAnswer } from '@/lib/reflectionFacts';

// =========== 类型 ===========

export type SummaryFieldType = 'enum' | 'multi' | 'text' | 'numeric';

export interface SummaryFieldSpec {
  /** Stable row id when several specs derive from the same database column. */
  id?: string;
  key: keyof TradeJournal;
  label: string;
  type: SummaryFieldType;
  getValue?: (journal: TradeJournal) => unknown;
  /** 解释这道问题在表单里问的是什么。 */
  hint?: string;
  /** enum / multi 用：值 → 显示文案。 */
  optionLabels?: Record<string, string>;
  /** enum 用：值 → 强调色（高亮"危险选项"）。 */
  optionAccents?: Record<string, string>;
  /** numeric 用：值域、可选 buckets。 */
  numericMin?: number;
  numericMax?: number;
  numericLabels?: Record<number | string, string>;
  numericUnit?: string;
}

export interface EnumBucket {
  value: string;
  label: string;
  count: number;
  share: number;
  accent?: string;
}

export interface EnumSummary {
  type: 'enum';
  filled: number;
  empty: number;
  buckets: EnumBucket[];
}

export interface MultiSummary {
  type: 'multi';
  filled: number;
  empty: number;
  /** 总计的"被选标签数"——一笔多选会贡献多个。 */
  selections: number;
  buckets: EnumBucket[];
}

export interface TextAnswer {
  journalId: string;
  symbol: string;
  direction: string | null;
  timeIso: string;
  outcome: string | null;
  text: string;
}

export interface TextSummary {
  type: 'text';
  filled: number;
  empty: number;
  answers: TextAnswer[];
}

export interface NumericSummary {
  type: 'numeric';
  filled: number;
  empty: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  /** 离散分布 (numericLabels 已知时按 label 一桶；否则按等宽桶)。 */
  buckets: EnumBucket[];
}

export type FieldSummary = EnumSummary | MultiSummary | TextSummary | NumericSummary;

// =========== 聚合 ===========

function isFilled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function fmtTimeIso(j: TradeJournal): string {
  return j.pre_simulated_time ?? j.created_at ?? '';
}

function getFieldValue(journal: TradeJournal, spec: SummaryFieldSpec): unknown {
  return spec.getValue ? spec.getValue(journal) : journal[spec.key];
}

export function summarizeField(journals: TradeJournal[], spec: SummaryFieldSpec): FieldSummary {
  const total = journals.length;
  switch (spec.type) {
    case 'enum': return summarizeEnum(journals, spec, total);
    case 'multi': return summarizeMulti(journals, spec, total);
    case 'numeric': return summarizeNumeric(journals, spec, total);
    case 'text': return summarizeText(journals, spec, total);
  }
}

function summarizeEnum(journals: TradeJournal[], spec: SummaryFieldSpec, total: number): EnumSummary {
  const counts = new Map<string, number>();
  let filled = 0;
  for (const j of journals) {
    const v = getFieldValue(j, spec);
    if (!isFilled(v)) continue;
    filled += 1;
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const buckets: EnumBucket[] = Array.from(counts.entries())
    .map(([value, count]) => ({
      value,
      label: spec.optionLabels?.[value] ?? value,
      count,
      share: filled > 0 ? count / filled : 0,
      accent: spec.optionAccents?.[value],
    }))
    .sort((a, b) => b.count - a.count);
  return { type: 'enum', filled, empty: total - filled, buckets };
}

function summarizeMulti(journals: TradeJournal[], spec: SummaryFieldSpec, total: number): MultiSummary {
  const counts = new Map<string, number>();
  let filled = 0;
  let selections = 0;
  for (const j of journals) {
    const v = getFieldValue(j, spec);
    if (!Array.isArray(v) || v.length === 0) continue;
    filled += 1;
    for (const tag of v) {
      const key = String(tag);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      selections += 1;
    }
  }
  const buckets: EnumBucket[] = Array.from(counts.entries())
    .map(([value, count]) => ({
      value,
      label: spec.optionLabels?.[value] ?? value,
      count,
      share: filled > 0 ? count / filled : 0, // 占"有填的笔数"
      accent: spec.optionAccents?.[value],
    }))
    .sort((a, b) => b.count - a.count);
  return { type: 'multi', filled, empty: total - filled, selections, buckets };
}

function summarizeNumeric(journals: TradeJournal[], spec: SummaryFieldSpec, total: number): NumericSummary {
  const values: number[] = [];
  for (const j of journals) {
    const raw = getFieldValue(j, spec);
    const n = typeof raw === 'number' ? raw : raw == null ? null : Number(raw);
    if (n != null && Number.isFinite(n)) values.push(n);
  }
  const filled = values.length;
  if (filled === 0) {
    return { type: 'numeric', filled: 0, empty: total, mean: null, median: null, min: null, max: null, buckets: [] };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((s, x) => s + x, 0);
  const mean = sum / filled;
  const median = filled % 2 === 1
    ? sorted[(filled - 1) / 2]
    : (sorted[filled / 2 - 1] + sorted[filled / 2]) / 2;
  const min = sorted[0];
  const max = sorted[filled - 1];

  // 离散桶：有 numericLabels（1-5 这种）就一档一桶；否则等宽 6 桶。
  let buckets: EnumBucket[];
  if (spec.numericLabels) {
    const counts = new Map<string, number>();
    for (const v of values) {
      const key = String(v);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    buckets = Object.entries(spec.numericLabels).map(([value, lbl]) => ({
      value,
      label: lbl,
      count: counts.get(value) ?? 0,
      share: filled > 0 ? (counts.get(value) ?? 0) / filled : 0,
    }));
  } else {
    const BUCKET_N = 6;
    const span = max - min || 1;
    const w = span / BUCKET_N;
    const tally = Array.from({ length: BUCKET_N }, () => 0);
    for (const v of values) {
      const idx = Math.min(BUCKET_N - 1, Math.floor((v - min) / w));
      tally[idx] += 1;
    }
    buckets = tally.map((count, i) => {
      const lo = min + i * w;
      const hi = i === BUCKET_N - 1 ? max : min + (i + 1) * w;
      return {
        value: `bucket-${i}`,
        label: `${formatRange(lo)}–${formatRange(hi)}${spec.numericUnit ?? ''}`,
        count,
        share: filled > 0 ? count / filled : 0,
      };
    });
  }
  return { type: 'numeric', filled, empty: total - filled, mean, median, min, max, buckets };
}

function formatRange(n: number): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 100) return n.toFixed(1);
  return n.toFixed(2);
}

function summarizeText(journals: TradeJournal[], spec: SummaryFieldSpec, total: number): TextSummary {
  const answers: TextAnswer[] = [];
  for (const j of journals) {
    const v = getFieldValue(j, spec);
    if (typeof v !== 'string' || v.trim().length === 0) continue;
    answers.push({
      journalId: j.id,
      symbol: j.symbol,
      direction: j.direction ?? null,
      timeIso: fmtTimeIso(j),
      outcome: j.post_outcome ?? null,
      text: v.trim(),
    });
  }
  // 按时间倒序，最新的在前
  answers.sort((a, b) => (a.timeIso > b.timeIso ? -1 : 1));
  const filled = answers.length;
  return { type: 'text', filled, empty: total - filled, answers };
}

// =========== Specs · 开仓快照（PRE） ===========

const OPP_COST_WORTH_LABELS: Record<string, string> = {
  'true': '是 · 不做更亏',
  'false': '否 · 不做也不亏',
};
const OPP_COST_WORTH_ACCENTS: Record<string, string> = {
  'true': '#0ECB81',
  'false': '#F6465D',
};
const CHEAP_OPPORTUNITY_LABELS: Record<string, string> = {
  cheap: '便宜机会',
  not_cheap: '不便宜',
  unclear: '说不清 / 凭感觉',
};
const CHEAP_OPPORTUNITY_ACCENTS: Record<string, string> = {
  cheap: '#0ECB81',
  not_cheap: '#F6465D',
  unclear: '#D89B00',
};

const MAIN_STONE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(MAIN_STONE_META).map(([k, v]) => [k, v.label]),
);

export const PRE_FIELD_SPECS: SummaryFieldSpec[] = [
  { key: 'pre_mental_state', label: '心态自评（1–5）', type: 'numeric', numericMin: 1, numericMax: 5, numericLabels: MENTAL_STATE_LABELS as unknown as Record<string, string>, hint: '排除性清单的硬门：≤2 阻断开仓。' },
  { key: 'pre_market_regime', label: '当前市场结构', type: 'enum', optionLabels: MARKET_REGIME_LABELS, hint: '判断单边 / 震荡 / 转换中。' },
  { key: 'pre_entry_stage', label: '入场阶段', type: 'enum', optionLabels: ENTRY_STAGE_LABELS, hint: '起步 / 中段 / 末端。' },
  { key: 'pre_edge_source', label: 'edge 源头', type: 'enum', optionLabels: EDGE_SOURCE_LABELS, optionAccents: { no_clear_edge: '#F6465D' }, hint: '这一单靠什么机制赚钱。' },
  { key: 'pre_opportunity_cost_worth', label: '不做更亏吗', type: 'enum', optionLabels: OPP_COST_WORTH_LABELS, optionAccents: OPP_COST_WORTH_ACCENTS, hint: '真有机会成本 vs 填补无聊。' },
  { key: 'pre_cheap_opportunity', label: '便宜机会', type: 'enum', optionLabels: CHEAP_OPPORTUNITY_LABELS, optionAccents: CHEAP_OPPORTUNITY_ACCENTS, hint: '用低成本拿到不对称暴露 vs 成本太厚。' },
  { key: 'pre_odds_structure', label: '盈亏比目标', type: 'enum', optionLabels: ODDS_STRUCTURE_LABELS, hint: '结构给的目标空间。' },
  { key: 'pre_stop_quality', label: '止损质量', type: 'enum', optionLabels: STOP_QUALITY_LABELS, optionAccents: { arbitrary: '#F6465D', structural: '#0ECB81' }, hint: '结构失效位 vs 拍脑袋百分比。' },
  { key: 'pre_calibration_win_pct', label: '开仓预测胜率（%）', type: 'numeric', numericMin: 0, numericMax: 100, numericUnit: '%', hint: '事后用 Brier 做校准。' },
  { key: 'pre_max_loss_usdt', label: '本次预设最大亏损（USDT）', type: 'numeric', numericUnit: '', hint: '风险预算上限。' },
  { key: 'pre_pain_tags', label: '情绪标签（开仓时）', type: 'multi', optionLabels: PAIN_TAG_LABELS, hint: '多选；按"被选频次"统计。' },
  { key: 'pre_cognitive_bias_tags', label: '认知偏差自查', type: 'multi', optionLabels: COGNITIVE_BIAS_LABELS, hint: '"另一条情绪轨"。' },
  { key: 'pre_thesis_why_right', label: '这笔为什么会对', type: 'text', hint: '正：方向论点。' },
  { key: 'pre_premortem_failure_reason', label: '亏完最可能原因', type: 'text', hint: '反：pre-mortem 剧本。' },
  { key: 'pre_falsification_signal', label: '提前止损 / 拆仓信号', type: 'text', hint: '止：可观测的失效信号。' },
  { key: 'pre_opponent_statement', label: '反对者陈述', type: 'text', hint: '一句话反方意见。' },
  { key: 'pre_stop_doing_ad_hoc', label: 'Stop Doing · 这次特别要防的', type: 'text', hint: '本次临时一条。' },
];

// =========== Specs · 平仓评价（POST） ===========

const DECISION_QUALITY_LABELS: Record<string, string> = {
  good: '正当过程（结构对）',
  mixed: '混合 / 未明确',
  bad: '错误过程（结构错）',
};
const DECISION_QUALITY_ACCENTS: Record<string, string> = {
  good: '#0ECB81',
  bad: '#F6465D',
  mixed: '#9AA0A6',
};
const FALSIFICATION_STATUS_LABELS: Record<string, string> = {
  triggered_reacted: '触发了，我及时反应了',
  triggered_late: '触发了，但我反应晚了',
  not_triggered: '没触发，我是主观平仓',
};
const FALSIFICATION_STATUS_ACCENTS: Record<string, string> = {
  triggered_reacted: '#0ECB81',
  triggered_late: '#F6465D',
  not_triggered: '#D89B00',
};
const ENTRY_PAYOFF_ESTIMATE_LABELS: Record<string, string> = {
  rr_1_2: '1:1-2:1',
  rr_2_5: '2:1-5:1',
  rr_gt_5: '>5:1',
};
const ENTRY_PAYOFF_ESTIMATE_ACCENTS: Record<string, string> = {
  rr_1_2: '#9AA0A6',
  rr_2_5: '#F0B90B',
  rr_gt_5: '#0ECB81',
};
const ENTRY_WIN_RATE_ESTIMATE_LABELS: Record<string, string> = {
  wr_lt_50: '<50%',
  wr_50_80: '50-80%',
  wr_gt_80: '>80%',
};
const ENTRY_WIN_RATE_ESTIMATE_ACCENTS: Record<string, string> = {
  wr_lt_50: '#F6465D',
  wr_50_80: '#F0B90B',
  wr_gt_80: '#0ECB81',
};

export const POST_FIELD_SPECS: SummaryFieldSpec[] = [
  { key: 'post_decision_quality', label: '选择本笔归类（结构 × 结果四象限的"结构轴"）', type: 'enum', optionLabels: DECISION_QUALITY_LABELS, optionAccents: DECISION_QUALITY_ACCENTS, hint: '过程是否正当——与盈亏无关。' },
  { key: 'post_struggle_level', label: '过程纠结度（1 极煎熬 → 5 行云流水）', type: 'numeric', numericMin: 1, numericMax: 5, numericLabels: STRUGGLE_LEVEL_LABELS as unknown as Record<string, string>, hint: '亏损的先行指标。' },
  { key: 'exit_falsification_status', label: '证伪信号触发状态（止）', type: 'enum', optionLabels: FALSIFICATION_STATUS_LABELS, optionAccents: FALSIFICATION_STATUS_ACCENTS, hint: '事前的止 vs 事后真实退出动作。' },
  { key: 'post_small_position_drag', label: '小机会仓位 · 隐性成本', type: 'enum', optionLabels: SMALL_POSITION_DRAG_LABELS, hint: '每笔主力单都自评一次：「无明显拖累」即代表这不是小机会仓。' },
  { key: 'post_emo_main_stone_tags', label: '主石头标签（恐惧 / 贪婪 / 自我保护 / 虚假掌控）', type: 'multi', optionLabels: MAIN_STONE_LABELS, hint: '可统计的复盘动机原型。' },
  {
    id: 'post_reflection_schelling_floor_weight',
    key: 'post_reflection',
    label: '事实模块 · 谢林兜底区权重',
    type: 'text',
    hint: '全程是否给谢林兜底区该有的权重。',
    getValue: journal => getCloseReviewAuditAnswer(journal.post_reflection, 'schelling_floor_weight'),
  },
  { key: 'post_premortem_review', label: '反 · 预设亏损原因兑现没有', type: 'text', hint: '事实模块·反。' },
  { key: 'post_invalidation_review', label: '止 · 离场 / 证伪事实', type: 'text', hint: '事实模块·止。' },
  { key: 'post_positive_expectancy_review', label: '结构 · 目标空间假设的实际表现', type: 'text', hint: '事实模块·结构。' },
  { key: 'post_entry_payoff_estimate_grade', label: '建仓时盈亏比估计 · 档位', type: 'enum', optionLabels: ENTRY_PAYOFF_ESTIMATE_LABELS, optionAccents: ENTRY_PAYOFF_ESTIMATE_ACCENTS, hint: '1:1-2:1 / 2:1-5:1 / >5:1。' },
  { key: 'post_entry_payoff_basis_review', label: '建仓时盈亏比估计 · 说明', type: 'text', hint: '填空说明：当时为什么判断这一档盈亏比，后来验证哪里对、哪里偏。' },
  { key: 'post_entry_win_rate_estimate_grade', label: '建仓时胜率估计 · 档位', type: 'enum', optionLabels: ENTRY_WIN_RATE_ESTIMATE_LABELS, optionAccents: ENTRY_WIN_RATE_ESTIMATE_ACCENTS, hint: '<50% / 50-80% / >80%。' },
  { key: 'post_entry_win_rate_basis_review', label: '建仓时胜率估计 · 说明', type: 'text', hint: '填空说明：当时为什么判断这一档胜率，后来验证哪里对、哪里偏。' },
  {
    id: 'post_reflection_decision_basis',
    key: 'post_reflection',
    label: '出场自审 ① 客观事实还是自洽借口',
    type: 'text',
    hint: '是否基于事实，还是被贪婪 / 恐惧 / 不愿认错驱动。',
    getValue: journal => getCloseReviewAuditAnswer(journal.post_reflection, 'decision_basis'),
  },
  {
    id: 'post_reflection_cycle_stage',
    key: 'post_reflection',
    label: '出场自审 ② 周期阶段是否辨认准确',
    type: 'text',
    hint: '是否识别了当下周期阶段，而不是用错位期待逆势强求。',
    getValue: journal => getCloseReviewAuditAnswer(journal.post_reflection, 'cycle_stage'),
  },
  {
    id: 'post_reflection_trend_stop',
    key: 'post_reflection',
    label: '出场自审 ③ 顺势而止其所当止',
    type: 'text',
    hint: '是否顺势、止在该止处，并避免乱动制造麻烦。',
    getValue: journal => getCloseReviewAuditAnswer(journal.post_reflection, 'trend_stop'),
  },
  { key: 'post_emo_disturbance', label: '情绪七问 ① 这单最起波澜的事', type: 'text' },
  { key: 'post_emo_first_reaction', label: '情绪七问 ② 我的第一反应', type: 'text' },
  { key: 'post_emo_wanted', label: '情绪七问 ③ 我其实想得到什么', type: 'text', hint: '贪婪本质。' },
  { key: 'post_emo_feared', label: '情绪七问 ④ 我其实在害怕什么', type: 'text', hint: '恐惧本质。' },
  { key: 'post_emo_excuse', label: '情绪七问 ⑤ 我给自己找的理由', type: 'text', hint: '合理化采证。' },
  { key: 'post_emo_main_stone', label: '情绪七问 ⑥ 主石头一句话', type: 'text' },
  { key: 'post_emo_next_time_plan', label: '情绪七问 ⑦ 明天再遇到怎么选', type: 'text', hint: '动作级预案。' },
];

/** outcome 着色：与 PostTradeReviewSheet 保持一致。 */
export const OUTCOME_LABEL: Record<string, string> = {
  win: '赢', loss: '亏', breakeven: '保本', no_entry: '未入场',
};
export const OUTCOME_COLOR: Record<string, string> = {
  win: '#0ECB81', loss: '#F6465D', breakeven: '#F0B90B', no_entry: '#9AA0A6',
};
