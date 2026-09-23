// Shared trading types for the matching engine
import {
  LEGACY_MAINTENANCE_MARGIN_RATE,
  isTieredRiskPosition,
  tieredLiquidationPrice,
} from "@/lib/positionRiskModel";

export type OrderSide = "LONG" | "SHORT";
export type OrderType =
  | "MARKET"
  | "LIMIT"
  | "POST_ONLY" // 只做Maker
  | "LIMIT_TP_SL" // 限价止盈止损
  | "MARKET_TP_SL" // 市价止盈止损
  | "CONDITIONAL" // 条件委托
  | "TRAILING_STOP" // 跟踪委托
  | "TWAP" // 分时委托
  | "SCALED"; // 分段订单

export type MarginMode = "cross" | "isolated";

/**
 * 新标的下单时的默认仓位模式。
 *
 * 取逐仓：本系统把「全仓」定为硬阻断（全仓会把单笔错误扩散到账户整体，
 * 违背损失有界的底层原则），默认却是全仓的话，每开一个新标的都要先手动切换
 * 才能提交，默认值与硬约束自相矛盾。
 *
 * 只作用于「尚未为该标的显式选过仓位模式」的实时下单路径；
 * 历史记录里缺失该字段的回填保持原样，不追溯改写过去交易的含义。
 */
export const DEFAULT_MARGIN_MODE: MarginMode = "isolated";
export type SettlementMode = "usdt" | "coin";

/**
 * 新标的下单时的默认结算方式。
 *
 * 只作用于「尚未为该标的显式选过结算方式」的实时下单路径。
 * 历史记录里缺失该字段的回填一律保持 "usdt"——那些单子是在旧默认下开的，
 * 事后按币本位重新解读会悄悄改写过去交易的含义，连带污染战役统计。
 */
export const DEFAULT_SETTLEMENT_MODE: SettlementMode = "coin";
export type OrderStatus = "NEW" | "PENDING" | "FILLED" | "CANCELED" | "TRIGGERED" | "ACTIVE";
export type TriggerOperator = ">=" | "<=";

/**
 * 加仓计算器在下单那一刻给出的计划，随委托 → 成交 → 平仓记录一路带着。
 *
 * COMMONUSDT 那一场的学费：用户严格按计算器的上限下单，Legs「加仓校验」却判超限 1.57% / 3.70%，
 * 而**没有任何地方记下计算器当时显示了什么**——事后只能从 PNG 反推。
 * 从此计算器有可用计划时，下的单就把计划的输入与输出钉在单子上：
 * 校验读到它才能说清「计算时现价 / 预计成交 / 上限」与「实际成交 / 上限」各是多少，
 * 超出的那一截是不是全部来自成交滑点。
 *
 * 纯数据、可 JSON 序列化：PendingOrder / Position.fills / TradeRecord 都是整块 JSON 持久化并云同步的，
 * 加一个可选字段不需要任何表结构变更；老数据没有这个字段（undefined）。
 */
export interface AddSizingSnapshot {
  /** 计划最后一次仍然现行的真实时刻（Date.now()）：发布、或计算器关闭时续上；保鲜期从它算起。 */
  at: number;
  /** A = G 为 0（Plan B 与 Plan A 同值）；B = G ≠ 0。 */
  plan: "A" | "B";
  side: OrderSide;
  /** 计划时的结算口径——G 的单位随它（U 本位 USD、币本位结算币）。 */
  settlement: SettlementMode;
  /** S₁ 止损 / 对冲线。 */
  s1: number;
  /** 计算时的参考价 S₂：市价 = 引擎市价成交的基准价；限价 = 手填的挂单价；条件委托 = 触发价（已按价格精度取整）。 */
  s2Ref: number;
  /**
   * 计划定量用的价 S₂′：市价 = calcSlippage(S₂, 上限名义)；限价 = 挂单价（S₂ 按价格精度向有利侧取整）；
   * 条件委托 = calcSlippage(触发价, 上限名义)——触发后按市价成交。
   */
  s2Fill: number;
  /** 市价计划的预计滑点 (S₂′ − S₂) ÷ S₂ × 100，带符号；限价为 0。 */
  slippagePct: number;
  /**
   * 钉到单子上那一刻，这张单**自己**的下单参考价：市价 / 最优价 = 引擎成交的基准价，
   * 限价 / 只做 Maker = 委托价，条件单 = 触发价。计划发布时没有（null / 缺省），由下单入口补上。
   * 计划与下单之间价格可能已经变了——Legs 校验靠它把「计算后价格变动」与「成交滑点」分开。
   */
  s2AtOrder?: number | null;
  /** X₁ 既有币量、S̄ 综合成本，都是计划时手填 / 预填的那个数。 */
  x1: number;
  sBar: number;
  /** 本轮落袋净额 G（带符号）与它的单位（USD / 结算币名）。 */
  g: number;
  gUnit: string;
  /** Plan B 上限（币），按 S₂′ 算。 */
  addCoinsMax: number;
  /** 上限折成整张（向下取整）；U 本位为 null。 */
  contracts: number | null;
  /** 计划按哪种方式成交：市价含滑点、限价 @S₂、条件委托 @S₂（触发后市价，含滑点）。 */
  orderKind: "market" | "limit" | "conditional";
}

export interface PendingOrder {
  id: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  stopPrice: number;
  quantity: number;
  leverage: number;
  marginMode: MarginMode;
  /** USDT linear contract by default; coin = Binance COIN-M inverse contract. */
  settlementMode?: SettlementMode;
  /** USDT for U本位; base coin (BTC/ETH/...) for 币本位. */
  settlementAsset?: string;
  /** COIN-M contract face value in USD, e.g. BTCUSD=100, most alts=10. */
  contractSizeUsd?: number;
  /** COIN-M order quantity in contracts/张. Mirrors quantity for coin-settled orders. */
  contracts?: number;
  /**
   * 风险模型来源（lib/positionRiskModel）。币安分层上线之后由引擎下单时盖上：
   * 'binance-tiers-v1' = 正常过了分层判定，成交开出分层仓位；
   * 'legacy-hedge-v1' = 只靠「对冲更新前的仓位」那条豁免放行，成交开出旧 0.4% 模型的豁免仓位，
   * 触发 / 成交那一刻再判一次豁免是否仍成立。
   * 上线之前挂出的委托没有这个字段：它们是按旧规则（通用表、滑块到 125x）放行的，
   * 成交后仍开旧的 0.4% 仓位（更新前的仓位），免得一成交就在开仓价上被强平。
   */
  riskModel?: 'binance-tiers-v1' | 'legacy-hedge-v1';
  /**
   * 币安单笔数量上限（MARKET_LOT_SIZE / LOT_SIZE，见 lib/marketLotSize）上线之后经引擎下的委托盖这个戳：
   * 按市价成交的（条件委托、跟踪委托、TWAP 的每一片、按成数的止盈止损）在触发 / 执行那一刻再判一次单笔上限。
   * 上线之前挂出的委托没有它，触发时不再判——它们是按旧规则放行的。
   */
  lotSizeRule?: 'binance-lot-size-v1';
  status: OrderStatus;
  createdAt: number;
  /**
   * 真实钱包时钟下的挂单时刻（Date.now()），与 createdAt 的模拟 K 线时间严格区分。
   * 归属战役靠它：同一段历史行情可以回放两次，两次的委托在模拟时间轴上完全重合，
   * 在真实时间轴上必然分开。老委托没有这个字段（undefined），归属时退回模拟窗口。
   */
  createdRealAt?: number;
  /**
   * 挂单时所在的回放时间线（lib/replayTimeline）。与 createdRealAt 是两件事：
   * 真实时间只能事后猜哪几笔属于同一次回放，时间线 id 是写入那一刻就确定的答案。
   * 老委托、时钟停着时挂的单没有（undefined / null），归属照旧走启发式。
   */
  createdTimelineId?: string | null;
  /** Trading mode captured at placement, so later fills keep the original incentive weight. */
  tradingMode?: "decision" | "direct";
  /** 下单时加仓计算器的计划（见 AddSizingSnapshot）；没有计划的单子没有这个字段。 */
  addSizingSnapshot?: AddSizingSnapshot | null;

  callbackRate?: number;
  trailingExecType?: "MARKET" | "LIMIT";
  trailingLimitPrice?: number;
  peakPrice?: number;
  troughPrice?: number;
  trailingActivated?: boolean;

  twapTotalQty?: number;
  twapFilledQty?: number;
  twapInterval?: number;
  twapNextExecTime?: number;
  twapEndTime?: number;

  conditionalExecType?: "MARKET" | "LIMIT";
  conditionalLimitPrice?: number;

  /**
   * 随这张单一起下的止盈 / 止损——**成交时**才变成减仓单。
   *
   * 此前面板把止盈价塞进 stopPrice、把类型改写成 LIMIT_TP_SL / MARKET_TP_SL，
   * 于是引擎把**止盈价当成开仓触发价**：市价单不再立刻成交，而是挂在止盈价上开仓
   * （Index.tsx:1136-1144）；限价单则要等价格先摸到止盈价才肯激活
   * （Index.tsx:1149-1159）。两种都不是用户勾那个框时想要的东西。
   * 分开存,开仓价与保护价从此不再共用一个字段。
   */
  attachedTpPrice?: number;
  attachedSlPrice?: number;
  attachedTpSlPercentage?: number;

  /** Trigger direction locked at placement: UP = triggerPrice > currentPrice, DOWN = triggerPrice < currentPrice */
  triggerDirection?: "UP" | "DOWN";
  /** Locked comparison operator for conditional orders, derived from triggerPrice vs currentPrice at placement */
  operator?: TriggerOperator;

  parentScaledId?: string;

  /** Reduce-only flag — TP/SL orders that only close existing positions */
  reduceOnly?: boolean;
  /** Symbol of the position this TP/SL order targets */
  reduceSymbol?: string;
  /** Side of the position this TP/SL order targets (opposite of close direction) */
  reducePositionSide?: OrderSide;
  /** Hard binding to a specific position id — TP/SL only acts on this one */
  linkedPositionId?: string;
  /** TP or SL category (used for OCO + UI display) */
  reduceKind?: "TP" | "SL";
  /** Percentage (0-100] of the linked position to close on trigger */
  reducePercentage?: number;
}

/**
 * Snapshot of a pending order captured at the moment it is cancelled.
 * Cancelling normally just deletes the order from `ordersMap`; we persist this
 * so campaign reviews can list 反向对冲挂单 (委托价 / 委托时间 / 取消时间).
 */
export interface CancelledOrderSnapshot {
  id: string;
  symbol: string;
  side: OrderSide;
  /** Original order type, kept so campaign yellow layers can exclude TP/SL close orders. */
  type?: OrderType;
  /** True for reduce-only TP/SL close orders; yellow campaign layers only use opening orders. */
  reduceOnly?: boolean;
  reduceKind?: "TP" | "SL" | null;
  linkedPositionId?: string | null;
  price: number;
  quantity: number;
  leverage: number;
  settlementMode?: SettlementMode;
  settlementAsset?: string;
  contractSizeUsd?: number;
  contracts?: number;
  /** 委托时间 (sim/K-line clock, same as PendingOrder.createdAt) */
  createdAt: number;
  /** 取消时间 (sim/K-line clock) */
  cancelledAt: number;
  /** 真实钱包时钟下的挂单 / 撤单时刻；老快照没有。 */
  createdRealAt?: number;
  cancelledRealAt?: number;
  /** 挂单 / 撤单时所在的回放时间线；老快照没有。 */
  createdTimelineId?: string | null;
  cancelledTimelineId?: string | null;
}

/**
 * Snapshot of a pending order captured at the moment it is triggered/filled.
 * The original order disappears from `ordersMap` after fill; keeping this lets
 * campaign charts draw the pre-trigger pending segment from the real order time.
 */
export interface FilledOrderSnapshot {
  id: string;
  symbol: string;
  side: OrderSide;
  /** Original order type, kept so campaign yellow layers can exclude TP/SL close orders. */
  type?: OrderType;
  /** True for reduce-only TP/SL close orders; yellow campaign layers only use opening orders. */
  reduceOnly?: boolean;
  reduceKind?: "TP" | "SL" | null;
  linkedPositionId?: string | null;
  /** Actual fill price after slippage/maker handling. */
  price: number;
  /** Raw trigger price from the k-line condition before slippage. */
  triggerPrice: number;
  quantity: number;
  leverage: number;
  settlementMode?: SettlementMode;
  settlementAsset?: string;
  contractSizeUsd?: number;
  contracts?: number;
  /** 委托时间 (sim/K-line clock, same as PendingOrder.createdAt) */
  createdAt: number;
  /** 触发/成交时间 (sim/K-line clock) */
  filledAt: number;
  /** 真实钱包时钟下的挂单 / 成交时刻；老快照没有。 */
  createdRealAt?: number;
  filledRealAt?: number;
  /** 挂单 / 成交时所在的回放时间线；老快照没有。挂单之后倒回过，两者就不同。 */
  createdTimelineId?: string | null;
  filledTimelineId?: string | null;
  positionId?: string;
  /** 挂单时带着的加仓计划，成交后原样带到快照上。 */
  addSizingSnapshot?: AddSizingSnapshot | null;
}

/**
 * One reverse-hedge order row shown in a campaign's 反向对冲挂单 section.
 * 三态：cancelled=已撤销、pending=仍挂单中、triggered=已触发成交。
 * 字段语义随状态：
 *  - cancelled/pending: price=委托价, createdAt=委托时间, cancelledAt=撤销时间(pending 为 null)。
 *  - triggered:        price=原委托触发价, fillPrice=成交价, createdAt=委托时间,
 *                      triggeredAt=触发时间, cancelledAt=平仓时间(未平为 null)。
 */
export interface CampaignReverseHedgeOrder {
  id: string;
  /** 成交后对应的 trade_history record id；用于在 Legs 列表里精确归属到对应 leg。 */
  tradeRecordId?: string | null;
  side: OrderSide;
  /** Original pending/trigger price. Profit-capture risk must use this value, never the slipped fill. */
  price: number;
  /** Actual fill after slippage when the order triggered. */
  fillPrice?: number | null;
  createdAt: number;
  triggeredAt?: number | null;
  cancelledAt: number | null;
  status: 'cancelled' | 'pending' | 'triggered';
  /**
   * 别的回放留下、在本场期间仍挂着的委托（getCampaignFullData 的 foreignLiveOrders）。
   * 只用于标注显示：不进 reverseHedgeOrders / pendingOrders，风险指标、Legs 合计与结束建议都不算它。
   */
  foreignReplay?: boolean;
}

interface TriggerRange {
  high: number;
  low: number;
}

export interface Position {
  id: string;
  /** 开仓成交来源；合并后仓位级字段属于第一笔，各笔各存 fills。旧数据缺失时保持未知。 */
  entry_method?: "manual" | "order";
  side: OrderSide;
  entryPrice: number;
  quantity: number;
  leverage: number;
  marginMode: MarginMode;
  settlementMode?: SettlementMode;
  settlementAsset?: string;
  contractSizeUsd?: number;
  contracts?: number;
  margin: number;
  /** Coin-settled margin in the settlement asset; margin remains USD-equivalent for account equity. */
  marginCoin?: number;
  /** For isolated positions: the segregated margin assigned to this position */
  isolatedMargin?: number;
  /** Simulated clock time when this position was opened */
  openTime?: number;
  /** 真实钱包时钟下的开仓时刻（Date.now()）；老仓位没有。战役按真实时间归属委托单时的下界依据。 */
  openedRealAt?: number;
  /** 开仓（第一笔成交）时所在的回放时间线；合并仓位里每笔成交各记在 fills[i].timelineId。老仓位没有。 */
  openTimelineId?: string | null;
  /**
   * 开仓那一刻的杠杆，**永不重述**。
   *
   * leverage 会被「调整杠杆」改写，而平仓记录写的是 pos.leverage——
   * 于是持仓中途提一次杠杆再平仓，战役的「初始杠杆」会被**追溯改写**成提高后的值，
   * 连带 R 倍数与预期最大亏损全部虚高。旧数据没有这个字段时退回 leverage。
   */
  openLeverage?: number;
  /**
   * 构成这个仓位的每一笔成交。**fills[0].id 恒等于 position.id**。
   *
   * 同标的同方向的成交会合并成一个仓位（币安单向持仓模式就是这样），
   * 但「这一笔加仓自己是什么时候、以什么价开的」不能因此丢掉——
   * 战役页的腿、开仓时刻、快照都要靠它。合并只改风控口径，不抹掉历史。
   *
   * 旧数据没有这个字段，读的时候一律按 [{ id, openTime, entryPrice, units }] 推导，
   * 不做持久化迁移（positions_map 是云同步的，没有版本号，坏迁移不可回滚）。
   */
  fills?: PositionFill[];
  /**
   * 开仓手续费随仓位走（合并仓位是各笔之和，部分平仓按比例带走），
   * 平仓记录据此写出这一笔的完整成本。旧仓位没有这些字段。
   */
  openFeeUsd?: number;
  openFeeCoin?: number;
  openIsMaker?: boolean;
  openFeeRate?: number;
  /**
   * 这笔成交（合并仓位里是 fills[0] 那一笔）下单时的加仓计划。
   * 合并进别的仓位后各笔各留各的，见 PositionFill.addSizingSnapshot。
   */
  addSizingSnapshot?: AddSizingSnapshot | null;
  /**
   * 风险模型来源（lib/positionRiskModel）。'binance-tiers-v1' = 维持保证金与强平价按币安分层算；
   * 'legacy-hedge-v1' = 只靠对冲豁免开出的仓位，按旧的 0.4% 算，但**不是**更新前的仓位（不能再当豁免的底）。
   * 仓位沿用开出它的委托的来源；上线前挂出、上线后才成交的委托开出的仓位没有这个字段（更新前的仓位）。
   * **仓位开出来之后不换模型**：合并时存活仓位一律沿用被加仓的那个仓位的来源（survivorRiskStamp），
   * 所以分层的一笔可以并进按旧 0.4% 的仓位（整仓仍 0.4%，不重新定价），反过来不并（mergeRiskBlocked）。
   * 没有来源的仓位一直按旧的 0.4% 统一费率，直到平掉——升级不改任何现有仓位的强平价。
   */
  riskModel?: 'binance-tiers-v1' | 'legacy-hedge-v1';
  /** 盖戳时的标的（positionsMap 的键）。仓位对象本身不带标的，按它查分层。 */
  riskSymbol?: string;
  /**
   * 冻结的「对冲豁免的底」，以该仓位的计量单位数计（币本位张数 / U 本位币数，与 getPositionUnits 同口径）。
   * 只有更新前的仓位才有意义；没有这个字段时整仓都是底（升级前就在的仓位）。
   * 分层 / 豁免成交并进来只加仓位的大小、**不加这个底**；部分平仓按比例缩。
   * 读它请走 positionRiskModel.hedgeExemptBaseUnits，别直接读这个字段。
   */
  hedgeBaseUnits?: number;
}

export interface PositionFill {
  id: string;
  /** 此笔是手动立即开仓还是由委托撮合；不能从 Maker/Taker 或成交记录 MARKET 推断。 */
  entry_method?: "manual" | "order";
  openTime: number;
  /** 这笔成交自己的真实开仓时刻；合并进仓位后各笔各留各的。 */
  openedRealAt?: number;
  /** 这笔成交自己所在的回放时间线；加仓可能发生在倒回之后，不能借用主力的。 */
  timelineId?: string | null;
  entryPrice: number;
  /** 该笔成交的计量单位数：币本位为张数，U 本位为币数。 */
  units: number;
  /**
   * 该笔成交**开仓时**的杠杆。持仓期内提过杠杆之后，合并仓位的 openLeverage
   * 一路继承最早那笔的值，加仓那一片就会顶着主力的杠杆写进历史，R 倍数随之失真。
   * 旧数据没有这个字段时退回仓位级的 openLeverage ?? leverage。
   */
  openLeverage?: number;
  /** 这笔成交开仓时付的手续费（USD）。旧数据没有；战役页按当年费率估算并标明。 */
  openFeeUsd?: number;
  /** 币本位：开仓手续费的币数。 */
  openFeeCoin?: number;
  /** 开仓时按 Maker 还是 Taker 收的。 */
  openIsMaker?: boolean;
  /** 开仓时适用的费率（小数）。费率表日后再变，历史记录仍能解释。 */
  openFeeRate?: number;
  /** 这笔成交自己下单时的加仓计划；主力那笔通常没有，加仓那笔才有。 */
  addSizingSnapshot?: AddSizingSnapshot | null;
}

export interface TradeRecord {
  id: string;
  /** Position that produced this close/funding/liquidation record when known. */
  /**
   * 这一片属于**哪一笔成交**。
   *
   * 同向成交会合并成一个仓位（币安单向持仓），但平仓时按每笔成交各写一条记录——
   * 否则加仓在战役里会整条消失,主力还会顶着一个混合开仓价。
   * positionId 仍然是**存活的那个合并仓位**;fillId 才是这一片自己的身份。
   * 旧记录没有这个字段,一律退回按 positionId 归属。
   */
  fillId?: string;
  positionId?: string | null;
  symbol: string;
  side: OrderSide;
  type: OrderType | "FUNDING";
  action: "OPEN" | "CLOSE" | "LIQUIDATION" | "FUNDING";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  leverage: number;
  settlementMode?: SettlementMode;
  settlementAsset?: string;
  contractSizeUsd?: number;
  contracts?: number;
  notionalUsd?: number;
  pnlCoin?: number;
  feeCoin?: number;
  pnl: number;
  fee: number;
  slippage: number;
  openTime: number;
  closeTime: number;
  /**
   * 真实钱包时钟（Date.now()）下的「操作时刻」——交易员实际下这一刀的现实时间，
   * 与 openTime/closeTime 的模拟 K 线时间严格区分。仅本字段上线后发生的成交才有；
   * 老记录为 undefined（界面显示「—」，绝不退回模拟时间冒充真实操作时间）。
   */
  closedRealAt?: number;
  /** 真实钱包时钟下的开仓时刻；与 closedRealAt 一起框出这笔交易在现实里的持有区间。老记录没有。 */
  openedRealAt?: number;
  /**
   * 这一片开仓 / 平仓时所在的回放时间线（lib/replayTimeline）。按每笔成交拆条时，
   * openedTimelineId 取那一笔成交自己的。资金费记录可以带 closedTimelineId，但它不是归属锚点。
   * 老记录没有。
   */
  openedTimelineId?: string | null;
  closedTimelineId?: string | null;
  /** 这笔成交的开仓方式，来自开仓时的明确记录；旧历史缺失时不推断。 */
  entry_method?: "manual" | "order";
  /** How the position was closed. Manual for user-initiated; sl/tp1-3 for triggered TP/SL; liquidation for forced close. */
  exit_method?: "manual" | "sl" | "tp1" | "tp2" | "tp3" | "liquidation";
  /**
   * 逐仓强平按破产价结算的记录：净盈亏恰为 −隔离保证金，与平仓价上的毛盈亏无关。
   * 按平仓价重算盈亏的地方（导出的出场价校正、手动修正）必须跳过它，否则会把保证金封顶拆掉。
   * 老的强平记录没有这个字段。
   */
  liquidationSettlement?: "bankruptcy";
  /**
   * 手续费明细（2026-09-12 起写入）。`fee` 一直只是**平仓费**（强平记录里含强平清算费）；
   * 开仓费在开仓当时从钱包扣除、此前不进任何记录——「平仓价高于开仓价却亏损」的来源。
   * 旧记录没有这些字段，战役页按当年费率估算开仓费（见 lib/tradeFees.ts）。
   */
  openFeeUsd?: number;
  openFeeCoin?: number;
  openIsMaker?: boolean;
  openFeeRate?: number;
  closeIsMaker?: boolean;
  closeFeeRate?: number;
  /** 强平记录：`fee` 里包含的强平清算费。 */
  liquidationFeeUsd?: number;
  /** User-written reason recorded after the close, used for post-trade review and playback. */
  exit_reason_text?: string;
  /**
   * 这一片开仓那一笔成交下单时的加仓计划（按笔拆条时取那一笔自己的）。
   * Legs「加仓校验」靠它说清「计算时上限 / 实际成交上限」以及超出是否全部来自滑点。老记录没有。
   */
  addSizingSnapshot?: AddSizingSnapshot | null;
}

/**
 * 旧模型的统一维持保证金率 0.4%。只适用于不带分层戳的仓位（币安分层上线前开的、靠对冲豁免开的 'legacy-hedge-v1'）；
 * 读维持保证金一律走 lib/positionRiskModel 的 positionMaintenanceMarginUsd，它按仓位选模型。
 */
export const MAINTENANCE_MARGIN_RATE = LEGACY_MAINTENANCE_MARGIN_RATE;
export const LIQUIDATION_FEE_RATE = 0.005; // 0.5%
export const FUNDING_RATE = 0.0001; // 0.01% per 8h settlement

/*
 * 杠杆分层不在这里：币安按合约分层（U 本位以 USDT 计、币本位以币计），
 * 数据与查询见 lib/leverageTiers，下单 / 改杠杆的上限判定见 lib/positionLimit。
 * 这里原先那张「所有合约一张表」的通用分层（≤50k 125x … 其余 10x）已删除。
 */

/** Lock the trigger operator at placement time using the then-current close price. */
export function getTriggerOperator(triggerPrice: number, currentPrice: number): TriggerOperator {
  return triggerPrice > currentPrice ? ">=" : "<=";
}

/** Intrabar trigger validation using kline extremes instead of latest close. */
export function isTriggerConditionMet(operator: TriggerOperator, triggerPrice: number, kline: TriggerRange): boolean {
  return operator === ">=" ? kline.high >= triggerPrice : kline.low <= triggerPrice;
}

// Funding settlement times in UTC hours
export const FUNDING_HOURS = [0, 8, 16];

/**
 * Volatility-adjusted slippage for market/taker orders.
 * Base slippage = 0.01% + notional / 5e9 (notional-scaled component).
 * If kline volatility (High-Low)/Close > 2%, slippage doubles (adverse market).
 */
export function calcSlippage(
  price: number,
  notionalValue: number,
  side: OrderSide,
  klineVolatility?: { high: number; low: number; close: number },
): number {
  let slippageRate = 0.0001 + notionalValue / 5_000_000_000;
  // Volatility doubling: if kline range > 2% of close, market is adverse
  if (klineVolatility && klineVolatility.close > 0) {
    const range = (klineVolatility.high - klineVolatility.low) / klineVolatility.close;
    if (range > 0.02) slippageRate *= 2;
  }
  return side === "LONG" ? price * (1 + slippageRate) : price * (1 - slippageRate);
}

/**
 * 币安合约手续费，普通用户（VIP 0）：Maker 0.02%，Taker 0.05%。U 本位与币本位同一档
 * （币本位自 2023-09-26 起 Maker 0.010% → 0.020%，Taker 0.050% 不变）。
 *
 * 计算式（币安官方 FAQ「Binance Futures Fee Structure & Fee Calculations」）：
 *   手续费 = 名义价值 × 费率，开仓、平仓各收一次
 *   U 本位：名义 = 数量 × 成交价，以 USDT 计
 *   币本位：名义 = 张数 × 面值 ÷ 成交价，以币计
 *   市价单、触发后的止损/止盈市价单是 Taker；挂在盘口成交的限价单是 Maker
 * 来源：binance.com/en/support/faq/binance-futures-fee-structure-fee-calculations-360033544231
 *       binance.com/en/support/announcement/binance-futures-updates-trading-fees-for-coin-m-futures-contracts-2023-09-26-…
 */
export const TAKER_FEE = 0.0005; // 0.05%
export const MAKER_FEE = 0.0002; // 0.02%
/**
 * 2026-09-12 之前本模拟器一直按 0.04% 收 Taker 费，而且不把开仓费写进任何记录。
 * 那之前的成交记录估算开仓费时用这个费率——用今天的费率去估当年扣走的钱会对不上钱包。
 */
export const LEGACY_TAKER_FEE = 0.0004;

export function calcUnrealizedPnl(pos: Position, currentPrice: number): number {
  if (pos.settlementMode === "coin") {
    const contracts = Math.max(0, Math.round(pos.contracts ?? pos.quantity ?? 0));
    const contractSizeUsd = pos.contractSizeUsd ?? 10;
    if (!contracts || !(pos.entryPrice > 0) || !(currentPrice > 0)) return 0;
    const coinPnl = pos.side === "LONG"
      ? contracts * contractSizeUsd * (1 / pos.entryPrice - 1 / currentPrice)
      : contracts * contractSizeUsd * (1 / currentPrice - 1 / pos.entryPrice);
    return coinPnl * currentPrice;
  }
  if (pos.side === "LONG") {
    return (currentPrice - pos.entryPrice) * pos.quantity;
  }
  return (pos.entryPrice - currentPrice) * pos.quantity;
}

export function calcROE(pos: Position, currentPrice: number): number {
  const pnl = calcUnrealizedPnl(pos, currentPrice);
  // ROE 分母统一固定为初始保证金 = 名义价值@开仓 / 杠杆（不含追加保证金），U本位/币本位同一口径。
  const notionalAtEntry = pos.settlementMode === "coin"
    ? Math.max(0, Math.round(pos.contracts ?? pos.quantity ?? 0)) * (pos.contractSizeUsd ?? 10)
    : pos.quantity * pos.entryPrice;
  const initialMargin = pos.leverage > 0 ? notionalAtEntry / pos.leverage : 0;
  return initialMargin > 0 ? (pnl / initialMargin) * 100 : 0;
}

/**
 * Strict U-margined liquidation price (industry-standard formula).
 *
 *   PositionNotional = quantity * entryPrice
 *   MaintenanceMargin (MM) = PositionNotional * MMR
 *
 *   LONG : liqPrice = (PositionNotional - margin + MM) / quantity
 *   SHORT: liqPrice = (PositionNotional + margin - MM) / quantity
 *
 * No zero-clamp: returns the true mathematical value, including negatives, so
 * over-collateralized positions truthfully show their "buffer below zero".
 * Only NaN / non-finite results are guarded (returns NaN to signal invalid input).
 *
 * 带 riskModel = 'binance-tiers-v1' 戳的仓位改走币安分层公式（lib/positionRiskModel），
 * 标的取 symbol 参数，缺省用戳里记下的 riskSymbol。下面的 0.4% 公式只给不带分层戳的仓位（更新前的、对冲豁免的）。
 */
export function calcLiquidationPrice(pos: Position, symbol?: string): number {
  if (!pos.quantity || pos.quantity <= 0 || !isFinite(pos.entryPrice)) return NaN;
  if (isTieredRiskPosition(pos)) return tieredLiquidationPrice(pos, symbol);

  const mmr = MAINTENANCE_MARGIN_RATE;
  if (pos.settlementMode === "coin") {
    const contracts = Math.max(0, Math.round(pos.contracts ?? pos.quantity ?? 0));
    const contractSizeUsd = pos.contractSizeUsd ?? 10;
    if (!contracts || !(pos.entryPrice > 0)) return NaN;
    const notionalUsd = contracts * contractSizeUsd;
    const marginCoin = pos.marginCoin ?? (pos.margin / pos.entryPrice);
    if (!(marginCoin > 0)) return NaN;

    let liq: number;
    if (pos.side === "LONG") {
      liq = (notionalUsd * (1 + mmr)) / (marginCoin + notionalUsd / pos.entryPrice);
    } else {
      const denominator = notionalUsd / pos.entryPrice - marginCoin;
      liq = denominator > 0 ? (notionalUsd * (1 - mmr)) / denominator : Infinity;
    }
    return Number.isFinite(liq) ? liq : NaN;
  }
  const positionNotional = pos.quantity * pos.entryPrice;
  const mm = positionNotional * mmr;

  let liq: number;
  if (pos.marginMode === "isolated" && pos.isolatedMargin != null) {
    const margin = pos.isolatedMargin;
    if (pos.side === "LONG") {
      liq = (positionNotional - margin + mm) / pos.quantity;
    } else {
      liq = (positionNotional + margin - mm) / pos.quantity;
    }
  } else {
    // Cross mode: derive an effective margin from leverage, then apply the same formula.
    const margin = positionNotional / pos.leverage;
    if (pos.side === "LONG") {
      liq = (positionNotional - margin + mm) / pos.quantity;
    } else {
      liq = (positionNotional + margin - mm) / pos.quantity;
    }
  }
  if (!isFinite(liq)) return NaN;
  return liq;
}

export function calcFee(price: number, quantity: number, isMaker: boolean): number {
  return price * quantity * (isMaker ? MAKER_FEE : TAKER_FEE);
}

// Order type display info
export const ORDER_TYPE_INFO: { value: OrderType; label: string; desc: string }[] = [
  { value: "LIMIT", label: "限价单", desc: "Limit Order" },
  { value: "POST_ONLY", label: "只做Maker", desc: "Post Only" },
  { value: "MARKET", label: "市价单", desc: "Market Order" },
  { value: "LIMIT_TP_SL", label: "限价止盈止损", desc: "Limit TP/SL" },
  { value: "MARKET_TP_SL", label: "市价止盈止损", desc: "Market TP/SL" },
  { value: "CONDITIONAL", label: "条件委托", desc: "Conditional Order" },
  { value: "TRAILING_STOP", label: "跟踪委托", desc: "Trailing Stop Order" },
  { value: "TWAP", label: "分时委托", desc: "TWAP" },
  { value: "SCALED", label: "分段订单", desc: "Scaled Order" },
];

/** Get price tick size based on price magnitude */
export function getPriceStep(price: number): number {
  if (price > 10000) return 0.1;
  if (price > 1000) return 0.01;
  if (price > 100) return 0.001;
  if (price > 10) return 0.0001;
  return 0.00001;
}
