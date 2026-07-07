/**
 * 错题集（Trade Journal）相关类型定义
 * 字段命名与数据库列名保持一致（snake_case），与 supabase/types.ts 风格统一。
 */

import type { SettlementMode } from './trading';

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
/** Batch 25: three kinds of hedge — filter (chaos), trailing (lock profit), ratio (partial). */
export type HedgeType = "filter" | "trailing" | "ratio";
/** Where the hedge boundary sits relative to the opportunity=risk crossover. */
export type HedgeBoundaryStance = "early" | "at_crossover" | "late";
/** How the hedge order was placed: a pre-set limit (discipline) vs chasing at market (often panic). */
export type HedgeOrderMethod = "limit_preset" | "market_chase";
/** Post-close verdict feeding the hedge calibration curve. */
export type HedgeWorthIt = "yes" | "partial" | "no";
export type OddsStructure =
  | "r1_easy"
  | "r2_supported"
  | "r3_open"
  | "odds_insufficient"
  | "target_unclear"
  /** @deprecated legacy three-state odds structure */
  | "against_crowd_unreleased"
  /** @deprecated legacy three-state odds structure */
  | "neutral_choppy"
  /** @deprecated legacy three-state odds structure */
  | "with_crowd_released";
/**
 * Edge / 源头：这笔交易靠什么赚钱。只识别市场机制，不判断是否值得下注。
 * 在快照时标注（属于 thesis 的一部分，避免事后归因），用于复盘「盈亏同源」分析。
 */
export type EdgeSource =
  | 'trend_follow'     // 顺势延续：趋势已经成立，靠惯性继续释放空间
  | 'breakout'         // 突破扩张：关键结构被打开，靠波动率扩张赚钱
  | 'mean_reversion'   // 均值回归：偏离过度，靠价格回到合理区间赚钱
  | 'squeeze_release'  // 挤压释放：多空一方过度拥挤，靠被迫平仓推动行情
  | 'no_clear_edge'    // 无明确 edge：看不出来源，只是想交易
  /** @deprecated legacy edge source */
  | 'against_crowd'
  /** @deprecated legacy edge source */
  | 'structure_level'
  /** @deprecated legacy edge source */
  | 'event_catalyst';
/**
 * 小机会仓位的隐性成本记账：持有小机会仓位是「一等负向状态」，比空仓更差，
 * 因为它损耗的是行动力本身。只对被标记为小机会仓位的单子在复盘时追问。
 */
export type SmallPositionDrag =
  | 'none'          // 无明显拖累：是干净的小仓，没影响别的
  | 'attention_only'// 占用了注意力 / 心力，但没错过大机会
  | 'missed_bigger' // 钝化了敏感度，做小 / 错过了真正更大的机会
  | 'chain_reaction';// 引发后续乱做（无聊 → 乱做 → 复仇等连锁负向）
/**
 * 踏空高盈亏比结构 / 该重没重：与「小机会仓位」对称的一等负向状态。
 * 小机会仓位 = 薄结构上浪费行动力；这里 = 厚结构出现时没上、上轻、或错过后补票。
 */
export type MissedHighOddsState =
  | 'none'        // 没有明显踏空，执行与结构厚度匹配
  | 'missed'      // 该做没做，厚结构被空仓踏空
  | 'under_sized' // 该重没重，仓位暴露明显低于结构质量
  | 'late_chase'; // 错过后补票，用差位置追回心理损失
/** 快照里的“便宜机会”判断：便宜 = 用小成本拿到不对称暴露，不便宜/说不清都进入小机会仓位警惕。 */
export type CheapOpportunityAnswer = 'cheap' | 'not_cheap' | 'unclear';
/**
 * 市场结构 regime（快照第 0 步）：先判断现在是什么市场，再决定能不能用某种打法。
 * 追涨在单边里是对的、在震荡里是致命的；同一个动作换个结构就改变性质。
 */
export type MarketRegime =
  | 'trending'    // 单边趋势：方向明确、惯性强 —— 顺势 / 突破有效，逆势接刀危险
  | 'ranging'     // 震荡市：区间来回、无持续方向 —— 均值回归有效，追涨杀跌致命
  | 'transition'; // 转换中：结构正在切换（突破临界 / 挤压释放）—— 方向尚未定型
/**
 * 入场阶段：你在这段行情的哪个位置入场。越靠末端，剩余空间越薄、止损越尴尬。
 */
export type EntryStage =
  | 'early'   // 起步段：刚启动 / 刚突破，空间最厚、容错最大
  | 'middle'  // 中段：方向已确认、已释放一部分空间
  | 'late';   // 末端：情绪高潮 / 已释放很远，追价容错最小
/**
 * 止损质量：止损放在结构失效位是保护，放在噪音里（拍脑袋百分比）是送钱。
 */
export type StopQuality =
  | 'structural'  // 结构失效位：跌破它，这一单的论点就错了 —— 保护
  | 'arbitrary';  // 按百分比 / 资金量拍的：与结构无关 —— 噪音里送钱
export type JournalSource = 'live' | 'retroactive_from_record';
/** Training-set vs holdout-set discipline (anti-overfitting). */
export type DatasetSplit = 'in_sample' | 'out_of_sample';
export type DecisionQuality = 'good' | 'mixed' | 'bad';
export type EntryPayoffEstimateGrade = 'rr_1_2' | 'rr_2_5' | 'rr_gt_5';
export type EntryWinRateEstimateGrade = 'wr_lt_50' | 'wr_50_80' | 'wr_gt_80';
export type RuleCategory = 'hard' | 'core' | 'watch' | 'retired';
export type PrincipleEvolutionLevel = 0 | 1 | 2 | 3 | 4 | 5;
/** @deprecated 旧版路径复盘：开仓第一段是否立刻站到你这边。 */
export type PostPathFirstMove = 'immediate_profit' | 'immediate_drawdown' | 'unclear';
/** @deprecated 旧版路径复盘：持仓途中是否经历有效浮亏。 */
export type PostPathDrawdown = 'none_or_shallow' | 'meaningful' | 'over_stop' | 'unclear';
/** @deprecated 旧版路径复盘：赢单是不是靠扛出来的。 */
export type PostPathWinQuality = 'clean_win' | 'dragged_win' | 'not_win' | 'unclear';
/** 平仓后路径：本笔按哪种出场/推进路径复盘。 */
export type PostPathMode = 'roll_position' | 'mirror_take_profit_1r';
/** 平仓后交易主动权评分：1 被动，4 完全主动。 */
export type PostTradeAgencyScore = 1 | 2 | 3 | 4;
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
/** 'trade' = normal order (incl. the 未下单但全程观察 / legacy 该开没开 decision record); 'no_trade' = Munger "too hard" skip. */
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
export type StrategyTemplate = 'main_dual_hedge_mirror_tp' | 'rolling' | 'main_only' | 'custom';
export type LegRole =
  | 'main_open'
  | 'main_add_1'
  | 'main_add_2'
  | 'main_add_3'
  | 'main_add_4'
  | 'main_add_5'
  | 'main_add_6'
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
  /**
   * Optional denormalized leg snapshot. These live inside actual_evolution JSON so
   * mutual followers can reconstruct the owner's original campaign view without
   * relying on the owner's browser-local trade history.
   */
  direction?: TradeDirection | null;
  leverage?: number | null;
  open_time?: string | null;
  close_time?: string | null;
  entry_price?: number | null;
  exit_price?: number | null;
  realized_pnl?: number | null;
  r_multiple?: number | null;
}

/** 用户对某条 SOP 偏离行的「违规阶段 / 违规描述 / 修正后」手改覆盖（留空＝清空，不回退自动值）。 */
export interface CampaignDeviationNote {
  category?: string;
  reason?: string;
  fix?: string;
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
  importance_weight: number;
  notes: string | null;
  actual_evolution: CampaignEvent[];
  /** 「SOP 偏离代价明细」手填备注，按行键存；存在战役行上，互关者可读、仅本人可改。 */
  deviation_notes: Record<string, CampaignDeviationNote>;
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
  /** Editable leg copy used by campaign-level manual What-if analysis. */
  manual_legs?: CampaignCounterfactualManualLeg[];
}

export interface CampaignCounterfactualManualLeg {
  id: string;
  leg_role: string;
  direction: 'long' | 'short';
  open_time: string;
  close_time: string;
  entry_price: number;
  exit_price: number;
  size_usdt: number;
  leverage: number;
  enabled: boolean;
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
  /** Entry snapshot settlement mode. Null means legacy USDT-M. */
  pre_settlement_mode?: SettlementMode | null;
  /** Margin/settlement asset for coin-margined snapshots. */
  pre_settlement_asset?: string | null;
  /** Coin-margined contract face value in USD. */
  pre_contract_size_usd?: number | null;
  /** Coin-margined contract count. */
  pre_contracts?: number | null;
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
  /** Main order only: payoff-target classification before entry. */
  pre_odds_structure?: OddsStructure | null;
  /** Optional source note for the payoff-target classification. */
  pre_odds_structure_source?: string | null;
  /** Why the payoff-target classification could be wrong. */
  pre_odds_structure_premortem?: string | null;
  /** Signals that mean the payoff-target thesis has broken. */
  pre_odds_structure_breakdown_signals?: string | null;
  /** Account equity snapshot used to reconstruct the risk-anchor percentage. */
  pre_account_equity_usdt?: number | null;

  // ============ 《不对称思考》review layer (main order only) ============
  /**
   * 机会成本问句：「与做相比，不做的机会成本更高吗？」
   * true = 不做的代价更高（值得做）；false = 不做也不亏 → 填补无聊的「小机会仓位」。
  */
  pre_opportunity_cost_worth?: boolean | null;
  /** 这是一个便宜的机会吗？cheap = 成本低且不对称；not_cheap / unclear = 机会成本不足或小机会仓位警惕。 */
  pre_cheap_opportunity?: CheapOpportunityAnswer | null;
  /** Edge / 源头标签：这笔交易靠什么赚钱（在快照标注，避免事后归因），用于盈亏同源。 */
  pre_edge_source?: EdgeSource | null;

  // ============ 市场结构层（main order only）：先判断结构，再决定打法 ============
  /** 第 0 步 · 市场结构 regime（震荡 / 单边 / 转换中）。追涨在单边里对、在震荡里致命。 */
  pre_market_regime?: MarketRegime | null;
  /** 入场阶段（起步段 / 中段 / 末端）。末端追价是空间最薄、止损最尴尬的位置。 */
  pre_entry_stage?: EntryStage | null;
  /** 止损质量（结构失效位 / 拍脑袋百分比）。止损在结构位是保护，在噪音里是送钱。 */
  pre_stop_quality?: StopQuality | null;
  /** 快照时检测到「刚平就开」的连续单（持单 = 耐心）。true=被标记，false=已检查无，null=不适用。 */
  pre_chase_after_close?: boolean | null;

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

  // ============ Batch 25: hedge snapshot (order_kind='hedge' only) ============
  /** Which of the three hedge kinds (filter / trailing / ratio). */
  hedge_type?: HedgeType | null;
  /** The boundary price the hedge is built around. */
  hedge_boundary_price?: number | null;
  /** Free-text basis for the boundary (ATR multiple, structure level, etc.). */
  hedge_boundary_basis?: string | null;
  /** Reflective tag: where this boundary sits versus the opportunity=risk crossover. */
  hedge_boundary_stance?: HedgeBoundaryStance | null;
  /** Trailing hedge only: the minimum micro-profit % locked in. */
  hedge_lock_profit_pct?: number | null;
  /** Pre-written plan if price breaks upward. */
  hedge_resolution_up?: string | null;
  /** @deprecated Replaced by hedge_down_if_chop / hedge_down_if_trend / hedge_down_if_rebound. */
  hedge_resolution_down?: string | null;
  /** Downside branch after trigger: price turns into chop / no confirmation yet. */
  hedge_down_if_chop?: string | null;
  /** Downside branch after trigger: bearish reversal gets confirmed. */
  hedge_down_if_trend?: string | null;
  /** Downside branch after trigger: price rebounds fast and positive signals strengthen. */
  hedge_down_if_rebound?: string | null;
  /** Necessity slider = hedge size as % of the main position (0–100, hard cap 100). External → size. */
  hedge_necessity_pct?: number | null;
  /** Objective anchor: how strong/forceful the市场 is (1–5). Drives the necessity suggestion. */
  hedge_safety_strength?: 1 | 2 | 3 | 4 | 5 | null;
  /** Objective anchor: how rule-like / regular recent price action has been (1–5). */
  hedge_safety_regularity?: 1 | 2 | 3 | 4 | 5 | null;
  /** Objective anchor: if the market turns, how violent the downside / tail move can be (1–5). */
  hedge_risk_magnitude?: 1 | 2 | 3 | 4 | 5 | null;
  /** Conviction slider = how sure this hedge is a thought-through call (0–100). Internal → quality. */
  hedge_conviction_pct?: number | null;
  /** What friction cost (spread + fees + funding) you accept for this insurance. */
  hedge_friction_cost?: string | null;
  /** Pre-set limit order vs market chase. */
  hedge_order_method?: HedgeOrderMethod | null;
  /** Post-close: did this hedge earn back its cost? Feeds the hedge calibration curve. */
  hedge_worth_it?: HedgeWorthIt | null;

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
  /** Stop Doing List：本笔确认勾选的全局条目 ID。强制全勾才能提交。 */
  pre_stop_doing_acknowledged_ids?: string[] | null;
  /** Stop Doing List：本笔补充的"这次特别要防的一条"。 */
  pre_stop_doing_ad_hoc?: string | null;

  // post-review
  post_outcome: TradeOutcome | null;
  post_realized_pnl: number | null;
  post_r_multiple: number | null;
  /** UI-only fallback for campaign event reconstruction; not a database column. */
  post_exit_price_snapshot?: number | null;
  post_reflection: string | null;
  post_correct_action: string | null;
  post_reviewed_at: string | null;
  /** Outcome summary separated from decision quality. */
  post_result_summary?: string | null;
  /** Good/bad decision under information available at entry, independent of outcome. */
  post_decision_quality?: DecisionQuality | null;
  /** 纠结度 / 轻松度（1 煎熬 … 5 行云流水）。过程质量的先行指标 —— 交易最重要的是轻松，不是赚钱。 */
  post_struggle_level?: 1 | 2 | 3 | 4 | 5 | null;
  /** 小机会仓位的隐性成本记账。仅对快照里被标记为小机会仓位的单子追问。 */
  post_small_position_drag?: SmallPositionDrag | null;
  /** 踏空高盈亏比结构 / 该重没重。仅对快照里识别为厚结构的单子追问。 */
  post_missed_high_odds_state?: MissedHighOddsState | null;
  /** @deprecated 旧版路径复盘：上来是不是就盈利。 */
  post_path_first_move?: PostPathFirstMove | null;
  /** @deprecated 旧版路径复盘：中途有没有有效浮亏。 */
  post_path_drawdown?: PostPathDrawdown | null;
  /** @deprecated 旧版路径复盘：赢单是不是「扛出来的」。 */
  post_path_win_quality?: PostPathWinQuality | null;
  /** @deprecated 旧版路径复盘：补充路径事实，供主动权元层聚合。 */
  post_path_agency_note?: string | null;
  /** 路径：滚仓 / 1:1 镜像止盈。 */
  post_path_mode?: PostPathMode | null;
  /** 交易主动权：1-4 分。 */
  post_trade_agency_score?: PostTradeAgencyScore | null;
  post_positive_expectancy_review?: string | null;
  post_premortem_review?: string | null;
  post_invalidation_review?: string | null;
  /** Post-close bucket for the entry-time payoff/risk estimate. */
  post_entry_payoff_estimate_grade?: EntryPayoffEstimateGrade | null;
  /** Post-close bucket for the entry-time win-rate estimate. */
  post_entry_win_rate_estimate_grade?: EntryWinRateEstimateGrade | null;
  /** Post-close note for the entry-time payoff/risk estimate. */
  post_entry_payoff_basis_review?: string | null;
  /** Post-close note for the entry-time win-rate estimate. */
  post_entry_win_rate_basis_review?: string | null;
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

  // ============ 平仓情绪侧复盘 · 七问 ============
  /** ① 这单最起波澜的事情是什么？ */
  post_emo_disturbance?: string | null;
  /** ② 我的第一反应是什么？ */
  post_emo_first_reaction?: string | null;
  /** ③ 我其实想得到什么？（贪婪本质） */
  post_emo_wanted?: string | null;
  /** ④ 我其实在害怕什么？（恐惧本质） */
  post_emo_feared?: string | null;
  /** ⑤ 我自己给自己找了一个什么样的理由？（合理化） */
  post_emo_excuse?: string | null;
  /** ⑥ 这单捞起的主石头：自由文本描述。 */
  post_emo_main_stone?: string | null;
  /** ⑥ 主石头快速选标签（恐惧 / 贪婪 / 自我保护 / 虚假掌控 原型）。 */
  post_emo_main_stone_tags?: string[] | null;
  /** ⑦ 如果明天同样遇到一样的事情，我准备怎么选？ */
  post_emo_next_time_plan?: string | null;

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

/**
 * Stop Doing List 全局条目：用户决心"不做"的事，开仓前必须勾选确认本次不会犯。
 * 和 TradingRule（"应该做 X"）刻意分开，避免语义混淆。
 */
export interface StopDoingItem {
  id: string;
  user_id: string;
  text: string;
  is_active: boolean;
  ui_order: number;
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
