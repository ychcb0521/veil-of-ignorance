/**
 * 加仓计算器的数学层 —— 使用说明 3.4「Plan B：当前垫子 + 已落袋利润」的可执行版本。
 *
 * A / B 分开展示是为了看清垫子的来源；镜像止盈已经落袋后，真正的加仓上限统一用 Plan B：
 * 当前仍持有旧仓在 S₁ 的净浮盈 Y₁ + 本轮已落袋 G，共同覆盖新腿退回 S₁ 的最大亏损。
 * 每次加仓都用当前 X₁ / S̄ 重算 Y₁，因此更早加仓在新 S₁ 上的浮亏会自动扣回，不会重复花垫子。
 *
 * A 本账 · 浮盈垫（computeCushionAdd）
 *   平衡式 X₁ (S₁ − S̄) = X₂ (S₂ − S₁)：旧腿在止损线上的浮盈 = 新腿跌回止损线的亏损，
 *   整场在 S₁ 归零。X₂ = X₁ ÷ b，b = (S₂ − S₁)/(S₁ − S̄)。
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
  /**
   * 无解时给出「要成立还差什么」的具体门槛，而不是只说一句「不行」：
   *   s1_not_past_cost → S₁ 至少要越过 S̄（主多 > S̄、主空 < S̄）
   *   s2_not_past_s1   → S₂ 至少要越过 S₁
   * 有解时为 null。
   */
  needed: { field: 'S₁' | 'S₂'; mustBe: 'above' | 'below'; threshold: number; gap: number } | null;
  /** 浮盈垫距离 |S₁ − S̄| */
  cushionDistance: number;
  /** 新腿风险距离 |S₂ − S₁| */
  riskDistance: number;
  /** 浮盈垫 USD = X₁ × 浮盈垫距离 */
  cushion: number;
  /** b = 风险距离 ÷ 垫子距离 */
  b: number;
  /**
   * 1/(1+b)：止损线走过 [S̄, S₂] 的比例，恒等于新腿在加仓后仓位里的占比 X₂/(X₁+X₂)。
   * 字段名沿用 p0 是历史原因，**它不是盘面 P_gap 的 P₀**——那个是「现价→目标」的首达概率，
   * 这个是「成本线→止损线」的几何占比，两者取值无关，界面上不要并称。
   */
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

function cushionFail(problem: CushionAddProblem, needed: CushionAddResult['needed'] = null): CushionAddResult {
  return {
    ok: false, problem, needed,
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
  if (!(cushionDistance > 0)) {
    return cushionFail('s1_not_past_cost', {
      field: 'S₁', mustBe: d > 0 ? 'above' : 'below', threshold: sBar, gap: Math.abs(sBar - s1),
    });
  }
  if (!(riskDistance > 0)) {
    return cushionFail('s2_not_past_s1', {
      field: 'S₂', mustBe: d > 0 ? 'above' : 'below', threshold: s1, gap: Math.abs(s1 - s2),
    });
  }

  const cushion = x1 * cushionDistance;
  const b = riskDistance / cushionDistance;
  const p0 = cushionDistance / (cushionDistance + riskDistance);
  const x2Max = x1 / b;
  const hedgeCoinsAtS1 = x1 + x2Max;
  return {
    ok: true, problem: null, needed: null,
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

// ===================== Plan B · 当前旧仓浮盈垫 + 本轮落袋 =====================

export interface PlanBCoverageInput {
  side: AddSide;
  settlement: SettlementMode;
  sBar: number;
  s1: number;
  s2: number;
  x1: number;
  /** U 本位为 USD，币本位为结算币数量。负数按 0。 */
  g: number;
}

export interface PlanBCoverage {
  /** 当前旧仓退回 S₁ 的净浮盈；与 g 同单位，可为负。 */
  cushion: number;
  banked: number;
  /** cushion + banked；≤ 0 时没有加仓额度。 */
  available: number;
  riskDistance: number;
  /** 旧仓垫换算的加仓币量，可为负；多轮加仓的既有浮亏借此扣回。 */
  cushionAddCoins: number;
  /** K_B = S₁ 时，落袋垫换算的加仓币量。 */
  bankedAddCoins: number;
  /** Plan B 在 S₁ 归零档的实际加仓上限，永不小于 0。 */
  addCoinsMax: number;
}

/**
 * Plan B 的统一覆盖式：Y₁ + G ≥ X_add × |S₂ − S₁|。
 *
 * 币本位下 Y₁ 与 G 都以结算币计：Y₁_coin = Y₁_usd ÷ S₁；
 * 每币新仓退回 S₁ 的亏损同样除以 S₁，所以浮盈垫对应的币量与 U 本位相同，
 * 落袋部分则是 G × S₁ ÷ 风险距离。
 */
export function computePlanBCoverageAtS1(input: PlanBCoverageInput): PlanBCoverage | null {
  const { sBar, s1, s2, x1 } = input;
  if (![sBar, s1, s2, x1].every(fin) || sBar <= 0 || s1 <= 0 || s2 <= 0 || x1 <= 0) return null;
  const d = input.side === 'SHORT' ? -1 : 1;
  const riskDistance = (s2 - s1) * d;
  if (!(riskDistance > 0)) return null;
  const banked = fin(input.g) && input.g > 0 ? input.g : 0;
  const cushionUsd = x1 * (s1 - sBar) * d;
  const cushion = input.settlement === 'coin' ? cushionUsd / s1 : cushionUsd;
  const lossPerCoin = input.settlement === 'coin' ? riskDistance / s1 : riskDistance;
  const cushionAddCoins = cushion / lossPerCoin;
  const bankedAddCoins = banked / lossPerCoin;
  const available = cushion + banked;
  return {
    cushion,
    banked,
    available,
    riskDistance,
    cushionAddCoins,
    bankedAddCoins,
    addCoinsMax: Math.max(0, available / lossPerCoin),
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
    // 与引擎 getCoinContracts 同规则：contracts 缺失时张数存在 quantity 里。
    // 只认 contracts 会把这类持仓的币量算成 0，X₁ 直接消失。
    const contracts = fin(leg.contracts) ? (leg.contracts as number)
      : fin(leg.quantity) ? (leg.quantity as number) : 0;
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
  /**
   * 最早一笔成交的**真实**开仓时刻（各仓位 openedRealAt 与各 fill openedRealAt 取最小）。
   *
   * 时光机里同一段历史可以重放很多遍，模拟时间在各次重放之间是撞车的——
   * 只靠 earliestOpenTime 框「本场」，别的重放里模拟时刻更晚的止盈会被混进来。
   * 真实时钟不会倒流，所以它才是「当前持仓从哪一刀开始」的可靠起点。
   * 只要有一笔成交没有真实时刻（老仓位，或在老仓位上新加的一刀）就为 null——
   * 缺的那笔恰恰可能是最早的，取剩下的最小值会把起点算晚。
   */
  earliestOpenedRealAt: number | null;
}

/** 真实时间戳：有限且为正；缺失 / 0 / NaN 一律视为「不知道」。 */
function realTs(v: unknown): number | null {
  return fin(v) && v > 0 ? v : null;
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
  let earliestReal: number | null = null;
  // 真实起点只有**每一笔**成交都带真实时刻时才可知。9-07 之前开的老腿没有时间戳，
  // 在它上面新加一刀时，只取有时间戳的最小值会落到那一刀——比真正的起点晚，
  // 本场自己的止盈反被当成别的重放排除。所以缺一笔就整体记为不知道，退回模拟口径。
  let realKnown = true;
  for (const p of legs) {
    const coins = legOpeningCoins(p, defaultFaceUsd);
    if (!(coins > 0)) continue;
    rows.push({ coins, entryPrice: p.entryPrice });
    notional += Math.abs(getPositionNotionalUsd(symbol, p, p.entryPrice));
    if (fin(p.openTime) && (p.openTime as number) > 0) {
      earliest = earliest == null ? (p.openTime as number) : Math.min(earliest, p.openTime as number);
    }
    // 合并仓位的每一笔成交各留各的真实开仓时刻，逐笔取最小
    for (const f of legFills(p)) {
      if (f.openedRealAt == null) { realKnown = false; continue; }
      earliestReal = earliestReal == null ? f.openedRealAt : Math.min(earliestReal, f.openedRealAt);
    }
    const posReal = realTs(p.openedRealAt);
    if (posReal != null) earliestReal = earliestReal == null ? posReal : Math.min(earliestReal, posReal);
  }
  const coins = rows.reduce((s, r) => s + r.coins, 0);
  if (!(coins > 0)) return null;
  return {
    side, coins, notionalUsd: notional,
    avgEntry: weightedEntryByCoins(rows),
    legCount: legs.length, earliestOpenTime: earliest,
    earliestOpenedRealAt: realKnown ? earliestReal : null,
  };
}

/**
 * 把一条持仓腿逐笔拆开：合并仓位看 fills；老仓位没有 fills，把仓位本身当成一笔。
 * fills[0] 就是仓位本身（id 相同），缺真实时刻时可借仓位级的；
 * 加仓那几笔不借——借了会显得比落袋早，也会把起点算错。
 */
function legFills(p: BankedPositionLike): Array<{ openTime: number | null; openedRealAt: number | null }> {
  const fills = p.fills && p.fills.length > 0
    ? p.fills
    : [{ id: p.id, openTime: p.openTime, openedRealAt: p.openedRealAt }];
  const out: Array<{ openTime: number | null; openedRealAt: number | null }> = [];
  for (const f of fills) {
    if (!f) continue;
    out.push({
      openTime: fin(f.openTime) ? (f.openTime as number) : null,
      openedRealAt: realTs(f.openedRealAt) ?? (f.id != null && f.id === p.id ? realTs(p.openedRealAt) : null),
    });
  }
  return out;
}

/** 主仓打法先看多头；没有多头才退到空头；都没有返回 null。 */
export function pickHeldSide(symbol: string, positions: Position[] | undefined, defaultFaceUsd: number): HeldPositionSummary | null {
  return readHeldPosition(symbol, positions, 'LONG', defaultFaceUsd)
    ?? readHeldPosition(symbol, positions, 'SHORT', defaultFaceUsd);
}

export interface BankedMirrorProfit {
  /** 以 USD 计的可用落袋净额：镜像止盈 / tp1 正利润 − 本轮后续已实现亏损 */
  usd: number;
  /** 以币计的可用落袋净额：优先取成交记录的 pnlCoin，缺失时按平仓价折算 */
  coin: number;
  /** 计入的镜像止盈 / tp1 笔数；用于说明建议值来源，不含被扣除的亏损笔数。 */
  count: number;
  /** 最后一笔落袋的时刻（模拟时钟）。G 是从这一刻起才存在的。 */
  lastBankedAt: number | null;
  /** 最后一笔落袋的**操作时间**（计入记录的 closedRealAt 取最大）；老记录没有时为 null。 */
  lastBankedRealAt: number | null;
  /**
   * 该笔落袋**之后**新开的同向成交笔数（按 fill 数，不按仓位数）。
   *
   * 「这是第几次加仓」的可靠识别信号,而且是**因果相关**的那一个:
   * G 从落袋那一刻才存在,所以只有落袋之后开的仓位才可能花掉它。
   * 用「持仓条数」或「leg_sequence」都不行——主仓与镜像是同一刻开出的两条腿,
   * 数条数会把它们误判成加过仓;而 leg 要等日志写完才有,加仓当下还没有。
   *
   * 必须数 fill:引擎把同标的同方向的成交合并成**一个**仓位,
   * 落袋之后的加仓只会给它追加一笔 fill,仓位条数一条不多——按仓位数永远是 0。
   *
   * > 0 就意味着这笔 G **可能已经被花掉了**,不能再原样填进 B 账本。
   */
  addsSinceBanked: number;
  /**
   * 同标的、同方向、止盈1、模拟时间也在本场之内，却因**操作时间早于当前持仓开仓**（或根本没有 closedRealAt）而没计入的笔数。
   * 典型来源：同一段历史的另一次重放，模拟时刻与本场撞车。只为透明，不参与计算。
   */
  excludedByOperationTime: number;
}

/** 数「落袋之后又开了几笔」要读的持仓形状；Position 天然满足。 */
export interface BankedPositionLike {
  id?: string | null;
  side?: AddSide | string | null;
  openTime?: number | null;
  openedRealAt?: number | null;
  fills?: Array<{ id?: string | null; openTime?: number | null; openedRealAt?: number | null } | null | undefined> | null;
}

export interface BankedMirrorOptions {
  /**
   * 当前持仓最早一笔成交的真实开仓时刻（HeldPositionSummary.earliestOpenedRealAt）。
   * 给了有效时间戳，止盈记录就必须**操作时间**（closedRealAt）不早于它才算本场；
   * 不给 / 老仓位为 null 时，退回只按模拟时间框定，行为与旧版一字不差。
   */
  earliestOpenedRealAt?: number | null;
}

/**
 * 本场可用于 Plan B 的落袋净额：正向只认「止盈1」，本轮已经实现的亏损则一并扣除；
 * 普通减仓 / 手动平仓的正利润不混入。所有记录都必须不早于当前最早一条持仓的开仓时间。
 * 没有持仓就没有「本场」可言，返回 0，不把历史上所有止盈都算进来。
 * 这是建议值——界面上要用户点一下才填进 G。
 *
 * 「不早于」要看两只钟：模拟时间（closeTime ≥ earliestOpenTime）照旧，
 * 当前持仓有真实开仓时刻时，再要求操作时间 closedRealAt ≥ earliestOpenedRealAt。
 * 否则同一段历史重放第二遍时，上一遍在同一模拟时刻落袋的止盈会被当成本场的 G 再填一次。
 * 能拿到真实起点就说明持仓每一笔成交都带时间戳（9-07 之后），而没有 closedRealAt 的止盈只可能来自 6 月以前，一律不计。
 */
export function detectBankedMirrorProfit(
  symbol: string,
  side: AddSide,
  tradeHistory: TradeRecord[] | undefined,
  earliestOpenTime: number | null,
  /** 当前持仓——用来数「落袋之后又开了几笔」。不传则不做这项判断。 */
  positions?: BankedPositionLike[] | null,
  options?: BankedMirrorOptions,
): BankedMirrorProfit {
  const empty = {
    usd: 0, coin: 0, count: 0, lastBankedAt: null, lastBankedRealAt: null,
    addsSinceBanked: 0, excludedByOperationTime: 0,
  };
  if (earliestOpenTime == null) return empty;
  const realStart = realTs(options?.earliestOpenedRealAt);
  let usd = 0;
  let coin = 0;
  let count = 0;
  let excludedByOperationTime = 0;
  let lastBankedAt: number | null = null;
  let lastBankedRealAt: number | null = null;
  for (const r of tradeHistory ?? []) {
    if (!r || r.symbol !== symbol || r.side !== side) continue;
    if (r.action !== 'CLOSE') continue;
    if (!((r.closeTime ?? 0) >= earliestOpenTime)) continue;
    if (!fin(r.pnl)) continue;
    const mirrorCredit = r.exit_method === 'tp1';
    const realizedLoss = r.pnl < 0;
    // Plan B 的正向来源只认镜像止盈；任何本轮已实现亏损都要把可用 G 扣回来。
    if (!mirrorCredit && !realizedLoss) continue;
    const opAt = realTs(r.closedRealAt);
    // 操作时间筛选：持仓有真实起点时，止盈必须在这之后才操作过；没有 closedRealAt 的一并排除。
    if (realStart != null && !(opAt != null && opAt >= realStart)) {
      if (mirrorCredit) excludedByOperationTime += 1;
      continue;
    }
    usd += r.pnl;
    coin += fin(r.pnlCoin)
      ? (r.pnlCoin as number)
      : (fin(r.exitPrice) && (r.exitPrice as number) > 0 ? r.pnl / (r.exitPrice as number) : 0);
    if (mirrorCredit) {
      count += 1;
      const t = fin(r.closeTime) ? (r.closeTime as number) : null;
      if (t != null && (lastBankedAt == null || t > lastBankedAt)) lastBankedAt = t;
      if (opAt != null && (lastBankedRealAt == null || opAt > lastBankedRealAt)) lastBankedRealAt = opAt;
    }
  }

  let addsSinceBanked = 0;
  if ((lastBankedAt != null || lastBankedRealAt != null) && positions) {
    for (const p of positions) {
      if (!p || p.side !== side) continue;
      // 合并仓位逐笔数 fill；老仓位没有 fills，把仓位本身当成一笔。
      for (const f of legFills(p)) {
        if (lastBankedRealAt != null && f.openedRealAt != null) {
          // 两边都有操作时间就按真实时钟比：倒带之后模拟时间会骗人，真实时钟不会。
          if (f.openedRealAt > lastBankedRealAt) addsSinceBanked += 1;
          continue;
        }
        // 严格晚于落袋时刻才算——同刻开出的是同一批腿,不是加仓。
        if (f.openTime != null && lastBankedAt != null && f.openTime > lastBankedAt) addsSinceBanked += 1;
      }
    }
  }

  return { usd, coin, count, lastBankedAt, lastBankedRealAt, addsSinceBanked, excludedByOperationTime };
}

/**
 * 加仓**之后**的综合成本线，以及它落在止损线的哪一侧。
 *
 * 这是 A3-R 的 R0 门槛：加仓后必须重算，成本线越过止损线即当场非法。
 * 实盘那一场就死在这里——加仓 3,076 万币之后成本线从 0.044722 升到 0.047158，
 * 而止损线在 0.045323，**超出 4.05%**，从那一刻起整个仓位已经不合法，
 * 后面的第二次加仓只是在一个已经违规的仓位上继续。
 *
 * 注意 A 账本的定义本身就是「加到成本线**恰好落在** S₁」（实测 0.0453230，分毫不差）。
 * 所以任何超出 A 的加量——包括整个 B 账本——**必然**把成本线推过 S₁。
 * 那不是 bug，是 B 的定义：它拿已落袋的 G 去买一个新期权，代价就是放弃「在 S₁ 打平」。
 * 因此这里只**如实显示**落点，不做硬拦截；真正该硬拦的是「A 连垫都没有」那种情形。
 */
export interface PostAddCostLine {
  /** 加仓后的综合成本线 */
  blendedCost: number;
  /** 成本线仍在止损线的安全侧（多单：成本线低于止损线） */
  pastStop: boolean;
  /** 成本线越过止损线的相对幅度；未越过时为 0 */
  overshootPct: number;
}

export function evaluatePostAddCostLine(args: {
  side: AddSide;
  sBar: number;
  s1: number;
  s2: number;
  x1: number;
  addCoins: number;
}): PostAddCostLine | null {
  const { side, sBar, s1, s2, x1, addCoins } = args;
  if (![sBar, s1, s2, x1, addCoins].every(v => fin(v) && v > 0)) return null;
  const total = x1 + addCoins;
  if (!(total > 0)) return null;
  const blendedCost = (x1 * sBar + addCoins * s2) / total;
  const d = side === 'SHORT' ? -1 : 1;
  // 多单：成本线高于止损线即越过；空单相反。
  const overshoot = (blendedCost - s1) * d;
  return {
    blendedCost,
    pastStop: overshoot > 0,
    overshootPct: overshoot > 0 ? (overshoot / s1) * 100 : 0,
  };
}
