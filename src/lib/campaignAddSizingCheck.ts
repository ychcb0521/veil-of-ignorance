/**
 * Legs 表「加仓校验」列：每一笔加仓的仓位大小是否合规。
 *
 * 规则来自加仓计算器（addSizing.ts）与使用说明 3.4 —— 镜像止盈落袋后统一按 Plan B 判：
 *   Y₁        加仓那一刻仍持有的旧仓，退回 S₁ 时的净浮盈（逐腿按剩余币量计算，可为负）
 *   G         本轮持仓加仓之前已经落袋的净已实现盈亏
 *   加仓合规 ⇔ Y₁ + G ≥ X₂ (S₂ − S₁)（主多；主空符号翻转）
 * 即「价格退回 S₁ 时，旧仓浮盈垫 + 已落袋镜像止盈足以抹平新加仓最大预期亏损」。
 *
 * 每次加仓都必须重算 Y₁：更早的加仓若在新 S₁ 上浮亏，会以负数进入 Y₁，
 * 自然扣掉此前已经动用的垫子；已平掉的部分则转入 G，因而不会重复花同一笔利润。
 *
 * **手续费不计**，与计算器一致：这一列校验的是仓位几何，不是净额。
 *
 * S₁ 从哪来：腿上不存加仓的止损价（pre_planned_stop_loss 已弃用），
 * 只能读加仓那一刻挂着的反向委托——对冲 @ S₁ 就是那张反向单的挂单价。
 * 反向委托列表与 Legs 表收到的是**同一份**（盘面上隐藏掉的不算），
 * 页面与导出 PNG 各自调用本函数、喂同样的输入，两处读数不可能打架。
 *
 * **旧仓与落袋一律按成交记录逐刀读，不看腿的「平仓时刻」。**
 * 同向成交在引擎里合并成一个仓位，止盈那一刀按成交占比拆到主力、镜像各一条记录；
 * 腿上解析出来的平仓时刻只是**最后一刀**。按它判「加仓时还开着」，
 * 00:36 已经落袋的镜像会被当成整腿持有：利润进不了 G，已平掉的几百万币还留在浮盈垫里。
 * 所以：加仓时刻 t 持有的币量 = 开仓币量 − Σ(t 之前平掉的刀)，落袋 = Σ(t 之前那几刀的盈亏)。
 *
 * **同一条判据走两条路再对账。** 上面的垫子式之外，再按加仓后综合成本线算一遍：
 * 成本线越过 S₁ 的那一段折成钱、减掉 G 就是缺口——展开即 X₂·险 − Y₁ − G，与垫子式恒等。
 * 成本线由计算器那边的 evaluatePostAddCostLine 算，与这里的逐刀账本是两套代码；
 * 两条路对不上（某个数错了单位 / 符号，或哪里改坏了）就既不给 ✓ 也不给 ✗，标成 unknown 把两个数都摆出来。
 *
 * **S₂ 一律按成交价判，计算器的快照只用来解释。** COMMONUSDT 那一场：用户严格按计算器上限下单，
 * 这里却判超限 1.57% / 3.70%——计算器读的是下单前的盘面价，市价单按 0.01% + 名义/50亿 滑点成交，
 * 而（张数 / 名义）上限对 S₂ 的弹性是 S₁/(S₂ − S₁) ≈ 十几倍。判定不能改：真正的风险就在成交价上。
 * 但成交记录带着计算器当时的计划（record.addSizingSnapshot）时，这里把它原样交出去，再按**本函数自己的**
 * Y₁ + G 与判定同一个容差，走 attributeAddExcess 说清超出从哪来：
 *   计划价（市价计划已含预计滑点）→ 下单价（计算后价格变动）→ 成交价（比预计多出来的滑点）。
 * 只有按下单时的价、计入计划预计的滑点仍合规，才说「超出部分全部来自成交滑点」；
 * 量本身超过计划、或计算后价格变了，各说各的，不拿滑点顶罪。
 * 没有快照就什么也不多说：腿上的 pre_entry_price 不能当下单前的价用——
 * syncTradeRecordCorrectionToJournals 与历史回填都把它改写成 record.entryPrice（成交价）。
 */
import {
  attributeAddExcess,
  evaluatePostAddCostLine,
  formatSignedPct,
  type AddExcessAttribution,
} from '@/lib/addSizing';
import {
  buildTradeRecordPnlCorrection,
  resolveLegExecution,
  tradeRecordNotionalAt,
  type LegExitPriceCorrections,
} from '@/lib/campaignLegExecution';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { PRE_MAIN_LOOKBACK_MS } from '@/lib/campaignReverseOrderAttribution';
import {
  buildTradeRecordLookup,
  journalCloseOperationTime,
  journalOpenOperationTime,
} from '@/lib/objectiveOperationTime';
import type { TradeJournal } from '@/types/journal';
import type { AddSizingSnapshot, CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

export type AddSizingStatus = 'ok' | 'fail' | 'unknown';

export type AddSizingUnknownReason =
  | 'no_direction'          // 腿没有多空方向
  | 'no_open_time'          // 加仓开仓时刻缺失
  | 'no_entry_price'        // 加仓价 S₂ 缺失或非正
  | 'no_position_size'      // 加仓名义缺失或非正，推不出 X₂
  | 'no_stop_line'          // 加仓那一刻没有挂在亏损侧的反向委托，S₁ 无从读起
  | 'old_leg_incomplete'    // 旧仓里有腿缺开仓价 / 名义 / 时刻，浮盈垫算不准
  | 'non_finite'            // 算出来的数不是有限数
  | 'self_check_mismatch';  // 垫子式与成本线式两套算法对不上——不给对错号，只摆出两个数

export interface AddSizingVerdict {
  status: AddSizingStatus;
  reason?: AddSizingUnknownReason;
  /** S₁ 止损 / 对冲线（反向委托挂单价） */
  s1: number | null;
  /** S₂ 加仓价 */
  s2: number | null;
  /** X₁ 加仓那一刻仍持有的同向旧仓币量（含更早的加仓；已部分平掉的只算剩下的） */
  x1Coins: number | null;
  /** X₂ 本次加仓币量 = 名义 ÷ S₂（与 Legs「币量」列同一个算式） */
  x2Coins: number | null;
  /**
   * Y₁ 浮盈垫 = Σ 旧腿剩余币量 × (S₁ − 开仓价) × d。
   * 这是加仓当下的旧仓净浮盈，可为负；与 G 一起参与 Plan B 判定。
   */
  cushion: number | null;
  /**
   * G 本轮持仓在加仓之前可用于 Plan B 的已落袋净额（USDT；币本位按 S₁ 折算）。
   * 正向只认镜像止盈 / tp1；同一轮里先前已经实现的亏损从中扣掉——花掉的 G 不能再花一次。
   */
  banked: number | null;
  /** 旧仓在 S₁ 的浮亏绝对额，仅作诊断明细；正式判定使用有正有负的 cushion 净额。 */
  consumedByHeld: number | null;
  /** 新腿退回 S₁ 的最大预期亏损 = X₂ × (S₂ − S₁) × d */
  maxLoss: number | null;
  /** Plan B 可用垫子 = cushion + banked；合规 ⇔ required ≥ maxLoss */
  required: number | null;
  /** 每加 1 币从 S₂ 退回 S₁ 的预期亏损（USDT / 币） */
  riskPerCoin: number | null;
  /** Plan B 允许的最大加仓币量；required ≤ 0 时为 0 */
  maxAllowedCoins: number | null;
  /** 最大加仓币量按 S₂ 折算的 U 本位名义仓位 */
  maxAllowedNotional: number | null;
  /** fail 时差多少（USDT）= maxLoss − required；ok 为 0；unknown 为 null（self_check_mismatch 时仍给垫子式的数，供对照） */
  shortfall: number | null;
  /** 加仓后综合成本线 C = (Σ 旧腿币量 × 开仓价 + X₂S₂) ÷ (X₁ + X₂)——成本线式复核的中间量 */
  blendedCost: number | null;
  /**
   * 成本线式算出的缺口 = max(0, (X₁ + X₂)(C − S₁)·d − G)。与 shortfall（垫子式）在代数上恒等；
   * 两者对不上即 self_check_mismatch，两个数都留在这里供诊断。
   */
  costLineShortfall: number | null;
  /** 成交记录带着的计算器计划（下单那一刻的输入与输出）；老记录 / 没经计算器的单子为 null。 */
  snapshot: AddSizingSnapshot | null;
  /** 本函数自己的 Y₁ + G 在快照参考价 S₂（市价计划 = 现价、限价计划 = 手填限价、条件委托 = 触发价，不计滑点）上给出的上限（币）；没有快照或参考价没有风险距离为 null。 */
  snapshotLimitAtRef: number | null;
  /** 实际成交价相对**这张单的下单参考价**（快照的 s2AtOrder，缺省为计划的下单价）的偏移（%），带符号。 */
  fillSlippagePct: number | null;
  /** 只因成交价偏离快照参考价 S₂ 而少掉的额度：snapshotLimitAtRef ÷ maxAllowedCoins − 1（%）。 */
  slippageOvershootPct: number | null;
  /** 判超限时超出从哪来（attributeAddExcess）；合规、无法判断或没有快照时为 null。 */
  excess: AddExcessAttribution | null;
  /** excess.cause === 'slippage'：超出部分全部来自成交滑点。合规或没有快照时为 null。 */
  withinSnapshotLimit: boolean | null;
}

export interface CampaignAddSizingInput {
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  legExitPriceCorrections?: LegExitPriceCorrections;
  /** 与 Legs 表收到的同一份可见反向委托 */
  reverseHedgeOrders?: CampaignReverseHedgeOrder[];
}

/**
 * 开仓名义 ÷ 开仓价与各刀记录数量之间有舍入 / 滑点差：平完之后剩不到开仓币量的 1%，视为已经平完，
 * 否则一条早就收掉的腿会带着一点尘埃永远「开着」，把本轮持仓的起点一路往前拖。
 */
const CLOSED_DUST_RATIO = 0.01;

/** 构成「旧仓」的角色：主力、再入场主力、其他加仓、镜像多单。对冲腿方向相反，不进浮盈垫。 */
function isMainSideRole(role: TradeJournal['leg_role']): boolean {
  return role === 'main_open'
    || role === 'reentry_main'
    || role === 'mirror_tp'
    || (role ?? '').startsWith('main_add_');
}

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function realTime(value: unknown): number | null {
  const time = finite(value);
  return time != null && time > 0 ? time : null;
}

function sequence(leg: TradeJournal): number {
  return leg.leg_sequence ?? Number.MAX_SAFE_INTEGER;
}

/** 与 campaignRealizedPnl 同一个「哪一刀最晚」的判据：平仓价校正只落在这一刀上。 */
function recordRecency(record: TradeRecord): number {
  return record.closeTime || record.openTime || 0;
}

/**
 * 委托在哪一刻失效：已触发的看触发时刻（没记就退到平仓 / 撤单时刻），其余看撤单时刻。
 * null = 到现在还挂着。
 */
function orderEnd(order: CampaignReverseHedgeOrder): number | null {
  if (order.status === 'triggered') return order.triggeredAt ?? order.cancelledAt ?? null;
  return order.cancelledAt ?? null;
}

function unknown(reason: AddSizingUnknownReason, partial: Partial<AddSizingVerdict> = {}): AddSizingVerdict {
  return {
    s1: null, s2: null, x1Coins: null, x2Coins: null,
    cushion: null, banked: null, consumedByHeld: null, maxLoss: null, required: null,
    riskPerCoin: null, maxAllowedCoins: null, maxAllowedNotional: null, shortfall: null,
    blendedCost: null, costLineShortfall: null,
    snapshot: null, snapshotLimitAtRef: null, fillSlippagePct: null, slippageOvershootPct: null, excess: null, withinSnapshotLimit: null,
    ...partial,
    status: 'unknown',
    reason,
  };
}

/** 币本位一张合约的毛盈亏折成币：名义 × (1/开仓价 − 1/平仓价)，与 tradeRecordGrossPnlAtExit ÷ 平仓价同一个数。 */
function coinGrossAtExit(record: TradeRecord, exitPrice: number): number | null {
  const contracts = Math.max(0, Number(record.contracts ?? record.quantity ?? 0));
  const notionalUsd = contracts * Math.max(0, Number(record.contractSizeUsd ?? 10));
  if (!(notionalUsd > 0) || !positive(record.entryPrice) || !positive(exitPrice)) return null;
  return record.side === 'LONG'
    ? notionalUsd * (1 / record.entryPrice - 1 / exitPrice)
    : notionalUsd * (1 / exitPrice - 1 / record.entryPrice);
}

/** 一刀：什么时候平的、平掉多少币、落袋多少（USD 与币本位的币数，后者按 S₁ 估值时用）。 */
interface LegCut {
  time: number;
  /** 真实钱包时钟；有持仓操作起点时，用它排除别次回放的落袋。 */
  operationTime: number | null;
  /** 正利润只有镜像止盈 / tp1 才能成为 G；其他来源的盈利不混入 Plan B。 */
  mirrorProfit: boolean;
  coins: number | null;
  usd: number | null;
  coin: number | null;
}

/** 一条同向主力侧腿的逐刀账本。 */
interface LegLedger {
  leg: TradeJournal;
  open: number | null;
  /** 这笔成交真实发生的时刻；老记录没有。 */
  openOperationTime: number | null;
  entry: number | null;
  /** 开仓币量 = 名义 ÷ 开仓价（与 Legs「币量」列同一个算式）；缺价或缺名义为 null */
  coins: number | null;
  /** 按时刻排好的平仓刀；没有成交记录的腿退到复盘快照，当作一刀整平 */
  cuts: LegCut[];
  /** 腿上记着的平仓时刻（复盘快照）；有记录的腿只拿它判「最后一刀之后确实平完了」 */
  journalClose: number | null;
}

function buildLedger(
  leg: TradeJournal,
  execution: ReturnType<typeof resolveLegExecution>,
  records: TradeRecord[],
  snapshotUsd: number | null,
  corrections: LegExitPriceCorrections,
): LegLedger {
  const open = execution.openTime;
  const recordOpenTimes = records.map(record => realTime(record.openedRealAt));
  const openOperationTime = records.length > 0 && recordOpenTimes.every((time): time is number => time != null)
    ? Math.min(...recordOpenTimes)
    : journalOpenOperationTime(leg);
  const entry = execution.entryPrice;
  const coins = positive(entry) && positive(leg.pre_position_size) ? leg.pre_position_size / entry : null;
  const journalClose = resolveLegExecution(leg, null, corrections).closeTime;

  if (records.length === 0) {
    const close = execution.closeTime;
    return {
      leg, open, openOperationTime, entry, coins, journalClose,
      cuts: close == null ? [] : [{
        time: close,
        operationTime: journalCloseOperationTime(leg),
        mirrorProfit: leg.leg_role === 'mirror_tp',
        coins,
        usd: snapshotUsd,
        coin: null,
      }],
    };
  }

  // 平仓价校正只改这条腿收盘的那一刀——与 byLeg / Legs「盈亏」列同一条规则
  const correction = corrections[leg.id];
  const closing = records.reduce((latest, r) => (recordRecency(r) > recordRecency(latest) ? r : latest), records[0]);
  const cuts = records.map((record): LegCut => {
    // 币本位按记录判，记录没写才看腿：事件还原出来的腿 pre_settlement_mode 一律是 null
    const coinSettled = (record.settlementMode ?? leg.pre_settlement_mode) === 'coin';
    const sized = coinSettled && !record.settlementMode ? { ...record, settlementMode: 'coin' as const } : record;
    const closedCoins = positive(record.entryPrice) ? tradeRecordNotionalAt(sized) / record.entryPrice : null;
    let usd = finite(record.pnl);
    let coin = coinSettled ? finite(record.pnlCoin) : null;
    const delta = correction && record === closing ? buildTradeRecordPnlCorrection(sized, correction) : null;
    if (delta) {
      usd = (usd ?? 0) + delta.pnlDelta;
      if (coin != null) {
        const before = coinGrossAtExit(sized, correction!.originalExitPrice);
        const after = coinGrossAtExit(sized, correction!.exitPrice);
        // 折不出币数时宁可退回校正后的 USD，也不拿没校正的币数去估值
        coin = before != null && after != null ? coin + (after - before) : null;
      }
    }
    return {
      time: record.closeTime,
      operationTime: realTime(record.closedRealAt),
      // 有成交记录就只认记录上的退出方式，与计算器 detectBankedMirrorProfit 同一判据。
      // 不能再看 leg_role：引擎把同向成交合并成一个仓位，手动 / 止损减仓按成交占比拆到每一笔，
      // 镜像腿因此会分到一片正利润——那不是镜像止盈，混进 G 会让 Legs 比计算器多放出上千币。
      // leg_role 兜底只留给没有记录、只剩复盘快照的腿（见上方 records.length === 0 分支）。
      mirrorProfit: record.exit_method === 'tp1',
      coins: finite(closedCoins),
      usd,
      coin,
    };
  }).sort((a, b) => a.time - b.time);
  return { leg, open, openOperationTime, entry, coins, cuts, journalClose };
}

/** t 时刻（含）之前平掉的币量；有一刀读不出币数就返回 null。 */
function closedCoinsBy(ledger: LegLedger, t: number): number | null {
  let sum = 0;
  for (const cut of ledger.cuts) {
    if (cut.time > t) break;
    if (cut.coins == null) return null;
    sum += cut.coins;
  }
  return sum;
}

/** 到 t 时刻（含）为止这条腿是否已经平完。之后还有刀的腿一定还开着。 */
function closedBy(ledger: LegLedger, t: number): boolean {
  if (ledger.cuts.length === 0 || ledger.cuts.some(cut => cut.time > t)) return false;
  if (ledger.journalClose != null && ledger.journalClose <= t) return true;
  const closed = closedCoinsBy(ledger, t);
  // 开仓币量或刀的币数读不出来：有刀、之后再没有刀，只能按平完处理
  if (ledger.coins == null || closed == null) return true;
  return ledger.coins - closed <= ledger.coins * CLOSED_DUST_RATIO;
}

/** 腿最终平完的时刻；到现在还开着为 +∞。 */
function ledgerEnd(ledger: LegLedger): number {
  const last = ledger.cuts.at(-1)?.time ?? null;
  return last != null && closedBy(ledger, Math.max(last, ledger.journalClose ?? last)) ? last : Number.POSITIVE_INFINITY;
}

/**
 * 读加仓那一刻的止损线 S₁。
 *
 * 候选 = 加仓时刻 t 仍挂着的反向委托（createdAt ≤ t < 失效时刻）∪ 加仓之后 5 分钟内挂出的——
 * 先加仓、随手补对冲（或把旧止损撤掉换一张更近的）是常见节奏，
 * 窗口与委托归属加仓行的预挂缓冲同一口径（PRE_MAIN_LOOKBACK_MS）。
 * 不能「有挂着的就不看补挂的」：那样一张马上要撤的旧止损会顶替刚补上的新线，
 * 把合规的加仓标成大红叉。
 * 亏损侧才算止损（多：价 < S₂）；有多张时离 S₂ 最近的那张先被打到，它才是生效的那条线。
 */
function resolveStopLine(
  orders: CampaignReverseHedgeOrder[],
  hedgeSide: CampaignReverseHedgeOrder['side'],
  t: number,
  s2: number,
  d: 1 | -1,
): number | null {
  const candidates = orders.filter(order => {
    if (order.side !== hedgeSide || !Number.isFinite(order.createdAt)) return false;
    if (!positive(order.price) || (s2 - order.price) * d <= 0) return false;
    if (order.createdAt > t) return order.createdAt <= t + PRE_MAIN_LOOKBACK_MS;
    const end = orderEnd(order);
    return end == null || end > t;
  });
  if (candidates.length === 0) return null;
  // 多：最高的那张；空：最低的那张
  return candidates.reduce((best, order) => ((order.price - best) * d > 0 ? order.price : best), candidates[0].price);
}

export function evaluateCampaignAddSizing(input: CampaignAddSizingInput): Map<string, AddSizingVerdict> {
  const { legs, tradeRecords } = input;
  const corrections = input.legExitPriceCorrections ?? {};
  const orders = input.reverseHedgeOrders ?? [];
  const result = new Map<string, AddSizingVerdict>();
  const addLegs = legs.filter(leg => (leg.leg_role ?? '').startsWith('main_add_'));
  if (addLegs.length === 0) return result;

  const recordMap = buildTradeRecordLookup(tradeRecords);
  // 每条腿认领哪几刀、快照盈亏是多少，走已实现盈亏的唯一真源，与 Legs「贡献 / 盈亏」列同源
  const settlement = computeCampaignRealizedPnl(
    { final_realized_pnl: null, actual_evolution: [] },
    legs,
    tradeRecords,
    corrections,
  );
  // 时刻与价格一律取 resolveLegExecution——与这一行渲染的「开 / 平 / 开仓价」严格同源
  const executions = new Map(legs.map(leg => {
    const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
    return [leg.id, resolveLegExecution(leg, record, corrections)] as const;
  }));
  const ledgers = new Map(legs.filter(leg => isMainSideRole(leg.leg_role)).flatMap(leg => {
    const records = settlement.recordsByLeg.get(leg.id) ?? [];
    const snapshotUsd = settlement.byLeg.get(leg.id) ?? null;
    /**
     * 没触发的镜像止盈是一张**挂单**，不是一笔持仓：appendUntriggeredMirrorTpLeg 合成的那条腿
     * 没有成交、没有盈亏，开仓价还是止盈触发价。把它当旧仓会凭空拿触发价算出一大块负浮盈垫。
     */
    if (leg.leg_role === 'mirror_tp' && !leg.trade_record_id && records.length === 0 && snapshotUsd == null) return [];
    return [[leg.id, buildLedger(leg, executions.get(leg.id)!, records, snapshotUsd, corrections)] as const];
  }));

  for (const add of addLegs) {
    if (add.direction !== 'long' && add.direction !== 'short') {
      result.set(add.id, unknown('no_direction'));
      continue;
    }
    const d: 1 | -1 = add.direction === 'short' ? -1 : 1;
    const execution = executions.get(add.id)!;
    const t = execution.openTime;
    const s2 = execution.entryPrice;
    if (t == null || !Number.isFinite(t)) {
      result.set(add.id, unknown('no_open_time'));
      continue;
    }
    if (!positive(s2)) {
      result.set(add.id, unknown('no_entry_price'));
      continue;
    }
    if (!positive(add.pre_position_size)) {
      result.set(add.id, unknown('no_position_size', { s2 }));
      continue;
    }
    const x2Coins = add.pre_position_size / s2;
    // 反向委托列表目前只收空单，主空战役读不到 S₁，自然落到 no_stop_line
    const s1 = resolveStopLine(orders, d > 0 ? 'SHORT' : 'LONG', t, s2, d);
    if (s1 == null) {
      result.set(add.id, unknown('no_stop_line', { s2, x2Coins }));
      continue;
    }

    const sameSide = [...ledgers.values()].filter(ledger => ledger.leg.id !== add.id && ledger.leg.direction === add.direction);

    /**
     * 本轮持仓从哪一刻开始：从 t 往回，把与之重叠的同向腿一条条接上，直到接不上为止。
     * 与计算器 detectBankedMirrorProfit 的「不早于当前持仓最早开仓」同一个意思——
     * 止损出局、空仓一段再重新入场，上一轮落袋的止盈与止损都不是这一轮的 G。
     */
    let holdingStart = t;
    for (let extended = true; extended;) {
      extended = false;
      for (const ledger of sameSide) {
        if (ledger.open != null && ledger.open < holdingStart && ledgerEnd(ledger) > holdingStart) {
          holdingStart = ledger.open;
          extended = true;
        }
      }
    }

    /**
     * 模拟时钟会在多次回放间撞车，所以能拿到完整盖章时，再加一道真实操作时间窗口：
     * 下界取「加仓当下仍持有的旧仓」最早真实开仓时刻；上界取本次加仓的真实开仓时刻。
     * 任一持仓腿缺盖章就退回模拟口径，绝不拿较新的那条腿冒充整轮起点。
     */
    const heldAtAdd = sameSide.filter(ledger => {
      if (ledger.open == null) return false;
      const openedBefore = ledger.open < t || (ledger.open === t && sequence(ledger.leg) < sequence(add));
      return openedBefore && !closedBy(ledger, t);
    });
    const heldOperationTimes = heldAtAdd.map(ledger => ledger.openOperationTime);
    const holdingStartOperation = heldOperationTimes.length > 0
      && heldOperationTimes.every((time): time is number => time != null)
      ? Math.min(...heldOperationTimes)
      : null;
    const addOperationTime = realTime(execution.record?.openedRealAt) ?? journalOpenOperationTime(add);

    let x1Coins = 0;
    let cushion = 0;
    /** Σ 旧腿剩余币量 × 开仓价：成本线式复核要的旧仓成本，与 cushion 分开累加、不互相借数 */
    let costBasis = 0;
    let consumedByHeld = 0;
    let banked = 0;
    let incomplete = false;
    for (const ledger of sameSide) {
      // 落袋 G：只把本轮镜像止盈 / tp1 的正利润记作垫子；任何已实现亏损都要扣掉，
      // 但普通减仓或手动平仓的正利润不能混进来冒充镜像止盈。
      for (const cut of ledger.cuts) {
        if (cut.time < holdingStart || cut.time > t) continue;
        if (holdingStartOperation != null) {
          // 真实起点可知时，没有操作时间的老刀、以及早于本轮持仓的别次回放，一律不进 G。
          if (cut.operationTime == null || cut.operationTime < holdingStartOperation) continue;
          if (addOperationTime != null && cut.operationTime > addOperationTime) continue;
        }
        // 币本位：落袋是币，按 S₁ 估值——与计算器币本位条件两边同乘 S₁ 等价
        const realized = cut.coin != null ? cut.coin * s1 : cut.usd ?? 0;
        if (realized > 0 && !cut.mirrorProfit) continue;
        banked += realized;
      }

      // 旧仓：加仓时刻仍持有的部分。同一刻开出的，按 leg_sequence 排在前面的才算旧仓。
      if (ledger.open == null) {
        if (!closedBy(ledger, t)) incomplete = true;
        continue;
      }
      const openedBefore = ledger.open < t || (ledger.open === t && sequence(ledger.leg) < sequence(add));
      if (!openedBefore || closedBy(ledger, t)) continue;
      const closed = closedCoinsBy(ledger, t);
      if (!positive(ledger.entry) || ledger.coins == null || closed == null) {
        incomplete = true;
        continue;
      }
      const coins = Math.max(0, ledger.coins - closed);
      const pnlAtS1 = coins * (s1 - ledger.entry) * d;
      x1Coins += coins;
      costBasis += coins * ledger.entry;
      cushion += pnlAtS1;
      // 不对称：在 S₁ 是浮盈的腿不抵扣任何东西，浮亏的腿按亏损占用落袋
      consumedByHeld += Math.max(0, -pnlAtS1);
    }

    const riskPerCoin = Math.max(0, (s2 - s1) * d);
    const maxLoss = Math.max(0, x2Coins * riskPerCoin);
    const required = cushion + banked;
    // “正确加仓”不是一个新的拍脑袋目标，而是 Plan B 的数学上限：低于它都合规，超过它就会失去覆盖。
    // X₂ 是币量；乘回 S₂ 才是交易面板里常见的 U 名义仓位。两种单位一起给，避免把币当 U 下单。
    const maxAllowedCoins = riskPerCoin > 0 ? Math.max(0, required) / riskPerCoin : null;
    const maxAllowedNotional = maxAllowedCoins == null ? null : maxAllowedCoins * s2;

    /**
     * 成本线式：同一条判据换一条路。加仓后综合成本线越过 S₁ 的那一段折成钱，减掉 G 就是缺口。
     * X₁ = 0（旧仓在加仓前已全部平掉、只剩落袋）时成本线就是 S₂，S̄ 不参与。
     */
    const post = evaluatePostAddCostLine({
      side: d > 0 ? 'LONG' : 'SHORT',
      sBar: x1Coins > 0 ? costBasis / x1Coins : Number.NaN,
      s1, s2, x1: x1Coins, addCoins: x2Coins,
    });
    const blendedCost = post?.blendedCost ?? Number.NaN;
    const costLineGap = post ? (x1Coins + x2Coins) * (post.blendedCost - s1) * d - banked : Number.NaN;
    // 容差只吸收浮点误差：取满计算器 Plan B 上限的加仓应判 ok，而不是差 1e-9 被判 fail；两条路对账用同一条容差
    const tolerance = Math.max(0.01, 1e-6 * Math.max(Math.abs(required), maxLoss));
    const ledgerGap = maxLoss - required;
    const costLineShortfall = costLineGap > tolerance ? costLineGap : 0;
    /**
     * 计算器的计划只作解释、不参与判定。方向对不上、价不全的快照不认。
     * 归因用**本函数**的 Y₁ + G 与同一个容差：某个价上「合规」= 这笔量在那个价上的最大亏损 − (Y₁ + G) ≤ 容差。
     * 这笔量在别的价上是多少币：币本位张数不变、币数 = 名义 ÷ 价；U 本位币数不变。
     */
    const snapshot = execution.record?.addSizingSnapshot ?? null;
    const usableSnapshot = snapshot && snapshot.side === (d > 0 ? 'LONG' : 'SHORT')
      && positive(snapshot.s2Ref) && positive(snapshot.s2Fill) ? snapshot : null;
    const addCoinSettled = (execution.record?.settlementMode ?? add.pre_settlement_mode) === 'coin';
    const coinsAt = (px: number) => (addCoinSettled ? add.pre_position_size! / px : x2Coins);
    const riskAt = (px: number) => Math.max(0, (px - s1) * d);
    const limitAt = (px: number) => (riskAt(px) > 0 ? Math.max(0, required) / riskAt(px) : Number.POSITIVE_INFINITY);
    const fitsAt = (px: number) => coinsAt(px) * riskAt(px) - required <= tolerance;
    const snapshotRefRisk = usableSnapshot ? riskAt(usableSnapshot.s2Ref) : 0;
    const snapshotLimitAtRef = usableSnapshot && snapshotRefRisk > 0 ? Math.max(0, required) / snapshotRefRisk : null;
    const slippageOvershootPct = snapshotLimitAtRef != null && maxAllowedCoins != null && maxAllowedCoins > 0
      ? (snapshotLimitAtRef / maxAllowedCoins - 1) * 100
      : null;
    const failing = !(required >= maxLoss - tolerance);
    const excess = usableSnapshot && failing
      ? attributeAddExcess({ plan: usableSnapshot, fillPrice: s2, coinsAt, limitAt, fitsAt })
      : null;
    const snapshotOrderPrice = usableSnapshot
      ? (positive(usableSnapshot.s2AtOrder) ? usableSnapshot.s2AtOrder : (usableSnapshot.orderKind === 'limit' ? usableSnapshot.s2Fill : usableSnapshot.s2Ref))
      : null;
    const fillSlippagePct = snapshotOrderPrice != null ? (s2 / snapshotOrderPrice - 1) * 100 : null;
    const withinSnapshotLimit = usableSnapshot && failing ? excess?.cause === 'slippage' : null;
    const partial = {
      s1, s2, x1Coins, x2Coins, cushion, banked, consumedByHeld, maxLoss, required,
      riskPerCoin, maxAllowedCoins, maxAllowedNotional, blendedCost, costLineShortfall,
      snapshot: usableSnapshot, snapshotLimitAtRef, fillSlippagePct, slippageOvershootPct, excess, withinSnapshotLimit,
    };
    if (incomplete) {
      result.set(add.id, unknown('old_leg_incomplete', partial));
      continue;
    }
    if (![x1Coins, cushion, banked, consumedByHeld, maxLoss, required, riskPerCoin, maxAllowedCoins, maxAllowedNotional, blendedCost, costLineGap].every(Number.isFinite)) {
      result.set(add.id, unknown('non_finite', partial));
      continue;
    }
    if (!(Math.abs(ledgerGap - costLineGap) <= tolerance)) {
      // 两条路给出的数分开了：不猜哪条对，把垫子式的缺口也留下，读屏 / 诊断能看到两个数
      result.set(add.id, unknown('self_check_mismatch', { ...partial, shortfall: ledgerGap > tolerance ? ledgerGap : 0 }));
      continue;
    }
    if (required >= maxLoss - tolerance) {
      result.set(add.id, { status: 'ok', ...partial, shortfall: 0 });
    } else {
      result.set(add.id, { status: 'fail', ...partial, shortfall: ledgerGap });
    }
  }
  return result;
}

/** 缺口金额：千位以上取整带千分位（「缺 3,789,250」），以下保留两位。页面与导出图共用。 */
export function formatAddSizingShortfall(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Math.abs(value) >= 1000
    ? Math.round(value).toLocaleString('en-US')
    : value.toFixed(2);
}

/** Plan B 公式里的 X 是币量：大币量留两位，小币量多留几位，避免显示成 0。 */
export function formatAddSizingCoinQuantity(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  const maximumFractionDigits = absolute >= 1_000 ? 2 : absolute >= 1 ? 4 : 8;
  return value.toLocaleString('en-US', { maximumFractionDigits });
}

/** 交易面板使用的 U 名义仓位统一保留两位。 */
export function formatAddSizingNotional(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 读屏 / aria-label 用的完整说明。页面不挂悬浮框（用户要求撤掉 Legs 单元格的提示框）。 */
const UNKNOWN_REASON_TEXT: Record<AddSizingUnknownReason, string> = {
  no_direction: '加仓腿没有多空方向',
  no_open_time: '加仓价、名义或时刻缺失',
  no_entry_price: '加仓价、名义或时刻缺失',
  no_position_size: '加仓价、名义或时刻缺失',
  no_stop_line: '加仓时没有挂在亏损侧的反向委托，读不到止损线 S₁',
  old_leg_incomplete: '旧仓有腿缺开仓价或名义，浮盈垫算不准',
  non_finite: '计算结果不是有限数',
  self_check_mismatch: '两种算法结果不一致',
};

export function describeAddSizingVerdict(verdict: AddSizingVerdict): string {
  const n = (value: number | null) => (value == null ? '—' : `${value.toFixed(2)} U`);
  if (verdict.status === 'unknown') {
    const reason = verdict.reason ? UNKNOWN_REASON_TEXT[verdict.reason] : '加仓价、名义或时刻缺失';
    // 两套算法对不上时把两个缺口都念出来——它们本该是同一个数
    const routes = verdict.reason === 'self_check_mismatch'
      ? `（垫子式缺口 ${n(verdict.shortfall)}、成本线式缺口 ${n(verdict.costLineShortfall)}）`
      : '';
    return `加仓校验：无法判断——${reason}${routes}`;
  }
  // 与点开红叉后的计算框同一套写法：可用额在 max(0,·) 处截断，金额带单位
  const detail = `退回 S₁ ${verdict.s1 ?? '—'} 时，旧仓浮盈垫 Y₁ ${n(verdict.cushion)} + 已落袋 G ${n(verdict.banked)}，可用 max(0, Y₁ + G) = ${n(verdict.required == null ? null : Math.max(0, verdict.required))}；新加仓最大亏损 ${n(verdict.maxLoss)}；Plan B 加仓上限 ${formatAddSizingCoinQuantity(verdict.maxAllowedCoins)} 币（${formatAddSizingNotional(verdict.maxAllowedNotional)} U 名义仓位）`;
  if (verdict.status === 'ok') return `加仓校验：仓位合规。${detail}`;
  const snapshotText = describeAddSizingSnapshot(verdict);
  return `加仓校验：仓位过大，缺 ${n(verdict.shortfall)}。${detail}${snapshotText ? `。${snapshotText}` : ''}`;
}

/** 带符号百分比：+0.14% / −0.14%；不足 0.005% 时多给两位，不把真实的偏差写成 +0.00%。 */
export function formatAddSizingSignedPct(value: number | null | undefined): string {
  return formatSignedPct(value);
}

export interface AddSizingSnapshotLines {
  /**
   * 「计算时 现价 …，预计成交 …（+0.14%），上限 … 币」。s2Ref 按计划的下单方式称呼：
   * 市价计划是引擎基准价（现价）；限价计划是手填的限价（盘面价不在快照里，不能叫它现价）；条件委托是触发价。
   */
  calc: string;
  /** 「下单时 参考价 …（计算后价格变动 +x%）」——下单价与计划的下单价不同才有。 */
  order: string | null;
  /** 「实际成交 …（+0.14%），上限 … 币」——括号里是相对这张单下单参考价的滑点。 */
  actual: string;
  /** 「超出部分全部来自成交滑点 +x%」——只在判超限、且按下单时的价计入计划预计的滑点仍合规时有。 */
  slippage: string | null;
  /** 判超限但不是滑点：计算后价格变动 / 输入不一致 / 量本身超过计划，各一句。 */
  cause: string | null;
}

const fmtSnapshotPx = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1 ? v.toFixed(4) : v.toPrecision(6));

/**
 * 快照的几行话。页面弹窗、PNG、读屏三处同一段文字，各自只决定怎么摆。
 * 原因只在判超限时给，判据见 attributeAddExcess：只有真是滑点才点名滑点。
 */
export function addSizingSnapshotLines(verdict: AddSizingVerdict): AddSizingSnapshotLines | null {
  const snap = verdict.snapshot;
  if (!snap) return null;
  const px = fmtSnapshotPx;
  const limitPlan = snap.orderKind === 'limit';
  // 条件委托的计划：参考价是触发价，触发后按市价成交——与市价计划同一条链，只是措辞换成触发价
  const conditionalPlan = snap.orderKind === 'conditional';
  // s2Ref 的称呼跟着下单方式走：只有市价计划的 s2Ref 是计算那一刻的盘面价
  const refWord = limitPlan ? '限价' : conditionalPlan ? '触发价' : '现价';
  const excess = verdict.status === 'fail' ? verdict.excess : null;
  const planOrderPrice = limitPlan ? snap.s2Fill : snap.s2Ref;
  const orderPrice = positive(snap.s2AtOrder) ? snap.s2AtOrder : planOrderPrice;
  const drifted = Math.abs(orderPrice / planOrderPrice - 1) > 1e-9;
  // 下单价与计划的下单价不同：市价计划是计算后价格变了；限价计划是挂单价没挂在计划的价上（手改、或取整取反了方向）；
  // 条件委托计划是触发价没挂在计划的价上
  const driftWord = limitPlan ? '下单价偏离计划挂单价' : conditionalPlan ? '触发价偏离计划触发价' : '计算后价格变动';
  let slippage: string | null = null;
  let cause: string | null = null;
  switch (excess?.cause) {
    case 'slippage':
      slippage = `超出部分全部来自成交滑点 ${formatSignedPct(excess.unexpectedSlippagePct)}`
        + (limitPlan ? '（计划按限价、不计滑点，这张却是吃单成交）' : `（比计划预计的成交价 ${px(excess.anchorPrice)} 更差）`);
      break;
    case 'price_drift':
      cause = `超出来自${limitPlan ? '下单价偏离计划挂单价' : conditionalPlan ? '触发价偏离计划触发价' : '计算后的价格变动'} ${formatSignedPct(excess.priceDriftPct)}：按下单时的价，上限只有 ${formatAddSizingCoinQuantity(excess.limitAtAnchor)} 币——`
        + (limitPlan
          ? '限价要挂在计划的价上（多头只能更低、空头只能更高）'
          : conditionalPlan ? '触发价要挂在计划的价上，改了触发价就按新触发价重算' : '下单前该按新价重算');
      break;
    case 'inputs':
      cause = `实际量在计算器的上限之内，差在计算器的输入与这里读到的不一致（计算器 S₁ ${px(snap.s1)}，校验 S₁ ${px(verdict.s1)}；或 G / 旧仓不同）`;
      break;
    case 'oversize':
      cause = `实际加仓比计算时的上限多 ${formatSignedPct(excess.planOvershootPct)}——超出来自仓位本身，不是滑点`;
      break;
    default:
      break;
  }
  return {
    calc: `计算时 ${refWord} ${px(snap.s2Ref)}，${limitPlan ? '挂单价' : '预计成交'} ${px(snap.s2Fill)}（${limitPlan ? '限价' : formatSignedPct(snap.slippagePct)}），上限 ${formatAddSizingCoinQuantity(snap.addCoinsMax)} 币`,
    order: drifted ? `下单时 参考价 ${px(orderPrice)}（${driftWord} ${formatSignedPct((orderPrice / planOrderPrice - 1) * 100)}）` : null,
    actual: `实际成交 ${px(verdict.s2)}（${formatSignedPct(verdict.fillSlippagePct)}），上限 ${formatAddSizingCoinQuantity(verdict.maxAllowedCoins)} 币`,
    slippage,
    cause,
  };
}

/** 几行话连成一句，给读屏 / aria-label。 */
export function describeAddSizingSnapshot(verdict: AddSizingVerdict): string {
  const lines = addSizingSnapshotLines(verdict);
  if (!lines) return '';
  const reason = lines.slippage ?? lines.cause;
  return `${lines.calc}；${lines.order ? `${lines.order}；` : ''}${lines.actual}${reason ? `。${reason}` : ''}`;
}
