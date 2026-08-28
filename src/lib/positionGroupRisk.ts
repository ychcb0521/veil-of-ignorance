import type { OrderSide, Position } from '@/types/trading';
import { calcLiquidationPrice } from '@/types/trading';
import { getSettlementMarginParts } from '@/lib/tradingSettlement';

/**
 * 合并持仓卡的风险读数。
 *
 * 同一标的同一方向的多笔仓位会并成一张卡，但**逐仓爆仓是逐仓位判的**：
 * 先死的是最弱的那一笔，不是"平均那一笔"。卡上此前显示的是把总量、总保证金、
 * 加权均价拼成一个**虚构的单仓位**再算出来的强平价（代码自己的注释写着
 * "approximation for merged"）——那个数既不是最先爆的，也不是最后爆的。
 *
 * 用户截图那张卡：104933 张、均价 0.147257、保证金 715173.97 RED、现价 0.154646。
 * 卡上写 0.134361（本模块能精确复现这个数）。但把它拆回两腿
 * （0.138395 / 0.156118，由 Σn/E 与 Σn·E 唯一确定），先死的那一腿在 **0.142494**。
 * 卡说还有 13.1% 空间，实际只有 7.9%——**低估的余量是现价的 5.26%**。
 * 那是"扛得住一根 10% 的针"和"扛不住"的区别。
 */

/** 一笔仓位的强平价；算不出来时返回 null（不返回 NaN，免得被当成数参与比较）。 */
export function positionLiquidationPrice(position: Position): number | null {
  const liq = calcLiquidationPrice(position);
  return Number.isFinite(liq) && liq > 0 ? liq : null;
}

/**
 * 一组仓位里**最先被强平**的那个价。
 *
 * 多单价格往下走，所以最先撞线的是强平价**最高**的那一笔；空单反之。
 * 全都算不出来时返回 null，由调用方显示 '--'，绝不编一个数。
 */
export function firstLiquidationPrice(positions: Position[], side: OrderSide): number | null {
  let out: number | null = null;
  for (const p of positions) {
    const liq = positionLiquidationPrice(p);
    if (liq == null) continue;
    if (out == null) out = liq;
    else out = side === 'LONG' ? Math.max(out, liq) : Math.min(out, liq);
  }
  return out;
}

/**
 * 开仓那一刻收的保证金（USD）——也就是"减少保证金"能减到的地板。
 *
 * 直接借 getSettlementMarginParts，两种结算方式一次说清，不在两处各推一遍公式：
 *   · 币本位 marginUsd = 名义 ÷ 杠杆，**与价无关**（price 在 coinMarginAmount
 *     与 coinAmountToUsd 之间精确约掉），所以喂 entryPrice 只是为了满足签名；
 *   · U 本位 marginUsd = 数量 × 开仓价 ÷ 杠杆。
 *
 * 此前币本位这条地板取的是 pos.margin —— 而 pos.margin 在开仓时就等于
 * 初始保证金、追加时又跟着一起涨，于是"可减 = 当前 − 地板"**恒为 0**：
 * 币本位仓位从开出来的那一刻起就减不掉任何保证金，不是"加过之后才不能减"。
 */
export function initialMarginUsd(symbol: string, position: Position): number {
  const price = position.entryPrice > 0 ? position.entryPrice : 0;
  if (!(price > 0)) return 0;
  const { marginUsd } = getSettlementMarginParts(symbol, position, price);
  return Number.isFinite(marginUsd) && marginUsd > 0 ? marginUsd : 0;
}

/** 当前占用的保证金（USD）。 */
export function currentMarginUsd(position: Position): number {
  const m = position.isolatedMargin ?? position.margin;
  return Number.isFinite(m) && m > 0 ? m : 0;
}

/**
 * 还能减掉多少（USD）。减到初始保证金为止——再往下就等于事后调高杠杆。
 *
 * ε 不是宽容额度，是防浮点残渣：币本位的地板走
 * 名义 ÷(价 × 杠杆) × 价 这条来回，52466 会算成 52465.99999999999，
 * 于是一笔从没加过保证金的仓位会显示「可减 7.3e-12」，
 * 并在等比摊分里分到一份皮克级的钱。按相对量取阈值，大仓位也吸得住。
 */
export function removableMarginUsd(symbol: string, position: Position): number {
  const initial = initialMarginUsd(symbol, position);
  const room = currentMarginUsd(position) - initial;
  const epsilon = Math.max(1e-6, Math.abs(initial) * 1e-9);
  return room > epsilon ? room : 0;
}

export function groupRemovableMarginUsd(symbol: string, positions: Position[]): number {
  return positions.reduce((sum, p) => sum + removableMarginUsd(symbol, p), 0);
}
