/**
 * 战役已实现盈亏的**唯一真源**。
 *
 * 在此之前系统里并存四套口径，同一场战役能算出四个不同的数：
 *   A 落库缓存 campaign.final_realized_pnl —— 每条腿只取「最后一刀」
 *   B Legs 表   —— 同样只取最后一刀，但 record 与 post_realized_pnl 的优先级与 A 相反
 *   C 盈亏概览  —— 把该仓位的每一刀都收进来求和，另有一条孤儿事件键会额外多计
 *   D 复盘 TXT  —— A 优先，否则 Σ post_realized_pnl
 * 于是详情页写「亏损结束」、盈亏概览却显示绿色的 +137363.90、Legs 三腿加起来又是另一个数。
 *
 * 分歧的机制不是「谁多算」，而是**同一个匹配规则被两种基数语义读**：
 *   buildTradeRecordLookup 把一个 positionId 折叠成「最新的那一条」record（多对一）
 *   而战役的 tradeRecords 过滤器保留该 positionId 名下的**每一条**（一对多）
 * 之所以两种键都要支持：实时「记录决策」的腿把 onPlaceOrder 返回的**仓位 id** 写进了
 * trade_record_id，回填的腿写的才是 **成交记录 id**。一个仓位分三刀平掉时，
 * 折叠语义只看得见第三刀，展开语义看得见三刀——差的就是前两刀的钱。
 *
 * 本模块把口径钉死为一条：
 *   **一场战役的已实现盈亏 = 归属于它的每一条结算记录（CLOSE / LIQUIDATION）的
 *   record.pnl 之和，按 record.id 去重，每条恰好计一次。**
 * 分批平仓的每一刀都算、镜像止盈落袋算（它就是主力仓位上的一刀）、资金费不算
 * （FUNDING 记录不带 positionId，无法归属到腿，并入会凭空改变盈亏比的分子）。
 *
 * 并且它同时产出 byLeg 与 total，两者按构造满足 Σ(byLeg) ≡ total ——
 * Legs 表画出来的合计因此恒等于盈亏概览的头条数字，界面本身就是一道断言。
 */
import type { CampaignStatus, TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import { buildTradeRecordPnlCorrection, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';

const EPSILON = 1e-9;

/** 只有结算记录才承载已实现盈亏；FUNDING 不进任何腿。 */
function isSettlementRecord(record: TradeRecord): boolean {
  return record.action === 'CLOSE' || record.action === 'LIQUIDATION';
}

/** 与 buildTradeRecordLookup 同一套「哪条更晚」的判据，避免两处对「收盘那一刀」理解不一致。 */
function recordRecency(record: TradeRecord): number {
  return record.closeTime || record.openTime || 0;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 盈亏的取数来源，用于界面标注与排查，不参与计算。 */
export type RealizedPnlBasis =
  | 'records'          // 全部腿都由成交记录结算——最可信
  | 'mixed'            // 部分腿有记录、部分腿只有复盘快照
  | 'leg_snapshots'    // 全部来自 post_realized_pnl（回填但本地无成交记录）
  | 'events'           // 无腿，只能从 actual_evolution 事件还原
  | 'campaign_summary' // 什么都没有，退回落库缓存
  | 'none';

export interface CampaignRealizedPnl {
  /** 本场已实现盈亏（USDT）。无法确定时为 null——绝不用 0 冒充「打平」。 */
  total: number | null;
  /** 每条腿分到的盈亏；该腿无记录也无快照时为 null。Σ(非 null) ≡ total。 */
  byLeg: Map<string, number | null>;
  /** 每条腿认领到的成交记录。一条记录最多被一条腿认领。 */
  recordsByLeg: Map<string, TradeRecord[]>;
  basis: RealizedPnlBasis;
  /** 全部腿都结算完毕——只有这时才应该回写落库值与结束状态。 */
  settled: boolean;
  /** 落库缓存值，用于对账。 */
  stored: number | null;
  /** 落库缓存 − 现算值。|drift| 超过容差说明存量数据尚未收敛。 */
  drift: number | null;
}

/**
 * 把成交记录认领给腿。分两档：
 *   1. 精确匹配 record.id === leg.trade_record_id（回填腿）
 *   2. 仅当精确匹配为空时，退到 record.positionId === leg.trade_record_id（实时快照腿），
 *      并把该仓位名下**全部**结算记录一并认领——「只算最后一刀」是明确的少计。
 * 一条记录最多被一条腿认领，避免同一笔钱被两条腿重复计。
 */
function claimRecordsByLeg(
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): Map<string, TradeRecord[]> {
  const settlement = tradeRecords.filter(isSettlementRecord);
  const claimed = new Set<string>();
  const result = new Map<string, TradeRecord[]>();

  // 先跑完所有腿的精确匹配，再跑仓位匹配：否则一条腿的仓位匹配会抢走
  // 另一条腿本该精确命中的记录，认领结果依赖腿的顺序。
  for (const leg of legs) {
    const ref = leg.trade_record_id;
    const exact = ref ? settlement.filter(r => r.id === ref) : [];
    for (const r of exact) claimed.add(r.id);
    result.set(leg.id, exact);
  }
  /**
   * 成交匹配夹在精确匹配与仓位匹配**之间**。
   *
   * 同向成交会并成一个仓位,平仓时按每笔成交各写一条记录,
   * 而 handlePlaceOrder 返回的是**这一笔成交自己的 id**——加仓那条腿存的就是它。
   * 没有这一级,加仓腿的 id 谁也匹配不上,而主力腿的仓位匹配会把**所有**分片一口吞掉:
   * 加仓在战役里既没有钱、也没有腿。
   */
  for (const leg of legs) {
    if ((result.get(leg.id) ?? []).length > 0) continue;
    const ref = leg.trade_record_id;
    if (!ref) continue;
    /**
     * `r.positionId !== ref` 这个条件不是冗余的,少了它加仓的钱会**静默蒸发**。
     *
     * 不变量 fills[0].id === position.id：主力那一片的 fillId 恰好**等于**仓位 id,
     * 而主力腿(实时快照腿)存的 ref 就是仓位 id。于是这一级会命中主力那一片、
     * 认领完就 return,下一级的仓位匹配被 `length > 0` 短路跳过——
     * 加仓那一片谁也认领不了,而 total 只累加各腿认领到的记录,那笔钱直接消失。
     *
     * 这一级只该处理**被吞并的成交**(加仓)：它们的 fillId 与所属仓位 id 不同。
     * ref 等于仓位 id 时让这一级自然落空,交回仓位匹配一口认领全部分片。
     */
    const byFill = settlement.filter(r =>
      r.fillId === ref && r.positionId !== ref && !claimed.has(r.id));
    if (byFill.length === 0) continue;
    for (const r of byFill) claimed.add(r.id);
    result.set(leg.id, byFill);
  }
  for (const leg of legs) {
    if ((result.get(leg.id) ?? []).length > 0) continue;
    const ref = leg.trade_record_id;
    if (!ref) continue;
    const byPosition = settlement.filter(r => r.positionId === ref && !claimed.has(r.id));
    for (const r of byPosition) claimed.add(r.id);
    result.set(leg.id, byPosition);
  }
  return result;
}

/** 事件兜底：只在完全没有腿时启用，按 event.id 去重。 */
function pnlFromEvents(campaign: Pick<TradeCampaign, 'actual_evolution'>): number | null {
  const seen = new Set<string>();
  let total: number | null = null;
  for (const event of campaign.actual_evolution ?? []) {
    const pnl = finite(event.realized_pnl);
    if (pnl == null || seen.has(event.id)) continue;
    seen.add(event.id);
    total = (total ?? 0) + pnl;
  }
  return total;
}

export function computeCampaignRealizedPnl(
  campaign: Pick<TradeCampaign, 'final_realized_pnl' | 'actual_evolution'>,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  exitPriceCorrections: LegExitPriceCorrections = {},
): CampaignRealizedPnl {
  const stored = finite(campaign.final_realized_pnl);
  const recordsByLeg = claimRecordsByLeg(legs, tradeRecords);
  const byLeg = new Map<string, number | null>();

  let fromRecords = 0;
  let fromSnapshots = 0;
  let total: number | null = null;

  for (const leg of legs) {
    const claimed = recordsByLeg.get(leg.id) ?? [];
    if (claimed.length > 0) {
      let sum = 0;
      for (const record of claimed) sum += finite(record.pnl) ?? 0;
      // 平仓价校正只改「这条腿收盘的那一刀」，不是每一刀都改：
      // 校正描述的是该腿的平仓价被错记，对应的是界面显示的那条成交（最晚的一条）。
      // 逐条叠加会把一次校正乘上刀数。
      const correction = exitPriceCorrections[leg.id];
      if (correction) {
        const closing = claimed.reduce((latest, r) => (recordRecency(r) > recordRecency(latest) ? r : latest), claimed[0]);
        const delta = buildTradeRecordPnlCorrection(closing, correction);
        if (delta) sum += delta.pnlDelta;
      }
      byLeg.set(leg.id, sum);
      total = (total ?? 0) + sum;
      fromRecords += 1;
      continue;
    }
    // 无成交记录的腿才退到复盘快照。引擎撮合出来的事实优先于人工回填。
    const snapshot = finite(leg.post_realized_pnl);
    byLeg.set(leg.id, snapshot);
    if (snapshot != null) {
      total = (total ?? 0) + snapshot;
      fromSnapshots += 1;
    }
  }

  // 兜底链一律是「腿 → 事件 → 落库缓存」，不因有没有腿而分叉：
  // 一条腿都没结算的战役（回填了腿但本地既无成交记录也无快照）仍应显示它落库的那个数，
  // 而不是判空或用 0 冒充打平。
  let basis: RealizedPnlBasis;
  if (fromRecords > 0 && fromSnapshots > 0) {
    basis = 'mixed';
  } else if (fromRecords > 0) {
    basis = 'records';
  } else if (fromSnapshots > 0) {
    basis = 'leg_snapshots';
  } else {
    total = pnlFromEvents(campaign);
    basis = total != null ? 'events' : 'none';
    if (total == null && stored != null) {
      total = stored;
      basis = 'campaign_summary';
    }
  }

  const settled = legs.length > 0 && legs.every(leg => byLeg.get(leg.id) != null);

  return {
    total,
    byLeg,
    recordsByLeg,
    basis,
    settled,
    stored,
    drift: stored == null || total == null ? null : stored - total,
  };
}

/**
 * 由已实现盈亏推出结束状态。状态与金额从此同源——
 * 「亏损结束」配一个绿色正数的情况在构造上不再可能。
 */
export function campaignStatusFromRealizedPnl(
  settlement: Pick<CampaignRealizedPnl, 'total' | 'settled'>,
  closedAt: string | null,
): CampaignStatus {
  if (!settlement.settled || !closedAt || settlement.total == null) return 'active';
  if (settlement.total > EPSILON) return 'closed_profit';
  if (settlement.total < -EPSILON) return 'closed_loss';
  return 'closed_breakeven';
}

/** 落库缓存与现算值是否已经偏离到需要提示用户的程度。 */
export function hasMaterialDrift(settlement: CampaignRealizedPnl): boolean {
  if (settlement.drift == null) return false;
  const scale = Math.max(Math.abs(settlement.stored ?? 0), Math.abs(settlement.total ?? 0));
  return Math.abs(settlement.drift) > Math.max(0.01, scale * 1e-6);
}
