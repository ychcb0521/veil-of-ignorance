/**
 * 加仓计算器的数学层 —— 使用说明 3.4「加仓量：浮盈垫锁死」的可执行版本。
 *
 * 刻意分成**两本账**，互不掺和：
 *
 * A 本账 · 浮盈垫（computeCushionAdd）
 *   平衡式 X₁ (S₁ − S̄) = X₂ (S₂ − S₁)：旧腿在止损线上的浮盈 = 新腿跌回止损线的亏损，
 *   整场在 S₁ 归零。X₂ = X₁ ÷ b，b = (S₂ − S₁)/(S₁ − S̄)，1/(1+b) = P₀。
 *   对冲 X_h = X₁ + X₂，扛起它保护的全部仓位。
 *   **落袋的镜像利润永远不进这本账**——它是已实现的钱，不是浮盈垫。
 *
 * B 本账 · 落袋镜像（computeBankedAdd）
 *   镜像止盈已落袋 G。用它再开一条腿 X₂ᴮ，这条腿允许有风险敞口，因为亏的是利润：
 *   给它自己的零风险线 K_B，使 **X₂ᴮ 从 S₂ 跌到 K_B 恰好亏掉 G**。
 *     U 本位：X₂ᴮ = G ÷ |S₂ − K_B|
 *     币本位：G 以币计、按 K_B 估值，X₂ᴮ = G·K_B ÷ |S₂ − K_B|
 *   两个旋钮互为反函数：定线 K_B 推出仓 X₂ᴮ，定仓 X₂ᴮ 推出线 K_B。
 *   K_B 可以低于 S₁（多头）——「零风险线可以更低」说的就是它；
 *   此时跌到 S₁ 只吃掉 G 的一部分（consumedAtS1 / exposureAtS1），其余留作缓冲。
 *   G = 0 时这本账整个关闭，A 本账一字不变 —— 这是「不影响原有逻辑」的保证。
 *
 * 读持仓默认值的工具（legOpeningCoins / weightedEntryByCoins / coinsToContracts）
 * 与本场落袋检测（detectBankedMirrorProfit）也放在这里，供计算器预填。
 */
import type { Position, SettlementMode, TradeRecord } from '@/types/trading';
import { getPositionNotionalUsd } from '@/lib/tradingSettlement';

export type AddSide = 'LONG' | 'SHORT';

function fin(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// ===================== A 本账 · 浮盈垫 =====================

export interface CushionAddInput {
  side: AddSide;
  /** S̄ 开仓均价（全部既有腿的综合成本） */
  sBar: number;
  /** S₁ 新止损 / 对冲线 */
  s1: number;
  /** S₂ 加仓价 */
  s2: number;
  /** X₁ 既有币量（按各腿开仓价折算，= 名义 ÷ 开仓均价） */
  x1: number;
}

export type CushionAddProblem = 'invalid_input' | 's1_not_past_cost' | 's2_not_past_s1';

export interface CushionAddResult {
  ok: boolean;
  problem: CushionAddProblem | null;
  /** 浮盈垫距离 |S₁ − S̄| */
  cushionDistance: number;
  /** 新腿风险距离 |S₂ − S₁| */
  riskDistance: number;
  /** 浮盈垫 USD = X₁ × 浮盈垫距离 */
  cushion: number;
  /** b = 风险距离 ÷ 垫子距离 */
  b: number;
  /** P₀ = 1/(1+b)：止损线走过 [S̄, S₂] 的比例 = 新腿占比 */
  p0: number;
  /** X₂ 锁死上限（币）；无效时为 0 */
  x2Max: number;
  x2MaxNotional: number;
  /** 取满 X₂ 时加仓后综合成本（恒等于 S₁） */
  blendedCostAfter: number;
  /** 对冲 X_h = X₁ + X₂ 及其在 S₁ 的名义 */
  hedgeCoinsAtS1: number;
  hedgeNotionalAtS1: number;
}

function cushionFail(problem: CushionAddProblem): CushionAddResult {
  return {
    ok: false, problem,
    cushionDistance: Number.NaN, riskDistance: Number.NaN, cushion: Number.NaN,
    b: Number.NaN, p0: Number.NaN,
    x2Max: 0, x2MaxNotional: 0,
    blendedCostAfter: Number.NaN, hedgeCoinsAtS1: Number.NaN, hedgeNotionalAtS1: Number.NaN,
  };
}

export function computeCushionAdd(input: CushionAddInput): CushionAddResult {
  const { sBar, s1, s2, x1 } = input;
  if (!fin(sBar) || !fin(s1) || !fin(s2) || !fin(x1) || sBar <= 0 || s1 <= 0 || s2 <= 0 || x1 <= 0) {
    return cushionFail('invalid_input');
  }
  const d = input.side === 'SHORT' ? -1 : 1;
  const cushionDistance = (s1 - sBar) * d;
  const riskDistance = (s2 - s1) * d;
  if (!(cushionDistance > 0)) return cushionFail('s1_not_past_cost');
  if (!(riskDistance > 0)) return cushionFail('s2_not_past_s1');

  const cushion = x1 * cushionDistance;
  const b = riskDistance / cushionDistance;
  const p0 = cushionDistance / (cushionDistance + riskDistance);
  const x2Max = x1 / b;
  const hedgeCoinsAtS1 = x1 + x2Max;
  return {
    ok: true, problem: null,
    cushionDistance, riskDistance, cushion, b, p0,
    x2Max, x2MaxNotional: x2Max * s2,
    blendedCostAfter: (x1 * sBar + x2Max * s2) / hedgeCoinsAtS1,
    hedgeCoinsAtS1, hedgeNotionalAtS1: hedgeCoinsAtS1 * s1,
  };
}

// ===================== B 本账 · 落袋镜像 =====================

export type BankedKnob =
  | { kind: 'line'; kB: number }   // 定线：B 腿自己的零风险线
  | { kind: 'size'; x2: number };  // 定仓：B 腿的币量

export interface BankedAddInput {
  side: AddSide;
  settlement: SettlementMode;
  /** 已落袋的镜像利润：U 本位为 USD，币本位为币 */
  g: number;
  /** S₂ 加仓价 */
  s2: number;
  /** S₁ A 本账的止损线，用来衡量 B 腿在那里吃掉多少落袋 */
  s1: number;
  knob: BankedKnob;
}

export type BankedAddProblem =
  | 'disabled'           // 没有落袋，或旋钮没给数
  | 'kB_not_below_s2'    // 多头：K_B 在 S₂ 上方（盈利侧）
  | 'kB_not_above_s2'    // 空头：K_B 在 S₂ 下方（盈利侧）
  | 'x2_not_positive'
  | 'x2_not_above_g';    // 币本位空头：X₂ᴮ 必须大于 G（币）才能解出 K_B

export interface BankedAddResult {
  ok: boolean;
  problem: BankedAddProblem | null;
  /** B 腿币量 X₂ᴮ */
  x2: number;
  x2Notional: number;
  /** B 腿自己的零风险线 */
  kB: number;
  /** 价格跌到 S₁ 时 B 腿吃掉的落袋（与 G 同单位） */
  consumedAtS1: number;
  /** G − consumedAtS1：跌到 S₁ 仍留在口袋里的部分 */
  residualAtS1: number;
  /** consumedAtS1 ÷ G：0 = 完全不动落袋，1 = 在 S₁ 刚好花光，>1 = 超支 */
  exposureAtS1: number;
  /** K_B 是否越过 S₁ 到更保守的一侧（多头更低 / 空头更高） */
  kBBeyondS1: boolean;
}

function bankedFail(problem: BankedAddProblem): BankedAddResult {
  return {
    ok: false, problem,
    x2: Number.NaN, x2Notional: Number.NaN, kB: Number.NaN,
    consumedAtS1: Number.NaN, residualAtS1: Number.NaN, exposureAtS1: Number.NaN,
    kBBeyondS1: false,
  };
}

export function computeBankedAdd(input: BankedAddInput): BankedAddResult {
  const { g, s1, s2, knob } = input;
  if (!fin(g) || g <= 0 || !fin(s1) || !fin(s2) || s1 <= 0 || s2 <= 0) return bankedFail('disabled');
  const d = input.side === 'SHORT' ? -1 : 1;
  const coin = input.settlement === 'coin';

  let x2: number;
  let kB: number;
  if (knob.kind === 'line') {
    if (!fin(knob.kB) || knob.kB <= 0) return bankedFail('disabled');
    kB = knob.kB;
    const dist = (s2 - kB) * d;                 // B 腿从加仓价到自己线的距离
    if (!(dist > 0)) return bankedFail(d > 0 ? 'kB_not_below_s2' : 'kB_not_above_s2');
    // U 本位：x2·dist = g。币本位：x2·dist/kB = g（以币计的亏损）。
    x2 = coin ? (g * kB) / dist : g / dist;
  } else {
    if (!fin(knob.x2)) return bankedFail('disabled');
    x2 = knob.x2;
    if (!(x2 > 0)) return bankedFail('x2_not_positive');
    if (!coin) {
      kB = s2 - d * (g / x2);
    } else if (d > 0) {
      // x2(s2 − kB)/kB = g → kB = x2·s2/(x2 + g)
      kB = (x2 * s2) / (x2 + g);
    } else {
      // x2(kB − s2)/kB = g → kB = x2·s2/(x2 − g)，要求 x2 > g
      if (!(x2 > g)) return bankedFail('x2_not_above_g');
      kB = (x2 * s2) / (x2 - g);
    }
  }

  const distS1 = (s2 - s1) * d;                 // 从加仓价到 A 线的距离（可能 ≤ 0，照算）
  const consumedAtS1 = coin ? (x2 * distS1) / s1 : x2 * distS1;
  return {
    ok: true, problem: null,
    x2, x2Notional: x2 * s2, kB,
    consumedAtS1,
    residualAtS1: g - consumedAtS1,
    exposureAtS1: consumedAtS1 / g,
    kBBeyondS1: (s1 - kB) * d > 0,
  };
}

// ===================== 从盘面读默认值 =====================

export interface OpeningCoinsSource {
  settlementMode?: SettlementMode | null;
  quantity?: number | null;
  contracts?: number | null;
  contractSizeUsd?: number | null;
  entryPrice: number;
}

/**
 * 一条腿开仓时的币量。U 本位：数量本身就是币量；
 * 币本位：张数 × 面值 ÷ 开仓价 —— 按**开仓价**折，不是按标记价。
 */
export function legOpeningCoins(leg: OpeningCoinsSource, defaultFaceUsd: number): number {
  if (!fin(leg.entryPrice) || leg.entryPrice <= 0) return 0;
  if (leg.settlementMode === 'coin') {
    const face = fin(leg.contractSizeUsd) && (leg.contractSizeUsd as number) > 0 ? (leg.contractSizeUsd as number) : defaultFaceUsd;
    const contracts = fin(leg.contracts) ? (leg.contracts as number) : 0;
    return (contracts * face) / leg.entryPrice;
  }
  return fin(leg.quantity) ? (leg.quantity as number) : 0;
}

/** 按币量加权的开仓均价；空集返回 0。 */
export function weightedEntryByCoins(legs: Array<{ coins: number; entryPrice: number }>): number {
  let coins = 0;
  let value = 0;
  for (const leg of legs) {
    if (!fin(leg.coins) || !fin(leg.entryPrice) || leg.coins <= 0) continue;
    coins += leg.coins;
    value += leg.coins * leg.entryPrice;
  }
  return coins > 0 ? value / coins : 0;
}

/** 币量 → 整张：四舍五入；只要币量为正至少 1 张；0 给 0。 */
export function coinsToContracts(coins: number, price: number, faceUsd: number): number {
  if (!fin(coins) || coins <= 0 || !fin(price) || price <= 0 || !fin(faceUsd) || faceUsd <= 0) return 0;
  return Math.max(1, Math.round((coins * price) / faceUsd));
}

export interface HeldPositionSummary {
  side: AddSide;
  /** X₁ = Σ 各腿开仓币量 */
  coins: number;
  notionalUsd: number;
  /** S̄ = 名义 ÷ X₁（U 本位即数量加权均价，币本位即名义加权调和均价） */
  avgEntry: number;
  legCount: number;
  /** 最早一条腿的开仓时间（模拟时钟），用于框定「本场」 */
  earliestOpenTime: number | null;
}

/** 把某标的某方向的所有未平仓位折成公式要的 (X₁, S̄)。 */
export function readHeldPosition(
  symbol: string,
  positions: Position[] | undefined,
  side: AddSide,
  defaultFaceUsd: number,
): HeldPositionSummary | null {
  const legs = (positions ?? []).filter(p => p && p.side === side);
  if (legs.length === 0) return null;
  const rows: Array<{ coins: number; entryPrice: number }> = [];
  let notional = 0;
  let earliest: number | null = null;
  for (const p of legs) {
    const coins = legOpeningCoins(p, defaultFaceUsd);
    if (!(coins > 0)) continue;
    rows.push({ coins, entryPrice: p.entryPrice });
    notional += Math.abs(getPositionNotionalUsd(symbol, p, p.entryPrice));
    if (fin(p.openTime) && (p.openTime as number) > 0) {
      earliest = earliest == null ? (p.openTime as number) : Math.min(earliest, p.openTime as number);
    }
  }
  const coins = rows.reduce((s, r) => s + r.coins, 0);
  if (!(coins > 0)) return null;
  return {
    side, coins, notionalUsd: notional,
    avgEntry: weightedEntryByCoins(rows),
    legCount: legs.length, earliestOpenTime: earliest,
  };
}

/** 主仓打法先看多头；没有多头才退到空头；都没有返回 null。 */
export function pickHeldSide(symbol: string, positions: Position[] | undefined, defaultFaceUsd: number): HeldPositionSummary | null {
  return readHeldPosition(symbol, positions, 'LONG', defaultFaceUsd)
    ?? readHeldPosition(symbol, positions, 'SHORT', defaultFaceUsd);
}

export interface BankedMirrorProfit {
  /** 以 USD 计的落袋合计（U 本位 B 本账用它） */
  usd: number;
  /** 以币计的落袋合计（币本位 B 本账用它）：优先取成交记录的 pnlCoin，缺失时按平仓价折算 */
  coin: number;
  count: number;
}

/**
 * 本场已落袋的镜像止盈：同标的、同方向、以「止盈1」平掉、且不早于当前最早一条持仓的开仓时间。
 * 没有持仓就没有「本场」可言，返回 0，不把历史上所有止盈都算进来。
 * 这是建议值——界面上要用户点一下才填进 G。
 */
export function detectBankedMirrorProfit(
  symbol: string,
  side: AddSide,
  tradeHistory: TradeRecord[] | undefined,
  earliestOpenTime: number | null,
): BankedMirrorProfit {
  if (earliestOpenTime == null) return { usd: 0, coin: 0, count: 0 };
  let usd = 0;
  let coin = 0;
  let count = 0;
  for (const r of tradeHistory ?? []) {
    if (!r || r.symbol !== symbol || r.side !== side) continue;
    if (r.action !== 'CLOSE' || r.exit_method !== 'tp1') continue;
    if (!((r.closeTime ?? 0) >= earliestOpenTime)) continue;
    if (!fin(r.pnl)) continue;
    usd += r.pnl;
    coin += fin(r.pnlCoin)
      ? (r.pnlCoin as number)
      : (fin(r.exitPrice) && (r.exitPrice as number) > 0 ? r.pnl / (r.exitPrice as number) : 0);
    count += 1;
  }
  return { usd, coin, count };
}
