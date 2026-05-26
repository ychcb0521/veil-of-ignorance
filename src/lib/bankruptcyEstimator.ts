/**
 * Ergodicity 破产估算
 *
 * Taleb 的核心原理：时间平均 ≠ 集合平均。同样的预期收益，对个体而言
 * 路径上的破产是不可逆终点。本模块给出"按当前仓位连续训练 100 次，
 * 期望破产次数"的诚实数字——让用户对 fat-tail 有数字直觉。
 *
 * 破产定义：账户余额下降到初始的 BANKRUPTCY_THRESHOLD（默认 0.5）以下。
 * 单次结果：以预设最大亏损（pre_max_loss_usdt）的概率为 1-p 亏掉；以
 * 平均盈利（基于平均盈亏比 b）的概率 p 赚到。
 */

const BANKRUPTCY_THRESHOLD = 0.5;
const DEFAULT_TRIALS = 200;
const DEFAULT_HORIZON = 100;
const DEFAULT_PAYOFF_RATIO = 1.5; // 平均盈利 / 平均亏损

export interface BankruptcyInputs {
  /** 用户预测胜率 0-1（来自 calibration 字段） */
  winProb: number;
  /** 每笔最大亏损 USDT */
  maxLossUsdt: number;
  /** 当前可用余额 */
  availableBalance: number;
  /** 平均盈利 / 平均亏损比，默认 1.5 */
  payoffRatio?: number;
  /** Monte Carlo 轨迹数 */
  trials?: number;
  /** 模拟 N 笔交易 */
  horizon?: number;
}

export interface BankruptcyResult {
  /** 100 条轨迹中至少 1 次出现"账户跌破阈值"的比例 */
  ruinProbability: number;
  /** 期望破产次数 = ruinProbability × 100（在 horizon=100 时） */
  expectedRuinCountPerHundred: number;
  /** 中位最终账户余额倍数 */
  medianFinalMultiple: number;
}

/** 简单确定性 PRNG（mulberry32），让结果可复现以便测试 */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function estimateBankruptcy(input: BankruptcyInputs): BankruptcyResult {
  const p = Math.max(0, Math.min(1, input.winProb));
  const trials = input.trials ?? DEFAULT_TRIALS;
  const horizon = input.horizon ?? DEFAULT_HORIZON;
  const b = input.payoffRatio ?? DEFAULT_PAYOFF_RATIO;
  const balance = input.availableBalance;
  const loss = input.maxLossUsdt;

  if (balance <= 0 || loss <= 0) {
    return { ruinProbability: 0, expectedRuinCountPerHundred: 0, medianFinalMultiple: 1 };
  }

  const ruinFloor = balance * BANKRUPTCY_THRESHOLD;
  const rand = prng(1337);

  let ruinedTrials = 0;
  const finalMultiples: number[] = [];

  for (let t = 0; t < trials; t++) {
    let bal = balance;
    let ruinedThisTrial = false;
    for (let i = 0; i < horizon; i++) {
      const win = rand() < p;
      const delta = win ? loss * b : -loss;
      bal += delta;
      if (!ruinedThisTrial && bal <= ruinFloor) {
        ruinedThisTrial = true;
        ruinedTrials++;
      }
      if (bal <= 0) break;
    }
    finalMultiples.push(Math.max(0, bal) / balance);
  }

  finalMultiples.sort((a, b) => a - b);
  const median = finalMultiples[Math.floor(finalMultiples.length / 2)];

  const ruinProbability = ruinedTrials / trials;
  return {
    ruinProbability,
    expectedRuinCountPerHundred: ruinProbability * 100,
    medianFinalMultiple: median,
  };
}
