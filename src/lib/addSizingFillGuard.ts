/**
 * 按计算器计划下的加仓**吃单成交**之后（市价 / 最优价，以及触发后按市价成交的条件委托），
 * 按**实际成交价**把 Plan B 再判一遍，超限就进消息中心。
 *
 * 计算器按预计成交价定量，Legs「加仓校验」按成交价判——两者之间还隔着计算器管不到的东西：
 * 关掉计算器到点下单之间基准价还会跳，量也可能没按计划下。
 * 所以成交那一刻就复判，把「成交价、参考价、滑点、超出多少币 / 多少张、减掉多少回到上限、超出从哪来」说出来，
 * 而不是等到战役页才看见一枚红叉。**只说，不拦**：单子已经成交，这里改不了也不该改。
 *
 * 只判**计算器那一侧**的加仓：单子必须带着同方向的计划（AddSizingSnapshot）。
 * 对冲侧的加码、镜像腿、没开计算器的第二刀都不是计算器授权的加仓——Legs 校验也不判它们，
 * 在这里按 Plan B 判只会喊出一句叫人去砍对冲的假警报。
 *
 * 状态一律取成交**之前**的：X₁ / S̄ 来自合并前仍持有的同向腿，S₁ 是那一刻盘口上亏损侧离成交价最近的反向委托
 * （与计算器、Legs 校验同一条规则；盘口没有就退到计划里的 S₁），G 走 detectBankedMirrorProfit。
 * 数学在 addSizing.evaluatePostFillAddSizing；这里只是读盘面 + 发消息。
 * 没有计划或没有同向持仓（首笔开仓、纯对冲）时立刻返回 null，不做任何计算——这条路径在每一笔市价单上都会走。
 *
 * 为什么不放进 addSizing.ts：hedgeLines.ts 依赖 addSizing.ts，读盘口对冲线的那一步放进去就成了循环依赖。
 *
 * 条件委托也在这里判：它在触发价上按同一个 calcSlippage 成交（Index 的条件单触发与后台撮合都传 isMaker = false）。
 * 突破加仓挂一张按「限价 @S₂」定量的条件单，就是 COMMONUSDT 那一场原样重演——参考价取触发价。
 * 三条成交路径（TradingContext 的市价 / 最优价、Index 的条件单触发、useBackgroundPrices 的后台撮合）
 * 都走 judgePlannedAddFill，门槛与口径只写一次。
 */
import {
  detectBankedMirrorProfit,
  evaluatePostFillAddSizing,
  formatSignedPct,
  readHeldPosition,
  type AddSide,
  type PostFillAddSizing,
} from '@/lib/addSizing';
import { getCoinMarginedContractSizeUsd, getSettlementAsset } from '@/lib/coinMargined';
import { PRE_MAIN_LOOKBACK_MS, pickBookLine, readHedgeLines } from '@/lib/hedgeLines';
import { toast } from '@/lib/notificationCenter';
import { getPositionNotionalUsd, isCoinSettled, isPositionOpen } from '@/lib/tradingSettlement';
import type { AddSizingSnapshot, PendingOrder, Position, TradeRecord } from '@/types/trading';

export interface MarketAddFillGuardInput {
  symbol: string;
  side: AddSide;
  /** 实际成交价（仓位的 entryPrice）。 */
  fillPrice: number;
  /** 这张单的下单参考价：市价 / 最优价 = 引擎拿去撮合的基准价（effectiveCurrentPrice），条件委托 = 触发价。 */
  referencePrice: number;
  /** 这一笔加进去的币量（币本位 = 张 × 面值 ÷ 成交价）。 */
  addCoins: number;
  /** 成交**之前**该标的的持仓（合并之前）。 */
  heldBefore: Position[] | undefined;
  ordersMap: Record<string, PendingOrder[]> | undefined;
  tradeHistory: TradeRecord[] | undefined;
  settlement: 'coin' | 'usdt';
  /** 这张单带着的计算器计划。没有、或方向不同，就不是计算器授权的加仓，不判。 */
  snapshot: AddSizingSnapshot | null | undefined;
}

export interface MarketAddFillVerdict extends PostFillAddSizing {
  symbol: string;
  side: AddSide;
  s1: number;
  /** S₁ 的来源：盘口对冲线，或计划里的 S₁。 */
  s1Source: 'book' | 'snapshot';
  x1: number;
  sBar: number;
  g: number;
  gUnit: string;
  fillPrice: number;
  referencePrice: number;
  /** 通知的标题 / 正文；未超限为 null。 */
  message: { title: string; description: string } | null;
}

const fmtPx = (v: number) => (!Number.isFinite(v) ? '—' : Math.abs(v) >= 1 ? v.toFixed(4) : v.toPrecision(6));
const fmtCoins = (v: number) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—');

/** 超出归因的一句话（与 Legs 校验 addSizingSnapshotLines 同一套判据与措辞）。 */
function causeSentence(verdict: PostFillAddSizing, snapshot: AddSizingSnapshot, s1: number, coinName: string): string {
  const a = verdict.attribution;
  if (!a) return '';
  switch (a.cause) {
    case 'slippage':
      return snapshot.orderKind === 'limit'
        ? ` 超出部分全部来自成交滑点 ${formatSignedPct(a.unexpectedSlippagePct)}（计划按限价 @S₂、不计滑点，这张却是吃单成交——市价单、条件委托触发后都按市价成交；这类单子该用计算器的「市价」或「条件单 @S₂」档定量）。`
        : ` 超出部分全部来自成交滑点 ${formatSignedPct(a.unexpectedSlippagePct)}（比计划预计的成交价 ${fmtPx(a.anchorPrice)} 更差）。`;
    case 'price_drift':
      if (snapshot.orderKind === 'limit') {
        return ` 超出来自下单价偏离计划挂单价 ${formatSignedPct(a.priceDriftPct)}（计划 ${fmtPx(a.planOrderPrice)}）：按下单时的价，上限只有 ${fmtCoins(a.limitAtAnchor)} ${coinName}——下单前该按新价重算。`;
      }
      return snapshot.orderKind === 'conditional'
        ? ` 超出来自触发价偏离计划触发价 ${formatSignedPct(a.priceDriftPct)}（计划 ${fmtPx(a.planOrderPrice)}）：按这张单的触发价，上限只有 ${fmtCoins(a.limitAtAnchor)} ${coinName}——改了触发价就该按新触发价重算。`
        : ` 超出来自计算后的价格变动 ${formatSignedPct(a.priceDriftPct)}（计算时 ${fmtPx(a.planOrderPrice)}）：按下单时的价，上限只有 ${fmtCoins(a.limitAtAnchor)} ${coinName}——下单前该按新价重算。`;
    case 'inputs':
      return ` 实际量在计算器的上限之内，差在计算器的输入与成交时的盘面不一致（计算器 S₁ ${fmtPx(snapshot.s1)}，盘面 S₁ ${fmtPx(s1)}；或 G / 旧仓变了）。`;
    case 'oversize':
    default:
      return ` 实际加仓比计算器的上限多 ${formatSignedPct(a.planOvershootPct)}——超出来自仓位本身，不是滑点。`;
  }
}

/**
 * 纯判定：读盘面、算数、组消息；**不**发通知。没有计划、没有同向持仓、读不到 S₁、算不出时返回 null。
 */
export function evaluateMarketAddFill(input: MarketAddFillGuardInput): MarketAddFillVerdict | null {
  const { symbol, side, fillPrice, referencePrice, addCoins, snapshot } = input;
  // 最便宜的两道门先过：不是按计算器下的这一侧，或没有同向持仓（不是加仓），都不判。
  if (!snapshot || snapshot.side !== side) return null;
  const held = input.heldBefore ?? [];
  if (!held.some(p => p && p.side === side)) return null;
  if (!(fillPrice > 0) || !(referencePrice > 0) || !(addCoins > 0)) return null;

  const face = getCoinMarginedContractSizeUsd(symbol);
  const summary = readHeldPosition(symbol, held, side, face);
  if (!summary) return null;

  const isCoin = input.settlement === 'coin';
  const book = readHedgeLines(
    symbol, input.ordersMap, held, side,
    (summary.earliestOpenTime ?? 0) - PRE_MAIN_LOOKBACK_MS,
    input.settlement, face,
  );
  const line = pickBookLine(book.candidates, side, fillPrice);
  const s1 = line?.price ?? (snapshot.s1 > 0 ? snapshot.s1 : null);
  if (s1 == null) return null;

  const banked = detectBankedMirrorProfit(symbol, side, input.tradeHistory, summary.earliestOpenTime, held,
    { earliestOpenedRealAt: summary.earliestOpenedRealAt });
  const g = isCoin ? banked.coin : banked.usd;
  const verdict = evaluatePostFillAddSizing({
    side, settlement: input.settlement, sBar: summary.avgEntry, s1, x1: summary.coins, g,
    s2Ref: referencePrice, s2Fill: fillPrice, addCoins, contractFaceUsd: isCoin ? face : null,
    plan: snapshot,
  });
  if (!verdict) return null;

  const coinName = getSettlementAsset(symbol);
  let message: MarketAddFillVerdict['message'] = null;
  if (verdict.overLimit) {
    const contractsText = verdict.excessContracts != null ? `（${verdict.excessContracts.toLocaleString('en-US')} 张）` : '';
    const zeroLimit = !(verdict.limitAtFill > 0);
    message = {
      title: zeroLimit
        ? '加仓成交后复判：Plan B 上限为 0，这一刀没有覆盖'
        : `加仓成交后复判：超出 Plan B 上限 ${formatSignedPct(verdict.overshootPct)}`,
      description:
        `${symbol} ${side === 'LONG' ? '多' : '空'}：成交 ${fmtPx(fillPrice)}，参考价 ${fmtPx(referencePrice)}，滑点 ${formatSignedPct(verdict.slippagePct)}；`
        + `按成交价上限 ${fmtCoins(verdict.limitAtFill)} ${coinName}，实际加 ${fmtCoins(addCoins)}，`
        + `超出 ${fmtCoins(verdict.excessCoins)} ${coinName}${contractsText}——减掉这么多即回到上限之内。`
        + causeSentence(verdict, snapshot, s1, coinName)
        + ` S₁ ${fmtPx(s1)}${line ? '（盘口对冲线）' : '（计划里的 S₁）'}。`,
    };
  }
  return {
    ...verdict,
    symbol, side, s1, s1Source: line ? 'book' : 'snapshot',
    x1: summary.coins, sBar: summary.avgEntry, g, gUnit: isCoin ? coinName : 'USD',
    fillPrice, referencePrice, message,
  };
}

/**
 * 成交路径调用的入口：判定 + 超限时发一条 warning 到消息中心（弹不弹由用户的「弹出通知」开关决定）。
 * 返回判定结果供测试 / 记录；从不抛错——这条路径上任何异常都不该影响已经成交的单子。
 */
export function judgeMarketAddFill(input: MarketAddFillGuardInput): MarketAddFillVerdict | null {
  try {
    const verdict = evaluateMarketAddFill(input);
    if (verdict?.message) toast.warning(verdict.message.title, { description: verdict.message.description });
    return verdict;
  } catch (error) {
    console.error('[加仓成交复判] 判定失败', error);
    return null;
  }
}

export interface PlannedAddFillInput {
  symbol: string;
  /** 这一笔成交产出的仓位（合并之前）：成交价、量、结算方式都从它读。 */
  position: Position;
  /** 这张单的下单参考价：市价 / 最优价 = 引擎基准价，条件委托 = 触发价。 */
  referencePrice: number;
  /** 成交**之前**该标的的持仓（合并之前）。 */
  heldBefore: Position[] | undefined;
  ordersMap: Record<string, PendingOrder[]> | undefined;
  tradeHistory: TradeRecord[] | undefined;
  /** 这张单带着的计算器计划。 */
  snapshot: AddSizingSnapshot | null | undefined;
}

/**
 * 成交路径的统一入口：只判**带着同方向计划、且成交前已有同向仓位**的吃单成交——
 * 没有计划、对冲侧、首笔开仓在头两道门就返回，几乎不花时间。加仓量按引擎名义 ÷ 成交价折币。
 */
export function judgePlannedAddFill(input: PlannedAddFillInput): MarketAddFillVerdict | null {
  const { symbol, position, snapshot } = input;
  if (!snapshot || !position || snapshot.side !== position.side) return null;
  const heldBefore = (input.heldBefore ?? []).filter(p => p && p.side === position.side && isPositionOpen(p));
  if (heldBefore.length === 0) return null;
  const fillPrice = position.entryPrice;
  const notional = fillPrice > 0 ? getPositionNotionalUsd(symbol, position, fillPrice) : 0;
  return judgeMarketAddFill({
    symbol, side: position.side, fillPrice, referencePrice: input.referencePrice,
    addCoins: fillPrice > 0 ? notional / fillPrice : 0,
    heldBefore: input.heldBefore, ordersMap: input.ordersMap, tradeHistory: input.tradeHistory,
    settlement: isCoinSettled(position) ? 'coin' : 'usdt', snapshot,
  });
}
