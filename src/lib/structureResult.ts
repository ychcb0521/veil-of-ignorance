import type { DecisionQuality, MissedHighOddsState, SituationHandling, SituationKind, SmallPositionDrag, TradeOutcome } from '@/types/journal';

// ============ 结构 × 结果 四象限 ============
// 结构 = 下单当时（已知信息下）的决策质量；结果 = 这单赢还是亏。
// 把「结构」与「结果」分开看，才看得见「危险盈利」与「正确的亏损」。

export type StructureResultQuadrant =
  | 'deserved_win' // 实力：结构对 + 赢
  | 'correct_loss' // 正确的亏损：结构对 + 亏
  | 'dangerous_win' // 危险盈利：结构错 + 赢（最危险）
  | 'deserved_loss'; // 应得的亏损：结构错 + 亏

export interface QuadrantMeta {
  id: StructureResultQuadrant;
  label: string;
  /** Structure axis sound? */
  structureSound: boolean;
  /** Result axis a win? */
  isWin: boolean;
  insight: string;
  /** Brand color. */
  accent: string;
  /** 危险盈利 — the one cell that must shout. */
  isDanger: boolean;
}

export const STRUCTURE_RESULT_QUADRANTS: Record<StructureResultQuadrant, QuadrantMeta> = {
  deserved_win: {
    id: 'deserved_win',
    label: '实力兑现',
    structureSound: true,
    isWin: true,
    insight: '结构对 + 赢钱。这是可复制的 —— 记住你做对了什么，而不是记住你赚了多少。',
    accent: '#0ECB81',
    isDanger: false,
  },
  correct_loss: {
    id: 'correct_loss',
    label: '正确的亏损',
    structureSound: true,
    isWin: false,
    insight: '结构对 + 亏钱。这是盈亏同源 —— 它和你的盈利来自同一个源头，是 edge 的成本。别因为这一次亏损就改掉对的做法。',
    accent: '#F0B90B',
    isDanger: false,
  },
  dangerous_win: {
    id: 'dangerous_win',
    label: '危险的盈利',
    structureSound: false,
    isWin: true,
    insight: '结构错 + 赢钱。最危险的一格：市场替你的错误买了单。别把趋势的能力当成自己的能力（贪天之功）—— 这次的赢会教给你错误的经验。',
    accent: '#F6465D',
    isDanger: true,
  },
  deserved_loss: {
    id: 'deserved_loss',
    label: '应得的亏损',
    structureSound: false,
    isWin: false,
    insight: '结构错 + 亏钱。结果诚实地反映了过程。要修正的是结构，不是运气。',
    accent: '#D89B00',
    isDanger: false,
  },
};

/**
 * Map (decision-quality, outcome) onto a structure×result quadrant.
 * Returns null when it doesn't cleanly fit a quadrant:
 *   - mixed decision quality (ambiguous structure axis)
 *   - breakeven / no_entry outcome (no result axis)
 */
export function classifyStructureResult(
  decisionQuality: DecisionQuality | null | undefined,
  outcome: TradeOutcome | null | undefined,
): StructureResultQuadrant | null {
  if (!decisionQuality || !outcome) return null;
  if (decisionQuality === 'mixed') return null;
  if (outcome !== 'win' && outcome !== 'loss') return null;

  const structureSound = decisionQuality === 'good';
  if (structureSound) return outcome === 'win' ? 'deserved_win' : 'correct_loss';
  return outcome === 'win' ? 'dangerous_win' : 'deserved_loss';
}

// ============ 回撤的非对称：恢复数学 ============

/**
 * Given a drawdown of `lossPct` percent, the gain (on the post-loss balance)
 * needed to climb back to even. The asymmetry the visualization makes visceral:
 *   -10% → +11.1% to recover; -25% → +33.3%; -50% → +100%; -90% → +900%.
 * Returns Infinity for a total (>=100%) wipeout.
 */
export function recoveryGainPct(lossPct: number): number {
  if (!Number.isFinite(lossPct) || lossPct <= 0) return 0;
  const f = lossPct / 100;
  if (f >= 1) return Infinity;
  return (f / (1 - f)) * 100;
}

/** How much heavier the climb-back is than the drop (e.g. -50% → 2.0×). */
export function recoveryAsymmetryRatio(lossPct: number): number {
  if (!Number.isFinite(lossPct) || lossPct <= 0) return 1;
  const gain = recoveryGainPct(lossPct);
  if (!Number.isFinite(gain)) return Infinity;
  return gain / lossPct;
}

// ============ 纠结度 / 轻松度（先行指标）============
// 交易最重要的事情不是赚钱，是轻松。高纠结度即使结果对，过程也已经亮黄灯。

export type StruggleLevel = 1 | 2 | 3 | 4 | 5;

export const STRUGGLE_LEVEL_LABELS: Record<StruggleLevel, string> = {
  1: '极度煎熬',
  2: '纠结',
  3: '一般',
  4: '轻松',
  5: '行云流水',
};

/** Hint copy shown under the slider, keyed by level. */
export const STRUGGLE_LEVEL_HINTS: Record<StruggleLevel, string> = {
  1: '全程煎熬、反复想平仓 —— 即使赚了，这也是高风险的过程，别重复。',
  2: '比较纠结，多次自我怀疑。检查是不是结构本身就不够干净。',
  3: '不轻松也不煎熬。',
  4: '比较轻松，基本照计划执行。',
  5: '如呼吸般自然，全程照结构执行 —— 这是你要复制的状态。',
};

// ============ 小机会仓位的隐性成本记账 ============

export interface SmallPositionDragOption {
  id: SmallPositionDrag;
  label: string;
  description: string;
  /** Ordinal severity, for coloring (0 = none … 3 = worst). */
  severity: 0 | 1 | 2 | 3;
}

export const SMALL_POSITION_DRAG_OPTIONS: readonly SmallPositionDragOption[] = [
  {
    id: 'none',
    label: '无明显拖累',
    description: '是干净的小仓，没有影响别的判断或机会',
    severity: 0,
  },
  {
    id: 'attention_only',
    label: '占用注意力',
    description: '占用了注意力 / 心力，但没错过大机会',
    severity: 1,
  },
  {
    id: 'missed_bigger',
    label: '错过更大机会',
    description: '钝化了敏感度，做小了 / 错过了真正更大的机会',
    severity: 2,
  },
  {
    id: 'chain_reaction',
    label: '引发连锁乱做',
    description: '引发后续乱做（无聊 → 乱做 → 复仇等连锁负向）',
    severity: 3,
  },
] as const;

export const SMALL_POSITION_DRAG_LABELS: Record<SmallPositionDrag, string> = {
  none: '无明显拖累',
  attention_only: '占用注意力',
  missed_bigger: '错过更大机会',
  chain_reaction: '引发连锁乱做',
};

// ============ 情境 × 处理 记账（取代旧「小机会仓位记账」）============
// 一手的本质不一定是小机会：可能是小机会 / 大机会 / 大危机，每种都有「处理得当 / 不得当」。

export const SITUATION_KIND_META: Record<SituationKind, { label: string; hint: string }> = {
  small: { label: '小机会', hint: '目标不厚 / 盈亏比不足的小仓或弃单' },
  big_opp: { label: '大机会', hint: '厚结构、真正值得重仓的机会' },
  crisis: { label: '大危机', hint: '可能造成大损失、需要回避或对冲的局面' },
};

export interface SituationHandlingOption {
  id: SituationHandling;
  situation: SituationKind;
  /** true = 处理得当（好），false = 处理不得当（错） */
  handledWell: boolean;
  label: string;
  description: string;
  /** 0 = 得当；越大越糟，用于着色 */
  severity: 0 | 2 | 3;
}

export const SITUATION_HANDLING_OPTIONS: readonly SituationHandlingOption[] = [
  { id: 'small_clean', situation: 'small', handledWell: true, label: '干净处理', description: '识别为小机会——干净小仓或正确弃单，没占心力、没错过别的、没引发乱做', severity: 0 },
  { id: 'small_dragged', situation: 'small', handledWell: false, label: '被它拖累', description: '被小机会拖累：占用心力 / 钝化敏感度错过更大 / 引发连锁乱做', severity: 2 },
  { id: 'big_opp_seized', situation: 'big_opp', handledWell: true, label: '把握住了', description: '识别为大机会，且上对仓位、吃够了', severity: 0 },
  { id: 'big_opp_missed', situation: 'big_opp', handledWell: false, label: '没把握住', description: '大机会却做小了 / 踏空 / 过早跑，把大机会做成小结果', severity: 3 },
  { id: 'crisis_avoided', situation: 'crisis', handledWell: true, label: '避开了', description: '识别为大危机，成功回避或对冲住——把无限风险换成可控摩擦', severity: 0 },
  { id: 'crisis_hit', situation: 'crisis', handledWell: false, label: '没避开', description: '大危机却踩进去——没回避 / 没对冲，被打穿', severity: 3 },
] as const;

export const SITUATION_HANDLING_LABELS: Record<SituationHandling, string> = {
  small_clean: '小机会·干净处理',
  small_dragged: '小机会·被它拖累',
  big_opp_seized: '大机会·把握住了',
  big_opp_missed: '大机会·没把握住',
  crisis_avoided: '大危机·避开了',
  crisis_hit: '大危机·没避开',
};

/** 展示用统一标签：新值走情境×处理，旧值（none/attention_only/…）沿用小机会一档旧标签。 */
export const SITUATION_HANDLING_ALL_LABELS: Record<string, string> = {
  ...SITUATION_HANDLING_LABELS,
  ...SMALL_POSITION_DRAG_LABELS,
};

/** 旧值 → 新六格的映射，供打开历史 journal 时把它落到对应格。 */
const LEGACY_SITUATION_MAP: Record<SmallPositionDrag, SituationHandling> = {
  none: 'small_clean',
  attention_only: 'small_dragged',
  missed_bigger: 'small_dragged',
  chain_reaction: 'small_dragged',
};

export function normalizeSituationHandling(
  value: SituationHandling | SmallPositionDrag | null | undefined,
): SituationHandling | null {
  if (!value) return null;
  if (value in SITUATION_HANDLING_LABELS) return value as SituationHandling;
  return LEGACY_SITUATION_MAP[value as SmallPositionDrag] ?? null;
}

/** 是否「处理不得当」= 该记为错误。新值看 handledWell；旧值 none 为好、其余为错。 */
export function situationHandledPoorly(
  value: SituationHandling | SmallPositionDrag | null | undefined,
): boolean {
  const normalized = normalizeSituationHandling(value);
  if (!normalized) return false;
  return SITUATION_HANDLING_OPTIONS.find(o => o.id === normalized)?.handledWell === false;
}

// ============ 踏空高盈亏比结构 / 该重没重 ============

export interface MissedHighOddsOption {
  id: MissedHighOddsState;
  label: string;
  description: string;
  /** Ordinal severity, for coloring (0 = none … 3 = worst). */
  severity: 0 | 1 | 2 | 3;
}

export const MISSED_HIGH_ODDS_OPTIONS: readonly MissedHighOddsOption[] = [
  {
    id: 'none',
    label: '没有明显踏空',
    description: '结构厚度与实际暴露基本匹配，没有明显错过或做轻',
    severity: 0,
  },
  {
    id: 'missed',
    label: '该做没做',
    description: '高盈亏比结构被识别出来，但最后没有参与',
    severity: 2,
  },
  {
    id: 'under_sized',
    label: '该重没重',
    description: '结构足够厚，但仓位过轻，收益没有覆盖判断质量',
    severity: 2,
  },
  {
    id: 'late_chase',
    label: '错过后补票',
    description: '错过好位置后用差位置追回，等于把厚结构做薄',
    severity: 3,
  },
] as const;

export const MISSED_HIGH_ODDS_LABELS: Record<MissedHighOddsState, string> = {
  none: '没有明显踏空',
  missed: '该做没做',
  under_sized: '该重没重',
  late_chase: '错过后补票',
};
