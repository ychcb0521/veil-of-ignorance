/**
 * 错题集（Trade Journal）相关类型定义
 * 字段命名与数据库列名保持一致（snake_case），与 supabase/types.ts 风格统一。
 */

export const ERROR_CATEGORY_CODES = [
  "entry_reason",
  "hedge_stop",
  "exit_reason",
  "mental_state",
  "no_entry_missed",
  "checklist_violation",
] as const;

export type ErrorCategoryCode = (typeof ERROR_CATEGORY_CODES)[number];

export const MENTAL_STATE_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "极差",
  2: "较差",
  3: "中性",
  4: "良好",
  5: "极佳",
};

export type TradeDirection = "long" | "short" | "no_entry";
export type TradeOutcome = "win" | "loss" | "breakeven" | "no_entry";
export type TaggedPhase = "pre" | "post";
export type PositionMode = "cross" | "isolated";
export type OrderKind = "main" | "hedge";
export type JournalSource = 'live' | 'retroactive_from_record';
/** Training-set vs holdout-set discipline (anti-overfitting). */
export type DatasetSplit = 'in_sample' | 'out_of_sample';
export type DecisionQuality = 'good' | 'mixed' | 'bad';
export type RuleCategory = 'hard' | 'core' | 'watch' | 'retired';
export type PrincipleEvolutionLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type PainTag =
  // 正向情绪 · 帮助执行规则（可放行，但不能替代规则）
  | 'calm'
  | 'focused'
  | 'patient'
  // 中性情绪 · 本身不坏，但必须校准
  | 'fear_of_loss'
  | 'fear_giveback'
  | 'hesitation'
  | 'unease'
  | 'confusion'
  | 'regret'
  | 'odds_excitement'
  | 'fatigue'
  | 'distracted'
  // 负向情绪 · 默认黄灯或红灯
  | 'fomo'
  | 'revenge'
  | 'prove_self'
  | 'impatience'
  | 'boredom'
  | 'anxiety'
  | 'greed'
  | 'overconfidence'
  | 'optimism'
  | 'jackpot_fantasy'
  | 'unwilling'
  | 'sunk_cost'
  | 'deprivation'
  | 'wishful'
  | 'denial'
  | 'stubborn_hold'
  | 'confirmation'
  | 'narrative'
  | 'anchoring'
  | 'envy'
  | 'anger'
  | 'panic'
  | 'despair'
  | 'frustration'
  | 'self_pity'
  | 'shame'
  | 'numbness'
  | 'stress_overload'
  | 'infatuation'
  | 'aversion'
  | 'false_safety'
  | 'false_control'
  | 'rationalization'
  | 'obsessive_focus';

/** 三类情绪：正向助执行 / 负向易破坏 / 中性需校准。 */
export type EmotionValence = 'positive' | 'neutral' | 'negative';

export interface EmotionTagMeta {
  label: string;
  valence: EmotionValence;
  /** 核心含义：这个情绪本身是什么。 */
  coreMeaning: string;
  /** 可能导致的行为倾向：它会把你推向哪些破坏纪律的动作。 */
  behaviorTendency: string;
}

/** 情绪类别元数据，驱动快照表单按"对交易纪律的影响"分组渲染。 */
export interface EmotionCategoryMeta {
  valence: EmotionValence;
  title: string;
  /** 该类情绪对"执行规则"的整体作用。 */
  ruleImpact: string;
  /** 系统提示语：下单前对该类情绪的处置原则（放行 / 校准 / 黄灯红灯）。 */
  systemPrompt: string;
  /** 分类强调色，严格走品牌色。 */
  accent: string;
}

export const EMOTION_CATEGORIES: EmotionCategoryMeta[] = [
  { valence: 'positive', title: '正向情绪', ruleImpact: '帮助执行规则', systemPrompt: '可放行，但不能替代规则', accent: '#0ECB81' },
  { valence: 'neutral', title: '中性情绪', ruleImpact: '本身不一定坏，但需要被校准，否则会滑向失控', systemPrompt: '本身不坏，但必须校准', accent: '#F0B90B' },
  { valence: 'negative', title: '负向情绪', ruleImpact: '容易破坏规则', systemPrompt: '默认黄灯或红灯', accent: '#F6465D' },
];
export type FiveStepWeakPoint = 'goal' | 'problem' | 'diagnosis' | 'design' | 'execution';
export type InterventionType = 'principle' | 'rule' | 'sop' | 'awareness';

// ============ Batch 24: Munger layer ============
/** 'trade' = normal order (incl. the legacy "该开没开" decision record); 'no_trade' = Munger "too hard" skip. */
export type JournalKind = 'trade' | 'no_trade';
/** Result of checking the entry-time falsification signal against what actually happened before close. */
export type ExitFalsificationStatus = 'triggered_reacted' | 'triggered_late' | 'not_triggered';

export const PRINCIPLE_EVOLUTION_LEVEL_LABELS: Record<PrincipleEvolutionLevel, string> = {
  0: '直觉',
  1: '表述',
  2: '模式确认',
  3: '规则化',
  4: '算法化',
  5: '已证伪/升级',
};

export const EMOTION_TAG_META: Record<PainTag, EmotionTagMeta> = {
  // ===== 正向情绪 · 帮助执行规则（可放行，但不能替代规则）=====
  calm: { label: '冷静', valence: 'positive', coreMeaning: '情绪稳定，能按计划交易', behaviorTendency: '无明显失控倾向' },
  focused: { label: '专注', valence: 'positive', coreMeaning: '注意力集中，只做计划内机会', behaviorTendency: '无明显失控倾向' },
  patient: { label: '耐心', valence: 'positive', coreMeaning: '能等待触发，不被噪音诱导', behaviorTendency: '无明显失控倾向' },

  // ===== 中性情绪 · 本身不坏，但必须校准 =====
  fear_of_loss: { label: '害怕亏损 / 恐惧', valence: 'neutral', coreMeaning: '对亏损或风险敏感，轻度是风控意识，过度会变成逃避', behaviorTendency: '提前止盈、频繁交易' },
  fear_giveback: { label: '害怕回吐利润', valence: 'neutral', coreMeaning: '一有浮盈就怕利润消失', behaviorTendency: '提前止盈' },
  hesitation: { label: '犹豫', valence: 'neutral', coreMeaning: '信号出现后迟迟不敢执行', behaviorTendency: '提前止盈、频繁交易' },
  unease: { label: '不安 / 怀疑', valence: 'neutral', coreMeaning: '直觉感到风险、不确定或信息不完整', behaviorTendency: '拒绝执行、频繁确认、错过机会' },
  confusion: { label: '困惑', valence: 'neutral', coreMeaning: '面对复杂行情时不知道如何解释', behaviorTendency: '过早下结论、频繁交易' },
  regret: { label: '后悔 / 懊悔', valence: 'neutral', coreMeaning: '对错过机会或错误操作产生补偿冲动', behaviorTendency: '追单、频繁交易、加仓' },
  odds_excitement: { label: '兴奋 / 赔率兴奋', valence: 'neutral', coreMeaning: '看到大机会、大波动或高赔率时情绪上升', behaviorTendency: '追单、加仓、取消止损' },
  fatigue: { label: '疲惫', valence: 'neutral', coreMeaning: '注意力和执行质量下降', behaviorTendency: '频繁交易、取消止损、拒绝更新判断' },
  distracted: { label: '分心', valence: 'neutral', coreMeaning: '注意力不完整，无法稳定监控交易', behaviorTendency: '取消止损、频繁交易' },

  // ===== 负向情绪 · 默认黄灯或红灯 =====
  fomo: { label: 'FOMO / 错失恐惧 / 踏空焦虑', valence: 'negative', coreMeaning: '害怕别人正在赚钱，而自己正在错过', behaviorTendency: '追单、频繁交易、加仓' },
  revenge: { label: '复仇交易', valence: 'negative', coreMeaning: '想把上一笔亏损立刻赚回来', behaviorTendency: '频繁交易、加仓、追单' },
  prove_self: { label: '证明自己', valence: 'negative', coreMeaning: '交易不是为了机会，而是为了证明判断没错', behaviorTendency: '扛单、加仓、拒绝更新判断' },
  impatience: { label: '急躁 / 冲动', valence: 'negative', coreMeaning: '等不了确认信号，想马上做点什么', behaviorTendency: '追单、频繁交易' },
  boredom: { label: '无聊交易', valence: 'negative', coreMeaning: '不是市场有机会，而是自己想找刺激', behaviorTendency: '频繁交易、追单' },
  anxiety: { label: '焦虑', valence: 'negative', coreMeaning: '面对不确定、账户波动或社交压力时持续不安', behaviorTendency: '频繁交易、追单、提前止盈' },
  greed: { label: '贪婪', valence: 'negative', coreMeaning: '已有收益后还想要更多，忽视风险边界', behaviorTendency: '加仓、拒绝更新判断、取消止损' },
  overconfidence: { label: '过度自信 / 自视过高 / 骄傲', valence: 'negative', coreMeaning: '高估自己的判断力、胜率和控制力', behaviorTendency: '加仓、追单、取消止损' },
  optimism: { label: '过度乐观', valence: 'negative', coreMeaning: '高估好结果，低估坏结果', behaviorTendency: '加仓、取消止损、低估尾部风险' },
  jackpot_fantasy: { label: '暴富幻想 / 狂热 / 躁狂', valence: 'negative', coreMeaning: '把一笔交易想象成人生翻身点', behaviorTendency: '加仓、扛单、取消止损' },
  unwilling: { label: '不甘心', valence: 'negative', coreMeaning: '亏损后觉得不能就这么走', behaviorTendency: '扛单、取消止损、拒绝更新判断' },
  sunk_cost: { label: '沉没成本痛', valence: 'negative', coreMeaning: '因为已经投入或已经亏损，所以舍不得退出', behaviorTendency: '扛单、加仓、拒绝更新判断' },
  deprivation: { label: '被剥夺感', valence: 'negative', coreMeaning: '感觉已有收益、差点到手的收益或机会被夺走', behaviorTendency: '复仇交易、追单、加仓' },
  wishful: { label: '侥幸 / 拖延观望', valence: 'negative', coreMeaning: '明知结构不对，但希望行情救回来', behaviorTendency: '扛单、取消止损、拒绝更新判断' },
  denial: { label: '心理否认', valence: 'negative', coreMeaning: '市场已经反馈错误，但大脑拒绝承认', behaviorTendency: '扛单、拒绝更新判断、取消止损' },
  stubborn_hold: { label: '死扛', valence: 'negative', coreMeaning: '不再基于策略，而是靠忍耐持仓', behaviorTendency: '扛单、取消止损、拒绝更新判断' },
  confirmation: { label: '确认偏误', valence: 'negative', coreMeaning: '只寻找支持自己仓位的信息', behaviorTendency: '拒绝更新判断、扛单' },
  narrative: { label: '叙事上头', valence: 'negative', coreMeaning: '被宏大故事带走，不看价格结构', behaviorTendency: '扛单、加仓、拒绝更新判断' },
  anchoring: { label: '锚定', valence: 'negative', coreMeaning: '被开仓价、前高、最高浮盈绑架', behaviorTendency: '扛单、提前止盈、拒绝更新判断' },
  envy: { label: '嫉妒 / 比较', valence: 'negative', coreMeaning: '看到别人赚钱后心态失衡', behaviorTendency: '追单、加仓、频繁交易' },
  anger: { label: '愤怒 / 委屈 / 敌意', valence: 'negative', coreMeaning: '觉得市场、对手或规则"不公平"，想反击', behaviorTendency: '复仇交易、加仓、频繁交易' },
  panic: { label: '恐慌 / 惊慌', valence: 'negative', coreMeaning: '剧烈波动时理性系统崩溃', behaviorTendency: '提前止盈、取消止损、频繁交易' },
  despair: { label: '极度悲观 / 绝望', valence: 'negative', coreMeaning: '认为坏情况会永久持续', behaviorTendency: '恐慌割肉、拒绝重新评估机会' },
  frustration: { label: '沮丧 / 挫败', valence: 'negative', coreMeaning: '连续失败后产生无力感', behaviorTendency: '频繁交易、放弃规则、消极执行' },
  self_pity: { label: '自怜', valence: 'negative', coreMeaning: '把亏损解释成"我总是倒霉"', behaviorTendency: '拒绝复盘、逃避责任' },
  shame: { label: '羞耻', valence: 'negative', coreMeaning: '因亏损、失误或负面情绪感到丢脸', behaviorTendency: '隐瞒错误、拒绝复盘' },
  numbness: { label: '麻木 / 冷漠', valence: 'negative', coreMeaning: '对风险失去感觉，或者用"不在乎"逃避现实', behaviorTendency: '加仓、取消止损、频繁交易' },
  stress_overload: { label: '压力过载', valence: 'negative', coreMeaning: '账户压力、生活压力、情绪压力叠加', behaviorTendency: '加仓、扛单、频繁交易、拒绝更新判断' },
  infatuation: { label: '盲目热爱 / 情感依恋', valence: 'negative', coreMeaning: '爱上某只股票、某个币或某个交易逻辑', behaviorTendency: '忽略负面信息、用感情持仓' },
  aversion: { label: '厌恶 / 排斥 / 非理性憎恨', valence: 'negative', coreMeaning: '因过去亏损或个人反感而拒绝客观分析', behaviorTendency: '错过机会、判断失真' },
  false_safety: { label: '虚假安心 / 盲从安全感', valence: 'negative', coreMeaning: '因为大家都这么做，所以觉得安全', behaviorTendency: '跟单、追单、降低验证标准' },
  false_control: { label: '虚假掌控感', valence: 'negative', coreMeaning: '通过频繁操作来安抚焦虑，误以为自己在掌控局面', behaviorTendency: '频繁交易、过度操作' },
  rationalization: { label: '合理化平静', valence: 'negative', coreMeaning: '犯错后用一堆理由安抚自己，维持原判断', behaviorTendency: '扛单、拒绝更新判断' },
  obsessive_focus: { label: '偏执专注', valence: 'negative', coreMeaning: '高度专注于寻找支持仓位的信息', behaviorTendency: '拒绝更新判断、扛单' },
};

/** 向后兼容旧代码：只保留 label。新 UI 用 EMOTION_TAG_META。 */
export const PAIN_TAG_LABELS: Record<PainTag, string> = Object.fromEntries(
  (Object.entries(EMOTION_TAG_META) as [PainTag, EmotionTagMeta][])
    .map(([tag, meta]) => [tag, meta.label]),
) as Record<PainTag, string>;
export type CampaignStatus =
  | 'planned'
  | 'active'
  | 'closed_profit'
  | 'closed_loss'
  | 'closed_breakeven'
  | 'abandoned';
export type StrategyTemplate = 'main_dual_hedge_mirror_tp' | 'main_only' | 'custom';
export type LegRole =
  | 'main_open'
  | 'hedge_initial_a'
  | 'hedge_initial_b'
  | 'hedge_rolling'
  | 'mirror_tp'
  | 'reentry_main'
  | 'reentry_hedge'
  | 'standalone';

export type SuggestionConfidence = 'high' | 'medium' | 'low';

export interface CampaignEvent {
  id: string;
  timestamp: string;
  event_type:
    | 'campaign_opened'
    | 'historical_classification_created'
    | 'historical_leg_attached'
    | 'main_opened'
    | 'hedge_placed'
    | 'mirror_tp_placed'
    | 'hedge_cancelled'
    | 'hedge_triggered'
    | 'mirror_tp_triggered'
    | 'main_partial_closed'
    | 'main_fully_closed'
    | 'campaign_closed'
    | 'note';
  leg_role: LegRole | null;
  journal_id: string | null;
  trade_record_id: string | null;
  pending_order_id: string | null;
  price: number | null;
  size_usdt: number | null;
  notes: string | null;
  recorded_at: string;
}

export interface TradeCampaign {
  id: string;
  user_id: string;
  symbol: string;
  direction: 'main_long' | 'main_short';
  status: CampaignStatus;
  strategy_template: StrategyTemplate;
  title: string;
  opened_at: string;
  closed_at: string | null;
  initial_main_size_usdt: number | null;
  initial_leverage: number | null;
  final_realized_pnl: number | null;
  final_r_multiple: number | null;
  peak_unrealized_pnl: number | null;
  peak_drawdown: number | null;
  notes: string | null;
  actual_evolution: CampaignEvent[];
  created_at: string;
  updated_at: string;
}

export function isHistoricalCampaign(campaign: Pick<TradeCampaign, 'actual_evolution'>): boolean {
  return (campaign.actual_evolution ?? []).some(event =>
    event.event_type === 'historical_classification_created' ||
    event.event_type === 'historical_leg_attached',
  );
}

export type CampaignCounterfactualBranchKind =
  | 'pure_sop'
  | 'fix_one_deviation'
  | 'custom_what_if';

export interface CampaignCounterfactualParams {
  entry: {
    time: string;
    price: number;
    size_usdt: number;
    direction: 'long' | 'short';
    leverage: number;
  };
  hedge_a: {
    offset_pct: number;
    size_pct: number;
  };
  hedge_b: {
    offset_pct: number;
    size_pct: number;
  };
  mirror_tp: {
    offset_pct: number;
    size_pct: number;
  };
  rolling: {
    enabled: boolean;
    trigger_rise_pct: number;
    min_interval_minutes: number;
    new_hedge_offset_pct: number;
    rolling_hedge_size_pct: number;
  };
  exit_rule: 'close_all_on_hedge_trigger' | 'reenter_after_hedge_trigger' | 'manual_only';
  reentry?: {
    delay_minutes: number;
    size_pct: number;
  };
}

export interface CampaignCounterfactualEvent {
  timestamp: string;
  event_type: string;
  leg_role: string;
  price: number;
  size_usdt: number;
  notes: string;
}

export interface CampaignCounterfactualLegSummary {
  leg_role: string;
  placed_at: string;
  trigger_price: number;
  status: 'filled' | 'cancelled' | 'never_triggered';
  triggered_at: string | null;
  realized_pnl_usdt: number;
}

export interface CampaignCounterfactualStateSegment {
  state: string;
  state_label: string;
  start_time: string;
  end_time: string;
}

export interface CampaignCounterfactualResult {
  final_realized_pnl: number;
  final_r_multiple: number;
  peak_unrealized_pnl: number;
  peak_drawdown: number;
  profit_capture_ratio: number;
  events: CampaignCounterfactualEvent[];
  legs_summary: CampaignCounterfactualLegSummary[];
  state_segments: CampaignCounterfactualStateSegment[];
  sop_score: number;
}

export interface CampaignCounterfactual {
  id: string;
  user_id: string;
  campaign_id: string;
  label: string;
  branch_kind: CampaignCounterfactualBranchKind;
  source_deduction_id: string | null;
  params: CampaignCounterfactualParams;
  result: CampaignCounterfactualResult;
  created_at: string;
}

export interface DeviationCost {
  deduction_category: 'setup' | 'lockin' | 'rolling' | 'exit';
  deduction_reason: string;
  cost_usdt: number;
  cost_pct_of_account: number;
  fix_description: string;
  source_deduction_id?: string;
}

export interface SuggestedLegRole {
  journalId: string;
  suggestedRole: LegRole;
  confidence: SuggestionConfidence;
  reason: string;
}

export interface ClassificationAssignmentInput {
  journalId: string;
  legRole: LegRole;
  legSequence?: number | null;
  attachNote?: string | null;
}

export interface ClassificationValidationInput {
  legs: Array<{ journalId: string; legRole: LegRole }>;
  strategyTemplate: StrategyTemplate;
  targetCampaignId?: string;
}

export interface ClassificationValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface ErrorTagCategory {
  id: string;
  code: ErrorCategoryCode;
  name_zh: string;
  description: string;
  color: string;
  sort_order: number;
  is_special: boolean;
  created_at: string;
}

export interface ErrorTagPattern {
  id: string;
  user_id: string;
  category_id: string;
  pattern_name: string;
  operational_definition: string;
  parent_id: string | null;
  occurrence_count: number;
  last_seen_at: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  required?: boolean;
}

export interface TradePrinciple {
  id: string;
  user_id: string;
  title: string;
  body: string;
  evolution_level: PrincipleEvolutionLevel;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PainLogEntry {
  id: string;
  user_id: string;
  journal_id: string | null;
  symbol: string | null;
  pain_tag: PainTag;
  intensity: 1 | 2 | 3 | 4 | 5;
  recorded_at: string;
  market_time: string | null;
  created_at: string;
}

export interface TradeJournal {
  id: string;
  user_id: string;
  trade_record_id: string | null;
  campaign_id: string | null;
  leg_role: LegRole | null;
  leg_sequence: number | null;
  source: JournalSource;
  symbol: string;
  direction: TradeDirection;
  leverage: number | null;
  position_mode: PositionMode | null;
  order_kind: OrderKind;

  // pre-snapshot
  pre_simulated_time: string;
  pre_real_time: string;
  pre_entry_price: number | null;
  /** @deprecated v2 snapshot no longer records stop-loss in this field. */
  pre_planned_stop_loss: number | null;
  /** @deprecated v2 snapshot does not collect TP levels; order-level TP/SL stays outside the snapshot. */
  pre_planned_take_profit: number | null;
  /** @deprecated v2 snapshot uses pre_thesis_why_right; legacy journals may still display this. */
  pre_entry_reason: string | null;
  pre_mental_state: 1 | 2 | 3 | 4 | 5;
  /** @deprecated v2 snapshot blocks mental <=2 and does not collect a separate trigger note. */
  pre_mental_trigger: string | null;
  /** @deprecated v2 snapshot folds risk framing into the decision-three-questions block. */
  pre_risk_awareness: string | null;
  /** @deprecated v2 snapshot folds risk framing into the decision-three-questions block. */
  pre_risk_management: string | null;
  pre_checklist_items: ChecklistItem[] | null;
  pre_checklist_passed: boolean | null;
  /** @deprecated v2 snapshot infers this from pendingOrderParams instead of user input. */
  pre_position_size: number | null;
  pre_max_loss_usdt: number | null;

  // ============ Snapshot v2 fields (batch 23) ============
  /** Decision-three-questions A: why this has positive expectancy. */
  pre_thesis_why_right?: string | null;
  /** Decision-three-questions B: pre-mortem failure reason. */
  pre_premortem_failure_reason?: string | null;
  /** Decision-three-questions C: objective falsification / exit signal. */
  pre_falsification_signal?: string | null;
  /** Optional basis for the binary probability slider. */
  pre_confidence_basis?: string | null;
  /** Account equity snapshot used to reconstruct the risk-anchor percentage. */
  pre_account_equity_usdt?: number | null;

  // ============ Batch 24: Munger layer ============
  /** 'trade' (default, incl. legacy no_entry decision record) or 'no_trade' (too-hard skip). */
  journal_kind?: JournalKind;
  /** Free-text reason a setup was judged "too hard" (no_trade only). */
  no_trade_reason?: string | null;
  /** Market price at the moment the user pressed "too hard", for hypothetical PnL. */
  no_trade_would_be_entry_price?: number | null;
  /** Direction the user would have taken had they entered (no_trade only). */
  no_trade_direction?: 'long' | 'short' | null;
  /** Cognitive-bias self-check tags (dual-track with pre_pain_tags). 'none' means self-checked clean. */
  pre_cognitive_bias_tags?: string[] | null;
  /** Post-close check of the entry-time falsification signal. */
  exit_falsification_status?: ExitFalsificationStatus | null;
  /** Optional note for the falsification check. */
  exit_falsification_note?: string | null;

  // ============ Decision-quality fields (added 2026-05) ============
  /** @deprecated v2 snapshot uses pre_premortem_failure_reason. */
  pre_mortem_text?: string | null;
  /** @deprecated v2 snapshot uses pre_thesis_why_right. */
  pre_positive_expectancy?: string | null;
  /** @deprecated v2 snapshot uses pre_falsification_signal. */
  pre_invalidation_condition?: string | null;
  /** Tetlock-style calibration prediction at open time, 0-100. */
  pre_calibration_win_pct?: number | null;
  /** @deprecated v2 snapshot keeps only a binary probability slider. */
  pre_confidence_interval_low_pct?: number | null;
  /** @deprecated v2 snapshot keeps only a binary probability slider. */
  pre_confidence_interval_high_pct?: number | null;
  /** @deprecated v2 snapshot no longer collects this separate field. */
  pre_calibration_reference_class?: string | null;
  /** @deprecated v2 snapshot uses pre_confidence_basis. */
  pre_calibration_competence_basis?: string | null;
  /** @deprecated v2 snapshot no longer collects this separate field. */
  pre_calibration_update_signal?: string | null;
  /** @deprecated v2 snapshot no longer asks for training/test split at entry. */
  pre_dataset_split?: DatasetSplit | null;
  /** @deprecated v2 snapshot removed the explicit Lollapalooza block. */
  pre_lollapalooza_score?: number | null;
  /** @deprecated v2 snapshot removed this submit-time estimate from the form. */
  pre_bankruptcy_estimate?: number | null;
  /** @deprecated v2 snapshot folds facts into pre_thesis_why_right. */
  pre_info_kline_facts?: string | null;
  /** @deprecated v2 snapshot folds facts into pre_thesis_why_right. */
  pre_info_macro_facts?: string | null;
  /** @deprecated v2 snapshot folds facts into pre_thesis_why_right. */
  pre_info_rule_advice?: string | null;
  /** @deprecated v2 snapshot folds facts into pre_thesis_why_right. */
  pre_info_intuition?: string | null;
  /** @deprecated v2 snapshot no longer collects designer-self separately. */
  pre_info_designer_view?: string | null;
  /** @deprecated v2 snapshot folds inversion into pre_premortem_failure_reason. */
  pre_opponent_statement?: string | null;
  /** @deprecated v2 snapshot no longer asks for explicit principle links. */
  pre_triggered_principle_ids?: string[] | null;
  /** @deprecated v2 snapshot keeps checklist entries but no separate triggered rule list. */
  pre_triggered_rule_ids?: string[] | null;
  /** Pain + reflection loop; also mirrored into pain_log_entries when possible. */
  pre_pain_tags?: PainTag[] | null;
  /** @deprecated v2 snapshot removed the executor/designer dialogue box. */
  pre_executor_self?: string | null;
  /** @deprecated v2 snapshot removed the executor/designer dialogue box. */
  pre_designer_self?: string | null;

  // post-review
  post_outcome: TradeOutcome | null;
  post_realized_pnl: number | null;
  post_r_multiple: number | null;
  post_reflection: string | null;
  post_correct_action: string | null;
  post_reviewed_at: string | null;
  /** Outcome summary separated from decision quality. */
  post_result_summary?: string | null;
  /** Good/bad decision under information available at entry, independent of outcome. */
  post_decision_quality?: DecisionQuality | null;
  post_positive_expectancy_review?: string | null;
  post_premortem_review?: string | null;
  post_invalidation_review?: string | null;
  post_opponent_was_right?: boolean | null;
  /** Dalio five-step diagnosis. */
  post_five_step_goal?: string | null;
  post_five_step_problem?: string | null;
  post_proximate_cause?: string | null;
  post_root_cause?: string | null;
  post_design_intervention?: string | null;
  post_intervention_type?: InterventionType | null;
  post_execution_monitor?: string | null;
  post_five_step_weak_point?: FiveStepWeakPoint | null;
  /** Real wall-clock time of position close (stamped on first review-sheet open). */
  post_real_close_time?: string | null;

  reason_was_rewritten: boolean;
  counterfactual_branches?: CounterfactualBranch[];

  // ============ Batch 7: 六步深度分析 ============
  post_error_scenario?: string | null;
  post_original_hypothesis?: string | null;
  post_reality_feedback?: string | null;
  post_error_type_summary?: string | null;
  post_real_problem?: string | null;
  post_new_rule_draft?: string | null;
  deep_analysis_completed_at?: string | null;

  created_at: string;
  updated_at: string;
}

export interface JournalTagAssignment {
  id: string;
  user_id: string;
  journal_id: string;
  pattern_id: string;
  tagged_phase: TaggedPhase;
  note: string | null;
  created_at: string;
}

export interface TradingRule {
  id: string;
  user_id: string;
  source_pattern_id: string | null;
  rule_text: string;
  is_active: boolean;
  added_to_checklist: boolean;
  trigger_threshold: number | null;
  required: boolean;
  rule_category: RuleCategory;
  weight: number;
  principle_id: string | null;
  evolution_level: PrincipleEvolutionLevel;
  ui_order: number;
  snooze_until: string | null;
  /** Stamped when the rule first reaches (is_active && added_to_checklist). Drives cooldown. */
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountFollow {
  id: string;
  follower_id: string;
  followee_id: string;
  created_at: string;
}

export interface CampaignComment {
  id: string;
  campaign_id: string;
  user_id: string;
  body: string;
  believability_score: number | null;
  created_at: string;
  updated_at: string;
}

/** Days a rule stays locked after activation. Weakening edits are blocked during this window. */
export const RULE_COOLDOWN_DAYS = 7;

/** Returns ms remaining in the cooldown window, or 0 if expired / never activated. */
export function ruleCooldownRemainingMs(rule: Pick<TradingRule, 'activated_at'>): number {
  if (!rule.activated_at) return 0;
  const end = new Date(rule.activated_at).getTime() + RULE_COOLDOWN_DAYS * 86400_000;
  return Math.max(0, end - Date.now());
}

// ============ Batch 6: Counterfactual branches ============

export interface CounterfactualTpLevel {
  price: number;
  size_pct: number;
}

export interface CounterfactualBranchParams {
  direction: TradeDirection;
  entry_price: number | null;
  stop_loss: number | null;
  take_profits: CounterfactualTpLevel[];
  position_size_usdt: number;
  leverage: number;
  entry_time: string; // ISO
  max_hold_minutes?: number;
}

export type CounterfactualExitReason =
  | 'sl_hit' | 'tp1_hit' | 'tp2_hit' | 'tp3_hit'
  | 'timeout' | 'no_entry' | 'no_data';

export interface CounterfactualBranchResult {
  exit_time: string | null; // ISO
  exit_price: number | null;
  exit_reason: CounterfactualExitReason;
  realized_pnl_usdt: number;
  r_multiple: number;
  filled_tp_index: number | null;
  hold_duration_minutes: number;
}

export interface CounterfactualBranch {
  id: string;
  label: string;
  created_at: string;
  params: CounterfactualBranchParams;
  result: CounterfactualBranchResult;
}
