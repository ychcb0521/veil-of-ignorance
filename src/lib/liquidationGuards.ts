/**
 * 强平判据的纯函数层。
 *
 * 为什么单独抽出来：强平是**不可逆的破坏性动作**——它删掉真实仓位、写死一条
 * LIQUIDATION 记录、没收保证金。这种代码必须能被单测逐条钉住，而不是埋在
 * 一个依赖 5 个 state 的 useEffect 里靠肉眼审。
 *
 * 本层的全部三条规则都**偏向「不强平」**。理由是两类错误的代价不对称：
 *   漏强平 → 用户多扛一会儿风险，下一帧价格到位就会正常强平；
 *   误强平 → 仓位没了、历史里多出一条假爆仓单，且不可撤销。
 */
import {
  MAINTENANCE_MARGIN_RATE,
  calcUnrealizedPnl,
  type Position,
} from '@/types/trading';
import { getPositionNotionalUsd, isPositionOpen } from '@/lib/tradingSettlement';

/**
 * 陈价容差的下限（模拟时间，毫秒）。
 * 背景行情每 1 秒真实时间刷一次，倍速越高一次轮询跨过的模拟时间越长，
 * 所以调用方按 max(本常量, speed × 轮询间隔) 放宽。
 * 真正要挡的是「跨日期回放」——那种价差是小时/天级，放宽多少都在容差之外。
 */
export const STALE_PRICE_MIN_TOLERANCE_MS = 60_000;

export function staleToleranceMs(speed: number): number {
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  // 5 秒真实时间 × 当前倍速：够覆盖一次轮询往返 + 节流，又远小于跨日期价差。
  return Math.max(STALE_PRICE_MIN_TOLERANCE_MS, s * 5_000);
}

/**
 * 这个价是不是「此刻的价」。
 *
 * priceMap 只是 Record<string, number>，**没有时间戳**，却被持久化进 localStorage、
 * 又被排除出云端同步（simStateSync 的 EXCLUDED_KEYS 里唯一一个）。于是上一段回放、
 * 上一个日期的价格会活过刷新、活过时间跳转，而强平判据此前唯一的护栏只有
 * `price > 0` —— 它挡得住「没有价」，挡不住「有一个属于别的时刻的价」。
 *
 * asOf 只在**真正发起过一次行情请求**的地方按请求所用的模拟时刻登记，
 * 所以「没登记过」= 说不清这个价属于哪一刻 = 一律不强平。
 */
export function isPriceFreshForLiquidation(
  priceAsOf: number | null | undefined,
  nowSim: number,
  toleranceMs: number,
): boolean {
  if (!Number.isFinite(nowSim) || nowSim <= 0) return false;
  if (priceAsOf == null || !Number.isFinite(priceAsOf)) return false;
  return Math.abs(nowSim - priceAsOf) <= Math.max(0, toleranceMs);
}

export type LiquidationSkipReason =
  | 'not_isolated'
  | 'no_position'
  | 'no_price'
  | 'stale_price'
  | 'bad_numbers'
  | 'solvent';

export type IsolatedLiquidationDecision =
  | { liquidate: false; reason: LiquidationSkipReason }
  | {
      liquidate: true;
      pnlUsd: number;
      notionalUsd: number;
      equityUsd: number;
      maintenanceUsd: number;
    };

/**
 * 逐仓强平的唯一判据。与此前内联版本相比有三处收紧，全部偏安全侧：
 *
 *   1. **价格必须对得上当前模拟时刻**，否则 stale_price —— 这是本次两个症状的根因。
 *   2. **零张 / 畸形仓位不产生强平事件**：notional ≤ 0 时旧代码会算出
 *      equity 0 ≤ maint 0，把一个根本不存在的仓位写成一条 quantity=0 的爆仓单。
 *   3. 比较写成**肯定式** `equity <= maint` 再取反。旧代码是 `if (equity > maint) continue`，
 *      任何 NaN 都会让 `>` 为假，于是一路掉进爆仓分支——NaN 的默认归宿是「爆仓」，
 *      这是反的。现在 NaN 落到 bad_numbers。
 */
export function evaluateIsolatedLiquidation(input: {
  symbol: string;
  position: Position;
  price: number;
  priceAsOf?: number | null;
  nowSim: number;
  toleranceMs: number;
}): IsolatedLiquidationDecision {
  const { symbol, position, price, priceAsOf, nowSim, toleranceMs } = input;

  if (position.marginMode !== 'isolated' || position.isolatedMargin == null) {
    return { liquidate: false, reason: 'not_isolated' };
  }
  if (!isPositionOpen(position)) return { liquidate: false, reason: 'no_position' };
  if (!Number.isFinite(price) || price <= 0) return { liquidate: false, reason: 'no_price' };
  if (!isPriceFreshForLiquidation(priceAsOf, nowSim, toleranceMs)) {
    return { liquidate: false, reason: 'stale_price' };
  }

  const notionalUsd = getPositionNotionalUsd(symbol, position, price);
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
    return { liquidate: false, reason: 'no_position' };
  }

  const pnlUsd = calcUnrealizedPnl(position, price);
  const equityUsd = position.isolatedMargin + pnlUsd;
  const maintenanceUsd = notionalUsd * MAINTENANCE_MARGIN_RATE;
  if (!Number.isFinite(equityUsd) || !Number.isFinite(maintenanceUsd)) {
    return { liquidate: false, reason: 'bad_numbers' };
  }
  if (!(equityUsd <= maintenanceUsd)) return { liquidate: false, reason: 'solvent' };

  return { liquidate: true, pnlUsd, notionalUsd, equityUsd, maintenanceUsd };
}
