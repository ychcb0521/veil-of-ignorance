/**
 * 认知偏差标签 — 批次 26 三类重构（扩充版）
 *
 * 决策出错分三个环节：
 *   信息偏差 = 看错信息（输入端：你拿到的证据本身就是偏的）— 我是不是只看见了想看的信息？
 *   判断偏差 = 想错逻辑（处理端：从证据推到结论的过程是偏的）— 我是不是把噪音当成规律？
 *   执行偏差 = 做错动作（输出端：明知道，却被盈亏和自尊绑架）— 我是不是被盈亏和自尊绑架了？
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
    systemPrompt: '我是不是只看见了想看的信息？',
    accent: '#7C8B9C',
  },
  {
    category: 'judgment',
    title: '判断偏差',
    oneLiner: '想错逻辑',
    definition: '处理端出错：证据没问题，但从证据推到结论的过程是偏的。',
    systemPrompt: '我是不是把噪音当成规律？',
    accent: '#F0B90B',
  },
  {
    category: 'execution',
    title: '执行偏差',
    oneLiner: '做错动作',
    definition: '输出端出错：判断没问题，却被过去盈亏和自尊绑架，动作变形。',
    systemPrompt: '我是不是被盈亏和自尊绑架了？',
    accent: '#F6465D',
  },
];

/**
 * 认知偏差全集，按声明顺序在各自类别内渲染。
 * 旧 ID（confirmation / social_proof / narrative / anchoring / sunk_cost 等）原样保留，历史快照不丢标签。
 */
export const COGNITIVE_BIAS_META = {
  // ===== 信息偏差 · 看错信息 · 我是不是只看见了想看的信息？=====
  confirmation: { label: '确认偏误', category: 'information', coreMeaning: '只寻找支持自己仓位的信息', tradingHarm: '拒绝更新判断、扛单' },
  social_proof: { label: '社会认同 / 羊群行为', category: 'information', coreMeaning: '因为别人都这么看，所以觉得更可靠', tradingHarm: '跟单、追单、泡沫末端接盘' },
  authority: { label: '权威偏误', category: 'information', coreMeaning: '因为大V、机构、专家说了，就降低验证标准', tradingHarm: '放弃独立判断、盲目跟单' },
  availability: { label: '可得性偏差', category: 'information', coreMeaning: '哪个信息更容易想起，就误以为更重要', tradingHarm: '追热门、误判风险' },
  recency: { label: '近期偏差', category: 'information', coreMeaning: '过度重视最近几根K线或最近几笔盈亏', tradingHarm: '追单、过早否定系统' },
  selective_memory: { label: '选择性记忆', category: 'information', coreMeaning: '记住做对的，淡化做错的', tradingHarm: '高估胜率、低估亏损' },
  survivorship: { label: '生存者偏差', category: 'information', coreMeaning: '只看到成功案例，忽略失败样本', tradingHarm: '高估成功概率、低估风险' },
  liking: { label: '喜欢 / 热爱倾向', category: 'information', coreMeaning: '爱上某只股票、某个币、某家公司', tradingHarm: '忽略负面信息、用感情持仓' },
  disliking: { label: '讨厌 / 憎恨倾向', category: 'information', coreMeaning: '因个人厌恶而放大负面信息', tradingHarm: '错过机会、判断失真' },
  first_conclusion: { label: '第一结论偏见', category: 'information', coreMeaning: '第一个判断获得过高权重', tradingHarm: '后续证据被自动降级' },
  halo_effect: { label: '光环效应', category: 'information', coreMeaning: '因为标的某一方面优秀，就误以为整体都优秀', tradingHarm: '用局部优点替代整体判断，忽略估值、流动性、筹码结构和反方证据' },
  group_polarization: { label: '群体极化', category: 'information', coreMeaning: '一群观点相似的人讨论后，判断变得更极端', tradingHarm: '社群越聊越看多或越聊越看空，风险感知被群体放大或压低' },
  peak_end_rule: { label: '峰终定律', category: 'information', coreMeaning: '只记住最强烈时刻和最后结果，忽略完整过程', tradingHarm: '只记得最后赚钱，忘了中间巨大回撤，导致复盘低估真实风险' },

  // ===== 判断偏差 · 想错逻辑 · 我是不是把噪音当成规律？=====
  narrative: { label: '叙事谬误', category: 'judgment', coreMeaning: '用故事替代结构判断', tradingHarm: '用故事持仓、拒绝止损' },
  representativeness: { label: '代表性偏差', category: 'judgment', coreMeaning: '看到相似形态，就以为走势会重复', tradingHarm: '模式误判、过拟合' },
  small_sample: { label: '小样本偏差', category: 'judgment', coreMeaning: '几笔交易就总结规律', tradingHarm: '过早加仓、过早放弃策略' },
  base_rate_neglect: { label: '基础率忽视', category: 'judgment', coreMeaning: '忽略长期统计概率，只盯眼前信号', tradingHarm: '高估小概率机会' },
  hot_hand: { label: '热手谬误', category: 'judgment', coreMeaning: '认为连续成功会提高下一次成功概率', tradingHarm: '连胜后重仓、追涨' },
  gamblers_fallacy: { label: '赌徒谬误', category: 'judgment', coreMeaning: '认为连续失败后"该赢了"', tradingHarm: '逆势抄底、频繁交易' },
  linear_extrapolation: { label: '线性外推', category: 'judgment', coreMeaning: '以为过去趋势会简单延续', tradingHarm: '趋势末端接盘' },
  mean_reversion_misread: { label: '回归均值误读', category: 'judgment', coreMeaning: '把自然回归误认为自己决策导致', tradingHarm: '建立错误因果' },
  illusory_causation: { label: '因果幻觉', category: 'judgment', coreMeaning: '把相关性误认为因果关系', tradingHarm: '错把噪音当机制' },
  single_cause: { label: '单因果偏差', category: 'judgment', coreMeaning: '用一个变量解释复杂行情', tradingHarm: '忽略系统性风险' },
  overfitting: { label: '过拟合偏差', category: 'judgment', coreMeaning: '把偶然有效当成稳定规律', tradingHarm: '回测好看，实盘失效' },
  physics_envy: { label: '物理学妒忌', category: 'judgment', coreMeaning: '迷信精确模型，忽略市场随机性和厚尾', tradingHarm: '模型脆弱、低估极端风险' },
  man_with_hammer: { label: '铁锤人倾向', category: 'judgment', coreMeaning: '只用熟悉工具解释所有问题', tradingHarm: '单一指标依赖、误判环境' },
  framing: { label: '对比 / 框架 / 价格幻觉', category: 'judgment', coreMeaning: '被参照物、表达方式、价格高低误导', tradingHarm: '误以为"跌多了就便宜"' },
  simple_association: { label: '简单联想泛化', category: 'judgment', coreMeaning: '把一次亏损经验泛化成永久规则', tradingHarm: '错误回避整个行业或策略' },
  need_for_closure: { label: '避免怀疑', category: 'judgment', coreMeaning: '急着消除不确定性，接受第一个解释', tradingHarm: '过早下结论、频繁交易' },
  reason_respecting: { label: '重视理由倾向', category: 'judgment', coreMeaning: '只要有人给理由，就更容易相信', tradingHarm: '被伪逻辑安抚' },
  illusion_of_control: { label: '控制错觉', category: 'judgment', coreMeaning: '以为自己能控制市场短期波动', tradingHarm: '过度操作、频繁交易' },
  planning_fallacy: { label: '计划谬误', category: 'judgment', coreMeaning: '高估自己能按计划执行', tradingHarm: '实盘变形、风控失效' },
  black_swan_blindness: { label: '黑天鹅盲区', category: 'judgment', coreMeaning: '低估小概率、高冲击事件的可能性', tradingHarm: '杠杆、仓位、止损设计过于乐观，极端行情下账户被打穿' },
  zero_risk_bias: { label: '零风险偏误', category: 'judgment', coreMeaning: '为了消除最后一点风险，愿意付出过高成本', tradingHarm: '过度对冲、过早止盈、频繁移动止损，长期收益被保险成本吃掉' },

  // ===== 执行偏差 · 做错动作 · 我是不是被盈亏和自尊绑架了？=====
  overconfidence: { label: '过度自信', category: 'execution', coreMeaning: '高估自己的判断力、能力和知识水平', tradingHarm: '重仓、频繁交易、取消止损' },
  optimism: { label: '过度乐观', category: 'execution', coreMeaning: '高估好结果，低估坏结果', tradingHarm: '低估亏损、忽略安全边际' },
  self_consistency: { label: '避免不一致性', category: 'execution', coreMeaning: '为了维持原判断，不愿承认错误', tradingHarm: '扛单、拒绝更新判断' },
  sunk_cost: { label: '沉没成本', category: 'execution', coreMeaning: '因为已经投入，所以更不愿退出', tradingHarm: '扛单、加仓、拖延止损' },
  loss_aversion: { label: '损失厌恶 / 被剥夺反应', category: 'execution', coreMeaning: '对失去过度敏感，亏损不愿认，盈利急着锁', tradingHarm: '亏损仓死扛，盈利仓过早止盈' },
  anchoring: { label: '锚定', category: 'execution', coreMeaning: '被开仓价、前高、历史高点、目标价绑架', tradingHarm: '等回本、等前高、错失退出' },
  denial: { label: '心理否认', category: 'execution', coreMeaning: '现实太痛苦，所以假装没发生', tradingHarm: '暴雷后继续幻想反转' },
  mental_accounting: { label: '心理账户', category: 'execution', coreMeaning: '把本金、盈利、浮盈分成不同心理账户', tradingHarm: '盈利后乱加风险' },
  endowment: { label: '禀赋效应', category: 'execution', coreMeaning: '一旦拥有某资产，就高估其价值', tradingHarm: '不愿卖出、替持仓辩护' },
  outcome_bias: { label: '结果偏差', category: 'execution', coreMeaning: '用单笔盈亏判断决策质量', tradingHarm: '违规盈利被强化，系统内亏损被惩罚' },
  hindsight: { label: '后见之明偏差', category: 'execution', coreMeaning: '事后觉得"早就知道"', tradingHarm: '高估自己、复盘失真' },
  attribution: { label: '归因偏差', category: 'execution', coreMeaning: '盈利归因于能力，亏损归因于市场', tradingHarm: '拒绝复盘、重复错误' },
  fomo: { label: 'FOMO / 错失恐惧', category: 'execution', coreMeaning: '害怕不上车就没机会', tradingHarm: '追高、追空、无计划开仓' },
  envy: { label: '艳羡 / 妒忌', category: 'execution', coreMeaning: '看到别人赚钱后风险偏好变形', tradingHarm: '跟风、重仓、攀比交易' },
  stress: { label: '压力影响', category: 'execution', coreMeaning: '高压下理性系统崩溃', tradingHarm: '恐慌割肉、乱反手' },
  incentive_bias: { label: '激励偏差 / 代理成本', category: 'execution', coreMeaning: '激励结构扭曲判断', tradingHarm: '为排名、手续费、规模而冒险' },
  missing_dual_track: { label: '双轨分析缺失', category: 'execution', coreMeaning: '只做市场分析，不查自己是否失真', tradingHarm: '理性分析被情绪污染' },
  lollapalooza: { label: 'Lollapalooza 复合效应', category: 'execution', coreMeaning: '多种偏差同向叠加，导致极端失控', tradingHarm: '泡沫、踩踏、爆仓级错误' },
  status_quo_bias: { label: '现状偏差', category: 'execution', coreMeaning: '明知应该调整，却因为惯性、懒惰或逃避而维持原状', tradingHarm: '该止损不止损，该降仓不降仓，该更新策略不更新' },
  escalation_of_commitment: { label: '承诺升级', category: 'execution', coreMeaning: '决策错了以后，不认错，反而继续加码证明自己没错', tradingHarm: '亏损加仓、越错越重，把小亏变成账户级事故' },
  procrastination_bias: { label: '拖延偏误', category: 'execution', coreMeaning: '明知该复盘、止损、降仓、设规则，却不断推迟', tradingHarm: '风控后置，错误持续暴露，系统无法形成闭环' },
} as const satisfies Record<string, CognitiveBiasMeta>;

export type CognitiveBiasTagId = keyof typeof COGNITIVE_BIAS_META;

/**
 * 标签 → 中文名映射。含全部当前标签；并保留历史 ID（'none' 旧"无明显偏差"哨兵，
 * price_illusion / disposition 早期版本已合并的标签），让 PostTradeReviewSheet /
 * biasSpectrum 在显示老快照时仍能取到中文名，而不是裸露英文 key。
 */
export const COGNITIVE_BIAS_LABELS: Record<string, string> = {
  none: '无',
  price_illusion: '价格幻觉',
  disposition: '处置效应',
  ...(Object.fromEntries(
    (Object.entries(COGNITIVE_BIAS_META) as [CognitiveBiasTagId, CognitiveBiasMeta][])
      .map(([id, meta]) => [id, meta.label]),
  ) as Record<string, string>),
};

/**
 * @deprecated 旧"无明显偏差"哨兵。新 UI 改为纯多选、不再使用该哨兵；
 * 仅为向后兼容（历史快照 / 旧引用）保留。
 */
export const COGNITIVE_BIAS_NONE = 'none';
