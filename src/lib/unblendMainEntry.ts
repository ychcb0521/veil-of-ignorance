import type { SettlementMode } from '@/types/trading';

/**
 * 从合并后的加权开仓价里，把**合并之前的主力单**开仓价反解出来。
 *
 * 为什么需要它：同向成交在持仓期合并成一个仓位（爆仓必须按整仓算），
 * 而平仓记录只写合并后的加权价。主力自己的成交价从来没被写进数据库过，
 * 于是历史战役里主力顶着一个它从未成交过的价格，
 * 预期最大亏损 L = 跌幅 × 敞口 的两个因子同时被污染，误差是相乘的。
 *
 * 这不是估计，是**代数反解**：合并价的定义式在两种结算模式下都是可逆的，
 * 只要加仓的价与量是对的，主力的价就唯一确定。
 *
 *   U 本位（数量加权算术平均）  Q·E = Σ qᵢ·eᵢ
 *     → e_主 = (Q·E − Σ q_加·e_加) / q_主
 *   币本位（名义加权**调和**平均） N/E = Σ Nᵢ/eᵢ
 *     → e_主 = q_主 / (Q/E − Σ q_加/e_加)
 *
 * 币本位那条式子里合约面值 N = q·面值 会整体约掉——这本身就是公式正确的一个校验：
 * 反解不需要知道面值，也就不会因为面值填错而给出错的答案。
 */

export interface UnblendAddLeg {
  /** 该笔加仓自己的开仓价。 */
  entryPrice: number;
  /** 该笔加仓的计量单位数：币本位为张数，U 本位为币数。 */
  units: number;
}

export type UnblendRefusal =
  | 'no-adds'          // 没有加仓，本来就不是混合价
  | 'invalid-input'    // 价或量不可用
  | 'adds-exceed'      // 加仓的量 ≥ 合计量，主力不剩什么
  | 'not-blended'      // 反解不出正数（多半是这条记录本来就没合并过）
  ;

export type UnblendResult =
  | { ok: true; entryPrice: number; mainUnits: number; addUnits: number }
  | { ok: false; reason: UnblendRefusal };

const positive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

export function unblendMainEntryPrice(input: {
  /** 平仓记录里那个合并后的加权开仓价。 */
  blendedEntryPrice: number;
  /** 平仓记录里的合计量（与 adds[].units 同单位）。 */
  totalUnits: number;
  settlementMode: SettlementMode | null | undefined;
  adds: UnblendAddLeg[];
}): UnblendResult {
  const { blendedEntryPrice: E, totalUnits: Q, settlementMode } = input;
  const adds = (input.adds ?? []).filter(a => positive(a.entryPrice) && positive(a.units));
  if (adds.length === 0) return { ok: false, reason: 'no-adds' };
  if (!positive(E) || !positive(Q)) return { ok: false, reason: 'invalid-input' };

  const addUnits = adds.reduce((s, a) => s + a.units, 0);
  const mainUnits = Q - addUnits;
  // 留一点余量：量是用户手填的，差半张就判失败太苛刻，但差到没有主力就必须拒绝。
  if (!(mainUnits > Q * 1e-9)) return { ok: false, reason: 'adds-exceed' };

  const coin = settlementMode === 'coin';
  const entryPrice = coin
    // 调和：Q/E 是「以币计的总量」，减掉各笔加仓的，剩下的就是主力的
    ? mainUnits / ((Q / E) - adds.reduce((s, a) => s + a.units / a.entryPrice, 0))
    // 算术：Q·E 是总名义，减掉各笔加仓的，剩下的除以主力的量
    : ((Q * E) - adds.reduce((s, a) => s + a.units * a.entryPrice, 0)) / mainUnits;

  // 反解出非正数或非有限值，说明输入自相矛盾（这条记录多半本来就没合并过，
  // 或者加仓的价量填错了）。宁可拒绝，也不要拿一个荒谬的价去给风险定价。
  if (!positive(entryPrice)) return { ok: false, reason: 'not-blended' };
  return { ok: true, entryPrice, mainUnits, addUnits };
}

/**
 * 正向：把主力与各笔加仓合并成一个加权价。反解的逆运算，
 * 存在的意义是让测试能做**往返校验**——没有它，反解只能靠人肉验算。
 */
export function blendEntryPrice(
  legs: UnblendAddLeg[],
  settlementMode: SettlementMode | null | undefined,
): number | null {
  const usable = legs.filter(l => positive(l.entryPrice) && positive(l.units));
  if (usable.length === 0) return null;
  const units = usable.reduce((s, l) => s + l.units, 0);
  const price = settlementMode === 'coin'
    ? units / usable.reduce((s, l) => s + l.units / l.entryPrice, 0)   // 调和
    : usable.reduce((s, l) => s + l.units * l.entryPrice, 0) / units;  // 算术
  return positive(price) ? price : null;
}

/**
 * 同一个反解，但以**名义**为输入而不是量。
 *
 * 战役侧手里有的是名义（腿的 `pre_position_size`、记录的 `tradeRecordNotionalUsd`），
 * 换算成「量」还要知道币本位的合约面值，多一个可能填错的参数。
 *
 * 而且在名义空间里，两种结算模式收敛成**同一条式子**：
 *
 *   e_主 = (N_总 − Σ N_加) / (N_总/E_混 − Σ N_加/e_加)
 *
 * 币本位：N/E 就是「以币计的持仓量」，调和定义式 N_总/E_混 = Σ Nᵢ/eᵢ 直接给出分母；
 * U 本位：开仓名义可加 N_总 = Σ Nᵢ，而 Q = N_总/E_混、q_加 = N_加/e_加，分母同样是主力的量。
 *
 * 这与「币本位恒等式 N(1/e − 1/x)·x ≡ N(x−e)/e」是同一件事的两种说法：
 * 一旦换到名义空间，反向合约与线性合约的代数就重合了。模式无关本身就是一道校验——
 * 调用方不必判断币本位还是 U 本位，也就不会判错。
 */
export function unblendMainEntryPriceByNotional(input: {
  blendedEntryPrice: number;
  /** 合并仓位的开仓名义（USD）。 */
  totalNotionalUsd: number;
  adds: Array<{ entryPrice: number; notionalUsd: number }>;
}): UnblendResult {
  const { blendedEntryPrice: E, totalNotionalUsd: N } = input;
  const adds = (input.adds ?? []).filter(a => positive(a.entryPrice) && positive(a.notionalUsd));
  if (adds.length === 0) return { ok: false, reason: 'no-adds' };
  if (!positive(E) || !positive(N)) return { ok: false, reason: 'invalid-input' };

  const addNotional = adds.reduce((s, a) => s + a.notionalUsd, 0);
  const mainNotional = N - addNotional;
  if (!(mainNotional > N * 1e-9)) return { ok: false, reason: 'adds-exceed' };

  const mainSize = (N / E) - adds.reduce((s, a) => s + a.notionalUsd / a.entryPrice, 0);
  const entryPrice = mainNotional / mainSize;
  if (!positive(mainSize) || !positive(entryPrice)) return { ok: false, reason: 'not-blended' };
  return { ok: true, entryPrice, mainUnits: mainSize, addUnits: N / E - mainSize };
}
