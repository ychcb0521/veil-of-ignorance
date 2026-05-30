/**
 * 认知偏差标签 — 批次 26 三类重构
 *
 * 决策出错分三个环节：
 *   信息偏差 = 看错信息（输入端：你拿到的证据本身就是偏的）
 *   判断偏差 = 想错逻辑（处理端：从证据推到结论的过程是偏的）
 *   执行偏差 = 做错动作（输出端：明知道，却被过去盈亏和面子绑架）
 *
 * 痛苦/情绪标签是「情绪轨」（你能感觉到）；认知偏差是「认知轨」（你意识不到，更要主动查）。
 * 每个标签带「核心含义」+「典型交易危害」，悬停即看；纯展示元数据，绝不写库、不阻塞提交。
 */

export type CognitiveBiasCategory = 'information' | 'judgment' | 'execution';

export interface CognitiveBiasMeta {
  label: string;
  category: CognitiveBiasCategory;
  /** 核心含义：这个偏差到底在说什么。 */
  coreMeaning: string;
  /** 典型交易危害：它会把你推向哪些亏钱动作。 */
  tradingHarm: string;
}

/** 认知偏差类别元数据，驱动快照表单按"决策的哪个环节出错"分组渲染。 */
export interface CognitiveBiasCategoryMeta {
  category: CognitiveBiasCategory;
  title: string;
  /** 一句话定性：看错信息 / 想错逻辑 / 做错动作。 */
  oneLiner: string;
  /** 这一类偏差的统一定义。 */
  definition: string;
  /** 系统提示语：下单前对自己问的那句话。 */
  systemPrompt: string;
  /** 分类强调色，严格走品牌色；越靠近"执行/动钱"越红。 */
  accent: string;
}

export const COGNITIVE_BIAS_CATEGORIES: CognitiveBiasCategoryMeta[] = [
  {
    category: 'information',
    title: '信息偏差',
    oneLiner: '看错信息',
    definition: '输入端出错：你拿到的证据本身就是偏的、不完整的。',
    systemPrompt: '我现在看到的是完整证据，还是只看到了支持我仓位的证据？',
    accent: '#7C8B9C',
  },
  {
    category: 'judgment',
    title: '判断偏差',
    oneLiner: '想错逻辑',
    definition: '处理端出错：证据没问题，但从证据推到结论的过程是偏的。',
    systemPrompt: '这是规律，还是小样本噪音？这是结构，还是故事？',
    accent: '#F0B90B',
  },
  {
    category: 'execution',
    title: '执行偏差',
    oneLiner: '做错动作',
    definition: '输出端出错：判断没问题，却被过去盈亏和面子绑架，动作变形。',
    systemPrompt: '我是在根据当前期望值决策，还是被过去盈亏和面子绑架？',
    accent: '#F6465D',
  },
];

/**
 * 30 个认知偏差，按声明顺序在各自类别内渲染。
 * 旧 ID（confirmation / social_proof / narrative / anchoring / sunk_cost）原样保留，历史快照不丢标签。
 */
export const COGNITIVE_BIAS_META = {
  // ===== 信息偏差 · 看错信息 =====
  confirmation: { label: '确认偏误', category: 'information', coreMeaning: '只看支持自己仓位的信息', tradingHarm: '拒绝更新判断、扛单' },
  social_proof: { label: '社会认同', category: 'information', coreMeaning: '因为别人都这么看，所以觉得更可靠', tradingHarm: '跟单、追单' },
  authority: { label: '权威偏误', category: 'information', coreMeaning: '因为大V、机构、高手说了，就放弃验证', tradingHarm: '跟单、降低标准' },
  availability: { label: '可得性偏差', category: 'information', coreMeaning: '哪个信息最容易想起，就觉得它最重要', tradingHarm: '过度反应、误判风险' },
  selective_memory: { label: '选择性记忆', category: 'information', coreMeaning: '记住自己做对的，淡化自己做错的', tradingHarm: '高估胜率、低估亏损' },
  survivorship: { label: '生存者偏差', category: 'information', coreMeaning: '只看到成功案例，忽略失败样本', tradingHarm: '盲目模仿、低估风险' },

  // ===== 判断偏差 · 想错逻辑 =====
  narrative: { label: '叙事谬误', category: 'judgment', coreMeaning: '用故事替代结构判断', tradingHarm: '用故事持仓' },
  recency: { label: '近期偏差', category: 'judgment', coreMeaning: '过度重视最近几根K线或最近几笔盈亏', tradingHarm: '追单、过早否定系统' },
  small_sample: { label: '小样本偏差', category: 'judgment', coreMeaning: '几笔交易就总结规律', tradingHarm: '过早加仓、过早放弃' },
  representativeness: { label: '代表性偏差', category: 'judgment', coreMeaning: '看到相似形态，就以为走势会重复', tradingHarm: '模式误判、过拟合' },
  gamblers_fallacy: { label: '赌徒谬误', category: 'judgment', coreMeaning: '以为连续亏后"该赢了"，连续跌后"该涨了"', tradingHarm: '逆势抄底、频繁交易' },
  base_rate_neglect: { label: '基础率忽视', category: 'judgment', coreMeaning: '忽略长期概率，只盯眼前信号', tradingHarm: '高估小概率机会' },
  overfitting: { label: '过拟合偏差', category: 'judgment', coreMeaning: '把偶然有效当成稳定规律', tradingHarm: '策略失真' },
  single_cause: { label: '单因果偏差', category: 'judgment', coreMeaning: '用一个变量解释复杂行情', tradingHarm: '忽略系统风险' },
  linear_extrapolation: { label: '线性外推', category: 'judgment', coreMeaning: '以为涨了会一直涨，跌了会一直跌', tradingHarm: '趋势末端追单' },
  price_illusion: { label: '价格幻觉', category: 'judgment', coreMeaning: '觉得价格低就是便宜，价格高就是危险', tradingHarm: '盲目抄底、错过强趋势' },
  framing: { label: '框架效应', category: 'judgment', coreMeaning: '同一信息换种说法，就改变判断', tradingHarm: '情绪化调仓' },
  need_for_closure: { label: '认知闭合需求', category: 'judgment', coreMeaning: '急着给行情找一个确定答案', tradingHarm: '过早下结论、频繁交易' },

  // ===== 执行偏差 · 做错动作 =====
  anchoring: { label: '锚定', category: 'execution', coreMeaning: '被开仓价、前高、目标价绑架', tradingHarm: '扛单、提前止盈' },
  sunk_cost: { label: '沉没成本', category: 'execution', coreMeaning: '因为已经亏了，所以更不愿退出', tradingHarm: '扛单、加仓、取消止损' },
  loss_aversion: { label: '损失厌恶', category: 'execution', coreMeaning: '过度害怕小亏', tradingHarm: '小亏拖成大亏' },
  disposition: { label: '处置效应', category: 'execution', coreMeaning: '盈利仓拿不住，亏损仓死扛', tradingHarm: '赚小亏大' },
  outcome_bias: { label: '结果偏差', category: 'execution', coreMeaning: '用单笔盈亏判断决策质量', tradingHarm: '错误强化、错误惩罚' },
  overconfidence: { label: '过度自信', category: 'execution', coreMeaning: '高估判断力、胜率和控制力', tradingHarm: '重仓、加仓' },
  attribution: { label: '归因偏差', category: 'execution', coreMeaning: '盈利归因于能力，亏损归因于市场', tradingHarm: '拒绝复盘' },
  hindsight: { label: '后见之明偏差', category: 'execution', coreMeaning: '事后觉得"早就知道"', tradingHarm: '高估自己、低估随机性' },
  self_consistency: { label: '自我一致性偏差', category: 'execution', coreMeaning: '为了证明自己是对的，不愿认错', tradingHarm: '扛单、拒绝更新判断' },
  optimism: { label: '乐观偏差', category: 'execution', coreMeaning: '默认行情会朝自己想要的方向走', tradingHarm: '不设止损、低估尾部风险' },
  illusion_of_control: { label: '控制错觉', category: 'execution', coreMeaning: '以为自己能控制市场短期波动', tradingHarm: '过度操作、频繁交易' },
  planning_fallacy: { label: '计划谬误', category: 'execution', coreMeaning: '高估自己能按计划执行', tradingHarm: '实盘变形、风控失效' },
} as const satisfies Record<string, CognitiveBiasMeta>;

export type CognitiveBiasTagId = keyof typeof COGNITIVE_BIAS_META;

/**
 * 标签 → 中文名映射。含全部当前标签；并保留历史 ID（'none' = 旧"无明显偏差"哨兵），
 * 让 PostTradeReviewSheet / biasSpectrum 在显示老快照时仍能取到中文名。
 */
export const COGNITIVE_BIAS_LABELS: Record<string, string> = {
  ...(Object.fromEntries(
    (Object.entries(COGNITIVE_BIAS_META) as [CognitiveBiasTagId, CognitiveBiasMeta][])
      .map(([id, meta]) => [id, meta.label]),
  ) as Record<string, string>),
  none: '无',
};

/**
 * @deprecated 旧"无明显偏差"哨兵。新 UI 改为纯多选、不再使用该哨兵；
 * 仅为向后兼容（历史快照 / 旧引用）保留。
 */
export const COGNITIVE_BIAS_NONE = 'none';
