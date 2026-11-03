/* eslint-disable */
// @ts-nocheck
/**
 * 【冻结文件，禁止修改】持仓监测 2026-10-31 旧引擎（quality-engine-2026-10-31）。
 *
 * 来源：提交 bb003e0c（2026-10-31 00:20）的 src/lib/fish/quality.ts 等源文件，由 scripts/build-legacy-quality-engine.mjs 原样打包
 * （esbuild，只保留引擎实际用到的代码；不含网络、存储、账号）。重新运行该脚本必须逐字节得到本文件。
 * 用途：2026-11-03 用户要求复原「卖出算法组合2」10-31 那次运行（RAVE +10027.38，b=2005.48）。
 *   11-01 起加仓改成箱体位置、删除入场距离、涨幅门槛改为相对成本线 S，当前引擎算不出那套结果；用这份旧引擎重跑，15 笔逐位一致。
 * K 线仍由当前代码的加载器提供（同一套限频与缓存）。
 * 正文 SHA-256：bd6bbf7363d7d59a0e8419f428dd7a292b740978762b5c42a01c35ede1500f3f
 */
// ===== 以下为打包正文（勿改）=====
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/lib/atr.ts
function advanceChartAtr(previous, bar, period = 14) {
  const range = previous ? Math.max(bar.high - bar.low, Math.abs(bar.high - previous.close), Math.abs(bar.low - previous.close)) : bar.high - bar.low;
  const alpha = 2 / (period + 1);
  return { value: previous ? range * alpha + previous.value * (1 - alpha) : range, close: bar.close };
}
var init_atr = __esm({
  "src/lib/atr.ts"() {
  }
});

// src/lib/addPositionCoverage.ts
function initialAddPositionState(strategyCost, coins, mirrorProfit = 0, realAverage = strategyCost) {
  return {
    strategyCost,
    realAverage,
    coins,
    mirrorProfitRealized: mirrorProfit,
    mirrorProfitAvailable: mirrorProfit,
    mirrorProfitAllocated: 0
  };
}
function calculateAddRiskBudget(oldCushion, bankedProfit, riskPerCoin) {
  if (![oldCushion, bankedProfit, riskPerCoin].every(Number.isFinite) || riskPerCoin <= 0) return null;
  const available = oldCushion + bankedProfit;
  const oldLoss = Math.max(0, -oldCushion);
  const baseCoins = Math.max(0, oldCushion + Math.min(0, bankedProfit)) / riskPerCoin;
  const bankedCoins = Math.max(0, bankedProfit - oldLoss) / riskPerCoin;
  return {
    available,
    oldLoss,
    shortfall: Math.max(0, -available),
    baseCoins,
    bankedCoins,
    maxAddCoins: baseCoins + bankedCoins
  };
}
function calculateAddPosition({ currentPrice: T, support: K, state, side = "LONG" }) {
  const {
    strategyCost: S,
    realAverage,
    coins: Q,
    mirrorProfitAvailable: P,
    mirrorProfitRealized,
    mirrorProfitAllocated
  } = state;
  const blank = (error, shortfall = 0) => ({
    error,
    oldLossShortfall: shortfall,
    safeDistance: Number.NaN,
    riskDistance: Number.NaN,
    oldCushion: Number.NaN,
    baseCoins: 0,
    mirrorCoins: 0,
    addCoins: 0,
    newCoins: Q,
    realAverage,
    strategyCost: S,
    mirrorUsed: 0,
    expectedNewLoss: 0,
    coverageGap: Number.NaN,
    next: null
  });
  if (![T, K, S, realAverage, Q, P, mirrorProfitRealized, mirrorProfitAllocated].every(Number.isFinite) || T <= 0 || K <= 0 || S <= 0 || realAverage <= 0 || Q <= 0 || P < 0 || mirrorProfitRealized < 0 || mirrorProfitAllocated < 0 || P + mirrorProfitAllocated > mirrorProfitRealized + 1e-9 * Math.max(1, mirrorProfitRealized)) {
    return blank("invalid_input");
  }
  const direction = side === "SHORT" ? -1 : 1;
  if ((T - K) * direction <= 0) return blank("price_not_above_support");
  const safeDistance = (K - S) * direction;
  const riskDistance = (T - K) * direction;
  const oldCushion = safeDistance * Q;
  const budget = calculateAddRiskBudget(oldCushion, P, riskDistance);
  if (!budget) return blank("invalid_input");
  const oldLoss = budget.oldLoss;
  if (P < oldLoss && oldLoss - P > 64 * Number.EPSILON * Math.max(1, P, oldLoss)) {
    return blank("mirror_profit_insufficient", oldLoss - P);
  }
  const baseCoins = budget.baseCoins;
  const mirrorRiskBudget = Math.max(0, P - oldLoss);
  const mirrorCoins = budget.bankedCoins;
  const addCoins = budget.maxAddCoins;
  const newCoins = Q + addCoins;
  const newRealAverage = (Q * realAverage + addCoins * T) / newCoins;
  const expectedNewLoss = addCoins * riskDistance;
  const mirrorUsed = oldLoss + mirrorRiskBudget;
  const coverageGap = oldCushion + mirrorUsed - expectedNewLoss;
  const next = {
    strategyCost: K,
    realAverage: newRealAverage,
    coins: newCoins,
    mirrorProfitRealized,
    mirrorProfitAvailable: Math.max(0, P - mirrorUsed),
    mirrorProfitAllocated: mirrorProfitAllocated + mirrorUsed
  };
  return {
    error: null,
    oldLossShortfall: 0,
    safeDistance,
    riskDistance,
    oldCushion,
    baseCoins,
    mirrorCoins,
    addCoins,
    newCoins,
    realAverage: newRealAverage,
    strategyCost: K,
    mirrorUsed,
    expectedNewLoss,
    coverageGap,
    next
  };
}
var init_addPositionCoverage = __esm({
  "src/lib/addPositionCoverage.ts"() {
  }
});

// src/lib/sellerRetention.ts
function retentionFormula(source, baseExpression, core, bound, windowHours = 48) {
  let p = "sr";
  while (new RegExp("\\b" + p + "_").test(source)) p += "_";
  const n = (key) => p + "_" + key;
  const lines = [
    "# seller-retention-v1：先冻结输入，再原样计算副本的原算法；不读取原特征结果或递推状态",
    `${n("time")} = T`,
    `${n("c")} = C`,
    `${n("e")} = E`,
    `${n("q")} = Q`,
    `${n("b")} = B`,
    `${n("s")} = S`,
    `${n("minutes")} = BAR_MINUTES`,
    source,
    `${n("base")} = ${baseExpression}`,
    "# 以下参数仅属于本副本。gain=0时逐根返回原算法；窗口不缩短，增强在最终压缩前进行",
    `${n("version")} = 1`,
    `${n("gain")} = 0.5`,
    `${n("window_h")} = ${windowHours}`,
    `${n("eta")} = 0.5`,
    `${n("alpha")} = 1`,
    `${n("impact_weight")} = 0.25`,
    `${n("flow_floor")} = 0.05`,
    `${n("sigma_floor")} = 0.000001`,
    `${n("epsilon")} = 0.000000000001`,
    `${n("window_n")} = bars(${n("window_h")})`,
    `${n("baseline_n")} = bars(avgh)`,
    `${n("parameters")} = if(${n("gain")} >= 0 and ${n("eta")} >= 0 and ${n("eta")} <= 1 and ${n("alpha")} >= 0 and ${n("impact_weight")} >= 0 and ${n("flow_floor")} > 0 and ${n("sigma_floor")} > 0 and ${n("epsilon")} > 0, 1, 0/0)`,
    `${n("valid")} = if(has(${n("parameters")}) and ${n("q")} > 0 and ${n("b")} >= 0 and ${n("s")} >= 0 and ${n("e")} > 0 and ${n("c")} > 0 and ${n("time")} - prev(${n("time")}) == ${n("minutes")} * 60000, 1, 0/0)`,
    `${n("r")} = if(has(${n("valid")}), ln(${n("e")} / prev(${n("e")})), 0/0)`,
    `${n("vbar")} = if(has(prev(full(${n("valid")}, ${n("baseline_n")}))), prev(avg(${n("q")}, avgh)), 0/0)`,
    `${n("sigma")} = if(has(prev(full(${n("r")}, ${n("baseline_n")}))), prev(sd(${n("r")}, avgh)), 0/0)`,
    `${n("denom")} = max(${n("sigma")}, ${n("sigma_floor")}) + ${n("epsilon")}`,
    `${n("flow")} = (${n("b")} - ${n("s")}) / ${n("q")}`,
    `${n("support")} = ln(1 + (abs(${n("b")} - ${n("s")}) + ${n("eta")} * (${n("q")} - abs(${n("b")} - ${n("s")}))) / ${n("vbar")})`,
    `${n("impact")} = -max(-${n("r")}, 0) / (${n("denom")} * (abs(${n("flow")}) + ${n("flow_floor")}))`,
    `${n("weight")} = ${n("support")} * (1 + ${n("alpha")} * max(-${n("flow")}, 0)) * (1 + ${n("impact_weight")} * max(-${n("flow")}, 0) * tanh(-${n("impact")}))`,
    `${n("ready")} = full(if(has(${n("valid")}) and has(${n("weight")}) and has(${n("sigma")}), 1, 0/0), ${n("window_n")})`,
    `${n("price")} = max(${n("e")}, ${n("c")})`,
    "# retain每根用当前price重估过去各时点位移；下移未收复为负，收复后回升，零点不随样本平移",
    `${n("retention_z")} = if(has(${n("ready")}), retain(${n("weight")}, ${n("price")}, prev(${n("e")}), hl, ${n("window_h")}) / ${n("denom")}, 0/0)`,
    `${n("price_z")} = if(has(${n("ready")}), retain(1, ${n("price")}, prev(${n("e")}), hl, ${n("window_h")}) / ${n("denom")}, 0/0)`,
    `${n("anomaly_z")} = if(has(${n("valid")}), ln(${n("price")} / prev(${n("e")})) / ${n("denom")}, 0/0)`
  ];
  const b = n("base"), z = n("retention_z"), g = n("gain");
  if (bound) {
    lines.push(`${n("base_unit")} = clip(${b} / ${bound}, -1 + ${n("epsilon")}, 1 - ${n("epsilon")})`, `${n("base_z")} = 0.5 * ln((1 + ${n("base_unit")}) / (1 - ${n("base_unit")}))`);
    lines.push(`${core} = if(${g} == 0, ${b}, if(has(${b}) and has(${z}) and abs(${b}) <= ${bound}, ${bound} * tanh(${n("base_z")} + ${g} * ${z}), 0/0))`);
  } else lines.push(`${core} = if(${g} == 0, ${b}, if(has(${b}) and has(${z}), ${b} + ${g} * ${z}, 0/0))`);
  return { formula: lines.join("\n"), prefix: p };
}
var SELLER_RETENTION_SPECS;
var init_sellerRetention = __esm({
  "src/lib/sellerRetention.ts"() {
    SELLER_RETENTION_SPECS = [
      { sourceId: "cdi2", label: "CDI2", id: "cdi2-retain", core: "CDI2_retained", sourceCore: "CDI2", chartId: "CDI2_RETAIN", bound: 1 },
      { sourceId: "seller-control", label: "DSP·bc", id: "seller-control-retain", core: "bc_retained", sourceCore: "bc", chartId: "SELLER_CONTROL_RETAIN", bound: 0 },
      { sourceId: "dss", label: "DSS", id: "dss-retain", core: "DSS_retained", sourceCore: "DSS", chartId: "DSS_RETAIN", bound: 1 },
      { sourceId: "mbi-bear", label: "MBI·空方", id: "mbi-bear-retain", core: "MBI_bear_retained", sourceCore: "MBI_bear", chartId: "MBI_BEAR_RETAIN", bound: 1 },
      { sourceId: "ctba-bear", label: "CTBA·空方", id: "ctba-bear-retain", core: "CTBA_bear_retained", sourceCore: "CTBA_bear", chartId: "CTBA_BEAR_RETAIN", bound: 100 },
      { sourceId: "mbi2-bear", label: "MBI2·卖方", id: "mbi2-bear-retain", core: "MBI2_bear_retained", sourceCore: "MBI2_bear", chartId: "MBI2_BEAR_RETAIN", bound: 1 },
      { sourceId: "ctba_12h-bear", label: "CTBA-12H·卖方", id: "ctba_12h-bear-retain", core: "CTBA_12H_bear_retained", sourceCore: "CTBA_12H_bear", chartId: "CTBA_12H_BEAR_RETAIN", bound: 100 }
    ];
  }
});

// src/lib/mbi.ts
function validateMbiParams(n, z0) {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error("MBI_N 必须是正整数（K 线根数）");
  if (!Number.isFinite(z0) || z0 <= 0) throw new Error("MBI_Z0 必须大于 0");
}
function computeMbi(closes, params = {}, options = {}) {
  const n = mbiNOf(params), z0 = mbiZ0Of(params);
  validateMbiParams(n, z0);
  const z = new Float64Array(closes.length).fill(NaN);
  const mbi = new Float64Array(closes.length).fill(NaN);
  const alpha = 1 / n, kappa = 1 / Math.sqrt(alpha * (2 - alpha));
  const x = Float64Array.from(closes, (c) => c > 0 && Number.isFinite(c) ? Math.log(c) : NaN);
  const first = x.findIndex(Number.isFinite);
  if (first < 0) return { z, mbi, kappa, initialVariance: null };
  let seed = 0, count = 0, seedEnd = first;
  for (let k = first + 1; k < x.length && count < n; k++) {
    if (Number.isFinite(x[k]) && Number.isFinite(x[k - 1])) {
      seed += (x[k] - x[k - 1]) ** 2;
      count++;
      seedEnd = k;
    }
  }
  if (count < n) return { z, mbi, kappa, initialVariance: null };
  const initialVariance = seed / n;
  let M = x[first], S = initialVariance;
  const warmupEnd = Math.max(first + 5 * n, seedEnd + 1);
  for (let t = first + 1; t < x.length; t++) {
    if (!Number.isFinite(x[t])) continue;
    const hasReturn = Number.isFinite(x[t - 1]);
    if (hasReturn && (options.warmup === false || t >= warmupEnd)) {
      z[t] = S > 0 ? (x[t] - M) / (kappa * Math.sqrt(S)) : 0;
      mbi[t] = Math.tanh(z[t] / z0);
    }
    M = (1 - alpha) * M + alpha * x[t];
    if (hasReturn) {
      const r = x[t] - x[t - 1];
      S = (1 - alpha) * S + alpha * r * r;
    }
  }
  return { z, mbi, kappa, initialVariance };
}
var MBI_N, MBI_Z0, MBI_TOOLTIP, mbiNOf, mbiZ0Of;
var init_mbi = __esm({
  "src/lib/mbi.ts"() {
    MBI_N = 25;
    MBI_Z0 = 1.25;
    MBI_TOOLTIP = "MBI：价格偏离指数均线多少个无趋势标准差，经 tanh 压到 −1 到 1。≥ 0.8：买方占优确立（无趋势时约 8.5% 的 K 线能达到）；0.5–0.8：偏向买方；−0.5–0.5：无明显优势；≤ −0.8：卖方占优。接近 ±1 是饱和，不代表反转。";
    mbiNOf = (params = {}) => params.MBI_N ?? MBI_N;
    mbiZ0Of = (params = {}) => params.MBI_Z0 ?? MBI_Z0;
  }
});

// src/lib/mbi2.ts
function validateMbi2Params(p = {}, minutes = 5) {
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(mbi2HoursOf(p, minutes)) || mbi2HoursOf(p, minutes) <= 0) throw Error("MBI2_T_HOURS 和周期分钟数必须大于0");
  if (!Number.isSafeInteger(mbi2NOf(p, minutes))) throw Error("MBI2 派生 n 超出有效范围");
  if (mbi2Z0Of(p) !== 1.25) throw Error("MBI2_Z0 固定为1.25");
  if (!Number.isFinite(mbi2BandOf(p)) || !Number.isFinite(mbi2ConfirmOf(p)) || mbi2BandOf(p) < 0 || mbi2BandOf(p) >= mbi2ConfirmOf(p) || mbi2ConfirmOf(p) >= 1) throw Error("MBI2 要求 0 ≤ BAND < CONFIRM < 1");
}
function validateCore(n, z0) {
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isFinite(z0) || z0 <= 0) throw Error("MBI2 核心参数无效");
}
function computeMbi2Core(closes, n = 25, z0 = 1.25, options = {}) {
  validateCore(n, z0);
  const z = new Float64Array(closes.length).fill(NaN);
  const mbi = new Float64Array(closes.length).fill(NaN);
  const alpha = 1 / n, kappa = 1 / Math.sqrt(alpha * (2 - alpha));
  const x = Float64Array.from(closes, (c) => c > 0 && Number.isFinite(c) ? Math.log(c) : NaN);
  const first = x.findIndex(Number.isFinite);
  if (first < 0) return { z, mbi, kappa, initialVariance: null };
  let seed = 0, count = 0, seedEnd = first;
  for (let k = first + 1; k < x.length && count < n; k++) {
    if (Number.isFinite(x[k]) && Number.isFinite(x[k - 1])) {
      seed += (x[k] - x[k - 1]) ** 2;
      count++;
      seedEnd = k;
    }
  }
  if (count < n) return { z, mbi, kappa, initialVariance: null };
  const initialVariance = seed / n;
  let M = x[first], S = initialVariance;
  const warmupEnd = Math.max(first + 5 * n, seedEnd + 1);
  for (let t = first + 1; t < x.length; t++) {
    if (!Number.isFinite(x[t])) continue;
    const hasReturn = Number.isFinite(x[t - 1]);
    if (hasReturn && (options.warmup === false || t >= warmupEnd)) {
      z[t] = S > 0 ? (x[t] - M) / (kappa * Math.sqrt(S)) : 0;
      mbi[t] = Math.tanh(z[t] / z0);
    }
    M = (1 - alpha) * M + alpha * x[t];
    if (hasReturn) {
      const r = x[t] - x[t - 1];
      S = (1 - alpha) * S + alpha * r * r;
    }
  }
  return { z, mbi, kappa, initialVariance };
}
function mbi2States(values, minutes = 5, p = {}, times) {
  validateMbi2Params(p, minutes);
  const length = values.length, blank = () => new Float64Array(length).fill(NaN);
  const state = blank(), lead = blank(), confirm = blank(), buyStarts = blank(), buyConfirms = blank();
  const band = mbi2BandOf(p), threshold = mbi2ConfirmOf(p), step = minutes * 6e4;
  let side = 0, started = -1, confirmed = -1;
  for (let i = 0; i < length; i++) {
    const value = values[i], time = times?.[i] ?? i * step;
    if (!Number.isFinite(value) || !Number.isFinite(time)) {
      side = 0;
      started = confirmed = -1;
      continue;
    }
    if (i > 0 && times && time - times[i - 1] !== step) {
      side = 0;
      started = confirmed = -1;
    }
    buyStarts[i] = buyConfirms[i] = 0;
    if (value > band) {
      if (side <= 0) {
        side = 1;
        started = i;
        confirmed = -1;
        buyStarts[i] = 1;
      }
      if (value > threshold && side !== 2) {
        side = 2;
        confirmed = i;
        buyConfirms[i] = 1;
      }
    } else if (value < -band) {
      if (side >= 0) {
        side = -1;
        started = i;
        confirmed = -1;
      }
      if (value < -threshold && side !== -2) {
        side = -2;
        confirmed = i;
      }
    }
    const elapsed = (start) => start < 0 ? 0 : Math.min(48, (time - (times?.[start] ?? start * step)) / 36e5);
    state[i] = side;
    lead[i] = side === 0 ? 0 : elapsed(started);
    confirm[i] = Math.abs(side) === 2 ? elapsed(confirmed) : 0;
  }
  return { state, lead, confirm, buyStarts, buyConfirms };
}
var MBI2_Z0, MBI2_TOOLTIP, MBI2_BAND, MBI2_CONFIRM, MBI2_T_HOURS, mbi2HoursOf, mbi2NOf, mbi2Z0Of, mbi2BandOf, mbi2ConfirmOf;
var init_mbi2 = __esm({
  "src/lib/mbi2.ts"() {
    MBI2_Z0 = 1.25;
    MBI2_TOOLTIP = "MBI2：独立价格递推，按小时换算 n；0为均衡，穿过±缓冲带开始试探，越过确认阈值后保持确认，直到穿过对侧缓冲带。只用已收盘价格，预热和缺失保持为空。";
    MBI2_BAND = 0.2;
    MBI2_CONFIRM = 0.8;
    MBI2_T_HOURS = 25 * 5 / 60;
    mbi2HoursOf = (p = {}, minutes = 5) => p.MBI2_T_HOURS ?? 25 * minutes / 60;
    mbi2NOf = (p = {}, minutes = 5) => Math.max(5, Math.round(mbi2HoursOf(p, minutes) * 60 / minutes));
    mbi2Z0Of = (p = {}) => p.MBI2_Z0 ?? MBI2_Z0;
    mbi2BandOf = (p = {}) => p.MBI2_BAND ?? MBI2_BAND;
    mbi2ConfirmOf = (p = {}) => p.MBI2_CONFIRM ?? MBI2_CONFIRM;
  }
});

// src/lib/recentFocusMath.ts
function recentFocus(hours, weight, minutes) {
  if (!(hours > 0) || !Number.isFinite(hours) || !(weight >= 1) || !Number.isFinite(weight) || !(minutes > 0)) throw Error("最近加权时长须为正数，权重须为大于等于1的有限数");
  const bars = Math.max(1, Math.round(hours * 60 / minutes));
  if (!Number.isSafeInteger(bars) || bars > 1e5) throw Error("最近加权时长超出有效根数");
  return { bars, weight };
}
function focusRolling(x, n, f, kind) {
  const out = new Float64Array(x.length).fill(NaN), l = Math.min(n, f.bars), d = f.weight - 1, d2 = f.weight * f.weight - 1;
  let sum2 = 0, sq = 0, count = 0, recent = 0, recentSq = 0, recentCount = 0;
  for (let t = 0; t < x.length; t++) {
    if (Number.isFinite(x[t])) {
      sum2 += x[t];
      sq += x[t] * x[t];
      count++;
      recent += x[t];
      recentSq += x[t] * x[t];
      recentCount++;
    }
    if (t >= n && Number.isFinite(x[t - n])) {
      sum2 -= x[t - n];
      sq -= x[t - n] * x[t - n];
      count--;
    }
    if (t >= l && Number.isFinite(x[t - l])) {
      recent -= x[t - l];
      recentSq -= x[t - l] * x[t - l];
      recentCount--;
    }
    if (!count || (kind === "sma" || kind === "sum") && (t < n - 1 || count !== n)) continue;
    const w = count + d * recentCount, w2 = count + d2 * recentCount, mean = (sum2 + d * recent) / w;
    if (kind === "avg" || kind === "sma") {
      out[t] = mean;
      continue;
    }
    if (kind === "sum" || kind === "rsum") {
      out[t] = mean * count;
      continue;
    }
    if (count < 2) continue;
    const numerator = sq + d * recentSq - w * mean * mean, den = w - w2 / w, sd = den > 0 && numerator > 0 ? Math.sqrt(numerator / den) : 0;
    out[t] = kind === "sd" ? sd : Number.isFinite(x[t]) && sd > 1e-12 * Math.max(1, Math.abs(mean)) ? (x[t] - mean) / sd : NaN;
  }
  return out;
}
function focusEma(x, base, rho, f, explicitSeed = false, resets, seed) {
  const out = new Float64Array(x.length).fill(NaN), counts = new Int32Array(x.length);
  let sum2 = 0, mass = 0, count = 0, first = -1, start = 0;
  let seedSum = 0, seedCount = 0;
  for (let t = 0; t < x.length; t++) {
    if (resets?.[t]) {
      sum2 = mass = count = 0;
      first = -1;
      start = t;
    }
    if (Number.isFinite(x[t])) {
      const initial = first < 0;
      if (initial) first = t;
      count++;
      sum2 *= rho;
      mass *= rho;
      const w = initial && !explicitSeed ? 1 : 1 - rho;
      sum2 += w * x[t];
      mass += w;
    }
    counts[t] = count;
    const old = t - f.bars;
    if (old >= start && Number.isFinite(x[old])) {
      const w = (old === first && !explicitSeed ? 1 : 1 - rho) * rho ** (count - counts[old]);
      sum2 -= w * x[old];
      mass -= w;
    }
    if (!Number.isFinite(base[t])) continue;
    if (seed) {
      if (Number.isFinite(seed.values[t])) {
        seedSum += seed.values[t];
        seedCount++;
      }
      if (old >= 0 && Number.isFinite(seed.values[old])) {
        seedSum -= seed.values[old];
        seedCount--;
      }
    }
    const recentSum = sum2 + (seed ? rho ** count * seedSum / seed.n : 0), recentMass = mass + (seed ? rho ** count * seedCount / seed.n : 0);
    const delta = recentSum - recentMass * base[t], roundoff = Number.EPSILON * 32 * Math.max(Number.MIN_VALUE, Math.abs(recentSum), Math.abs(recentMass * base[t]));
    out[t] = base[t] + (Math.abs(delta) <= roundoff ? 0 : (f.weight - 1) * delta / (1 + (f.weight - 1) * Math.max(0, recentMass)));
  }
  return out;
}
function focusRetain(k, p, e, rho, n, f, resume) {
  const out = focusOutput(p.length, resume);
  for (let t = resume?.from ?? 0; t < p.length; t++) {
    if (!(p[t] > 0)) continue;
    let sum2 = 0, weights = 0;
    const logP = Math.log(p[t]);
    for (let j = 0; j < n && j <= t; j++) {
      const w = rho ** j * (j < f.bars ? f.weight : 1);
      weights += w;
      if (Number.isFinite(k[t - j]) && e[t - j] > 0 && Number.isFinite(e[t - j])) sum2 += w * k[t - j] * (logP - Math.log(e[t - j])) / (j + 1);
    }
    out[t] = sum2 / weights;
  }
  return out;
}
function focusWsum(x, rho, n, f, resume) {
  const out = focusOutput(x.length, resume);
  for (let t = resume?.from ?? 0; t < x.length; t++) {
    let sum2 = 0, oldMass = 0, mass = 0, any = false;
    for (let j = 0; j < n && j <= t; j++) {
      const old = rho ** j, w = old * (j < f.bars ? f.weight : 1);
      oldMass += old;
      mass += w;
      if (Number.isFinite(x[t - j])) {
        sum2 += w * x[t - j];
        any = true;
      }
    }
    if (any) out[t] = sum2 * oldMass / mass;
  }
  return out;
}
function weightedMedian(values) {
  values.sort((a, b) => a.x - b.x);
  const total = values.reduce((n, v) => n + v.w, 0);
  let sum2 = 0;
  for (let i = 0; i < values.length; i++) {
    sum2 += values[i].w;
    if (Math.abs(sum2 - total / 2) <= Number.EPSILON * 16 * total && i + 1 < values.length) return (values[i].x + values[i + 1].x) / 2;
    if (sum2 > total / 2) return values[i].x;
  }
  return values.at(-1)?.x ?? NaN;
}
function focusRobust(x, n, f, kind, resume) {
  const out = focusOutput(x.length, resume);
  for (let t = resume?.from ?? 0; t < x.length; t++) {
    const values = [];
    for (let j = 0; j < n && j <= t; j++) if (Number.isFinite(x[t - j])) values.push({ x: x[t - j], w: j < f.bars ? f.weight : 1 });
    if (!values.length) continue;
    const median = weightedMedian([...values]);
    if (kind === "median") {
      out[t] = median;
      continue;
    }
    const deviations = values.map((v) => ({ x: Math.abs(v.x - median), w: v.w })), mad = weightedMedian([...deviations]);
    out[t] = kind === "mad" ? mad : mad > 0 ? 1.4826 * mad : 1.2533 * deviations.reduce((s, v) => s + v.x * v.w, 0) / deviations.reduce((s, v) => s + v.w, 0);
  }
  return out;
}
function focusBeta(y, x, n, f, resume) {
  const out = focusOutput(y.length, resume);
  for (let t = resume?.from ?? 0; t < y.length; t++) {
    let sx = 0, sy = 0, sxy = 0, sxx = 0, w = 0, count = 0;
    for (let j = 0; j < n && j <= t; j++) if (Number.isFinite(x[t - j]) && Number.isFinite(y[t - j])) {
      const a = j < f.bars ? f.weight : 1;
      w += a;
      count++;
      sx += a * x[t - j];
      sy += a * y[t - j];
      sxy += a * x[t - j] * y[t - j];
      sxx += a * x[t - j] ** 2;
    }
    const den = w * sxx - sx * sx;
    if (count >= 2 && den > 1e-18 * Math.max(1, w * sxx)) out[t] = (w * sxy - sx * sy) / den;
  }
  return out;
}
function focusMbiKappa(n, f) {
  const rho = 1 - 1 / n, tail = rho ** f.bars, den = 1 + (f.weight - 1) * (1 - tail);
  let sum2 = tail * tail / (1 - rho * rho);
  for (let j = 0; j < f.bars; j++) sum2 += (f.weight * rho ** j - (f.weight - 1) * tail) ** 2;
  return Math.sqrt(sum2) / den;
}
function focusMbiZ(closes, n, f, second = false) {
  const original = second ? computeMbi2Core(closes, n) : computeMbi(closes, { MBI_N: n }), out = new Float64Array(closes.length).fill(NaN);
  if (original.initialVariance == null) return out;
  const x = Float64Array.from(closes, (v) => v > 0 && Number.isFinite(v) ? Math.log(v) : NaN), first = x.findIndex(Number.isFinite);
  if (first < 0) return out;
  const means = new Float64Array(x.length).fill(NaN), variance = new Float64Array(x.length).fill(NaN), returns = new Float64Array(x.length).fill(NaN), rho = 1 - 1 / n;
  let m = x[first], s = original.initialVariance;
  means[first] = m;
  variance[first] = s;
  for (let t = first + 1; t < x.length; t++) {
    if (Number.isFinite(x[t])) {
      m = rho * m + x[t] / n;
      if (Number.isFinite(x[t - 1])) {
        returns[t] = (x[t] - x[t - 1]) ** 2;
        s = rho * s + returns[t] / n;
      }
    }
    means[t] = m;
    variance[t] = s;
  }
  const seedValues = new Float64Array(x.length).fill(NaN);
  let seedCount = 0;
  for (let t = first + 1; t < x.length && seedCount < n; t++) if (Number.isFinite(returns[t])) {
    seedValues[t] = returns[t];
    seedCount++;
  }
  const focusedM = focusEma(x, means, rho, f), focusedS = focusEma(returns, variance, rho, f, true, void 0, { values: seedValues, n }), kappa = focusMbiKappa(n, f);
  for (let t = first + 1; t < x.length; t++) if (Number.isFinite(original.z[t]) && Number.isFinite(focusedM[t - 1]) && Number.isFinite(focusedS[t - 1])) out[t] = focusedS[t - 1] > 0 ? (x[t] - focusedM[t - 1]) / (kappa * Math.sqrt(focusedS[t - 1])) : 0;
  return out;
}
function focusAtr(h, l, c, n, base, f) {
  const tr = new Float64Array(c.length).fill(NaN), ranks = new Int32Array(c.length), out = new Float64Array(c.length).fill(NaN), rho = 1 - 1 / n;
  let count = 0;
  for (let t = 0; t < c.length; t++) {
    const pc = t > 0 ? c[t - 1] : NaN;
    tr[t] = Number.isFinite(pc) ? Math.max(h[t] - l[t], Math.abs(h[t] - pc), Math.abs(l[t] - pc)) : h[t] - l[t];
    if (Number.isFinite(tr[t])) count++;
    ranks[t] = count;
    if (!Number.isFinite(base[t])) continue;
    let sum2 = 0, mass = 0;
    for (let j = Math.max(0, t - f.bars + 1); j <= t; j++) if (Number.isFinite(tr[j])) {
      const w = rho ** (count - Math.max(n, ranks[j])) / n;
      sum2 += w * tr[j];
      mass += w;
    }
    out[t] = (base[t] + (f.weight - 1) * sum2) / (1 + (f.weight - 1) * mass);
  }
  return out;
}
var FOCUS_BASE_ARITIES, focusOutput;
var init_recentFocusMath = __esm({
  "src/lib/recentFocusMath.ts"() {
    init_mbi();
    init_mbi2();
    FOCUS_BASE_ARITIES = { avg: [2], sd: [2], zscore: [2], ema: [2, 3], retain: [4, 5], wsum: [3], rsum: [2], median: [2], mad: [2], rscale: [2], sma: [2], sum: [2], msum: [2], atr: [4], beta: [3], mbiz: [2], mbiz2: [2], ctba: [17] };
    focusOutput = (size, resume) => {
      const out = new Float64Array(size).fill(NaN);
      if (resume) out.set(resume.previous.subarray(0, Math.min(resume.from, size)));
      return out;
    };
  }
});

// src/lib/ctba.ts
function validateCtba(p) {
  for (const k of ["N", "f", "s", "m"]) if (!Number.isSafeInteger(p[k]) || p[k] < (k === "m" ? 2 : 1)) throw Error("CTBA " + k + " 必须为有效正整数（m ≥ 2）");
  if (p.f >= p.s) throw Error("CTBA 必须满足 f < s");
  if (!Number.isFinite(p.lambda) || p.lambda < 0 || !Number.isFinite(p.epsilon) || p.epsilon <= 0) throw Error("CTBA 要求 λ ≥ 0，ε > 0");
  if (![p.alpha, p.beta, p.gamma].every((v) => Number.isFinite(v) && v >= 0) || Math.abs(p.alpha + p.beta + p.gamma - 1) > 1e-12) throw Error("CTBA 权重必须非负且合计为 1");
}
function computeCtbaSeries(b, p = { ...CTBA_DEFAULTS }, focus) {
  validateCtba(p);
  const size = b.C.length, blank = () => new Float64Array(size).fill(NaN);
  const T = blank(), M = blank(), F = blank(), CTBA = blank(), noTrade = blank(), complete = new Float64Array(size);
  const rho = Math.exp(-p.lambda), tail = rho ** p.N, af = 2 / (p.f + 1), as = 2 / (p.s + 1);
  let ef = NaN, es = NaN, emaCount = 0, weightedB = 0, weightedS = 0, missing = 0;
  const buys = blank(), sells = blank(), returns = blank();
  const focused = focus && focus.weight > 1, logE = focused ? blank() : null, fast = focused ? blank() : null, slow = focused ? blank() : null, resets = focused ? new Uint8Array(size) : null;
  for (let t = 0; t < size; t++) {
    const amountOk = Number.isFinite(b.B[t]) && b.B[t] >= 0 && Number.isFinite(b.S[t]) && b.S[t] >= 0;
    buys[t] = amountOk ? b.B[t] : NaN;
    sells[t] = amountOk ? b.S[t] : NaN;
    if (!amountOk) missing++;
    if (t >= p.N && !Number.isFinite(buys[t - p.N])) missing--;
    weightedB = (amountOk ? buys[t] : 0) + rho * weightedB;
    weightedS = (amountOk ? sells[t] : 0) + rho * weightedS;
    if (t >= p.N) {
      weightedB -= tail * (Number.isFinite(buys[t - p.N]) ? buys[t - p.N] : 0);
      weightedS -= tail * (Number.isFinite(sells[t - p.N]) ? sells[t - p.N] : 0);
    }
    const gap = t > 0 && b.time[t] - b.time[t - 1] !== 3e5;
    if (gap) {
      ef = es = NaN;
      emaCount = 0;
      if (resets) resets[t] = 1;
    }
    const e = b.E[t], prior = t > 0 ? b.E[t - 1] : NaN;
    if (e > 0 && Number.isFinite(e)) {
      const x = Math.log(e);
      ef = Number.isFinite(ef) ? ef + af * (x - ef) : x;
      es = Number.isFinite(es) ? es + as * (x - es) : x;
      emaCount++;
      if (!gap && prior > 0 && Number.isFinite(prior)) returns[t] = Math.log(e / prior);
    } else {
      ef = es = NaN;
      emaCount = 0;
      if (resets) resets[t] = 1;
    }
    if (logE && fast && slow) {
      logE[t] = e > 0 && Number.isFinite(e) ? Math.log(e) : NaN;
      fast[t] = ef;
      slow[t] = es;
    }
    if (t >= p.N - 1 && missing === 0 && b.time[t] - b.time[t - p.N + 1] === (p.N - 1) * 3e5) {
      let total = 0;
      for (let j = t - p.N + 1; j <= t; j++) total += buys[j] + sells[j];
      noTrade[t] = total === 0 ? 1 : 0;
      F[t] = total === 0 ? 0 : (weightedB - weightedS) / (weightedB + weightedS + p.epsilon);
    }
    if (t >= p.N && b.time[t] - b.time[t - p.N] === p.N * 3e5 && b.C[t] > 0 && Number.isFinite(b.C[t])) {
      let hi = -Infinity, lo = Infinity, ok = true;
      for (let j = t - p.N; j < t; j++) {
        if (!(b.H[j] > 0 && b.L[j] > 0 && Number.isFinite(b.H[j]) && Number.isFinite(b.L[j]) && b.H[j] >= b.L[j])) {
          ok = false;
          break;
        }
        hi = Math.max(hi, b.H[j]);
        lo = Math.min(lo, b.L[j]);
      }
      if (ok) T[t] = hi === lo ? 0 : 2 * (b.C[t] - lo) / (hi - lo) - 1;
    }
    if (t >= p.m && emaCount >= 5 * p.s) {
      let sum2 = 0, ok = true;
      for (let j = t - p.m + 1; j <= t; j++) {
        if (!Number.isFinite(returns[j])) {
          ok = false;
          break;
        }
        sum2 += returns[j];
      }
      if (ok) {
        const mean = sum2 / p.m;
        let sq = 0;
        for (let j = t - p.m + 1; j <= t; j++) sq += (returns[j] - mean) ** 2;
        M[t] = (ef - es) / (Math.sqrt(sq / (p.m - 1)) + p.epsilon);
      }
    }
    if ([T[t], M[t], F[t]].every(Number.isFinite)) {
      complete[t] = 1;
      CTBA[t] = 100 * Math.tanh(p.alpha * Math.tanh(T[t]) + p.beta * Math.tanh(M[t]) + p.gamma * F[t]);
    }
  }
  if (focused && logE && fast && slow && resets) {
    const ef2 = focusEma(logE, fast, 1 - af, focus, false, resets), es2 = focusEma(logE, slow, 1 - as, focus, false, resets);
    const sd = focusRolling(returns, p.m, focus, "sd"), wb = focusWsum(buys, rho, p.N, focus), ws = focusWsum(sells, rho, p.N, focus);
    for (let t = 0; t < size; t++) {
      if (Number.isFinite(M[t])) M[t] = (ef2[t] - es2[t]) / (sd[t] + p.epsilon);
      if (Number.isFinite(F[t])) F[t] = noTrade[t] === 1 ? 0 : (wb[t] - ws[t]) / (wb[t] + ws[t] + p.epsilon);
      CTBA[t] = [T[t], M[t], F[t]].every(Number.isFinite) ? 100 * Math.tanh(p.alpha * Math.tanh(T[t]) + p.beta * Math.tanh(M[t]) + p.gamma * F[t]) : NaN;
      complete[t] = Number.isFinite(CTBA[t]) ? 1 : 0;
    }
  }
  return { T, M, F, CTBA, noTrade, complete };
}
function ctbaFormula(p = { ...CTBA_DEFAULTS }) {
  validateCtba(p);
  const args = "C,H,L,E,B,S,clock,N,f,s,m,lambda,epsilon,alpha,ctba_beta,gamma";
  return [
    "# CTBA v1：5m 已收盘；参数以根计；真实 E=成交金额/成交数量",
    ...Object.entries(p).map(([k, v]) => (k === "beta" ? "ctba_beta" : k) + " = " + v + (k === "beta" ? " # β：趋势动能权重" : "")),
    "ctba_version = 1",
    "# EMA α=2/(k+1)，从首个有效 ln(E) 起算，连续 5s 根预热；Std 使用样本标准差（m−1）",
    "clock = T",
    ...["T", "M", "F", "no_trade", "data_complete", "CTBA"].map((name, i) => name + " = ctba(" + args + "," + [0, 1, 2, 4, 5, 3][i] + ")")
  ].join("\n");
}
var CTBA_DEFAULTS, CTBA_12H_DEFAULTS, CTBA_ABSOLUTE_BOUND, CTBA_DESCRIPTION;
var init_ctba = __esm({
  "src/lib/ctba.ts"() {
    init_recentFocusMath();
    CTBA_DEFAULTS = { N: 576, f: 12, s: 48, m: 48, lambda: Math.LN2 / 144, epsilon: 1e-12, alpha: 0.35, beta: 0.4, gamma: 0.25 };
    CTBA_12H_DEFAULTS = Object.freeze({ N: 144, f: 8, s: 24, m: 48, lambda: Math.LN2 / 24, epsilon: 1e-12, alpha: 0.35, beta: 0.4, gamma: 0.25 });
    CTBA_ABSOLUTE_BOUND = 100 * Math.tanh(1);
    CTBA_DESCRIPTION = "CTBA｜趋势买方优势：100·tanh[α·tanh(T)+β·tanh(M)+γ·F]。T 为不含当根的历史区间位置（不截断），M 为真实 VWAP 对数的快慢 EMA 差除以近期收益率标准差，F 为主动买卖成交金额的衰减加权差额。正负表示综合方向，不是上涨概率；这是趋势跟踪思想的扩展模型。";
  }
});

// src/lib/sellerResponse.ts
function sellerResponse(value, gain, scale) {
  if (![value, gain, scale].every(Number.isFinite) || !(gain > 0) || !(scale > 0) || Math.abs(value) > scale) return NaN;
  if (value === 0) return 0;
  if (value > 0 || gain === 1 || value === -scale) return value;
  const x = value / scale;
  return scale * (gain === 2 ? 2 * x / (1 + x * x) : Math.tanh(gain * Math.atanh(x)));
}
var init_sellerResponse = __esm({
  "src/lib/sellerResponse.ts"() {
  }
});

// src/lib/deepDig/formula.ts
function tokenize(src) {
  const text = [...src].map((ch) => NORMALIZE[ch] ?? ch).join("");
  const out = [];
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n") {
      out.push({ t: "sep", line });
      line++;
      i++;
      continue;
    }
    if (ch === ";") {
      out.push({ t: "sep", line });
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "#" || ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]), line });
      i += num[0].length;
      continue;
    }
    const id = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(text.slice(i));
    if (id) {
      const kw = KEYWORDS[id[0]];
      out.push(kw ? { t: "op", v: kw, line } : { t: "id", v: id[0], line });
      i += id[0].length;
      continue;
    }
    const two = text.slice(i, i + 2);
    if ([">=", "<=", "==", "!=", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two === "&&" ? "and" : two === "||" ? "or" : two, line });
      i += 2;
      continue;
    }
    if ("+-*/^()<>=,!".includes(ch)) {
      out.push({ t: "op", v: ch === "!" ? "not" : ch, line });
      i++;
      continue;
    }
    throw new FormulaError(`看不懂「${ch}」`, line);
  }
  out.push({ t: "end", line });
  return out;
}
function programHistoryBars(program2, params, barMinutes, mbiWarmupOnly = false) {
  const constants = new Map(Object.entries(params));
  const history = /* @__PURE__ */ new Map();
  const scalar = (n) => {
    try {
      const value = evaluateNode(n, constants, barMinutes);
      return typeof value === "number" ? value : NaN;
    } catch {
      return NaN;
    }
  };
  const depth = (n) => {
    if (Number.isFinite(scalar(n))) return 0;
    if (n.k === "num") return 0;
    if (n.k === "var") return history.get(n.name) ?? 0;
    if (n.k === "un") return depth(n.a);
    if (n.k === "bin") return Math.max(depth(n.a), depth(n.b));
    const inherited = Math.max(0, ...n.args.map(depth));
    const arg = (i, fallback = NaN) => n.args[i] ? scalar(n.args[i]) : fallback;
    let extra = 0;
    if (["avg", "sd", "median", "mad", "rscale", "zscore", "rsum"].includes(n.name)) extra = barsForHours(arg(1), barMinutes) - 1;
    else if (["full", "peak", "sma", "sum", "highest", "lowest", "msum"].includes(n.name)) extra = arg(1) - 1;
    else if (n.name === "wsum") extra = arg(2) - 1;
    else if (n.name === "prev") extra = arg(1, 1);
    else if (n.name === "ago") extra = barsForHours(arg(1), barMinutes);
    else if (n.name === "beta") extra = barsForHours(arg(2), barMinutes) - 1;
    else if (n.name === "atr") extra = arg(3);
    else if (n.name === "ctba") extra = Math.max(arg(7), 5 * arg(9), arg(10)) + 1;
    else if (n.name === "mbiz" || n.name === "mbiz2") extra = 5 * arg(1);
    else if (n.name === "retain") extra = barsForHours(n.args.length === 6 ? 48 : arg(4, 48), barMinutes) - 1;
    if (mbiWarmupOnly && !["mbiz", "mbiz2"].includes(n.name)) extra = 0;
    return inherited + (Number.isFinite(extra) ? Math.max(0, extra) : 0);
  };
  let max = 0;
  for (const statement of program2.statements) {
    const d = depth(statement.expr);
    max = Math.max(max, d);
    if (statement.name) {
      history.set(statement.name, d);
      constants.set(statement.name, scalar(statement.expr));
    }
  }
  return Math.ceil(max);
}
function parseFormula(src, known) {
  const statements = new Parser(tokenize(src)).program();
  if (!statements.length) throw new FormulaError("还没写公式", 1);
  const defined = /* @__PURE__ */ new Set();
  const inputs = /* @__PURE__ */ new Set();
  const check2 = (n) => {
    if (n.k === "var") {
      if (defined.has(n.name)) return;
      if (known.has(n.name)) {
        inputs.add(n.name);
        return;
      }
      throw new FormulaError(`不认识「${n.name}」：可用的名字见「可用写法」，中间量要先「${n.name} = …」再用`, n.line);
    }
    if (n.k === "un") check2(n.a);
    else if (n.k === "bin") {
      check2(n.a);
      check2(n.b);
    } else if (n.k === "call") {
      const spec = FN.get(n.name);
      if (!spec) throw new FormulaError(`没有「${n.name}」这个函数`, n.line);
      if (n.args.length < spec.min || n.args.length > spec.max || spec.counts && !spec.counts.includes(n.args.length)) throw new FormulaError(`${spec.usage} 的参数个数不对`, n.line);
      n.args.forEach(check2);
    }
  };
  for (const s of statements) {
    check2(s.expr);
    if (s.name) {
      if (FN.has(s.name)) throw new FormulaError(`「${s.name}」是函数名，换个名字`, s.line);
      defined.add(s.name);
    }
  }
  return { statements, inputs };
}
function lengthOf(...vs) {
  let n = -1;
  for (const v of vs) if (isSeries(v)) n = Math.max(n, v.length);
  return n;
}
function map1(a, f, resume) {
  if (!isSeries(a)) return f(a);
  const out = resumedOutput(a.length, resume);
  for (let i = resume?.from ?? 0; i < a.length; i++) out[i] = f(a[i]);
  return out;
}
function map2(a, b, f, resume) {
  const sa = isSeries(a);
  const sb = isSeries(b);
  if (!sa && !sb) return f(a, b);
  const n = lengthOf(a, b);
  const out = resumedOutput(n, resume);
  if (sa && sb) {
    const A = a;
    const B = b;
    if (A.length === n && B.length === n) for (let i = resume?.from ?? 0; i < n; i++) out[i] = f(A[i], B[i]);
    else for (let i = resume?.from ?? 0; i < n; i++) out[i] = f(at(A, i), at(B, i));
  } else if (sa) {
    const A = a;
    const y = b;
    for (let i = resume?.from ?? 0; i < n; i++) out[i] = f(A[i], y);
  } else {
    const x = a;
    const B = b;
    for (let i = resume?.from ?? 0; i < n; i++) out[i] = f(x, B[i]);
  }
  return out;
}
function map3(a, b, c, f, resume) {
  const n = lengthOf(a, b, c);
  if (n < 0) return f(a, b, c);
  const out = resumedOutput(n, resume);
  for (let i = resume?.from ?? 0; i < n; i++) out[i] = f(at(a, i), at(b, i), at(c, i));
  return out;
}
function rollingMean(x, n, resume) {
  const out = resumedOutput(x.length, resume);
  const sums = checkpoint(resume, "sum", x.length), counts = checkpoint(resume, "count", x.length);
  let sum2 = resume?.from ? sums[resume.from - 1] : 0;
  let count = resume?.from ? counts[resume.from - 1] : 0;
  for (let i = resume?.from ?? 0; i < x.length; i++) {
    if (Number.isFinite(x[i])) {
      sum2 += x[i];
      count++;
    }
    const drop = i - n;
    if (drop >= 0 && Number.isFinite(x[drop])) {
      sum2 -= x[drop];
      count--;
    }
    if (sums && counts) {
      sums[i] = sum2;
      counts[i] = count;
    }
    out[i] = count > 0 ? clean(sum2 / count) : Number.NaN;
  }
  return out;
}
function shiftBars(x, k, resume) {
  const out = resumedOutput(x.length, resume);
  for (let i = resume?.from ?? 0; i < x.length; i++) out[i] = i >= k ? x[i - k] : Number.NaN;
  return out;
}
function rollingZScore(x, n, resume) {
  const out = resumedOutput(x.length, resume);
  const sums = checkpoint(resume, "sum", x.length), counts = checkpoint(resume, "count", x.length);
  let sum2 = resume?.from ? sums[resume.from - 1] : 0;
  const squares = checkpoint(resume, "sq", x.length);
  let sq = resume?.from ? squares[resume.from - 1] : 0;
  let count = resume?.from ? counts[resume.from - 1] : 0;
  for (let i = resume?.from ?? 0; i < x.length; i++) {
    if (Number.isFinite(x[i])) {
      sum2 += x[i];
      sq += x[i] * x[i];
      count++;
    }
    const drop = i - n;
    if (drop >= 0 && Number.isFinite(x[drop])) {
      sum2 -= x[drop];
      sq -= x[drop] * x[drop];
      count--;
    }
    if (sums && counts) {
      sums[i] = sum2;
      counts[i] = count;
      squares[i] = sq;
    }
    if (!Number.isFinite(x[i]) || count < 2) {
      out[i] = Number.NaN;
      continue;
    }
    const mean = sum2 / count;
    const variance = (sq - count * mean * mean) / (count - 1);
    const sd = variance > 0 ? Math.sqrt(variance) : 0;
    out[i] = sd > 1e-12 * Math.max(1, Math.abs(mean)) ? clean((x[i] - mean) / sd) : Number.NaN;
  }
  return out;
}
function rollingSd(x, n, resume) {
  const out = resumedOutput(x.length, resume);
  const sums = checkpoint(resume, "sum", x.length), counts = checkpoint(resume, "count", x.length);
  let sum2 = resume?.from ? sums[resume.from - 1] : 0;
  const squares = checkpoint(resume, "sq", x.length);
  let sq = resume?.from ? squares[resume.from - 1] : 0;
  let count = resume?.from ? counts[resume.from - 1] : 0;
  for (let i = resume?.from ?? 0; i < x.length; i++) {
    if (Number.isFinite(x[i])) {
      sum2 += x[i];
      sq += x[i] * x[i];
      count++;
    }
    const drop = i - n;
    if (drop >= 0 && Number.isFinite(x[drop])) {
      sum2 -= x[drop];
      sq -= x[drop] * x[drop];
      count--;
    }
    if (sums && counts) {
      sums[i] = sum2;
      counts[i] = count;
      squares[i] = sq;
    }
    if (count < 2) {
      out[i] = Number.NaN;
      continue;
    }
    const mean = sum2 / count;
    const variance = (sq - count * mean * mean) / (count - 1);
    out[i] = variance > 0 ? Math.sqrt(variance) : 0;
  }
  return out;
}
function checkpoint(resume, key, length) {
  if (!resume?.states) return void 0;
  const old = resume.states.get(key);
  if (old?.length === length) return old;
  if (old && old.byteOffset + length * 8 <= old.buffer.byteLength) {
    const next2 = new Float64Array(old.buffer, old.byteOffset, length);
    resume.states.set(key, next2);
    return next2;
  }
  const capacity = length > 0 ? 2 ** Math.ceil(Math.log2(length)) : 0;
  const next = new Float64Array(capacity).subarray(0, length);
  if (old) next.set(old.subarray(0, Math.min(old.length, length)));
  resume.states.set(key, next);
  return next;
}
function retainSum(k, p, e0, rho, n, resume) {
  const N = p.length;
  const out = resumedOutput(N, resume);
  const lnE0 = checkpoint(resume, "logE0", N) ?? new Float64Array(N);
  for (let i = resume?.from ?? 0; i < N; i++) lnE0[i] = e0[i] > 0 ? Math.log(e0[i]) : NaN;
  const c = new Float64Array(n);
  for (let j = 0, r = 1; j < n; j++, r *= rho) c[j] = r / (j + 1);
  for (let t = resume?.from ?? 0; t < N; t++) {
    const pt = p[t];
    if (!(pt > 0)) {
      out[t] = Number.NaN;
      continue;
    }
    const lnP = Math.log(pt);
    const m = Math.min(n, t + 1);
    let sum2 = 0;
    for (let j = 0; j < m; j++) {
      const kk = k[t - j];
      const le = lnE0[t - j];
      if (Number.isFinite(kk) && Number.isFinite(le)) sum2 += c[j] * kk * (lnP - le);
    }
    const z = rho === 1 ? m : (1 - rho ** m) / (1 - rho);
    out[t] = clean(sum2 / z);
  }
  return out;
}
function rollingSorted(x, n, fn, resume) {
  const out = resumedOutput(x.length, resume);
  const win = [];
  const lowerBound = (v) => {
    let lo = 0;
    let hi = win.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (win[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const start = Math.max(0, (resume?.from ?? 0) - n + 1);
  for (let i = start; i < x.length; i++) {
    if (Number.isFinite(x[i])) win.splice(lowerBound(x[i]), 0, x[i]);
    const drop = i - n;
    if (drop >= start && Number.isFinite(x[drop])) win.splice(lowerBound(x[drop]), 1);
    if (i >= (resume?.from ?? 0)) out[i] = win.length ? fn(win) : Number.NaN;
  }
  return out;
}
function madOfSorted(s) {
  const m = medianOfSorted(s);
  const len = s.length;
  let lo = 0;
  let hi = len;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (s[mid] < m) lo = mid + 1;
    else hi = mid;
  }
  const p = lo;
  const aAt = (i) => m - s[p - 1 - i];
  const bAt = (j) => s[p + j] - m;
  const kth = (k) => {
    let aOff = 0;
    let bOff = 0;
    const aLen = p;
    const bLen = len - p;
    for (; ; ) {
      if (aOff === aLen) return bAt(bOff + k);
      if (bOff === bLen) return aAt(aOff + k);
      if (k === 0) return Math.min(aAt(aOff), bAt(bOff));
      const half = k + 1 >> 1;
      const ai = Math.min(aOff + half, aLen) - 1;
      const bi = Math.min(bOff + half, bLen) - 1;
      if (aAt(ai) <= bAt(bi)) {
        k -= ai - aOff + 1;
        aOff = ai + 1;
      } else {
        k -= bi - bOff + 1;
        bOff = bi + 1;
      }
    }
  };
  const h = len >> 1;
  return len % 2 ? kth(h) : (kth(h - 1) + kth(h)) / 2;
}
function rollingSum(x, n, resume) {
  const out = resumedOutput(x.length, resume);
  const sums = checkpoint(resume, "sum", x.length), counts = checkpoint(resume, "count", x.length);
  let sum2 = resume?.from ? sums[resume.from - 1] : 0;
  let count = resume?.from ? counts[resume.from - 1] : 0;
  for (let i = resume?.from ?? 0; i < x.length; i++) {
    if (Number.isFinite(x[i])) {
      sum2 += x[i];
      count++;
    }
    const drop = i - n;
    if (drop >= 0 && Number.isFinite(x[drop])) {
      sum2 -= x[drop];
      count--;
    }
    if (sums && counts) {
      sums[i] = sum2;
      counts[i] = count;
    }
    out[i] = count > 0 ? clean(sum2) : Number.NaN;
  }
  return out;
}
function rollingExtreme(x, n, max, resume) {
  const out = resumedOutput(x.length, resume);
  for (let t = resume?.from ?? 0; t < x.length; t++) {
    let best = Number.NaN;
    for (let k = 0; k < n && k <= t; k++) {
      const v = x[t - k];
      if (Number.isFinite(v) && (Number.isNaN(best) || (max ? v > best : v < best))) best = v;
    }
    out[t] = best;
  }
  return out;
}
function rollingBeta(y, x, n) {
  const out = new Float64Array(y.length);
  let sx = 0, sy = 0, sxy = 0, sxx = 0, c = 0;
  const ok = (i) => Number.isFinite(x[i]) && Number.isFinite(y[i]);
  for (let i = 0; i < y.length; i++) {
    if (ok(i)) {
      sx += x[i];
      sy += y[i];
      sxy += x[i] * y[i];
      sxx += x[i] * x[i];
      c++;
    }
    const drop = i - n;
    if (drop >= 0 && ok(drop)) {
      sx -= x[drop];
      sy -= y[drop];
      sxy -= x[drop] * y[drop];
      sxx -= x[drop] * x[drop];
      c--;
    }
    const den = c * sxx - sx * sx;
    out[i] = c >= 2 && den > 1e-18 * Math.max(1, c * sxx) ? clean((c * sxy - sx * sy) / den) : Number.NaN;
  }
  return out;
}
function wsumBars(x, h, n, resume) {
  const out = resumedOutput(x.length, resume);
  const w = Float64Array.from({ length: n }, (_, k) => 2 ** (-k / h));
  for (let t = resume?.from ?? 0; t < x.length; t++) {
    let sum2 = 0;
    let any = false;
    for (let k = 0; k < n && k <= t; k++) {
      const v = x[t - k];
      if (Number.isFinite(v)) {
        sum2 += w[k] * v;
        any = true;
      }
    }
    out[t] = any ? clean(sum2) : Number.NaN;
  }
  return out;
}
function atrSeries(h, l, c, n) {
  const out = new Float64Array(c.length).fill(Number.NaN);
  let atr = Number.NaN;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < c.length; i++) {
    const pc = i > 0 ? c[i - 1] : Number.NaN;
    const hl = h[i] - l[i];
    const tr = Number.isFinite(pc) ? Math.max(hl, Math.abs(h[i] - pc), Math.abs(l[i] - pc)) : hl;
    if (Number.isFinite(tr)) {
      if (Number.isNaN(atr)) {
        seedSum += tr;
        seedCount++;
        if (seedCount === n) atr = seedSum / n;
      } else {
        atr = (atr * (n - 1) + tr) / n;
      }
    }
    out[i] = atr;
  }
  return out;
}
function binary(op, a, b, resume) {
  switch (op) {
    case "+":
      return map2(a, b, (x, y) => clean(x + y), resume);
    case "-":
      return map2(a, b, (x, y) => clean(x - y), resume);
    case "*":
      return map2(a, b, (x, y) => clean(x * y), resume);
    case "/":
      return map2(a, b, (x, y) => clean(x / y), resume);
    case "^":
      return map2(a, b, (x, y) => clean(x ** y), resume);
    case ">":
      return map2(a, b, (x, y) => Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x > y ? 1 : 0, resume);
    case "<":
      return map2(a, b, (x, y) => Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x < y ? 1 : 0, resume);
    case ">=":
      return map2(a, b, (x, y) => Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x >= y ? 1 : 0, resume);
    case "<=":
      return map2(a, b, (x, y) => Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x <= y ? 1 : 0, resume);
    case "==":
      return map2(a, b, (x, y) => Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x === y ? 1 : 0, resume);
    case "!=":
      return map2(a, b, (x, y) => Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x !== y ? 1 : 0, resume);
    case "and":
      return map2(a, b, (x, y) => truthy(x) && truthy(y) ? 1 : 0, resume);
    case "or":
      return map2(a, b, (x, y) => truthy(x) || truthy(y) ? 1 : 0, resume);
    default:
      throw new Error(op);
  }
}
function memoCtba(args, focus, memo) {
  const key = [...args.slice(0, 16), focus?.bars ?? 0, focus?.weight ?? 1];
  const prior = memo?.ctba.find((entry) => entry.key.every((v, i) => Object.is(v, key[i])));
  if (prior) return prior.out;
  const [N, f, s, m, lambda, epsilon, alpha, beta, gamma] = args.slice(7, 16);
  const out = computeCtbaSeries({ C: args[0], H: args[1], L: args[2], E: args[3], B: args[4], S: args[5], time: args[6] }, { N, f, s, m, lambda, epsilon, alpha, beta, gamma }, focus);
  memo?.ctba.push({ key, out });
  return out;
}
function call(name, args, line, barMinutes, resume, memo) {
  const arities = FOCUS_BASE_ARITIES[name];
  if (arities?.some((n) => n + 2 === args.length)) {
    const baseArgs = args.slice(0, -2), h = scalarArg(args.at(-2), name, "最近加权小时", line), weight = scalarArg(args.at(-1), name, "最近相对权重", line);
    let f;
    try {
      f = recentFocus(h, weight, barMinutes);
    } catch (error) {
      throw new FormulaError(error.message, line);
    }
    const priorBase = resume?.states?.get("__focus_base");
    const baseResume = resume ? { ...resume, from: priorBase ? Math.min(resume.from, priorBase.length) : 0, previous: priorBase ?? new Float64Array(0) } : void 0;
    const base = call(name, baseArgs, line, barMinutes, baseResume, memo);
    if (isSeries(base)) resume?.states?.set("__focus_base", base);
    if (weight === 1 || !isSeries(base)) return base;
    const [a, b, c] = baseArgs, scalar = (i) => scalarArg(baseArgs[i], name, "参数", line);
    const len = base.length, series = (v) => isSeries(v) ? v : new Float64Array(len).fill(v);
    if (name === "ctba") {
      if (barMinutes !== 5 || !baseArgs.slice(0, 7).every(isSeries)) return base;
      const part = scalarArg(baseArgs[16], name, "参数", line);
      const out = memoCtba(baseArgs, f, memo);
      return [out.T, out.M, out.F, out.CTBA, out.noTrade, out.complete][part];
    }
    if (name === "mbiz" || name === "mbiz2") return focusMbiZ(series(a), scalar(1), f, name === "mbiz2");
    if (name === "ema") return focusEma(series(a), base, 2 ** (-barMinutes / (scalar(1) * 60)), f, baseArgs.length === 3);
    if (name === "retain") return focusRetain(series(a), series(b), series(c), 2 ** (-barMinutes / (scalar(3) * 60)), barsForHours(baseArgs.length === 5 ? scalar(4) : 48, barMinutes), f, resume);
    if (name === "wsum") return focusWsum(series(a), 2 ** (-1 / scalar(1)), scalar(2), f, resume);
    if (name === "atr") return focusAtr(series(a), series(b), series(c), scalar(3), base, f);
    if (name === "beta") return focusBeta(series(a), series(b), barsForHours(scalar(2), barMinutes), f, resume);
    const n = name === "sma" || name === "sum" || name === "msum" ? scalar(1) : barsForHours(scalar(1), barMinutes);
    if (name === "median" || name === "mad" || name === "rscale") return focusRobust(series(a), n, f, name, resume);
    return focusRolling(series(a), n, f, name === "msum" ? "rsum" : name);
  }
  const [x, y, z] = args;
  switch (name) {
    case "ln":
    case "log":
      return map1(x, (v) => clean(Math.log(v)), resume);
    case "exp":
      return map1(x, (v) => clean(Math.exp(v)), resume);
    case "abs":
      return map1(x, Math.abs, resume);
    case "tanh":
      return map1(x, (v) => clean(Math.tanh(v)), resume);
    case "ctba": {
      if (barMinutes !== 5) return isSeries(x) ? new Float64Array(x.length).fill(NaN) : NaN;
      if (!args.slice(0, 7).every(isSeries)) return NaN;
      const values = args.slice(7).map((v) => scalarArg(v, "ctba", "参数", line));
      const part = values[9];
      const out = memoCtba(args, void 0, memo);
      if (!Number.isInteger(part) || part < 0 || part > 5) throw new FormulaError("CTBA 分量编号无效", line);
      return [out.T, out.M, out.F, out.CTBA, out.noTrade, out.complete][part];
    }
    case "mbi2state": {
      if (!isSeries(x) || !isSeries(y)) return NaN;
      const band = scalarArg(args[2], "mbi2state", "BAND", line), confirm = scalarArg(args[3], "mbi2state", "CONFIRM", line), part = scalarArg(args[4], "mbi2state", "part", line);
      if (!Number.isInteger(part) || part < 0 || part > 4) throw new FormulaError("MBI2 状态分量编号无效", line);
      const out = mbi2States(x, barMinutes, { MBI2_BAND: band, MBI2_CONFIRM: confirm }, y);
      return [out.state, out.lead, out.confirm, out.buyStarts, out.buyConfirms][part];
    }
    case "mbiz2": {
      const n = scalarArg(y, "mbiz2", "衰减周期", line);
      return isSeries(x) ? computeMbi2Core(x, n).z : Number.NaN;
    }
    case "mbiz": {
      const n = scalarArg(y, "mbiz", "衰减周期", line);
      if (!Number.isSafeInteger(n) || n < 1) throw new FormulaError("MBI_N 必须是正整数（K 线根数）", line);
      return isSeries(x) ? computeMbi(x, { MBI_N: n }).z : Number.NaN;
    }
    case "seller_response": {
      const gain = scalarArg(y, "seller_response", "负向增益", line), scale = scalarArg(z, "seller_response", "输出尺度", line);
      if (!(gain > 0) || !(scale > 0) || !Number.isFinite(gain) || !Number.isFinite(scale)) throw new FormulaError("负向增益和输出尺度必须为有限正数", line);
      return map1(x, (v) => sellerResponse(v, gain, scale), resume);
    }
    case "sqrt":
      return map1(x, (v) => clean(Math.sqrt(v)), resume);
    case "sign":
      return map1(x, (v) => Number.isNaN(v) ? Number.NaN : Math.sign(v), resume);
    case "max":
      return map2(x, y, (a, b) => Number.isNaN(a) || Number.isNaN(b) ? Number.NaN : Math.max(a, b), resume);
    case "min":
      return map2(x, y, (a, b) => Number.isNaN(a) || Number.isNaN(b) ? Number.NaN : Math.min(a, b), resume);
    case "nz": {
      const v = y == null ? 0 : scalarArg(y, "nz", "替换值", line);
      return map1(x, (a) => Number.isFinite(a) ? a : v, resume);
    }
    case "has":
      return map1(x, (a) => Number.isFinite(a) ? 1 : 0, resume);
    case "if":
      return map3(x, y, z, (c, a, b) => Number.isNaN(c) ? Number.NaN : truthy(c) ? a : b, resume);
    case "prev": {
      const k = y == null ? 1 : scalarArg(y, "prev", "根数", line);
      if (!Number.isInteger(k) || k < 0) throw new FormulaError("prev 的根数要是 0 或正整数", line);
      if (!isSeries(x)) return x;
      const out = resumedOutput(x.length, resume);
      for (let i = resume?.from ?? 0; i < x.length; i++) out[i] = i >= k ? x[i - k] : Number.NaN;
      return out;
    }
    case "ema": {
      const h = scalarArg(y, "ema", "半衰期", line);
      if (!(h > 0)) throw new FormulaError("ema 的半衰期要大于 0（单位：小时）", line);
      const init = z == null ? null : scalarArg(z, "ema", "初值", line);
      const rho = 2 ** (-barMinutes / (h * 60));
      if (!isSeries(x)) return x;
      const out = resumedOutput(x.length, resume);
      let s = resume && Number.isFinite(resume.previous[resume.from - 1]) ? resume.previous[resume.from - 1] : init;
      for (let i = resume?.from ?? 0; i < x.length; i++) {
        const v = x[i];
        if (Number.isFinite(v)) s = s == null ? v : rho * s + (1 - rho) * v;
        out[i] = s == null ? Number.NaN : s;
      }
      return out;
    }
    case "median":
    case "mad":
    case "rsum":
    case "rscale": {
      const h = scalarArg(y, name, "时长", line);
      if (!(h > 0)) throw new FormulaError(`${name} 的时长要大于 0（单位：小时）`, line);
      const n = barsForHours(h, barMinutes);
      if (!isSeries(x)) return name === "median" ? x : name === "mad" || name === "rscale" ? 0 : x * n;
      return name === "median" ? rollingMedian(x, n, resume) : name === "mad" ? rollingMad(x, n, resume) : name === "rscale" ? rollingRobustScale(x, n, resume) : rollingSum(x, n, resume);
    }
    case "bars": {
      const h = scalarArg(x, name, "时长", line);
      if (!(h > 0)) throw new FormulaError("bars 的时长须大于0（小时）", line);
      return barsForHours(h, barMinutes);
    }
    case "full":
    case "peak": {
      const n = scalarArg(y, name, "根数", line);
      if (!Number.isInteger(n) || n < 1) throw new FormulaError(`${name} 的根数要是正整数`, line);
      if (!isSeries(x)) return x;
      const out = new Float64Array(x.length).fill(Number.NaN);
      let count = 0;
      for (let i = 0; i < x.length; i++) {
        if (Number.isFinite(x[i])) count++;
        if (i >= n && Number.isFinite(x[i - n])) count--;
        if (i >= n - 1 && count === n) {
          let v = x[i];
          if (name === "peak") for (let j = i - n + 1; j < i; j++) v = Math.max(v, x[j]);
          out[i] = v;
        }
      }
      return out;
    }
    case "highest":
    case "lowest":
    case "msum": {
      const n = scalarArg(y, name, "根数", line);
      if (!Number.isInteger(n) || n < 1) throw new FormulaError(`${name} 的根数要是正整数`, line);
      if (!isSeries(x)) return name === "msum" ? x * n : x;
      return name === "msum" ? rollingSum(x, n) : rollingExtreme(x, n, name === "highest", resume);
    }
    case "beta": {
      const h = scalarArg(z, "beta", "时长", line);
      if (!(h > 0)) throw new FormulaError("beta 的时长要大于 0（单位：小时）", line);
      const len = [x, y].find(isSeries)?.length;
      if (len == null) return Number.NaN;
      const asSeries = (v) => isSeries(v) ? v : new Float64Array(len).fill(v);
      return rollingBeta(asSeries(x), asSeries(y), barsForHours(h, barMinutes));
    }
    case "clip": {
      const lo = scalarArg(y, "clip", "下限", line);
      const hi = scalarArg(z, "clip", "上限", line);
      return map1(x, (v) => Number.isNaN(v) ? Number.NaN : Math.min(hi, Math.max(lo, v)), resume);
    }
    case "wsum": {
      const h = scalarArg(y, "wsum", "半衰期", line);
      const n = scalarArg(z, "wsum", "根数", line);
      if (!(h > 0)) throw new FormulaError("wsum 的半衰期要大于 0（单位：根）", line);
      if (!Number.isInteger(n) || n < 1) throw new FormulaError("wsum 的根数要是正整数", line);
      if (!isSeries(x)) {
        let t = 0;
        for (let j = 0; j < n; j++) t += 2 ** (-j / h);
        return x * t;
      }
      return wsumBars(x, h, n, resume);
    }
    case "atr": {
      const n = scalarArg(args[3], "atr", "根数", line);
      if (!Number.isInteger(n) || n < 1) throw new FormulaError("atr 的根数要是正整数", line);
      const len = [x, y, z].find(isSeries)?.length;
      if (len == null) return Number.NaN;
      const asSeries = (v) => isSeries(v) ? v : new Float64Array(len).fill(v);
      return atrSeries(asSeries(x), asSeries(y), asSeries(z), n);
    }
    case "avg":
    case "ago":
    case "zscore":
    case "sd": {
      const h = scalarArg(y, name, "时长", line);
      if (!(h > 0)) throw new FormulaError(`${name} 的时长要大于 0（单位：小时）`, line);
      if (!isSeries(x)) return name === "zscore" || name === "sd" ? Number.NaN : x;
      const n = barsForHours(h, barMinutes);
      return name === "avg" ? rollingMean(x, n, resume) : name === "ago" ? shiftBars(x, n, resume) : name === "sd" ? rollingSd(x, n, resume) : rollingZScore(x, n, resume);
    }
    case "retain": {
      const [k, pr, e0, hArg, wArg] = args;
      const h = scalarArg(hArg, "retain", "半衰期", line);
      if (!(h > 0)) throw new FormulaError("retain 的半衰期要大于 0（单位：小时）", line);
      const wHours = wArg == null ? 48 : scalarArg(wArg, "retain", "窗口时长", line);
      if (!(wHours > 0)) throw new FormulaError("retain 的窗口时长要大于 0（单位：小时）", line);
      const len = [k, pr, e0].find(isSeries)?.length ?? 1;
      const asSeries = (v) => isSeries(v) ? v : new Float64Array(len).fill(v);
      const out = retainSum(asSeries(k), asSeries(pr), asSeries(e0), 2 ** (-barMinutes / (h * 60)), barsForHours(wHours, barMinutes), resume);
      return [k, pr, e0].some(isSeries) ? out : out[0];
    }
    case "sma":
    case "sum": {
      const n = scalarArg(y, name, "根数", line);
      if (!Number.isInteger(n) || n < 1) throw new FormulaError(`${name} 的根数要是正整数`, line);
      if (!isSeries(x)) return name === "sum" ? x * n : x;
      const out = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) {
        if (i < n - 1) {
          out[i] = Number.NaN;
          continue;
        }
        let s = 0;
        for (let j = i - n + 1; j <= i; j++) s += x[j];
        out[i] = clean(name === "sum" ? s : s / n);
      }
      return out;
    }
    default:
      throw new FormulaError(`没有「${name}」这个函数`, line);
  }
}
function evaluateNode(n, env, barMinutes, reuse, memo) {
  const previous = reuse?.cache.nodes.get(n);
  const resume = reuse && reuse.from > 0 && previous ? { from: reuse.from, previous } : void 0;
  const remember = (out) => {
    if (reuse && isSeries(out)) reuse.cache.nodes.set(n, out);
    return out;
  };
  switch (n.k) {
    case "num":
      return n.v;
    case "var": {
      const v = env.get(n.name);
      if (v === void 0) throw new FormulaError(`不认识「${n.name}」`, n.line);
      return v;
    }
    case "un": {
      const a = evaluateNode(n.a, env, barMinutes, reuse, memo);
      return remember(n.op === "-" ? map1(a, (x) => -x, resume) : map1(a, (x) => Number.isNaN(x) ? Number.NaN : truthy(x) ? 0 : 1, resume));
    }
    case "bin":
      return remember(binary(n.op, evaluateNode(n.a, env, barMinutes, reuse, memo), evaluateNode(n.b, env, barMinutes, reuse, memo), resume));
    case "call": {
      const args = n.args.map((a) => evaluateNode(a, env, barMinutes, reuse, memo));
      const priorCall = reuse?.cache.nodes.get(n);
      let callResume;
      if (reuse && resumableCalls.has(n.name)) {
        let states = reuse.cache.states.get(n);
        if (!states) {
          states = /* @__PURE__ */ new Map();
          reuse.cache.states.set(n, states);
        }
        callResume = { from: priorCall ? reuse.from : 0, previous: priorCall ?? new Float64Array(Math.max(0, lengthOf(...args))), states };
      }
      const out = call(n.name, args, n.line, barMinutes, callResume, memo);
      if (reuse && isSeries(out) && resumableCalls.has(n.name)) reuse.cache.nodes.set(n, out);
      return out;
    }
  }
}
function evaluateProgram(program2, inputs, options = {}) {
  return evaluateProgramVars(program2, inputs, options).last;
}
function evaluateProgramVars(program2, inputs, options = {}) {
  let reuse;
  if (options.cache) {
    const cache = options.cache, old = cache.inputs;
    let from = old ? Infinity : 0;
    if (old) for (const [key, value] of Object.entries(inputs)) {
      const prior = old[key];
      if (isSeries(value)) {
        if (prior === void 0 || !isSeries(prior) || value.length < prior.length) {
          from = 0;
          break;
        }
        from = Math.min(from, prior.length);
        for (let i = 0; i < from; i++) if (!Object.is(prior[i], value[i])) {
          from = i;
          break;
        }
      } else if (!Object.is(prior, value)) {
        from = 0;
        break;
      }
    }
    if (!Number.isFinite(from)) from = 0;
    if (!from) {
      cache.nodes = /* @__PURE__ */ new WeakMap();
      cache.states = /* @__PURE__ */ new WeakMap();
    }
    const copies = {};
    for (const [key, value] of Object.entries(inputs)) {
      if (!isSeries(value)) {
        copies[key] = value;
        continue;
      }
      const previous = old?.[key];
      const copy = previous instanceof Float64Array ? resumedOutput(value.length, { from: Math.min(from, previous.length), previous }) : new Float64Array(value.length);
      copy.set(value.subarray(from), from);
      copies[key] = copy;
    }
    cache.inputs = copies;
    reuse = { from, cache };
  }
  const env = new Map(Object.entries(inputs));
  const vars = /* @__PURE__ */ new Map();
  const barMinutes = options.barMinutes ?? FORMULA_BAR_MINUTES;
  let last = Number.NaN;
  const memo = { ctba: [] };
  for (const s of program2.statements) {
    last = evaluateNode(s.expr, env, barMinutes, reuse, memo);
    if (s.name) {
      env.set(s.name, last);
      vars.set(s.name, last);
    }
  }
  return { last, vars };
}
var FORMULA_BAR_MINUTES, ORIGINAL_FUNCTIONS, FUNCTIONS, FN, FormulaError, NORMALIZE, KEYWORDS, Parser, isSeries, at, barsForHours, resumedOutput, medianOfSorted, rollingMedian, rollingMad, rollingRobustScale, truthy, clean, scalarArg, createFormulaEvaluationCache, resumableCalls;
var init_formula = __esm({
  "src/lib/deepDig/formula.ts"() {
    init_ctba();
    init_mbi();
    init_mbi2();
    init_sellerResponse();
    init_recentFocusMath();
    FORMULA_BAR_MINUTES = 5;
    ORIGINAL_FUNCTIONS = [
      { name: "ln", min: 1, max: 1, usage: "ln(x)", help: "自然对数（也可写 log）" },
      { name: "log", min: 1, max: 1, usage: "log(x)", help: "同 ln" },
      { name: "exp", min: 1, max: 1, usage: "exp(x)", help: "e 的 x 次方" },
      { name: "tanh", min: 1, max: 1, usage: "tanh(x)", help: "双曲正切：把任意数平滑压到 −1 ~ 1（0 → 0，±1 → ±0.76，±2 → ±0.96）" },
      { name: "ctba", min: 17, max: 17, usage: "ctba(C,H,L,E,B,S,T,N,f,s,m,lambda,epsilon,alpha,beta,gamma,part)", help: "CTBA 共享核心：part 0/1/2/3/4/5 为 T/M/F/CTBA/无成交/完整性；仅5m，缺失不补零" },
      { name: "mbi2state", min: 5, max: 5, usage: "mbi2state(MBI2,T,BAND,CONFIRM,part)", help: "MBI2 严格缓冲状态机：part 0/1/2/3/4 为状态/本轮小时/确认小时/买方试探开始/买方进入确认；缺失不补零" },
      { name: "mbiz2", min: 2, max: 2, usage: "mbiz2(C, MBI2_N)", help: "MBI2 独立复制的价格偏离核心；前5n根保持缺失" },
      { name: "mbiz", min: 2, max: 2, usage: "mbiz(C, MBI_N)", help: "MBI 的无趋势标准差偏离 z：α = 1/n，κ = 1/√(α·(2−α))；先用上一根 M、S 算 z 再更新。前 5n 根为空，只用正收盘价，不补零。MBI = tanh(z / MBI_Z0)" },
      { name: "seller_response", min: 3, max: 3, usage: "seller_response(x, gain, scale)", help: "负向响应：x≥0 原样保留；x<0 返回 scale·tanh(gain·atanh(x/scale))。gain>0、scale>0，缺失和越界保持缺失；0仍为平衡，不改变任何窗口，默认增益2。" },
      { name: "abs", min: 1, max: 1, usage: "abs(x)", help: "绝对值" },
      { name: "sqrt", min: 1, max: 1, usage: "sqrt(x)", help: "平方根" },
      { name: "sign", min: 1, max: 1, usage: "sign(x)", help: "正 1、负 −1、零 0" },
      { name: "max", min: 2, max: 2, usage: "max(a, b)", help: "逐根取较大的" },
      { name: "min", min: 2, max: 2, usage: "min(a, b)", help: "逐根取较小的" },
      { name: "prev", min: 1, max: 2, usage: "prev(x, k)", help: "前 k 根的值（k 默认 1）；开头没有前 k 根的记空" },
      { name: "ema", min: 2, max: 3, usage: "ema(x, h, 初值)", help: "指数平滑，半衰期 h 小时（h 可写 hl = 上面选的半衰期）：yₜ = ρ·yₜ₋₁ + (1 − ρ)·xₜ，ρ = 2^(−周期 ÷ h)，周期 = 上面选的 K 线周期；x 为空的那根跳过；不给初值时从第一个非空值起算" },
      { name: "ago", min: 2, max: 2, usage: "ago(x, h)", help: "h 小时以前那根的值（按 K 线周期换算成根数；开头不够 h 小时的记空）" },
      { name: "zscore", min: 2, max: 2, usage: "zscore(x, h)", help: "滚动标准化：(当根 − 过去 h 小时的平均) ÷ 过去 h 小时的标准差（含当根，样本标准差）；空值跳过，开头不满 h 小时用已有的，少于 2 个或标准差为 0 记空" },
      { name: "sd", min: 2, max: 2, usage: "sd(x, h)", help: "过去 h 小时的标准差（含当根，样本标准差）：空值跳过，开头不满 h 小时用已有的，少于 2 个记空。例：R / sd(R, avgh) = 按自身波动标准化的涨跌（Z 分数，均值按 0）" },
      { name: "retain", min: 4, max: 5, usage: "retain(K, P, E0, h, W)", help: "保留加权和（CBA 用）：Σ wᵢ·Kᵢ·ln(Pₜ ÷ E0ᵢ) ÷ (t − i + 1)，i 取过去 W 小时（默认 48）里的每一根，wᵢ = 2^(−距今小时 ÷ h) 归一化（权重合计 1）；Kᵢ 或 E0ᵢ 为空的那根这一项记 0" },
      { name: "bars", min: 1, max: 1, usage: "bars(h)", help: "按当前计算周期把小时数换算为根数，与avg/sd/retain同样四舍五入、至少1根；h须大于0。" },
      { name: "full", min: 2, max: 2, usage: "full(x, n)", help: "最近 n 根全部存在且有效时返回当根 x，否则记空（不补零）" },
      { name: "peak", min: 2, max: 2, usage: "peak(x, n)", help: "最近 n 根最大值，必须满 n 根且没有缺值" },
      { name: "wsum", min: 3, max: 3, usage: "wsum(x, h, n)", help: "时间衰减加权和：最近 n 根（含当根），第 i 根权重 2^(−(t − i) ÷ h)，h、n 都以根计；空值跳过，一个都没有记空" },
      { name: "rsum", min: 2, max: 2, usage: "rsum(x, h)", help: "过去 h 小时的和（含当根）：空值跳过，一个都没有记空" },
      { name: "median", min: 2, max: 2, usage: "median(x, h)", help: "过去 h 小时的中位数（含当根）：空值跳过，一个都没有记空" },
      { name: "mad", min: 2, max: 2, usage: "mad(x, h)", help: "过去 h 小时的中位数绝对偏差 median(|x − 中位数|)（含当根）：空值跳过；稳健 z = (x − 中性点) ÷ (1.4826 × mad)" },
      { name: "rscale", min: 2, max: 2, usage: "rscale(x, h)", help: "稳健尺度：过去 h 小时（含当根）的 1.4826 × MAD；一半以上的值相同、MAD = 0 时改用 1.2533 × 平均绝对偏差（离中位数）；稳健 z = (x − 中性点) ÷ rscale" },
      { name: "highest", min: 2, max: 2, usage: "highest(x, n)", help: "最近 n 根（含当根）的最大值：空值跳过" },
      { name: "lowest", min: 2, max: 2, usage: "lowest(x, n)", help: "最近 n 根（含当根）的最小值：空值跳过" },
      { name: "msum", min: 2, max: 2, usage: "msum(x, n)", help: "最近 n 根（含当根）的和：空值跳过，一个都没有记空（sum 要求 n 根都有值）" },
      { name: "beta", min: 3, max: 3, usage: "beta(y, x, h)", help: "过去 h 小时（含当根）y 对 x 的回归斜率：两个都有值的根才算，少于 2 根记空" },
      { name: "clip", min: 3, max: 3, usage: "clip(x, lo, hi)", help: "截断到 lo ~ hi" },
      { name: "atr", min: 4, max: 4, usage: "atr(H, L, C, n)", help: "平均真实波幅：真实波幅 = max(H − L, |H − 前收|, |L − 前收|)，Wilder 平滑 n 根（前 n 根的平均起算，不满 n 根记空）" },
      { name: "avg", min: 2, max: 2, usage: "avg(x, h)", help: "过去 h 小时的平均（含当根；h 可写 avgh = 上面选的平均时长）：按 K 线周期换算成根数，周期变了时长不变；x 为空的那根跳过；开头不满 h 小时的用已有的" },
      { name: "sma", min: 2, max: 2, usage: "sma(x, n)", help: "最近 n 根的平均（不满 n 根记空）" },
      { name: "sum", min: 2, max: 2, usage: "sum(x, n)", help: "最近 n 根的和（不满 n 根记空）" },
      { name: "nz", min: 1, max: 2, usage: "nz(x, v)", help: "空换成 v（默认 0）" },
      { name: "if", min: 3, max: 3, usage: "if(条件, a, b)", help: "条件成立取 a，否则取 b" },
      { name: "has", min: 1, max: 1, usage: "has(x)", help: "x 不是空 → 1，否则 0" }
    ];
    FUNCTIONS = ORIGINAL_FUNCTIONS.map((f) => {
      const original = FOCUS_BASE_ARITIES[f.name];
      if (!original) return f;
      const counts = [...original, ...original.map((n) => n + 2)];
      return { ...f, max: Math.max(...counts), counts, help: f.help + "；可追加 focus_h, focus_weight：保留原窗口，最近 focus_h 小时的相对权重乘 focus_weight（≥1）；权重1精确恢复原计算。" };
    });
    FN = new Map(FUNCTIONS.map((f) => [f.name, f]));
    FormulaError = class extends Error {
      constructor(message, line) {
        super(`第 ${line} 行：${message}`);
        this.line = line;
      }
    };
    NORMALIZE = { "×": "*", "·": "*", "÷": "/", "−": "-", "（": "(", "）": ")", "，": ",", "；": ";", "＝": "=", "＋": "+", "＞": ">", "＜": "<" };
    KEYWORDS = { and: "and", or: "or", not: "not" };
    Parser = class {
      constructor(toks) {
        this.toks = toks;
        __publicField(this, "i", 0);
      }
      peek() {
        return this.toks[this.i];
      }
      next() {
        return this.toks[this.i++];
      }
      isOp(v) {
        const t = this.peek();
        return t.t === "op" && t.v === v;
      }
      expectOp(v) {
        const t = this.next();
        if (t.t !== "op" || t.v !== v) throw new FormulaError(`这里应该是「${v}」`, t.line);
      }
      program() {
        const out = [];
        while (this.peek().t !== "end") {
          if (this.peek().t === "sep") {
            this.next();
            continue;
          }
          const start = this.peek();
          let name = null;
          const after = this.toks[this.i + 1];
          if (start.t === "id" && after?.t === "op" && after.v === "=") {
            name = start.v;
            this.i += 2;
          }
          const expr = this.or();
          const t = this.peek();
          if (t.t !== "sep" && t.t !== "end") throw new FormulaError(t.t === "op" && t.v === "=" ? "「=」左边只能是一个名字" : "式子没写完整，或少了运算符", t.line);
          out.push({ name, expr, line: start.line });
        }
        return out;
      }
      or() {
        let a = this.and();
        while (this.isOp("or")) {
          this.next();
          a = { k: "bin", op: "or", a, b: this.and() };
        }
        return a;
      }
      and() {
        let a = this.not();
        while (this.isOp("and")) {
          this.next();
          a = { k: "bin", op: "and", a, b: this.not() };
        }
        return a;
      }
      not() {
        if (this.isOp("not")) {
          this.next();
          return { k: "un", op: "not", a: this.not() };
        }
        return this.cmp();
      }
      cmp() {
        const a = this.add();
        const t = this.peek();
        if (t.t === "op" && [">", "<", ">=", "<=", "==", "!="].includes(t.v)) {
          this.next();
          return { k: "bin", op: t.v, a, b: this.add() };
        }
        if (t.t === "op" && t.v === "=") throw new FormulaError("比较相等请写「==」", t.line);
        return a;
      }
      add() {
        let a = this.mul();
        for (; ; ) {
          const t = this.peek();
          if (t.t === "op" && (t.v === "+" || t.v === "-")) {
            this.next();
            a = { k: "bin", op: t.v, a, b: this.mul() };
          } else return a;
        }
      }
      mul() {
        let a = this.unary();
        for (; ; ) {
          const t = this.peek();
          if (t.t === "op" && (t.v === "*" || t.v === "/")) {
            this.next();
            a = { k: "bin", op: t.v, a, b: this.unary() };
          } else return a;
        }
      }
      unary() {
        if (this.isOp("-")) {
          this.next();
          return { k: "un", op: "-", a: this.unary() };
        }
        if (this.isOp("+")) {
          this.next();
          return this.unary();
        }
        return this.pow();
      }
      pow() {
        const a = this.primary();
        if (this.isOp("^")) {
          this.next();
          return { k: "bin", op: "^", a, b: this.unary() };
        }
        return a;
      }
      primary() {
        const t = this.next();
        if (t.t === "num") return { k: "num", v: t.v };
        if (t.t === "id") {
          if (this.isOp("(")) {
            this.next();
            const args = [];
            if (!this.isOp(")")) {
              for (; ; ) {
                args.push(this.or());
                if (this.isOp(",")) {
                  this.next();
                  continue;
                }
                break;
              }
            }
            this.expectOp(")");
            return { k: "call", name: t.v, args, line: t.line };
          }
          return { k: "var", name: t.v, line: t.line };
        }
        if (t.t === "op" && t.v === "(") {
          const e = this.or();
          this.expectOp(")");
          return e;
        }
        if (t.t === "sep" || t.t === "end") throw new FormulaError("式子没写完整", t.line);
        throw new FormulaError(`这里不应该出现「${t.t === "op" ? t.v : ""}」`, t.line);
      }
    };
    isSeries = (v) => typeof v !== "number";
    at = (v, i) => isSeries(v) ? i < v.length ? v[i] : Number.NaN : v;
    barsForHours = (h, barMinutes) => Math.max(1, Math.round(h * 60 / barMinutes));
    resumedOutput = (length, resume) => {
      if (resume?.previous.length === length) return resume.previous;
      if (resume && resume.previous.byteOffset + length * 8 <= resume.previous.buffer.byteLength)
        return new Float64Array(resume.previous.buffer, resume.previous.byteOffset, length);
      const capacity = resume && length > 0 ? 2 ** Math.ceil(Math.log2(length)) : length;
      const out = new Float64Array(capacity).subarray(0, length);
      if (resume) out.set(resume.previous.subarray(0, resume.from));
      return out;
    };
    medianOfSorted = (s) => {
      const h = s.length >> 1;
      return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
    };
    rollingMedian = (x, n, resume) => rollingSorted(x, n, medianOfSorted, resume);
    rollingMad = (x, n, resume) => rollingSorted(x, n, madOfSorted, resume);
    rollingRobustScale = (x, n, resume) => rollingSorted(x, n, (s) => {
      const madV = madOfSorted(s);
      if (madV > 0) return 1.4826 * madV;
      const m = medianOfSorted(s);
      let sum2 = 0;
      for (const v of s) sum2 += Math.abs(v - m);
      return 1.2533 * (sum2 / s.length);
    }, resume);
    truthy = (x) => Number.isFinite(x) && x !== 0;
    clean = (x) => Number.isFinite(x) ? x : Number.NaN;
    scalarArg = (v, fn, what, line) => {
      if (isSeries(v) || !Number.isFinite(v)) throw new FormulaError(`${fn} 的${what}要写一个具体的数`, line);
      return v;
    };
    createFormulaEvaluationCache = () => ({ nodes: /* @__PURE__ */ new WeakMap(), states: /* @__PURE__ */ new WeakMap() });
    resumableCalls = /* @__PURE__ */ new Set(["median", "mad", "rscale", "wsum", "retain", "highest", "lowest", "ln", "log", "exp", "abs", "tanh", "sqrt", "sign", "max", "min", "nz", "has", "if", "clip", "ema", "avg", "sd", "zscore", "rsum", "prev", "ago", "beta"]);
  }
});

// src/lib/cba2.ts
var CBA2_FORMULA, CBA2_DEFINITION, CBA2_STEPS, program;
var init_cba2 = __esm({
  "src/lib/cba2.ts"() {
    init_formula();
    CBA2_FORMULA = [
      "# CBA-2 = 100·tanh(Σ w·F*·G*·R*)；仅已收盘5分钟，48小时权重合计1；不是胜率",
      "# hl = 时间权重半衰期（小时）；avgh = 成交额基线时长与 r² EWMA 半衰期（小时）；以下为可修改的研究默认值",
      "alpha = 1",
      "epsilon = 0.000001",
      "m = 12",
      "dmax = 3",
      "V = if(Q > 0 and B >= 0 and S >= 0 and (not has(prev(T)) or T - prev(T) == 300000), Q, 0 / 0)",
      "price = if(V > 0 and E > 0, E, 0 / 0) # E=成交额/成交数量（VWAP）",
      "D = B - S # 主动成交净差额，不是市场净资金流入",
      "r = ln(price / prev(price))",
      "Vbar = prev(if(has(full(V, avgh * 12)), avg(V, avgh), 0 / 0)) # 只用上一根及以前",
      "s = if(has(prev(full(r, avgh * 12))), sqrt(prev(ema(r ^ 2, avgh)) + epsilon ^ 2), 0 / 0)",
      "F = ln(1 + V / Vbar)",
      "G = 1 + alpha * abs(D) / V * (D * r > 0) # 主动买配合上涨、主动卖配合下跌均放大",
      "R = r / s",
      "U = full(F * G * R, 576) # 满48小时且无缺值才计算",
      "W = wsum(1, hl * 12, 576)",
      "score = wsum(F * G * R, hl * 12, 576) / W",
      "Ppeak = peak(C, m + 1) # 含当前共m+1个收盘价",
      "DD = ln(Ppeak / C) / s",
      "invalid = DD > dmax # 独立失效标记，不清零主指标，不替代止损；未失效不代表满足买入条件",
      "CBA2 = if(has(U), 100 * tanh(score), 0 / 0)"
    ].join("\n");
    CBA2_DEFINITION = "CBA-2｜成交支持下的价格重心迁移指标（−100 ~ 100）：正值表示加权上行变化占优，负值表示加权下行变化占优，不是胜率。仅已结束的5分钟K线；回撤失效标记独立运行，不清零主指标，也不替代交易止损。";
    CBA2_STEPS = [
      "CBA-2ₜ = 100·tanh(Σ wᵢ,ₜ·Fᵢ*·Gᵢ*·Rᵢ*)，Wₜ = 截至当前的48小时窗口",
      "wᵢ,ₜ = 2^(−ΔTᵢ,ₜ/h) ÷ Σ 2^(−ΔTⱼ,ₜ/h)，时间以小时计，窗口权重合计1",
      "Vᵢ = Bᵢ + Sᵢ；Dᵢ = Bᵢ − Sᵢ；B、S为主动买入/卖出成交额（统一计价）",
      "Fᵢ* = ln(1 + Vᵢ / V̄ᵢ₋₁)，V̄为截至上一根的历史常态成交额",
      "Gᵢ* = 1 + α·|Dᵢ|/Vᵢ·1{Dᵢrᵢ > 0}，同向取1，否则取0",
      "Rᵢ* = rᵢ/sᵢ₋₁；rᵢ = ln(Eᵢ/Eᵢ₋₁)；Eᵢ = 成交额/成交数量（VWAP）",
      "sᵢ₋₁ = sqrt(EWMAᵢ₋₁(r²) + ε²)，仅用上一根及以前数据",
      "Ppeak = max(Cₜ₋ₘ,…,Cₜ)；DD = ln(Ppeak/Cₜ)/sₜ₋₁；DD > dmax 暂停认定为有效做多候选",
      "研究默认值（原图未定，尚需回测）：h=6小时，成交额基线24小时、r² EWMA半衰期24小时，α=1，ε=0.000001，m=12根，dmax=3。EWMA从首个有效r²起算；缺值或基线/48小时窗口未就绪留空。",
      "未触发失效不等于满足买入条件；读数不能直接解释为未来上涨概率。"
    ].join("\n");
    program = parseFormula(CBA2_FORMULA, /* @__PURE__ */ new Set(["Q", "B", "S", "E", "C", "T", "hl", "avgh"]));
  }
});

// src/lib/researchAverageFormula.ts
function appendResearchAverages(formula, names, series) {
  const extra = [];
  if (!names.has(series.avg)) extra.push(`${series.avg} = avg(${series.core}, 24)`);
  if (!names.has(series.avg2)) {
    let helper = "_chart_m6";
    while (names.has(helper)) helper += "_";
    extra.push(`${helper} = avg(${series.core}, 6)`, `${series.avg2} = (4 * ${helper} + 3 * ago(${helper}, 6) + 2 * ago(${helper}, 12) + ago(${helper}, 18)) / 10`);
  }
  return [formula, ...extra].join("\n");
}
var init_researchAverageFormula = __esm({
  "src/lib/researchAverageFormula.ts"() {
  }
});

// src/lib/timeFormat.ts
function formatUTC8(ts) {
  if (!ts) return "--";
  const d = new Date(ts + 8 * 36e5);
  return d.toISOString().replace("T", " ").slice(0, 19);
}
var init_timeFormat = __esm({
  "src/lib/timeFormat.ts"() {
  }
});

// src/lib/deepRsa/marketData.ts
function intervalMs(interval) {
  const n = Number.parseInt(interval, 10);
  const unit = interval.slice(String(n).length);
  return n * (unit === "m" ? 6e4 : unit === "h" ? 36e5 : 864e5);
}
var init_marketData = __esm({
  "src/lib/deepRsa/marketData.ts"() {
  }
});

// src/lib/campaignMainPriceChange.ts
function computePeakPriceChangePct(args) {
  const { side, entryPrice, klines, startMs, endMs, barMs } = args;
  if (side == null || entryPrice == null || !Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs || !(barMs > 0)) return null;
  const bars = klines.filter((bar) => bar.time <= endMs && bar.time + barMs > startMs);
  if (bars.length === 0) return null;
  const extreme = side === "long" ? Math.max(...bars.map((bar) => bar.high)) : Math.min(...bars.map((bar) => bar.low));
  const directedPct = side === "long" ? (extreme - entryPrice) / entryPrice * 100 : (entryPrice - extreme) / entryPrice * 100;
  return Math.max(0, directedPct);
}
function computeHoldingDynamicMaxDrawdownPct(args) {
  const { klines, startMs, endMs, barMs } = args;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs || !(barMs > 0)) return null;
  const bars = klines.filter((bar) => bar.time <= endMs && bar.time + barMs > startMs).sort((a, b) => a.time - b.time);
  if (bars.length === 0) return null;
  let runningPeak = Number.isFinite(bars[0].open) && bars[0].open > 0 ? bars[0].open : null;
  let maxDrawdown = 0;
  for (const bar of bars) {
    if (runningPeak != null && Number.isFinite(bar.low) && bar.low >= 0) {
      maxDrawdown = Math.max(maxDrawdown, (runningPeak - bar.low) / runningPeak * 100);
    }
    if (Number.isFinite(bar.high) && bar.high > 0) {
      runningPeak = runningPeak == null ? bar.high : Math.max(runningPeak, bar.high);
    }
  }
  return runningPeak == null ? null : Math.max(0, maxDrawdown);
}
var EMPTY_CAMPAIGN_PRICE_CHANGE;
var init_campaignMainPriceChange = __esm({
  "src/lib/campaignMainPriceChange.ts"() {
    EMPTY_CAMPAIGN_PRICE_CHANGE = Object.freeze({
      pct: null,
      side: null,
      entryPrice: null,
      entryLegId: null,
      entryOpenTime: null,
      exitPrice: null,
      exitSource: null,
      exitLegId: null,
      mainCloseTime: null
    });
  }
});

// src/lib/deepDig/features.ts
function sellerNegativeFormula(formula, core) {
  if (formula.includes(SELLER_SIGN_MARK)) return formula;
  const program2 = compileFeatureFormula(formula).program;
  const last = program2.statements.at(-1);
  const names = new Set(program2.statements.flatMap((s) => s.name && (s.name === core || new RegExp(`^avg_${core}(?:_\\d+)?$`).test(s.name)) ? [s.name] : []));
  let capture = "";
  let result = last.name;
  if (!result) {
    result = "_seller_result";
    while (program2.statements.some((s) => s.name === result) || program2.inputs.has(result)) result += "_";
    const render = (n) => n.k === "num" ? String(n.v) : n.k === "var" ? n.name : n.k === "un" ? `(${n.op} ${render(n.a)})` : n.k === "bin" ? `(${render(n.a)} ${n.op} ${render(n.b)})` : `${n.name}(${n.args.map(render).join(", ")})`;
    capture = `
${result} = ${render(last.expr)}`;
  }
  names.delete(result);
  names.add(result);
  return `${formula}${capture}
${SELLER_SIGN_MARK}
# 卖方输出取负：中间量保持原样；原值和已定义的均值一并转换。
${[...names].map((name) => `${name} = -${name}`).join("\n")}`;
}
function featureParams(d) {
  const original = { BAR_MINUTES: intervalMs(intervalOf(d)) / 6e4, hl: halfLifeOf(d), 半衰期: halfLifeOf(d), avgh: avgHoursOf(d), 平均时长: avgHoursOf(d), MBI_N: mbiNOf(d), MBI_Z0: mbiZ0Of(d) };
  if (!featureUsesMbi2(d)) return original;
  const minutes = intervalMs(intervalOf(d)) / 6e4;
  return { ...original, MBI2_T_HOURS: mbi2HoursOf(d, minutes), MBI2_N: mbi2NOf(d, minutes), MBI2_Z0: mbi2Z0Of(d), MBI2_BAND: mbi2BandOf(d), MBI2_CONFIRM: mbi2ConfirmOf(d) };
}
function featureWindowMs(d) {
  const H = 36e5;
  let formulaHistory = 0;
  let mbiWarmupMs = 0;
  if (d.formula) {
    try {
      const barMs = intervalMs(intervalOf(d));
      const params = featureParams(d);
      const program2 = compileFeatureFormula(d.formula).program;
      formulaHistory = (programHistoryBars(program2, params, barMs / 6e4) + 2) * barMs;
      if (featureUsesMbi(d)) mbiWarmupMs = programHistoryBars(program2, params, barMs / 6e4, true) * barMs;
    } catch {
    }
  }
  if (featureUsesMbi2(d)) {
    const originalWindow = 48 * H + 5 * mbi2NOf(d, intervalMs(intervalOf(d)) / 6e4) * intervalMs(intervalOf(d));
    return d.formula?.includes("# seller-retention-v1") ? Math.max(formulaHistory, originalWindow) : originalWindow;
  }
  const window = Math.max(featureTemplateId(d) === "cba-2" ? (48 + avgHoursOf(d) + 1) * H : 0, 48 * H, 8 * halfLifeOf(d) * H, (avgHoursOf(d) + 4 * halfLifeOf(d)) * H, 50 * intervalMs(intervalOf(d)));
  if (featureTemplateId(d) === "ctba") return (d.researchWindowHours ?? 48) * H + formulaHistory;
  return Math.max(formulaHistory, featureUsesMbi(d) ? 48 * H + Math.max(mbiWarmupMs, 5 * mbiNOf(d) * intervalMs(intervalOf(d))) : window);
}
function bearFeatureFormula(source, original, core, scale = 1, response = false) {
  const formula = source + "\n" + (response ? `${BEAR_RESPONSE_MARK}
seller_gain = 2
${core} = seller_response(${original}, seller_gain, ${scale})` : `${core} = min(${original}, 0)`);
  const names = new Set(compileFeatureFormula(formula).program.statements.flatMap((s) => s.name ? [s.name] : []));
  return appendResearchAverages(formula, names, { core, avg: "avg_" + core, avg2: "avg_" + core + "_2" }) + "\n" + core + " = " + core;
}
function createSellerRetentionCopy(source, spec) {
  const copy = copyFeatureDefinition(source, [source], Date.UTC(2026, 9, 30, 3));
  const program2 = compileFeatureFormula(source.formula).program, declared = new Set(program2.statements.map((s) => s.name));
  const last = program2.statements.at(-1);
  const render = (n) => n.k === "num" ? String(n.v) : n.k === "var" ? n.name : n.k === "un" ? `(${n.op} ${render(n.a)})` : n.k === "bin" ? `(${render(n.a)} ${n.op} ${render(n.b)})` : `${n.name}(${n.args.map(render).join(",")})`;
  const base = declared.has(source.chartCore ?? spec.sourceCore) ? source.chartCore ?? spec.sourceCore : last.name ?? render(last.expr);
  const built = retentionFormula(copy.formula, base, spec.core, spec.bound, source.researchWindowHours ?? 48);
  const names = new Set(compileFeatureFormula(built.formula).program.statements.flatMap((s) => s.name ? [s.name] : []));
  const formula = appendResearchAverages(built.formula, names, { core: spec.core, avg: "avg_" + spec.core, avg2: "avg_" + spec.core + "_2" }) + "\n" + spec.core + " = " + spec.core;
  return {
    ...copy,
    id: spec.id,
    name: source.name + "｜成交保留增强",
    short: source.short + "·保留",
    builtin: true,
    chartCore: spec.core,
    sellerSignVersion: 1,
    retentionSourceId: source.id,
    retentionPrefix: built.prefix,
    retentionVersion: 1,
    formula,
    definition: source.definition + "\n独立副本 v1：原算法完整保留，新增成交支持加权的历史价格位移重估。失守未收复为负，收复后回升；主动成交失衡及单位失衡下行冲击作为权重代理，不代表完整订单簿OFI或因果冲击。以过去avgh小时波动率标准化，成交基线和波动率只用上一根及以前；缺失/缺根/预热不足不补零。新增分量在最终压缩前按gain合成（默认0.5，gain=0恢复原读数）；原窗口和参数不缩短，新窗口默认" + (source.researchWindowHours ?? 48) + "小时。固定零中心，原始/均值序列与存储版本独立，阈值需另行验证。"
  };
}
function createSellerFocusCopy(source, id = source.id + "-v2", now = SELLER_FOCUS_CREATED_AT) {
  const copy = copyFeatureDefinition(source, [source], now);
  let prefix = "focus2";
  while (new RegExp("\\b" + prefix + "(?:_|\\b)").test(copy.formula)) prefix += "_";
  const program2 = compileFeatureFormula(copy.formula).program;
  const render = (n) => {
    if (n.k === "num") return String(n.v);
    if (n.k === "var") return n.name;
    if (n.k === "un") return `(${n.op} ${render(n.a)})`;
    if (n.k === "bin") return `(${render(n.a)} ${n.op} ${render(n.b)})`;
    const args = n.args.map(render), original = FOCUS_BASE_ARITIES[n.name];
    if (original?.includes(args.length)) args.push(prefix + "_h", prefix + "_weight");
    return n.name + "(" + args.join(", ") + ")";
  };
  const markers = [...new Set(copy.formula.match(/# seller-[\w-]+/g) ?? [])];
  const formula = [
    ...markers,
    "# seller-focus-v2：原窗口不变；最近2小时相对更早数据3倍权重",
    prefix + "_h = 2",
    prefix + "_weight = 3",
    ...program2.statements.map((s) => (s.name ? s.name + " = " : "") + render(s.expr))
  ].join("\n");
  const state = source.id === "state";
  return {
    ...copy,
    id,
    name: source.name + "｜版本2",
    short: state ? "状态 S·版本2" : source.short + "·版本2",
    chartCore: source.chartCore ?? FOCUS_SOURCE_CORES[source.id] ?? program2.statements.at(-1)?.name ?? void 0,
    sellerSignVersion: 1,
    focusSourceId: source.id,
    focusVersion: 2,
    focusPrefix: prefix,
    formula,
    definition: source.definition + "\n版本2：独立复制创建时的账号公式和参数，保留原窗口、周期、半衰期及预热；历史聚合核中最近2小时的相对权重为更早数据的3倍。可在本副本公式顶部修改 " + prefix + "_h 和 " + prefix + "_weight；权重1恢复复制时原计算。重加权均值、波动尺度、递推/成交核；极值与时间滞后保持原义，不直接放大最终分数。" + (state ? "状态S保持0–1刻度，0.5为均衡，越低越偏卖方；图表沿用原S的0.6参考线。" : "零仍为均衡，卖方仍为负值。") + "原阈值不自动沿用。"
  };
}
function newFeatureTemplate(now) {
  return {
    id: `f-${now.toString(36)}`,
    name: "新特征值",
    short: "X",
    definition: "",
    formula: "# 例：最近 144 根 K 线的涨跌幅（5 分钟周期 = 12 小时）\nln(C / prev(C, 144))",
    scale: 100,
    unit: "%",
    positive: DEFAULT_POSITIVE,
    control: DEFAULT_CONTROL,
    source: "campaigns",
    groupVars: 2,
    createdAt: now
  };
}
function copyFeatureDefinition(source, existing, now = Date.now()) {
  let id = newFeatureTemplate(now).id, serial = 1;
  while (existing.some((d) => d.id === id)) id = newFeatureTemplate(now).id + "-" + serial++;
  let number = 1;
  const name = () => source.name + "（副本" + (number === 1 ? "" : number) + "）";
  while (existing.some((d) => d.name === name())) number++;
  const { builtin: _builtin, removed: _removed, visibilityVersion: _visibility, ...copy } = structuredClone(source);
  return {
    ...copy,
    id,
    name: name(),
    short: source.short + "·副本" + (number === 1 ? "" : number),
    chartTemplate: featureTemplateId(source),
    createdAt: now
  };
}
function compileFeatureFormula(formula) {
  const program2 = parseFormula(formula, /* @__PURE__ */ new Set([...SERIES_VARIABLES.map((v) => v.name), ...PARAM_NAMES]));
  return { program: program2, usesAmounts: [...program2.inputs].some((n) => AMOUNT_VARIABLES.has(n)), usesBtc: program2.inputs.has("CB"), usesMbi: featureUsesMbi({ formula }), usesMbi2: featureUsesMbi2({ formula }) };
}
function evaluateOnBars(bars, compiled, params = {}, cache) {
  if (compiled.usesMbi || params.id === "mbi") validateMbiParams(mbiNOf(params), mbiZ0Of(params));
  if (compiled.usesMbi2 || featureUsesMbi2(params)) validateMbi2Params(params, intervalMs(intervalOf(params)) / 6e4);
  const keys = ["T", "C", "O", "H", "L", "Q", "B", "S", "E", "CB"];
  const input = cache?.buffers ?? {};
  for (const key of keys) {
    const old = input[key];
    if (old?.length === bars.length) continue;
    if (old && old.byteOffset + bars.length * 8 <= old.buffer.byteLength) input[key] = new Float64Array(old.buffer, old.byteOffset, bars.length);
    else {
      const capacity = cache && bars.length ? 2 ** Math.ceil(Math.log2(bars.length)) : bars.length;
      input[key] = new Float64Array(capacity).subarray(0, bars.length);
    }
  }
  if (cache) cache.buffers = input;
  const finite = (v) => v != null && Number.isFinite(v) ? v : NaN;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], q = finite(b.quoteVolume), buy = finite(b.takerBuyQuoteVolume);
    input.T[i] = finite(b.openTime);
    input.C[i] = finite(b.close);
    input.O[i] = finite(b.open);
    input.H[i] = finite(b.high);
    input.L[i] = finite(b.low);
    input.Q[i] = q;
    input.B[i] = buy;
    input.S[i] = q - buy;
    input.E[i] = finite(b.quoteVolume != null && b.volume != null && b.volume > 0 ? b.quoteVolume / b.volume : null);
    input.CB[i] = finite(b.refClose);
  }
  return evaluateProgramVars(compiled.program, {
    ...input,
    ...featureParams(params)
  }, { barMinutes: intervalMs(intervalOf(params)) / 6e4, cache });
}
var ORIGINAL_SELLER_CORES, FOCUS_SOURCE_CORES, SELLER_FEATURE_CORES, SELLER_SIGN_MARK, BEAR_RESPONSE_MARK, DEFAULT_INTERVAL, DEFAULT_HALF_LIFE_HOURS, DEFAULT_AVG_HOURS, featureTemplateId, intervalOf, halfLifeOf, avgHoursOf, featureUsesMbi, featureUsesMbi2, PARAM_VARIABLES, PARAM_NAMES, SERIES_VARIABLES, AMOUNT_VARIABLES, DEFAULT_GROUPS, DEFAULT_POSITIVE, DEFAULT_CONTROL, LEGACY_DRIFT_SPEED_FORMULA, EMA_DRIFT_SPEED_FORMULA, LEGACY_V_DRIFT_SPEED_FORMULA, LEGACY_A_DRIFT_SPEED_FORMULA, DRIFT_SPEED_FORMULA, DRIFT_SPEED_DEF, BSS_FORMULA, BSS_NEW_HEAD, BSS_NEW_VD, BSS_LINE_UPGRADES, BSS_DEF, DRIFT_SPEED_Z_FORMULA, DRIFT_SPEED_Z_DEF, CBA_FORMULA, CBA_DEF, CBI_FORMULA, CBI_DEF, CBA2_DEF, CBI2_FORMULA, CBI2_DEF, MBI_FORMULA, MBI_DEF, mbi2Copy, _oldN, _oldZ, mbi2Own, MBI2_FORMULA, MBI2_DEF, CDI2_FORMULA, CDI2_DEF, STATE_FORMULA, STATE_DEF, STATE2_FORMULA, STATE2_DEF, SELLER_CONTROL_FORMULA, SELLER_CONTROL_DEF, DSS_FORMULA, DSS_DEF, CDA_FORMULA, CDA_DEF, CTBA_DEF, ctba12hCopy, CTBA_12H_DEF, LEGACY_MBI_BEAR_FORMULA, LEGACY_CTBA_BEAR_FORMULA, MBI_BEAR_DEF, CTBA_BEAR_DEF, mbi2SellerCopy, MBI2_BEAR_DEF, ctba12hSellerCopy, CTBA_12H_BEAR_DEF, retentionSources, SELLER_RETENTION_FEATURES, ORIGINAL_BUILTIN_FEATURES, SELLER_FOCUS_CREATED_AT, SELLER_FOCUS_FEATURES, BUILTIN_FEATURES;
var init_features = __esm({
  "src/lib/deepDig/features.ts"() {
    init_sellerRetention();
    init_ctba();
    init_cba2();
    init_mbi2();
    init_mbi();
    init_researchAverageFormula();
    init_recentFocusMath();
    init_marketData();
    init_formula();
    ORIGINAL_SELLER_CORES = { cdi2: "CDI2", dss: "DSS", "seller-control": "bc", cda: "CDA", "mbi-bear": "MBI_bear", "ctba-bear": "CTBA_bear", "mbi2-bear": "MBI2_bear", "ctba_12h-bear": "CTBA_12H_bear", ...Object.fromEntries(SELLER_RETENTION_SPECS.map((s) => [s.id, s.core])) };
    FOCUS_SOURCE_CORES = { ...ORIGINAL_SELLER_CORES, state: "state" };
    SELLER_FEATURE_CORES = { ...ORIGINAL_SELLER_CORES, ...Object.fromEntries(Object.entries(ORIGINAL_SELLER_CORES).map(([id, core]) => [id + "-v2", core])) };
    SELLER_SIGN_MARK = "# seller-negative-v1";
    BEAR_RESPONSE_MARK = "# seller-response-v2";
    DEFAULT_INTERVAL = "5m";
    DEFAULT_HALF_LIFE_HOURS = 6;
    DEFAULT_AVG_HOURS = 24;
    featureTemplateId = (d) => d.chartTemplate ?? d.id;
    intervalOf = (d) => ["cba-2", "ctba"].includes(featureTemplateId(d) ?? "") ? "5m" : d.interval ?? DEFAULT_INTERVAL;
    halfLifeOf = (d) => d.halfLifeHours != null && d.halfLifeHours > 0 ? d.halfLifeHours : DEFAULT_HALF_LIFE_HOURS;
    avgHoursOf = (d) => d.avgHours != null && d.avgHours > 0 ? d.avgHours : DEFAULT_AVG_HOURS;
    featureUsesMbi = (d) => d.id === "mbi" || /\bmbiz\s*\(/.test((d.formula ?? "").replace(/(#|\/\/).*$/gm, ""));
    featureUsesMbi2 = (d) => d.id === "mbi2" || /\bmbiz2\s*\(/.test((d.formula ?? "").replace(/(#|\/\/).*$/gm, ""));
    PARAM_VARIABLES = [
      { name: "BAR_MINUTES", alias: "BAR_MINUTES", label: "当前计算周期的分钟数（自动读取，不手填）" },
      { name: "hl", alias: "半衰期", label: "半衰期（小时，上面选的；也可写「半衰期」）" },
      { name: "avgh", alias: "平均时长", label: "平均时长（小时，上面选的；也可写「平均时长」），配 avg(x, avgh) 用" },
      { name: "MBI2_N", alias: "MBI2_N", label: "MBI2 按小时和周期派生的根数（不手填）" },
      { name: "MBI2_T_HOURS", alias: "MBI2_T_HOURS", label: "MBI2 日历时长（小时）" },
      { name: "MBI2_BAND", alias: "MBI2_BAND", label: "MBI2 缓冲带半宽（默认0.2）" },
      { name: "MBI2_CONFIRM", alias: "MBI2_CONFIRM", label: "MBI2 确认阈值（默认0.8）" },
      { name: "MBI2_Z0", alias: "MBI2_Z0", label: "MBI2 独立饱和尺度" },
      { name: "MBI_N", alias: "MBI_N", label: `MBI 衰减周期（K 线根数，默认 ${MBI_N}；α 严格等于 1/n）` },
      { name: "MBI_Z0", alias: "MBI_Z0", label: `MBI 饱和尺度（默认 ${MBI_Z0}）` }
    ];
    PARAM_NAMES = PARAM_VARIABLES.flatMap((p) => [p.name, p.alias]);
    SERIES_VARIABLES = [
      { name: "T", label: "K线开盘时间（毫秒）" },
      { name: "C", label: "收盘价" },
      { name: "O", label: "开盘价" },
      { name: "H", label: "最高价" },
      { name: "L", label: "最低价" },
      { name: "Q", label: "成交额（USDT）= B + S" },
      { name: "B", label: "主动买入成交额（USDT）" },
      { name: "S", label: "主动卖出成交额（USDT）= Q − B" },
      { name: "E", label: "成交均价 VWAP = 成交额 ÷ 成交量" },
      { name: "CB", label: "同时段 BTCUSDT 收盘价（用到时另取；取不到为空）" }
    ];
    AMOUNT_VARIABLES = /* @__PURE__ */ new Set(["Q", "B", "S", "E"]);
    DEFAULT_GROUPS = {
      // 与原 Deep RSA 分组一致：理论 b 或盈亏比 > 3 为正样本，< 0.5 为对照
      campaigns: { positive: "Bₜ > 3 or b > 3", control: "Bₜ < 0.5 or b < 0.5" },
      // 与原信号分组一致：≥ 3 星为正样本，< 3 星为对照
      signals: { positive: "s >= 3", control: "s < 3" }
    };
    DEFAULT_POSITIVE = DEFAULT_GROUPS.campaigns.positive;
    DEFAULT_CONTROL = DEFAULT_GROUPS.campaigns.control;
    LEGACY_DRIFT_SPEED_FORMULA = [
      "# B / S = 主动买入 / 卖出成交金额（USDT），Q = B + S",
      "N = abs(B - S)              # 主动净资金",
      "F = ln(1 + N / ema(Q, 6))   # 资金力量：净资金比平时的成交额异常多少",
      "A = (B - S) / Q             # 主动买方优势",
      "G = 1 + max(A, 0)           # 买方优势权重",
      "R = ln(C / prev(C))         # 价格变化",
      "U = nz(F * G * R)           # 单根推动力（缺数据的那根记 0）",
      "V = ema(U, 6, 0)            # 漂移速度：半衰期 6 小时指数平滑"
    ].join("\n");
    EMA_DRIFT_SPEED_FORMULA = [
      "# B / S = 主动买入 / 卖出成交金额（USDT），Q = B + S；hl = 上面选的半衰期（小时）",
      "N = abs(B - S)              # 主动净资金",
      "F = ln(1 + N / ema(Q, hl))  # 资金力量：净资金比平时的成交额异常多少",
      "A = (B - S) / Q             # 主动买方优势",
      "G = 1 + max(A, 0)           # 买方优势权重",
      "R = ln(C / prev(C))         # 价格变化",
      "U = nz(F * G * R)           # 单根推动力（缺数据的那根记 0）",
      "V = ema(U, hl, 0)           # 漂移速度：按半衰期 hl 指数平滑"
    ].join("\n");
    LEGACY_V_DRIFT_SPEED_FORMULA = [
      "# B / S = 主动买入 / 卖出成交金额（USDT），Q = B + S；hl = 半衰期，avgh = 平均时长（小时，都在下面选）",
      "N = abs(B - S)                 # 主动净资金",
      "F = ln(1 + N / avg(Q, avgh))   # 资金力量：净资金比过去 avgh 小时的平均成交额异常多少",
      "A = (B - S) / Q                # 主动买方优势",
      "G = 1 + max(A, 0)              # 买方优势权重",
      "R = ln(C / prev(C))            # 价格变化",
      "U = nz(F * G * R)              # 单根推动力（缺数据的那根记 0）",
      "V = ema(U, hl, 0)              # 漂移速度：按半衰期 hl 指数平滑"
    ].join("\n");
    LEGACY_A_DRIFT_SPEED_FORMULA = LEGACY_V_DRIFT_SPEED_FORMULA.replace("V = ema(U, hl, 0)", "a = ema(U, hl, 0)");
    DRIFT_SPEED_FORMULA = LEGACY_A_DRIFT_SPEED_FORMULA.replace("F = ln(", "f = ln(").replace("U = nz(F * G * R)", "F = nz(f * G * R)").replace("ema(U, hl, 0)", "ema(F, hl, 0)").replace("单根推动力", "单根推力");
    DRIFT_SPEED_DEF = {
      id: "drift-speed",
      visibilityVersion: 1,
      name: "买方推力漂移速度 DSP·a",
      short: "a",
      definition: "进场前最后一根 K 线上，动态谢林点（多空博弈的均衡价）每根往上（+）或往下（−）移动多少：净资金力量 × 买方优势权重 × 涨跌幅，按半衰期指数平滑（周期、半衰期见下）。",
      formula: DRIFT_SPEED_FORMULA,
      scale: 1e4,
      unit: "基点/根",
      positive: DEFAULT_POSITIVE,
      control: DEFAULT_CONTROL,
      source: "campaigns",
      groupVars: 2,
      builtin: true
    };
    BSS_FORMULA = [
      "# BSS = 0.45·M标准化 + 0.25·Vd + 0.30·A，−1 ~ 1；Vd = V 随价格方向的加减分；订单簿 I 没有历史数据，去掉",
      "# Q = 成交额，B / S = 主动买入 / 卖出成交额（USDT）；avgh = 标准化窗口（下面选，默认 24 小时）",
      "n = 1                                   # 近期窗口（小时）",
      "M = C / ago(C, n) - 1                   # 价格动量：近 n 小时涨跌幅",
      "V = avg(Q, n) / avg(Q, avgh)            # 相对成交量：近 n 小时平均成交额 ÷ 近 avgh 小时平均",
      "A = (avg(B, n) - avg(S, n)) / avg(Q, n) # 成交攻击性：(主动买 − 主动卖) ÷ 合计，−1 ~ 1",
      "Mz = tanh(zscore(M, avgh))              # M 标准化：滚动 z-score 压到 −1 ~ 1",
      "Vz = tanh(zscore(V, avgh))              # V 标准化",
      "Vd = if(M > 0, Vz, if(M < 0, min(-Vz, 0), 0))   # 涨时放量加分、缩量扣分；跌时放量扣分、缩量不加分",
      "BSS = 0.45 * Mz + 0.25 * Vd + 0.30 * A"
    ].join("\n");
    BSS_NEW_HEAD = "# BSS = 0.45·M标准化 + 0.25·Vd + 0.30·A，−1 ~ 1；Vd = V 随价格方向的加减分；订单簿 I 没有历史数据，去掉";
    BSS_NEW_VD = "Vd = if(M > 0, Vz, if(M < 0, min(-Vz, 0), 0))   # 涨时放量加分、缩量扣分；跌时放量扣分、缩量不加分";
    BSS_LINE_UPGRADES = [
      { match: (l) => l.startsWith("# BSS = 0.45·M标准化 + 0.25·V标准化 + 0.30·A") || l.startsWith("# BSS = 0.45·M标准化 + 0.25·sign(M)·V标准化 + 0.30·A"), to: BSS_NEW_HEAD },
      { match: (l) => l === "BSS = 0.45 * Mz + 0.25 * Vz + 0.30 * A", to: `${BSS_NEW_VD}
BSS = 0.45 * Mz + 0.25 * Vd + 0.30 * A` },
      { match: (l) => /^Vd = sign\(M\) \* Vz\b/.test(l), to: BSS_NEW_VD }
    ];
    BSS_DEF = {
      id: "bss",
      name: "买卖强度综合分 BSS",
      short: "BSS",
      definition: "进场前最后一根 K 线上的买卖强度（−1 ~ 1）：0.45 × 价格动量 M 标准化 + 0.25 × 相对成交量 V 标准化 + 0.30 × 成交攻击性 A。> 0.55 且 M > 0 买方优势明确；从高位回落到 < 0.2 或 A 转负 = 弱了（阈值需自行验证）。订单簿没有历史，板不平衡 I 去掉。",
      formula: BSS_FORMULA,
      scale: 1,
      unit: "",
      positive: DEFAULT_POSITIVE,
      control: DEFAULT_CONTROL,
      source: "campaigns",
      groupVars: 2,
      builtin: true
    };
    DRIFT_SPEED_Z_FORMULA = [
      "# 波动率归一化：R / sd(R)，未减均值；再加权和平滑后的 az 不是标准 Z 分数，0 为净推力方向分界",
      "# B / S = 主动买入 / 卖出成交金额（USDT），Q = B + S；hl = 半衰期，avgh = 平均时长（小时，都在下面选）",
      "N = abs(B - S)                 # 主动净资金",
      "f = ln(1 + N / avg(Q, avgh))   # 资金力量：净资金比过去 avgh 小时的平均成交额异常多少",
      "A = (B - S) / Q                # 主动买方优势",
      "G = 1 + max(A, 0)              # 买方优势权重",
      "R = ln(C / prev(C))            # 价格变化",
      "Rz = R / sd(R, avgh)           # 波动率缩放的价格变化：未减均值，不是标准 Z 分数",
      "F = nz(f * G * Rz)             # 单根推力（标准差单位；缺数据的那根记 0）",
      "az = ema(F, hl, 0)             # 波动率归一化推力：按半衰期 hl 指数平滑"
    ].join("\n");
    DRIFT_SPEED_Z_DEF = {
      id: "drift-speed-z",
      name: "买方推力漂移速度 DSP·az（波动率归一化）",
      short: "az",
      definition: "原始 az = EMA(f × G × R / sd(R))，图上读数为 100 × az。仅按波动率缩放涨跌，不减均值；最终指标未标准化、方差不保证为 1。0 是净推力方向分界，15 仅对应未乘显示倍数前的 0.15，不是理论强弱门槛或 15 个标准差。",
      formula: DRIFT_SPEED_Z_FORMULA,
      scale: 100,
      unit: "归一化×100",
      positive: DEFAULT_POSITIVE,
      control: DEFAULT_CONTROL,
      source: "campaigns",
      groupVars: 2,
      builtin: true
    };
    CBA_FORMULA = [
      "# CBA 买方定价优势指数（−100 ~ 100）= 100·tanh(Σ w·F·G·R)；正 = 向上的价格优势仍被保留，负 = 价格结果不支持买方优势；不是胜率",
      "# B / S = 主动买入 / 卖出成交额，Q = B + S，E = 成交均价（VWAP）；hl = 时间权重半衰期，avgh = 常态成交额与波动率的回看时长（小时，都在下面选）",
      "eta = 0.5                                     # η：双向活跃成交的保留权重（0 < η ≤ 1）",
      "alpha = 1                                     # α：主动买入优势的额外加权系数（≥ 0）",
      "D = B - S                                     # 主动成交净差额（不是市场净资金流入）",
      "A = D / Q                                     # 主动买卖失衡，−1 ~ 1",
      "Vbar = prev(avg(Q, avgh))                     # 截至上一根的常态成交额：过去 avgh 小时平均",
      "F = ln(1 + (abs(D) + eta * (Q - abs(D))) / Vbar)  # 成交支持",
      "G = 1 + alpha * max(A, 0)                     # 主动买入加权",
      "P = min(E, C)                                 # 当前价：成交均价与收盘价取低",
      "sig = prev(sd(ln(E / prev(E)), avgh))         # 截至上一根：成交均价对数收益率的波动率 σ",
      "CBA = 100 * tanh(retain(F * G, P, prev(E), hl, 48) / sig)  # 48 小时窗口、时间权重 w、保留上移速度 R = ln(P ÷ Eᵢ₋₁) ÷ ((t − i + 1)·σ)"
    ].join("\n");
    CBA_DEF = {
      id: "cba",
      name: "买方定价优势指数 CBA",
      short: "CBA",
      definition: "进场前最后一根 K 线上的买方定价优势（−100 ~ 100）：过去 48 小时每根 K 线的成交支持 × 主动买入加权 × 保留上移速度，按时间权重加总后 100·tanh 压缩。正值 = 向上的价格优势仍被保留；负值 = 价格结果不支持买方优势。不是胜率。",
      formula: CBA_FORMULA,
      scale: 1,
      unit: "",
      positive: DEFAULT_POSITIVE,
      control: DEFAULT_CONTROL,
      source: "campaigns",
      groupVars: 2,
      builtin: true
    };
    CBI_FORMULA = [
      "# CBI 买方优势指数（−1 ~ 1）= P × D；> 0 买方占优。D = 方向（四个分量加权），P = 参与度（可信度）",
      "# V = 成交额 Q，Vᵇ / Vˢ = 主动买入 / 卖出成交额 B / S；avgh = 基线期（小时，下面选；原文 V̄ 是同时段 20 天中位数，拿不到，改用过去 avgh 小时）",
      "h = 12                                          # 时间衰减半衰期（根）：w = 2^(−(t − i) ÷ h)",
      "N = 48                                          # 求和窗口：最近 N 根",
      "m = 12                                          # 均价斜率回看根数",
      "kappa = 1                                       # κ：吸收斜率的收缩强度",
      "k = 2                                           # 参与度敏感度",
      "ATR = atr(H, L, C, 14)                          # 平均真实波幅（14 根）",
      "Vbar = prev(median(Q, avgh))                    # 基线成交额：截至上一根、过去 avgh 小时的中位数",
      "x = (B - S) / Vbar                              # 主动净流量",
      "r = (C - prev(C)) / ATR                         # 单根收益（以 ATR 计）",
      "F = wsum(B - S, h, N) / wsum(Q, h, N)           # F 主动性",
      "lam0 = rsum(r * sign(x), avgh) / rsum(abs(x), avgh)   # λ₀：基线对称冲击",
      "lp = (wsum(if(x > 0, r, 0), h, N) + kappa * lam0) / (wsum(if(x > 0, x, 0), h, N) + kappa)   # λ⁺：买一侧的价格冲击斜率",
      "lm = (wsum(if(x < 0, r, 0), h, N) - kappa * lam0) / (wsum(if(x < 0, x, 0), h, N) - kappa)   # λ⁻：卖一侧的价格冲击斜率",
      "A = (lp - lm) / (abs(lp) + abs(lm))             # A 吸收",
      "CLV = if(H > L, (2 * C - H - L) / (H - L), 0)   # 收盘在 K 线区间里的位置（−1 ~ 1）",
      "K = wsum(Q * CLV, h, N) / wsum(Q, h, N)         # K 收盘控制",
      "M = wsum(Q * ((H + L + C) / 3), h, N) / wsum(Q, h, N)   # 窗口成交额加权均价（平均成本）",
      "d = (C - M) / ATR                               # 价格相对均价的偏离",
      "v = (M - prev(M, m)) / (m * ATR)                # 均价漂移速度（ATR / 根）",
      "uF = tanh((F - prev(median(F, avgh))) / prev(rscale(F, avgh)) / 2)   # 稳健 z 压到 −1 ~ 1：z = (X − 中性点) ÷ rscale，rscale = 1.4826·MAD（MAD = 0 时 1.2533·平均绝对偏差）；F 的中性点 = 基线中位数",
      "uA = tanh(A / prev(rscale(A, avgh)) / 2)",
      "uK = tanh(K / prev(rscale(K, avgh)) / 2)",
      "uS = (tanh(d / prev(rscale(d, avgh)) / 2) + tanh(v / prev(rscale(v, avgh)) / 2)) / 2   # S 结构",
      "D = (0.30 * uF + 0.30 * uA + 0.15 * uK + 0.25 * uS) / (0.30 + 0.30 + 0.15 + 0.25)   # 方向",
      "RV = wsum(Q, h, N) / wsum(Vbar, h, N)           # 相对成交量",
      "P = RV ^ k / (1 + RV ^ k)                       # 参与度（可信度）",
      "CBI = P * D"
    ].join("\n");
    CBI_DEF = {
      id: "cbi",
      name: "买方优势指数 CBI",
      short: "CBI",
      definition: "进场前最后一根 K 线上的买方优势（−1 ~ 1）= 参与度 P × 方向 D：D 由主动性 F、吸收 A、收盘控制 K、结构 S 四个分量（稳健 z 压到 −1 ~ 1）按 0.30 / 0.30 / 0.15 / 0.25 加权；P = RV² ÷ (1 + RV²)。> 0 买方占优。",
      formula: CBI_FORMULA,
      scale: 1,
      unit: "",
      positive: DEFAULT_POSITIVE,
      control: DEFAULT_CONTROL,
      source: "campaigns",
      groupVars: 2,
      builtin: true
    };
    CBA2_DEF = { id: "cba-2", name: "成交支持下的价格重心迁移指标 CBA-2", short: "CBA-2", definition: CBA2_DEFINITION, formula: CBA2_FORMULA, scale: 1, unit: "", positive: DEFAULT_POSITIVE, control: DEFAULT_CONTROL, source: "campaigns", groupVars: 2, builtin: true };
    CBI2_FORMULA = [
      "# CBI-2 买方优势指数第 2 版（−1 ~ 1）= 2p − 1；0 = 五五开，0.1 ≈ 55:45。p = (1 − Ψ)·σ(L₁) + Ψ·σ(L₂)，σ = logistic",
      "# V = 成交额 Q，Vᵇ / Vˢ = B / S，CB = 同时段 BTCUSDT 收盘价；avgh = 基线期（小时，下面选；原文 20 天 / 14 天拿不到，改用过去 avgh 小时）",
      "k = 2                                            # 参与度敏感度",
      "kappa = 0.5                                      # κ：吸收斜率的收缩强度",
      "m = 6                                            # 动量 / 均价斜率回看根数",
      "ATR = atr(H, L, C, 14)                           # 平均真实波幅（14 根）",
      "ATRb = prev(median(ATR, avgh))                   # ATR̄：基线期 ATR 中位数",
      "Vbar = prev(median(Q, avgh))                     # V̄：基线成交额（中位数）",
      "x = (B - S) / Vbar                               # 主动净流量（除以基线量）",
      "r = (C - prev(C)) / ATRb                         # 单根收益（除以 ATR̄）",
      "rho = ln(C / prev(C))                            # 对数收益 ρ",
      "rb = ln(CB / prev(CB))                           # BTC 的对数收益",
      "F = wsum(B - S, 3, 12) / wsum(Q, 3, 12)          # F 主动买卖失衡（12 根，半衰期 3）",
      "dF = wsum(B - S, 2, 6) / wsum(Q, 2, 6) - wsum(B - S, 6, 24) / wsum(Q, 6, 24)   # ΔF = F₆ − F₂₄：买盘增减",
      "lam0 = rsum(r * sign(x), avgh) / rsum(abs(x), avgh)   # λ₀：基线期的对称冲击",
      "lp = (wsum(if(x > 0, r, 0), 6, 24) + kappa * lam0) / (wsum(if(x > 0, x, 0), 6, 24) + kappa)   # λ⁺（24 根，半衰期 6）",
      "lm = (wsum(if(x < 0, r, 0), 6, 24) - kappa * lam0) / (wsum(if(x < 0, x, 0), 6, 24) - kappa)   # λ⁻",
      "A = (lp - lm) / (abs(lp) + abs(lm))              # A 吸收",
      "lpf = (wsum(if(x > 0, r, 0), 3, 12) + kappa * lam0) / (wsum(if(x > 0, x, 0), 3, 12) + kappa)  # 快速版 λ⁺（12 根，半衰期 3）",
      "lmf = (wsum(if(x < 0, r, 0), 3, 12) - kappa * lam0) / (wsum(if(x < 0, x, 0), 3, 12) - kappa)  # 快速版 λ⁻",
      "Af = (lpf - lmf) / (abs(lpf) + abs(lmf))         # A_f 吸收快速版",
      "e = r - (lp * max(x, 0) + lm * min(x, 0))        # 成交解释不了的价格变化",
      "U = e / prev(sd(e, avgh))                        # U 意外度：除以基线标准差 s_e",
      "phi = prev(beta(rho, rb, 24))                    # φ：对 BTC 的回归斜率（过去 1 天）",
      "Mo = msum(rho - nz(phi * rb), m) / (ATR / C * sqrt(m))   # Mo 剔除 BTC 后的短期动量（BTC 读数缺失时不剔除）",
      "M = wsum(Q * ((H + L + C) / 3), 6, 24) / wsum(Q, 6, 24)  # 成交额加权均价（24 根，半衰期 6）",
      "d = (C - M) / ATR                                # 价格相对均价的偏离",
      "v = (M - prev(M, m)) / (m * ATR)                 # 均价漂移速度（ATR / 根）",
      "Hh = highest(H, 12)                              # 最近 12 根最高价",
      "Ll = lowest(L, 12)                               # 最近 12 根最低价",
      "K = if(Hh > Ll, (2 * C - Hh - Ll) / (Hh - Ll), 0)   # K 最近 1 小时的收盘位置（−1 ~ 1）",
      "S6 = msum(S, 6)                                  # 最近 6 根主动卖出之和",
      "Ex = ln(highest(S6, 43) / S6)                    # Ex 卖盘衰竭度：48 根内任意连续 6 根的最大值 ÷ 最近 6 根",
      "DD = (highest(C, 48) - C) / ATR                  # 距 48 根最高收盘的回撤（ATR）",
      "RV = msum(Q, 12) / msum(Vbar, 12)                # 相对成交量（12 根）",
      "RV24 = msum(Q, 24) / msum(Vbar, 24)              # 相对成交量（24 根）",
      "g = 2 * RV ^ k / (1 + RV ^ k)                    # 参与度放大系数（量能正常 = 1）",
      "Psi = 1 / (1 + exp(-4 * (ln(RV24) - ln(2.5)))) / (1 + exp(-2 * (DD - 3)))   # Ψ 恐慌度 = σ(4·(ln RV₂₄ − ln 2.5))·σ(2·(DD − 3))",
      "zF = clip((F - prev(median(F, avgh))) / prev(rscale(F, avgh)), -3, 3)   # 稳健 z 截断到 ±3：(X − 中性点) ÷ (1.4826·MAD)；F 的中性点 = 基线中位数",
      "zdF = clip(dF / prev(rscale(dF, avgh)), -3, 3)",
      "zA = clip(A / prev(rscale(A, avgh)), -3, 3)",
      "zMo = clip(Mo / prev(rscale(Mo, avgh)), -3, 3)",
      "zd = clip(d / prev(rscale(d, avgh)), -3, 3)",
      "zv = clip(v / prev(rscale(v, avgh)), -3, 3)",
      "zK = clip(K / prev(rscale(K, avgh)), -3, 3)",
      "zU = clip(U / prev(rscale(U, avgh)), -3, 3)",
      "zAf = clip(Af / prev(rscale(Af, avgh)), -3, 3)",
      "zEx = clip(Ex / prev(rscale(Ex, avgh)), -3, 3)",
      "L1 = 0 + g * (0.07 * zF + 0.04 * zdF + 0.07 * zA + 0.07 * zMo + 0.04 * zd + 0.04 * zv + 0.02 * zK) + 0.2 * min(zU, 0)   # L₁ 顺势分支（对数几率）",
      "L2 = -0.5 + 0.35 * zAf + 0.25 * zEx              # L₂ 吸收分支（对数几率）",
      "p = (1 - Psi) / (1 + exp(-L1)) + Psi / (1 + exp(-L2))   # 上涨（交易成功）的概率",
      "CBI2 = 2 * p - 1"
    ].join("\n");
    CBI2_DEF = {
      id: "cbi2",
      name: "买方优势指数 CBI-2",
      short: "CBI-2",
      definition: "进场前最后一根 K 线上的买方优势第 2 版（−1 ~ 1）= 2p − 1：p 是上涨的概率，由顺势分支 L₁（主动性、买盘增减、吸收、剔除 BTC 的动量、均价偏离与漂移、收盘位置、意外度）与吸收分支 L₂（快速吸收、卖盘衰竭）按恐慌度 Ψ 混合。0 = 五五开，0.1 ≈ 55:45。",
      formula: CBI2_FORMULA,
      scale: 1,
      unit: "",
      positive: DEFAULT_POSITIVE,
      control: DEFAULT_CONTROL,
      source: "campaigns",
      groupVars: 2,
      builtin: true
    };
    MBI_FORMULA = appendResearchAverages([
      "# MBI 只看已收盘价格；参数 MBI_N、MBI_Z0 在下方设置。",
      "# x = ln(C)；α = 1/MBI_N；κ = 1/√(α·(2−α))。",
      "# M、S 从序列首根递推；S 初值为前 n 个对数涨跌平方的平均。",
      "# z 使用更新前的 M、S；前 5n 根为空，不参与均值、平滑或评估。",
      "z = mbiz(C, MBI_N)",
      "MBI = tanh(z / MBI_Z0)"
    ].join("\n"), /* @__PURE__ */ new Set(["z", "MBI"]), { core: "MBI", avg: "avg_MBI", avg2: "avg_MBI_2" }) + "\nMBI = MBI";
    MBI_DEF = {
      id: "mbi",
      name: "MBI 迈克尔买方优势",
      short: "MBI",
      definition: MBI_TOOLTIP,
      formula: MBI_FORMULA,
      MBI_N,
      MBI_Z0,
      scale: 1,
      unit: "",
      positive: DEFAULT_POSITIVE,
      control: DEFAULT_CONTROL,
      source: "campaigns",
      groupVars: 2,
      builtin: true
    };
    mbi2Copy = copyFeatureDefinition(MBI_DEF, [MBI_DEF], Date.UTC(2026, 9, 29, 14));
    ({ MBI_N: _oldN, MBI_Z0: _oldZ, ...mbi2Own } = mbi2Copy);
    MBI2_FORMULA = appendResearchAverages([
      "# MBI2 独立副本；MBI2_N由日历小时派生，前5n根为空；z0固定1.25。",
      "MBI2_z = mbiz2(C, MBI2_N)",
      "MBI2 = tanh(MBI2_z / MBI2_Z0)"
    ].join("\n"), /* @__PURE__ */ new Set(["MBI2_z", "MBI2"]), { core: "MBI2", avg: "avg_MBI2", avg2: "avg_MBI2_2" }) + [
      "",
      "MBI2_state = mbi2state(MBI2,T,MBI2_BAND,MBI2_CONFIRM,0)",
      "MBI2_lead_h = mbi2state(MBI2,T,MBI2_BAND,MBI2_CONFIRM,1)",
      "MBI2_confirm_h = mbi2state(MBI2,T,MBI2_BAND,MBI2_CONFIRM,2)",
      "MBI2 = MBI2"
    ].join("\n");
    MBI2_DEF = {
      ...mbi2Own,
      id: "mbi2",
      name: "MBI2 迈克尔买方优势（可调版）",
      short: "MBI2",
      builtin: true,
      chartTemplate: "mbi2",
      chartCore: "MBI2",
      formula: MBI2_FORMULA,
      MBI2_Z0,
      MBI2_BAND: 0.2,
      MBI2_CONFIRM: 0.8,
      researchWindowHours: 48,
      definition: MBI2_TOOLTIP + " 未手动设小时数时，每个周期默认n=25；手动设定后固定日历时长。状态为买方确认/买方试探/均衡/卖方试探/卖方确认。持续小时以当前方向及本段确认为起点，起始根为0，最多48小时。扫描仅展示，不自动调整默认参数。"
    };
    CDI2_FORMULA = sellerNegativeFormula([
      "# CDI2 买方失控程度（−1 ~ 1）：越低（越负）表示卖方优势越强、买方控制越弱；p 为模型映射分数，未经胜率校准",
      "# B / S = 主动买入 / 卖出成交额，CB = 同时段 BTC 收盘价；窗口、系数与 CBI-2 相同，方向对称转换",
      "k = 2                                            # 参与度敏感度",
      "kappa = 0.5                                      # κ：吸收斜率的收缩强度",
      "m = 6                                            # 动量 / 均价斜率回看根数",
      "ATR = atr(H, L, C, 14)                           # 平均真实波幅（14 根）",
      "ATRb = prev(median(ATR, avgh))                   # ATR̄：基线期 ATR 中位数",
      "Vbar = prev(median(Q, avgh))                     # V̄：基线成交额（中位数）",
      "x = (S - B) / Vbar                               # 主动卖出净差额（除以基线量）",
      "r = (prev(C) - C) / ATRb                         # 向下价格变化（除以 ATR̄）",
      "rho = -ln(C / prev(C))                            # 向下对数收益 ρ",
      "rb = -ln(CB / prev(CB))                           # BTC 的向下对数收益",
      "F = wsum(S - B, 3, 12) / wsum(Q, 3, 12)          # F 主动卖买失衡（12 根，半衰期 3）",
      "dF = wsum(S - B, 2, 6) / wsum(Q, 2, 6) - wsum(S - B, 6, 24) / wsum(Q, 6, 24)   # ΔF = F₆ − F₂₄：卖盘增减",
      "lam0 = rsum(r * sign(x), avgh) / rsum(abs(x), avgh)   # λ₀：基线期的对称冲击",
      "lp = (wsum(if(x > 0, r, 0), 6, 24) + kappa * lam0) / (wsum(if(x > 0, x, 0), 6, 24) + kappa)   # λ⁺（24 根，半衰期 6）",
      "lm = (wsum(if(x < 0, r, 0), 6, 24) - kappa * lam0) / (wsum(if(x < 0, x, 0), 6, 24) - kappa)   # λ⁻",
      "A = (lp - lm) / (abs(lp) + abs(lm))              # A 卖方吸收",
      "lpf = (wsum(if(x > 0, r, 0), 3, 12) + kappa * lam0) / (wsum(if(x > 0, x, 0), 3, 12) + kappa)  # 快速版 λ⁺（12 根，半衰期 3）",
      "lmf = (wsum(if(x < 0, r, 0), 3, 12) - kappa * lam0) / (wsum(if(x < 0, x, 0), 3, 12) - kappa)  # 快速版 λ⁻",
      "Af = (lpf - lmf) / (abs(lpf) + abs(lmf))         # A_f 卖方吸收快速版",
      "e = r - (lp * max(x, 0) + lm * min(x, 0))        # 成交解释不了的向下价格变化（负值为意外上涨，惩罚卖方判断）",
      "U = e / prev(sd(e, avgh))                        # U 意外度：除以基线标准差 s_e",
      "phi = prev(beta(rho, rb, 24))                    # φ：对 BTC 的回归斜率（过去 1 天）",
      "Mo = msum(rho - nz(phi * rb), m) / (ATR / C * sqrt(m))   # Mo 剔除 BTC 后的向下短期动量（BTC 读数缺失时不剔除）",
      "M = wsum(Q * ((H + L + C) / 3), 6, 24) / wsum(Q, 6, 24)  # 成交额加权均价（24 根，半衰期 6）",
      "d = (M - C) / ATR                                # 均价相对价格的向下偏离",
      "v = (prev(M, m) - M) / (m * ATR)                 # 均价向下漂移速度（ATR / 根）",
      "Hh = highest(H, 12)                              # 最近 12 根最高价",
      "Ll = lowest(L, 12)                               # 最近 12 根最低价",
      "K = if(Hh > Ll, (Hh + Ll - 2 * C) / (Hh - Ll), 0)   # K 最近 12 根的向下收盘位置（−1 ~ 1）",
      "B6 = msum(B, 6)                                  # 最近 6 根主动买入之和",
      "Ex = ln(highest(B6, 43) / B6)                    # Ex 买盘衰竭度：48 根内任意连续 6 根的最大值 ÷ 最近 6 根",
      "DU = (C - lowest(C, 48)) / ATR                  # 距 48 根最低收盘的上冲（ATR）",
      "RV = msum(Q, 12) / msum(Vbar, 12)                # 相对成交量（12 根）",
      "RV24 = msum(Q, 24) / msum(Vbar, 24)              # 相对成交量（24 根）",
      "g = 2 * RV ^ k / (1 + RV ^ k)                    # 参与度放大系数（量能正常 = 1）",
      "Psi = 1 / (1 + exp(-4 * (ln(RV24) - ln(2.5)))) / (1 + exp(-2 * (DU - 3)))   # Ψ 亢奋度 = σ(4·(ln RV₂₄ − ln 2.5))·σ(2·(DU − 3))",
      "zF = clip((F - prev(median(F, avgh))) / prev(rscale(F, avgh)), -3, 3)   # 稳健 z 截断到 ±3：(X − 中性点) ÷ (1.4826·MAD)；F 的中性点 = 基线中位数",
      "zdF = clip(dF / prev(rscale(dF, avgh)), -3, 3)",
      "zA = clip(A / prev(rscale(A, avgh)), -3, 3)",
      "zMo = clip(Mo / prev(rscale(Mo, avgh)), -3, 3)",
      "zd = clip(d / prev(rscale(d, avgh)), -3, 3)",
      "zv = clip(v / prev(rscale(v, avgh)), -3, 3)",
      "zK = clip(K / prev(rscale(K, avgh)), -3, 3)",
      "zU = clip(U / prev(rscale(U, avgh)), -3, 3)",
      "zAf = clip(Af / prev(rscale(Af, avgh)), -3, 3)",
      "zEx = clip(Ex / prev(rscale(Ex, avgh)), -3, 3)",
      "L1 = 0 + g * (0.07 * zF + 0.04 * zdF + 0.07 * zA + 0.07 * zMo + 0.04 * zd + 0.04 * zv + 0.02 * zK) + 0.2 * min(zU, 0)   # L₁ 卖方顺势分支（对数几率）",
      "L2 = -0.5 + 0.35 * zAf + 0.25 * zEx              # L₂ 卖方吸收分支（对数几率）",
      "p = (1 - Psi) / (1 + exp(-L1)) + Psi / (1 + exp(-L2))   # 卖方优势的模型映射分数（非实测胜率）",
      "CDI2 = 2 * p - 1"
    ].join("\n"), "CDI2");
    CDI2_DEF = {
      id: "cdi2",
      name: "买方失控程度",
      short: "CDI2",
      definition: "买方失控程度（−1 ~ 1）：越低（越负）表示优势越向卖方转移、卖方优势越强、买方控制越弱。沿用 CBI-2 的窗口与权重，改看主动卖盘、卖盘增减、卖方吸收、剔除 BTC 后的向下动量、均价下移与低位收盘；放量上冲时侧重买盘衰竭与快速卖方吸收。p 是模型映射分数，未经真实下跌概率或胜率校准。",
      sellerSignVersion: 1,
      formula: CDI2_FORMULA,
      scale: 1,
      unit: "",
      positive: DEFAULT_POSITIVE,
      control: DEFAULT_CONTROL,
      source: "campaigns",
      groupVars: 2,
      builtin: true
    };
    STATE_FORMULA = [
      "# 多空状态 S（0 ~ 1）：0 = 卖方完全占优，0.5 = 均衡，1 = 买方完全占优；三部分都买卖对称，相加后 logistic 压到 0 ~ 1",
      "# B / S = 主动买入 / 卖出成交额，Q = B + S，E = 成交均价，CB = 同时段 BTC 收盘价；hl = 半衰期，avgh = 基线时长（小时，下面选）",
      "wc = 3                                           # CBI-2 买卖对称分的权重（它本身读数偏小，0.04 ≈ 52:48）",
      "wa = 0.4                                         # 推力 az 的权重",
      "wb = 1                                           # 定价保留的权重",
      "sh = 4                                           # CBI-2 部分的平滑半衰期（小时）",
      "ka = 10                                          # az 每 0.1 记 1 个对数几率单位",
      "# —— 1. CBI-2：买方分数 p（与 CBI-2 公式相同）",
      ...CBI2_FORMULA.split("\n").slice(2),
      "# —— 卖方分数 ps（与 CDI2 相同：方向项取反，吸收分支改看买盘衰竭与上冲）",
      "dir = 0.07 * zF + 0.04 * zdF + 0.07 * zA + 0.07 * zMo + 0.04 * zd + 0.04 * zv + 0.02 * zK   # CBI-2 的方向合计",
      "B6 = msum(B, 6)                                  # 最近 6 根主动买入之和",
      "ExS = ln(highest(B6, 43) / B6)                   # 买盘衰竭度",
      "DU = (C - lowest(C, 48)) / ATR                   # 距 48 根最低收盘的上冲（ATR）",
      "PsiS = 1 / (1 + exp(-4 * (ln(RV24) - ln(2.5)))) / (1 + exp(-2 * (DU - 3)))   # 亢奋度",
      "zExS = clip(ExS / prev(rscale(ExS, avgh)), -3, 3)",
      "L1s = -g * dir + 0.2 * min(-zU, 0)               # 卖方顺势分支",
      "L2s = -0.5 - 0.35 * zAf + 0.25 * zExS            # 卖方吸收分支",
      "ps = (1 - PsiS) / (1 + exp(-L1s)) + PsiS / (1 + exp(-L2s))   # 卖方分数",
      "Lc = (ln(p / (1 - p)) - ln(ps / (1 - ps))) / 2   # 买卖对称分（对数几率）：买方占优 > 0，卖方占优 < 0",
      "Lcs = ema(nz(Lc), sh, 0)                         # 平滑（不平均有界的 2p − 1，免得极端被压向中间）",
      "# —— 2. 推力 az（买卖双方都加权）",
      "uN = abs(B - S)                                  # 主动净资金",
      "uf = ln(1 + uN / avg(Q, avgh))                   # 资金力量",
      "uA = (B - S) / Q                                 # 主动买卖失衡，−1 ~ 1",
      "uG = 1 + abs(uA)                                 # 失衡权重：哪边主动都加权（原 DSP 只加权买方）",
      "uR = ln(C / prev(C))                             # 价格变化",
      "uRz = uR / sd(uR, avgh)                          # 几个标准差",
      "uF = nz(uf * uG * uRz)                           # 单根推力",
      "az = ema(uF, hl, 0)                              # 推力漂移速度（Z 分数）",
      "La = clip(ka * az, -3, 3)                        # 换成对数几率单位",
      "# —— 3. 定价保留（CBA 的买卖对称版）",
      "cD = B - S                                       # 主动成交净差额",
      "cA = cD / Q                                      # 主动买卖失衡",
      "cVbar = prev(avg(Q, avgh))                       # 截至上一根的常态成交额",
      "cF = ln(1 + (abs(cD) + 0.5 * (Q - abs(cD))) / cVbar)   # 成交支持",
      "sig = prev(sd(ln(E / prev(E)), avgh))            # 成交均价对数收益率的波动率",
      "Sb = retain(cF * (1 + max(cA, 0)), min(E, C), prev(E), hl, 48) / sig   # 买方：向上的价格优势是否被保留（取较低价）",
      "Ss = retain(cF * (1 + max(-cA, 0)), max(E, C), prev(E), hl, 48) / sig  # 卖方：向下的价格优势是否被保留（取较高价）",
      "Lb = clip((Sb + Ss) / 2, -3, 3)                  # 对称定价保留",
      "# —— 合成",
      "Lt = wc * Lcs + wa * La + wb * Lb                # 合计对数几率",
      "state = 1 / (1 + exp(-Lt))"
    ].join("\n");
    STATE_DEF = {
      id: "state",
      name: "多空状态 S（0–1）",
      short: "状态",
      definition: "当前多空状态（0 ~ 1）：0 = 卖方完全占优，0.5 = 均衡，1 = 买方完全占优。由三部分合成，都做成买卖对称：CBI-2 的买方分数与同一套算法的卖方分数之差（对数几率，4 小时半衰期平滑）、买卖双方都加权的推力 az、买卖双方各算一次的定价保留（CBA 对称版）。数值是模型分数，不是胜率。",
      formula: STATE_FORMULA,
      scale: 1,
      unit: "",
      positive: DEFAULT_POSITIVE,
      control: DEFAULT_CONTROL,
      source: "campaigns",
      groupVars: 2,
      builtin: true
    };
    STATE2_FORMULA = STATE_FORMULA.split("\n").filter((line) => !line.startsWith("Sb = ")).map((line) => line.startsWith("# 多空状态 S（") ? "# 多空状态 S2（0 ~ 1）：沿用状态 S，第三部分改为 CDA 定价保留、权重 3；越高越偏买方" : line.startsWith("wb = ") ? "wb = 3                                           # CDA 定价保留的权重（状态 S 为 1）" : line.startsWith("# —— 3.") ? "# —— 3. CDA 定价保留（沿用状态 S 的尺度、方向与截断）" : line.startsWith("Lb = ") ? "Lb = clip(Ss, -3, 3)                             # CDA 的有符号定价保留，负值偏卖方；保持原合成尺度" : line.startsWith("state = ") ? line.replace("state = ", "state2 = ") : line).join("\n");
    STATE2_DEF = {
      ...STATE_DEF,
      id: "state2",
      name: "多空状态 S2（0–1）",
      short: "状态 S2",
      definition: "状态 S 的独立变体（0 ~ 1）：将第三部分由 CBA 买卖对称定价保留改为 CDA 对应的有符号定价保留，越负表示卖方越强；沿用原分量尺度与 ±3 截断。权重为 3 / 0.4 / 3（定价保留权重由状态 S 的 1 提高到 3）；CBI-2 买卖对称分、对称推力 az、4 小时平滑与最终 logistic 均不变。越高越偏买方，0.5 为模型中性点；不是胜率。",
      formula: STATE2_FORMULA
    };
    SELLER_CONTROL_FORMULA = sellerNegativeFormula([
      "# 卖方控制力：涨跌共用对称权重 1 + abs(A)，不因哪方主动而系统性偏向卖方",
      "# RMS = sqrt(avg(R * R, avgh))，保留漂移；不是减均值的标准差或最终指标的 Z 分数",
      "N = abs(B - S)",
      "f = ln(1 + N / avg(Q, avgh))",
      "A = (B - S) / Q",
      "W = 1 + abs(A)",
      "R = ln(C / prev(C))",
      "Rz = R / sqrt(avg(R * R, avgh))",
      "Dn = max(-Rz, 0)",
      "Up = max(Rz, 0)",
      "F = nz(f * W * (Dn - Up))",
      "bc = ema(F, hl, 0)"
    ].join("\n"), "bc");
    SELLER_CONTROL_DEF = {
      id: "seller-control",
      name: "卖方控制力",
      short: "DSP·bc",
      definition: "衡量卖方是否控制价格结果：主动卖压低价格、或被动卖盘压住主动买，都计为卖方占优；上涨（含卖压失败）计为买方占优。涨跌共用 1 + abs(A) 对称权重和收益 RMS 归一化。按 hl 半衰期平滑并取负后，负值表示卖方占优，正值表示买方占优，均衡约为 0。",
      formula: SELLER_CONTROL_FORMULA,
      sellerSignVersion: 1,
      scale: 100,
      unit: "%σ/根",
      positive: DEFAULT_POSITIVE,
      control: DEFAULT_CONTROL,
      source: "campaigns",
      groupVars: 2,
      builtin: true
    };
    DSS_FORMULA = sellerNegativeFormula([
      "# DSS 买方状态恶化（−1 ~ 1）= 0.45·向下动量标准化 + 0.25·卖方成交量方向分 + 0.30·主动卖方失衡",
      "# Q = 成交额，B / S = 主动买入 / 卖出成交额；avgh = 标准化窗口（小时，默认 24）；窗口与权重沿用 BSS",
      "n = 1                                   # 近期窗口（小时）",
      "M = 1 - C / ago(C, n)                   # 向下价格动量：相对 n 小时前的跌幅，下跌为正",
      "V = avg(Q, n) / avg(Q, avgh)            # 相对成交量：近期平均成交额 ÷ 基线平均",
      "A = (avg(S, n) - avg(B, n)) / avg(Q, n) # 主动卖方失衡：(主动卖 − 主动买) ÷ 合计",
      "Mz = tanh(zscore(M, avgh))              # 向下动量标准化，保留 BSS 的滚动口径",
      "Vz = tanh(zscore(V, avgh))              # 相对成交量标准化",
      "Vd = if(M > 0, Vz, if(M < 0, min(-Vz, 0), 0))   # 跌时放量加分、缩量扣分；涨时放量扣分、缩量不加分",
      "DSS = 0.45 * Mz + 0.25 * Vd + 0.30 * A"
    ].join("\n"), "DSS");
    DSS_DEF = {
      id: "dss",
      name: "买方状态恶化",
      short: "DSS",
      definition: "买方状态恶化（−1 ~ 1）：0.45 × 向下动量标准化 + 0.25 × 卖方成交量方向分 + 0.30 × 主动卖方失衡。下跌时放量加分、缩量扣分；上涨时放量扣分、缩量不加分。沿用 BSS 的 1 小时近期窗口、标准化窗口和权重；数值越低（越负）表示综合状态越偏向卖方。读数是相对常态的状态评分，不是恶化速度或下跌概率。",
      sellerSignVersion: 1,
      formula: DSS_FORMULA,
      scale: 1,
      unit: "",
      positive: DEFAULT_POSITIVE,
      control: DEFAULT_CONTROL,
      source: "campaigns",
      groupVars: 2,
      builtin: true
    };
    CDA_FORMULA = sellerNegativeFormula([
      "# CDA 买方阻力（−100 ~ 100）：成交支持 × 主动卖出权重 × 保留下移速度，按时间加权后 100·tanh 压缩",
      "# B / S = 主动买入 / 卖出成交额，Q = B + S，E = 成交均价；hl、avgh 均以小时计，沿用 CBA",
      "eta = 0.5                                     # 双向活跃成交的保留权重",
      "alpha = 1                                     # 主动卖出优势的额外加权系数",
      "D = S - B                                     # 主动卖出净差额",
      "A = D / Q                                     # 主动卖方失衡",
      "Vbar = prev(avg(Q, avgh))                     # 截至上一根的常态成交额",
      "F = ln(1 + (abs(D) + eta * (Q - abs(D))) / Vbar)  # 成交支持",
      "G = 1 + alpha * max(A, 0)                     # 主动卖出加权",
      "P = max(E, C)                                 # 当前价取成交均价与收盘价的较高者，保守衡量向下成果",
      "sig = prev(sd(ln(E / prev(E)), avgh))         # 截至上一根的成交均价对数收益率波动率",
      "CDA = 100 * tanh(-retain(F * G, P, prev(E), hl, 48) / sig)  # 保留下移速度 = ln(Eᵢ₋₁ ÷ P) ÷ ((t − i + 1)·σ)，48 小时窗口"
    ].join("\n"), "CDA");
    CDA_DEF = {
      id: "cda",
      name: "买方阻力",
      short: "CDA",
      definition: "买方阻力（−100 ~ 100）：过去 48 小时每根 K 线的成交支持 × 主动卖出权重 × 当前仍保留的向下价格位移速度，按时间加权后 100·tanh 压缩。当前价取成交均价与收盘价的较高者，保守衡量卖方成果；负值表示向下的价格优势仍被保留，数值越低表示买方面临的卖方阻力越强。沿用 CBA 的窗口、权重和波动率标准化；这是状态评分，不是订单簿阻力价位或下跌概率。",
      sellerSignVersion: 1,
      formula: CDA_FORMULA,
      scale: 1,
      unit: "",
      positive: DEFAULT_POSITIVE,
      control: DEFAULT_CONTROL,
      source: "campaigns",
      groupVars: 2,
      builtin: true
    };
    CTBA_DEF = { id: "ctba", name: "CTBA｜趋势买方优势", short: "CTBA", definition: CTBA_DESCRIPTION, formula: ctbaFormula(), scale: 1, unit: "", positive: DEFAULT_POSITIVE, control: DEFAULT_CONTROL, source: "campaigns", groupVars: 2, builtin: true, interval: "5m" };
    ctba12hCopy = copyFeatureDefinition(CTBA_DEF, [CTBA_DEF], Date.UTC(2026, 9, 29));
    CTBA_12H_DEF = {
      ...ctba12hCopy,
      id: "ctba_12h",
      name: "CTBA-12H｜趋势买方优势（12小时）",
      short: "CTBA-12H",
      builtin: true,
      chartTemplate: "ctba",
      chartCore: "CTBA",
      interval: "5m",
      halfLifeHours: 2,
      researchWindowHours: 12,
      formula: "ctba_12h_version = 1\n" + ctbaFormula({ ...CTBA_12H_DEFAULTS }),
      definition: "原 CTBA 的独立12小时副本：5m，N=144，EMA 8/24，波动窗口48根，主动买卖半衰期24根（2h），λ=ln(2)/24，ε=1e-12，权重0.35/0.40/0.25。100·tanh[0.35·tanh(T)+0.40·tanh(M)+0.25·F]；0是固定综合中性基准，正值偏买方、负值偏卖方。分量正负可抵消，0不单独证明主动买卖额相等。无平移、无样本重定心、无截负；保留缺失与全精度。研究展示入场前144根已收盘线，另取滚动与EMA预热；原CTBA独立保留。"
    };
    LEGACY_MBI_BEAR_FORMULA = bearFeatureFormula(MBI_FORMULA, "MBI", "MBI_bear");
    LEGACY_CTBA_BEAR_FORMULA = bearFeatureFormula(CTBA_DEF.formula, "CTBA", "CTBA_bear");
    MBI_BEAR_DEF = {
      ...MBI_DEF,
      id: "mbi-bear",
      name: "MBI 空方趋势",
      short: "MBI·空方",
      chartTemplate: "mbi",
      chartCore: "MBI_bear",
      sellerSignVersion: 1,
      definition: "MBI 空方趋势 v2：0 为多空平衡，卖方优势用负值、买方优势用正值，保留 −1～1 双向刻度。正值原样保留；负值在 tanh 压缩前施加 seller_gain（默认 2），增强弱卖方信号，保持零轴、衰减周期、饱和尺度、预热及均值窗口不变。MBI=−0.5 时空方读数为−0.8；缺失值不补零。增益可在公式中修改。",
      formula: bearFeatureFormula(MBI_FORMULA, "MBI", "MBI_bear", 1, true)
    };
    CTBA_BEAR_DEF = {
      ...CTBA_DEF,
      id: "ctba-bear",
      name: "CTBA 空方趋势",
      short: "CTBA·空方",
      chartTemplate: "ctba",
      chartCore: "CTBA_bear",
      sellerSignVersion: 1,
      definition: "CTBA 空方趋势 v2：0 为趋势位置、VWAP 动能及主动成交金额的综合平衡，卖方优势为负、买方优势为正，保留 −100～100 双向刻度。正值原样保留；负值在外层 tanh 压缩前施加 seller_gain（默认 2）。CTBA=−50 时空方读数为−80。全部窗口、权重、5m 已收盘规则、预热和均值窗口保持不变，缺失值不补零；增益可在公式中修改。",
      formula: bearFeatureFormula(CTBA_DEF.formula, "CTBA", "CTBA_bear", 100, true)
    };
    mbi2SellerCopy = copyFeatureDefinition(MBI2_DEF, [MBI2_DEF], Date.UTC(2026, 9, 29, 15));
    MBI2_BEAR_DEF = {
      ...mbi2SellerCopy,
      id: "mbi2-bear",
      name: "MBI2 卖方趋势（可调版）",
      short: "MBI2·卖方",
      builtin: true,
      chartTemplate: "mbi2",
      chartCore: "MBI2_bear",
      sellerSignVersion: 1,
      formula: bearFeatureFormula(MBI2_FORMULA, "MBI2", "MBI2_bear", 1, true) + [
        "",
        "MBI2_bear_state = mbi2state(MBI2_bear,T,MBI2_BAND,MBI2_CONFIRM,0)",
        "MBI2_bear_lead_h = mbi2state(MBI2_bear,T,MBI2_BAND,MBI2_CONFIRM,1)",
        "MBI2_bear_confirm_h = mbi2state(MBI2_bear,T,MBI2_BAND,MBI2_CONFIRM,2)",
        "MBI2_bear = MBI2_bear"
      ].join("\n"),
      definition: "MBI2 的独立卖方副本。0为综合均衡，卖方越强越负，正值原样保留；seller_gain默认2，只增强负向幅度，不缩短日历时长、5n预热或均值窗口。保留独立的缓冲状态及本轮/确认持续小时；状态阈值作用于本副本增强后的读数。确认阈值默认0.8、缓冲带默认0.2，z0固定1.25。缺失不补零，原MBI2及原MBI不变；参数扫描仍在原MBI2买方研究中运行，本副本支持通用描述与推断统计。"
    };
    ctba12hSellerCopy = copyFeatureDefinition(CTBA_12H_DEF, [CTBA_12H_DEF], Date.UTC(2026, 9, 29, 15, 1));
    CTBA_12H_BEAR_DEF = {
      ...ctba12hSellerCopy,
      id: "ctba_12h-bear",
      name: "CTBA-12H 卖方趋势（12小时）",
      short: "CTBA-12H·卖方",
      builtin: true,
      chartTemplate: "ctba",
      chartCore: "CTBA_12H_bear",
      sellerSignVersion: 1,
      formula: "ctba_12h_bear_version = 1\n" + bearFeatureFormula(CTBA_12H_DEF.formula, "CTBA", "CTBA_12H_bear", 100, true),
      definition: "CTBA-12H 的独立卖方副本。5m，N144，EMA8/24，波动窗口48根，主动成交半衰期24根（2小时），权重0.35/0.40/0.25全部保留。0为固定综合均衡基准；正值原样保留，负值在外层tanh前以seller_gain（默认2）增强，不截负、不按样本平移或缩放。负向绝对值理论上界约96.4028，保留对称零轴和12小时研究窗口；均值另读足够预热。T/M/F及缺失保留，公式、缓存和计算状态独立，原CTBA-12H及CTBA不变。"
    };
    retentionSources = [CDI2_DEF, SELLER_CONTROL_DEF, DSS_DEF, MBI_BEAR_DEF, CTBA_BEAR_DEF, MBI2_BEAR_DEF, CTBA_12H_BEAR_DEF];
    SELLER_RETENTION_FEATURES = SELLER_RETENTION_SPECS.map((s) => createSellerRetentionCopy(retentionSources.find((d) => d.id === s.sourceId), s));
    ORIGINAL_BUILTIN_FEATURES = [DRIFT_SPEED_DEF, BSS_DEF, CBA_DEF, DRIFT_SPEED_Z_DEF, CBI_DEF, CBA2_DEF, CBI2_DEF, MBI_DEF, MBI2_DEF, CTBA_DEF, CTBA_12H_DEF, STATE_DEF, STATE2_DEF, CDI2_DEF, SELLER_CONTROL_DEF, DSS_DEF, CDA_DEF, MBI_BEAR_DEF, CTBA_BEAR_DEF, MBI2_BEAR_DEF, CTBA_12H_BEAR_DEF, ...SELLER_RETENTION_FEATURES];
    SELLER_FOCUS_CREATED_AT = Date.parse("2026-10-30T06:03:46Z");
    SELLER_FOCUS_FEATURES = Object.keys(FOCUS_SOURCE_CORES).map((id) => ({ ...createSellerFocusCopy(ORIGINAL_BUILTIN_FEATURES.find((d) => d.id === id), id + "-v2", id === "state" ? Date.parse("2026-10-30T06:26:11Z") : SELLER_FOCUS_CREATED_AT), builtin: true }));
    BUILTIN_FEATURES = [...ORIGINAL_BUILTIN_FEATURES, ...SELLER_FOCUS_FEATURES];
  }
});

// src/lib/featureSource.ts
function pureAverageOf(st, earlier) {
  const e = st.expr;
  if (!st.name || e.k !== "call" || e.name !== "avg" || e.args.length !== 2) return null;
  const a = e.args[0];
  return a.k === "var" && earlier.has(a.name) ? a.name : null;
}
function featureCoreName(program2) {
  const st = program2.statements;
  let end = st.length - 1;
  for (; ; ) {
    if (end < 0) return null;
    const current = st[end];
    if (current.name && current.expr.k === "un" && current.expr.op === "-" && current.expr.a.k === "var" && current.expr.a.name === current.name) {
      let previous = end - 1;
      while (previous >= 0 && st[previous].name !== current.name) previous--;
      if (previous >= 0) {
        end = previous;
        continue;
      }
    }
    const earlier = new Set(st.slice(0, end).flatMap((s) => s.name ? [s.name] : []));
    const inner = pureAverageOf(st[end], earlier);
    if (!inner) return st[end].name;
    let k = end - 1;
    while (k >= 0 && st[k].name !== inner) k--;
    if (k < 0) return inner;
    end = k;
  }
}
function coreProgram(program2) {
  const core = featureCoreName(program2);
  if (!core) return program2;
  let end = program2.statements.length - 1;
  while (end >= 0 && program2.statements[end].name !== core) end--;
  return end < 0 || end === program2.statements.length - 1 ? program2 : { ...program2, statements: program2.statements.slice(0, end + 1) };
}
var init_featureSource = __esm({
  "src/lib/featureSource.ts"() {
  }
});

// src/lib/fish/shared.ts
function fishDelay(ms, signal) {
  check(signal);
  if (ms <= 0 && typeof document !== "undefined" && document.hidden && typeof MessageChannel !== "undefined") {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        if (signal.aborted) reject(new DOMException("已取消", "AbortError"));
        else resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolve, reject) => {
    const abort2 = () => {
      clearTimeout(timer);
      reject(new DOMException("已取消", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort2);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort2, { once: true });
  });
}
function validateFishBars(bars, cutoffMs, count = FISH_BARS, step = FISH_STEP) {
  const from = cutoffMs - count * step;
  if (!bars.length) throw new FishError(`当时没有K线，或可取历史不足${count}根`, "history");
  const first = bars[0].openTime;
  if (first > from && bars.every((b, i) => b.openTime === first + i * step) && bars.at(-1).openTime === cutoffMs - step) throw new FishError(`最早K线晚于所需起点：当时未上市 / 历史不足${count}根`, "history");
  if (bars.length !== count || bars.some((b, i) => b.openTime !== from + i * step)) throw new FishError("K线中间缺根、末尾缺根或时间点重复", "gap");
}
var FISH_STEP, FISH_MAX_HISTORY_BARS, FISH_BARS, FishError, check;
var init_shared = __esm({
  "src/lib/fish/shared.ts"() {
    FISH_STEP = 3e5;
    FISH_MAX_HISTORY_BARS = 12e3;
    FISH_BARS = 2e3;
    FishError = class extends Error {
      constructor(message, kind, detail) {
        super(message);
        this.kind = kind;
        this.detail = detail;
      }
    };
    check = (signal) => {
      if (signal.aborted) throw new DOMException("已取消", "AbortError");
    };
  }
});

// src/lib/fish/algorithm.ts
function shortFishHash(text) {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}
function fishStatistics(def) {
  const base = compileFeatureFormula(def.formula), vars = evaluateOnBars([], base, def).vars, lines = def.formula.split(/\r?\n/);
  const named = /* @__PURE__ */ new Map();
  for (const st of base.program.statements) if (st.name && st.name !== "结果" && vars.get(st.name) instanceof Float64Array) {
    const comment = lines[st.line - 1]?.split("#").slice(1).join("#").trim();
    named.set(st.name, comment ? `${st.name} · ${comment}` : st.name);
  }
  const lastName = base.program.statements.at(-1)?.name;
  return [{ name: "结果", label: lastName && lastName !== "结果" ? `结果 · ${lastName}` : "结果" }, ...Array.from(named, ([name, label]) => ({ name, label }))];
}
function parseFishConstraint(def, text) {
  const base = compileFeatureFormula(def.formula);
  const known = /* @__PURE__ */ new Set([...SERIES_VARIABLES.map((v) => v.name), ...PARAM_VARIABLES.flatMap((p2) => [p2.name, p2.alias]), ...base.program.statements.flatMap((s) => s.name ? [s.name] : []), "X"]);
  if (/[\r\n]/.test(text)) throw new Error("每条约束只能写一行布尔式");
  const p = parseFormula(text, known);
  if (p.statements.length !== 1 || p.statements[0].name !== null) throw new Error("请写一条条件式，不要赋值或引用其他特征值");
  return p;
}
function convergenceHistory(program2, params, minutes) {
  const constants = { ...params }, history = /* @__PURE__ */ new Map();
  const isConstant = (n) => n.k === "num" || (n.k === "var" ? Number.isFinite(constants[n.name]) : n.k === "un" ? isConstant(n.a) : n.k === "bin" ? isConstant(n.a) && isConstant(n.b) : n.args.every(isConstant));
  const scalar = (expr) => {
    if (!isConstant(expr)) return NaN;
    try {
      const v = evaluateProgram({ statements: [{ name: null, expr, line: 1 }], inputs: /* @__PURE__ */ new Set() }, constants, { barMinutes: minutes });
      return typeof v === "number" ? v : NaN;
    } catch {
      return NaN;
    }
  };
  const depth = (n) => {
    if (n.k === "num") return 0;
    if (n.k === "var") return history.get(n.name) ?? 0;
    if (n.k === "un") return depth(n.a);
    if (n.k === "bin") return Math.max(depth(n.a), depth(n.b));
    const inherited = Math.max(0, ...n.args.map(depth)), arg = (i, fallback = NaN) => n.args[i] ? scalar(n.args[i]) : fallback;
    const hours = (i, fallback = NaN) => Math.max(1, Math.ceil(arg(i, fallback) * 60 / minutes));
    let extra = 0;
    if (["avg", "sd", "median", "mad", "rscale", "zscore", "rsum"].includes(n.name)) extra = hours(1) - 1;
    else if (["full", "peak", "sma", "sum", "highest", "lowest", "msum"].includes(n.name)) extra = arg(1) - 1;
    else if (n.name === "wsum") extra = arg(2) - 1;
    else if (n.name === "prev") extra = arg(1, 1);
    else if (n.name === "ago") extra = hours(1);
    else if (n.name === "beta") extra = hours(2) - 1;
    else if (n.name === "retain") extra = (n.args.length === 6 ? Math.max(1, Math.ceil(48 * 60 / minutes)) : hours(4, 48)) - 1;
    else if (n.name === "ema") extra = 32 * hours(1);
    else if (n.name === "atr") {
      const size = arg(3);
      extra = size + (size === 1 ? 0 : Math.ceil(32 * -Math.LN2 / Math.log1p(-1 / size)));
    } else if (n.name === "ctba") extra = Math.max(arg(7), 5 * arg(9), arg(10)) + 1;
    else if (n.name === "mbiz") extra = 5 * arg(1);
    if (!Number.isFinite(extra)) throw new Error(`${n.name} 的窗口或平滑参数必须是固定的有限数字`);
    return inherited + Math.max(0, Math.ceil(extra));
  };
  let maximum = 0;
  for (const st of program2.statements) {
    const d = depth(st.expr);
    maximum = Math.max(maximum, d);
    if (st.name) {
      history.set(st.name, d);
      constants[st.name] = scalar(st.expr);
    }
  }
  return maximum;
}
function compileFishProgram(def, settings) {
  if (!Number.isFinite(settings.threshold)) throw new Error("请填写有限数字阈值");
  if (![">", "<"].includes(settings.direction)) throw new Error("方向只能选择 > 或 <");
  if (!(Number.isFinite(def.scale) && def.scale > 0)) throw new Error("特征值显示倍率必须是有限正数");
  const statistic = settings.statistic ?? "结果", scale = statistic === "结果" ? def.scale : 1, unit = statistic === "结果" ? def.unit : "原值";
  if (!fishStatistics(def).some((v) => v.name === statistic)) throw new Error("所选统计量已不存在或不是序列，请重新选择");
  if (!Number.isFinite(settings.threshold / scale)) throw new Error("换算后的阈值超出有效范围");
  const { H: _legacyH, ...rest } = structuredClone(settings);
  const frozen = structuredClone(def), config = { ...rest, statistic }, full = compileFeatureFormula(frozen.formula);
  const needed = /* @__PURE__ */ new Set([statistic, ...config.constraints.filter((c) => c.enabled).flatMap((c) => [...parseFishConstraint(frozen, c.text).inputs].filter((n) => n !== "X"))]);
  let end = coreProgram(full.program).statements.length;
  full.program.statements.forEach((s, i) => {
    if (s.name && needed.has(s.name)) end = Math.max(end, i + 1);
  });
  if (statistic === "结果") end = full.program.statements.length;
  const base = { ...full, program: { ...full.program, statements: full.program.statements.slice(0, end) } };
  const used = /* @__PURE__ */ new Set([...base.program.inputs, ...base.program.statements.flatMap((s) => s.name ? [s.name] : [])]);
  const name = (hint) => {
    let n = hint;
    while (used.has(n)) n += "_";
    used.add(n);
    return n;
  };
  const resultName = name("__result"), displayName = name("__X"), averageName = name("__A"), mainName = name("__main");
  const statements = base.program.statements.map((s) => ({ ...s }));
  const last = statements.at(-1);
  if (!last) throw new Error("特征值公式不能为空");
  let result = featureCoreName(full.program);
  if (!result) {
    last.name = resultName;
    result = resultName;
  }
  if (statistic === "结果" && !last.name) last.name = resultName;
  const known = /* @__PURE__ */ new Set([...SERIES_VARIABLES.map((v) => v.name), ...PARAM_VARIABLES.flatMap((p) => [p.name, p.alias]), ...used]);
  const statisticName = statistic === "结果" ? last.name : statistic;
  const tail = parseFormula(`${displayName} = ${result} * ${def.scale}
${averageName} = ${statisticName}
${mainName} = ${averageName} ${settings.direction} ${settings.threshold / scale}`, known);
  const inputs = new Set([...base.program.inputs, ...tail.inputs].filter((n) => !used.has(n)));
  const enabled = config.constraints.filter((c) => c.enabled), texts = enabled.map((c) => normalizeConstraint(c.text));
  const constraintNames = enabled.map((c) => {
    const p = parseFishConstraint(frozen, c.text), n = name("__c" + used.size);
    for (const input of p.inputs) if (input !== "X" && !used.has(input)) inputs.add(input);
    tail.statements.push({ name: n, expr: renameX(p.statements[0].expr, displayName), line: 1 });
    return n;
  });
  const step = intervalMs(intervalOf(frozen)), hold = fishStateHold(frozen.id, statistic, settings.direction);
  const stateHold = hold ? { ...hold, samples: Math.ceil(hold.hours * 36e5 / step) + 1 } : void 0;
  const stateHoldAlternatives = hold ? FISH_STATE_HOLD_ROUTES.map((route) => ({ ...route, samples: Math.ceil(route.hours * 36e5 / step) + 1 })) : void 0;
  if (stateHold) {
    const routeNames = stateHoldAlternatives.map((route) => {
      const n2 = name("__stateHoldRoute");
      const p2 = parseFormula(`sum(${averageName} > ${route.threshold}, ${route.samples}) >= ${route.samples}`, known);
      tail.statements.push({ name: n2, expr: p2.statements[0].expr, line: 1 });
      known.add(n2);
      return n2;
    });
    const n = name("__stateHold");
    const any = routeNames.map((r) => `nz(${r},0)`).join(" or "), allKnown = routeNames.map((r) => `has(${r})`).join(" and ");
    const p = parseFormula(`if(${any},1,if(${allKnown},0,1/0))`, known);
    tail.statements.push({ name: n, expr: p.statements[0].expr, line: 1 });
    constraintNames.push(n);
    texts.push(FISH_STATE_HOLD_TEXT);
  }
  for (const input of base.program.inputs) inputs.add(input);
  const program2 = { statements: [...statements, ...tail.statements], inputs };
  const compiled = { program: program2, usesAmounts: [...inputs].some((n) => ["Q", "B", "S", "E"].includes(n)), usesBtc: inputs.has("CB") };
  evaluateOnBars([], compiled, frozen);
  const params = featureParams(frozen);
  const windowDef = end < full.program.statements.length ? { ...frozen, formula: frozen.formula.split(/\r?\n/).slice(0, full.program.statements[end - 1].line).join("\n") } : frozen;
  const warm = Math.max(programHistoryBars(program2, params, step / 6e4) + 1, Math.ceil(featureWindowMs(windowDef) / step), convergenceHistory(program2, params, step / 6e4) + 1);
  const N = warm + 546, constraintKey = constraintFingerprint(texts);
  return { usesTaker: inputs.has("B") || inputs.has("S"), def: frozen, settings: config, compiled, resultName: result, statisticName, scale, unit, averageName, mainName, constraintNames, texts, constraintKey, algorithmKey: fishAlgorithmKey(frozen.id, void 0, settings.direction, settings.threshold, constraintKey, statistic), warm, N, step, stateHold, stateHoldAlternatives, unavailable: !Number.isFinite(N) || N > FISH_MAX_HISTORY_BARS ? `需要 ${N} 根历史（含平滑收敛预热），超过 ${FISH_MAX_HISTORY_BARS} 根上限，暂不可扫` : void 0 };
}
function evaluateFishProgram(bars, plan) {
  const out = evaluateOnBars(bars, plan.compiled, plan.def), n = bars.length;
  const series = (name) => {
    const x = out.vars.get(name) ?? NaN;
    return typeof x === "number" ? new Float64Array(n).fill(x) : x;
  };
  const value = series(plan.statisticName), average = series(plan.averageName), main = series(plan.mainName), constraints = plan.constraintNames.map(series);
  const condition = Float64Array.from(main, (m, i) => plan.stateHold && m === 0 && Number.isFinite(average[i]) ? 0 : !Number.isFinite(m) || !Number.isFinite(average[i]) || constraints.some((c) => !Number.isFinite(c[i])) ? NaN : m !== 0 && constraints.every((c) => c[i] !== 0) ? 1 : 0);
  return { value, average, main, constraints, condition };
}
var FISH_STATE_HOLD, FISH_STATE_HOLD_ROUTES, FISH_STATE_HOLD_TEXT, fishStateHold, FISH_PRESETS, normalizeConstraint, constraintFingerprint, fishAlgorithmKey, renameX;
var init_algorithm = __esm({
  "src/lib/fish/algorithm.ts"() {
    init_features();
    init_formula();
    init_marketData();
    init_featureSource();
    init_shared();
    FISH_STATE_HOLD = { threshold: 0.55, hours: 6 };
    FISH_STATE_HOLD_ROUTES = [FISH_STATE_HOLD, { threshold: 0.66, hours: 3 }];
    FISH_STATE_HOLD_TEXT = "S > 0.55 连续至少 6 小时，或 S > 0.66 连续至少 3 小时";
    fishStateHold = (featureId, statistic, direction) => featureId === "state" && statistic === "state" && direction === ">" ? FISH_STATE_HOLD : void 0;
    FISH_PRESETS = [
      { name: "多周期为正", lines: [24, 12, 6, 3, 1].map((h) => `avg(X,${h}) > 0`) },
      { name: "短期强于长期", lines: ["avg(X,1)>=avg(X,3) and avg(X,3)>=avg(X,6) and avg(X,6)>=avg(X,12) and avg(X,12)>=avg(X,24)"] },
      { name: "正值占比", lines: ["avg(X > 0, 6) >= 0.7"] },
      { name: "均值上行", lines: ["avg(X,3) > ago(avg(X,3),3)"] },
      { name: "当前值为正", lines: ["X > 0"] },
      { name: "成交额门槛", lines: ["rsum(Q, 24) >= 20000000"] }
    ];
    normalizeConstraint = (s) => s.trim().replace(/\s+/g, " ");
    constraintFingerprint = (texts) => shortFishHash(texts.map(normalizeConstraint).join(";"));
    fishAlgorithmKey = (id, H, direction, threshold, key, statistic = "结果") => `${id}|${statistic}|${H === void 0 ? "=" : H}|${direction}|${threshold}|${key}`;
    renameX = (n, name) => n.k === "var" && n.name === "X" ? { ...n, name } : n.k === "un" ? { ...n, a: renameX(n.a, name) } : n.k === "bin" ? { ...n, a: renameX(n.a, name), b: renameX(n.b, name) } : n.k === "call" ? { ...n, args: n.args.map((a) => renameX(a, name)) } : n;
  }
});

// src/lib/fish/qualityAdditionScan.ts
function observation(candidate, bars, values, i, entry) {
  const { plan } = candidate, at2 = bars[i].openTime + plan.step, first = Math.floor(entry / plan.step) * plan.step + plan.step, reading = values.average[i] * candidate.scale;
  if (!Number.isFinite(reading) || values.constraints.some((c) => !Number.isFinite(c[i]))) throw Error("加仓探测存在缺失读数，不能越过缺口判断加仓");
  if (!(candidate.direction === ">" ? reading > candidate.threshold : reading < candidate.threshold) || values.constraints.some((c) => !c[i])) return;
  if (plan.stateHold && !(plan.stateHoldAlternatives ?? [plan.stateHold]).some((route) => at2 >= first + (route.samples - 1) * plan.step && i >= route.samples - 1 && values.average.subarray(i - route.samples + 1, i + 1).every((v) => Number.isFinite(v) && v > route.threshold))) return;
  return { at: at2, reading, threshold: candidate.threshold, direction: candidate.direction, metric: candidate.metric, label: candidate.label, featureId: candidate.featureId, definitionKey: candidate.definitionKey, barOpenTime: bars[i].openTime };
}
function constraintReader(candidate, o) {
  const { plan } = candidate;
  let cache;
  return async (at2) => {
    const closedAt = Math.floor(at2 / plan.step) * plan.step, barAt = closedAt - plan.step;
    if (closedAt <= o.entry) return;
    if (plan.unavailable) throw Error(plan.unavailable);
    if (!cache || barAt < cache.from || barAt >= cache.to) {
      const from = barAt - plan.warm * plan.step, to = Math.min(Math.floor(o.end / plan.step) * plan.step, barAt + 500 * plan.step);
      if (from < 0) throw Error("加仓探测公式预热历史不足");
      const bars = await o.load(o.row, from, to, plan, o.signal);
      validateFishBars(bars, to, (to - from) / plan.step, plan.step);
      cache = { from, to, bars, values: evaluateFishProgram(bars, plan) };
    }
    return observation(candidate, cache.bars, cache.values, Math.round((barAt - cache.from) / plan.step), o.entry);
  };
}
async function findQualityAdditionTrigger(o) {
  let best;
  const required = (o.required ?? []).map((candidate) => constraintReader(candidate, o));
  for (const candidate of o.candidates) {
    const { plan } = candidate, start = Math.floor(Math.max(o.entry, o.after ?? o.entry) / plan.step) * plan.step;
    if (plan.unavailable) throw Error(plan.unavailable);
    let cursor = start;
    const stop = Math.floor(Math.min(o.end, best?.at ?? Infinity) / plan.step) * plan.step;
    while (cursor < stop) {
      if (o.signal.aborted) throw new DOMException("已暂停", "AbortError");
      const cut = Math.min(stop, cursor + 500 * plan.step), from = cursor - plan.warm * plan.step;
      if (from < 0) throw Error("加仓探测公式预热历史不足");
      const bars2 = await o.load(o.row, from, cut, plan, o.signal);
      validateFishBars(bars2, cut, (cut - from) / plan.step, plan.step);
      const values = evaluateFishProgram(bars2, plan);
      for (let i = 0; i < bars2.length; i++) {
        const at2 = bars2[i].openTime + plan.step;
        if (at2 <= o.entry || at2 <= (o.after ?? -Infinity) || at2 <= cursor || at2 >= o.end || best && at2 >= best.at) continue;
        const primary = observation(candidate, bars2, values, i, o.entry);
        if (!primary) continue;
        const conditions = [primary];
        let qualified = true;
        for (const read of required) {
          const confirmed = await read(at2);
          if (!confirmed) {
            qualified = false;
            break;
          }
          conditions.push(confirmed);
        }
        if (!qualified) continue;
        let priceGate;
        if (o.priceGate) {
          const { referencePrice, thresholdPct, basis } = o.priceGate, observedPrice = bars2[i].close;
          if (!(referencePrice > 0) || !Number.isFinite(referencePrice) || !(observedPrice > 0) || !Number.isFinite(observedPrice)) throw Error("加仓涨幅基准或收盘价格无效");
          const target = referencePrice * (1 + thresholdPct / 100);
          if (!Number.isFinite(target)) throw Error("加仓涨幅门槛超出有效范围");
          if (observedPrice + Number.EPSILON * 8 * Math.max(target, observedPrice) < target) continue;
          priceGate = { basis, referencePrice, thresholdPct, observedPrice, gainPct: (observedPrice / referencePrice - 1) * 100, confirmedAt: at2 };
        }
        best = { ...primary, scanFrom: o.entry, ...required.length ? { conditions } : {}, ...priceGate ? { priceGate } : {} };
        break;
      }
      if (best && best.at <= cut) break;
      cursor = cut;
      await fishDelay(0, o.signal);
    }
  }
  if (!best) return;
  const known = o.priceAt?.get(best.at);
  if (known != null && known > 0 && Number.isFinite(known)) return { ...best, price: known };
  const price = compileFishProgram({ id: "add-price", name: "加仓成交价", short: "价格", definition: "", formula: "C", scale: 1, unit: "", positive: "1", control: "0", interval: "1m" }, { statistic: "结果", direction: ">", threshold: 0, constraints: [] });
  const bars = await o.load(o.row, best.at, best.at + MINUTE, price, o.signal);
  validateFishBars(bars, best.at + MINUTE, 1, MINUTE);
  if (!(bars[0].open > 0) || !Number.isFinite(bars[0].open)) throw Error("缺少有效加仓成交价格");
  return { ...best, price: bars[0].open };
}
async function findQualityAddition(o) {
  const trigger = await findQualityAdditionTrigger(o);
  if (!trigger) return;
  const quantity = o.quantity ?? o.notional / trigger.price, notional = o.quantity == null ? o.notional : quantity * trigger.price;
  if (!(quantity > 0) || !Number.isFinite(quantity) || !(notional > 0) || !Number.isFinite(notional)) throw Error("加仓数量或成交金额超出可计算范围");
  return { ...trigger, quantity, notional };
}
var MINUTE;
var init_qualityAdditionScan = __esm({
  "src/lib/fish/qualityAdditionScan.ts"() {
    init_algorithm();
    init_shared();
    MINUTE = 6e4;
  }
});

// src/lib/fish/qualityAddition.ts
function qualityAdditionConditions(rule) {
  return (rule?.conditions?.length ? rule.conditions : rule?.condition ? [rule.condition] : []).filter((f) => f.enabled !== false);
}
function validateQualityAddition(rule) {
  if (!rule?.enabled) return;
  if (!["detector", "custom"].includes(rule.source) || !(rule.quantityMode ? ["calculator", "entry", "fixed"].includes(rule.quantityMode) : ["entry", "fixed"].includes(rule.amountMode))) throw new Error("加仓条件来源或数量方式无效");
  if (rule.quantityMode) {
    if (rule.quantityMode === "fixed" && (!(rule.quantity > 0) || !Number.isFinite(rule.quantity))) throw new Error("加仓数量须为大于 0 的有限数字");
  } else if (rule.amountMode === "fixed" && (!(rule.amountUsdt > 0) || !Number.isFinite(rule.amountUsdt))) throw new Error("加仓金额须为大于 0 的有限数字");
  if (rule.source === "detector" && (!(rule.stricterPct > 0) || !Number.isFinite(rule.stricterPct))) throw new Error("加仓门槛提高幅度须为大于 0 的有限数字");
  if (rule.source === "custom" && (!qualityAdditionConditions(rule).length || qualityAdditionConditions(rule).some((f) => !Number.isFinite(f.threshold) || !["<", ">"].includes(f.direction)))) throw new Error("请选择加仓指标并填写有限数字门槛");
  if (rule.minGainPct != null && (!Number.isFinite(rule.minGainPct) || rule.minGainPct < 0)) throw new Error("加仓涨幅门槛须为不小于 0 的有限数字");
  if (rule.quantityMode === "calculator") {
    const atr = qualityAdditionAtrSettings(rule);
    if (!Number.isFinite(atr.entryBufferAtr) || atr.entryBufferAtr < 0) throw new Error("T 高于 S 的 ATR 倍数须为不小于 0 的有限数字");
    if (!Number.isFinite(atr.supportOffsetAtr) || atr.supportOffsetAtr <= 0) throw new Error("K 回撤的 ATR 倍数须为大于 0 的有限数字");
  }
  if (rule.maxRounds != null && (!Number.isInteger(rule.maxRounds) || rule.maxRounds < 1 || rule.maxRounds > 100)) throw new Error("最多加仓次数须为 1 至 100 的整数");
  if (rule.rounds) {
    if (rule.maxRounds == null || rule.rounds.length !== rule.maxRounds) throw new Error("每次加仓须有对应的独立条件");
    for (const [i, round] of rule.rounds.entries()) {
      try {
        validateQualityAddition({ ...rule, ...round, maxRounds: void 0, rounds: void 0 });
      } catch (e) {
        throw new Error(`第 ${i + 1} 次加仓：${e instanceof Error ? e.message : "条件无效"}`);
      }
    }
  }
}
function stricterAdditionThreshold(threshold, direction, pct) {
  const next = threshold + (direction === ">" ? 1 : -1) * (Math.abs(threshold) || 1) * pct / 100;
  if (!Number.isFinite(next) || !(direction === ">" ? next > threshold : next < threshold)) throw new Error("加仓门槛提高幅度超出有效精度或范围");
  return Number(next.toPrecision(15));
}
function additionFormulaLabel(rule) {
  const rounds = rule.rounds?.length ? rule.rounds : [rule], first = qualityAdditionAtrSettings(rounds[0]);
  return rounds.some((r) => {
    const a = qualityAdditionAtrSettings(r);
    return a.entryBufferAtr !== first.entryBufferAtr || a.supportOffsetAtr !== first.supportOffsetAtr;
  }) ? "逐轮 ATR 倍数独立设置" : `T≥S+${first.entryBufferAtr}ATR · K=T−${first.supportOffsetAtr}ATR`;
}
function qualityAdditionFills(result) {
  return result.additionFills?.length ? result.additionFills : result.additionFill ? [result.additionFill] : [];
}
function additionPosition(notional, entry, mark, closed, addition, mirror) {
  const fills = Array.isArray(addition) ? addition : [addition];
  const totalInvested = notional + fills.reduce((n, a) => n + a.notional, 0), totalQuantity = notional / entry + fills.reduce((n, a) => n + a.quantity, 0);
  const fullMirror = mirror?.fraction === 1;
  const mirrorQuantity = mirror ? fullMirror ? totalQuantity : notional / entry * mirror.fraction : 0;
  const mirrorCost = mirror ? fullMirror ? totalInvested : notional * mirror.fraction : 0;
  const mirrorPnl = mirror ? mirrorQuantity * mirror.price - mirrorCost : 0;
  const unsoldQuantity = totalQuantity - mirrorQuantity, unsoldCost = totalInvested - mirrorCost;
  const remainingPnl = unsoldQuantity * mark - unsoldCost, totalPnl = mirrorPnl + remainingPnl;
  const values = [totalInvested, totalQuantity, mirrorPnl, remainingPnl, totalPnl];
  if (!values.every(Number.isFinite) || !(totalInvested > 0) || !fills.every((a) => a.quantity > 0 && Number.isFinite(a.quantity) && a.notional > 0 && Number.isFinite(a.notional))) throw new Error("加仓金额或持仓数量超出可计算范围");
  return {
    totalInvested,
    totalQuantity,
    mirrorQuantity,
    mirrorCost,
    mirrorPnl,
    remainingPnl,
    totalPnl,
    returnPct: totalPnl / totalInvested * 100,
    averageEntryPrice: unsoldQuantity > 0 ? unsoldCost / unsoldQuantity : totalInvested / totalQuantity,
    remainingQuantity: closed ? 0 : unsoldQuantity,
    remainingCost: closed ? 0 : unsoldCost,
    realizedPnl: mirrorPnl + (closed ? remainingPnl : 0),
    exitQuantity: closed ? unsoldQuantity : 0
  };
}
var qualityAdditionAtrSettings, atrIdentity, customAtrSettings, qualityAdditionRoundLimit, conditionIdentity, additionIdentity, additionLabel;
var init_qualityAddition = __esm({
  "src/lib/fish/qualityAddition.ts"() {
    qualityAdditionAtrSettings = (rule) => ({ entryBufferAtr: rule.entryBufferAtr ?? 2, supportOffsetAtr: rule.supportOffsetAtr ?? 1.5 });
    atrIdentity = (rule) => {
      const a = qualityAdditionAtrSettings(rule);
      return [a.entryBufferAtr, a.supportOffsetAtr];
    };
    customAtrSettings = (rule) => {
      const a = qualityAdditionAtrSettings(rule);
      return a.entryBufferAtr !== 2 || a.supportOffsetAtr !== 1.5;
    };
    qualityAdditionRoundLimit = (rule) => rule.maxRounds ?? (rule.repeat === false ? 1 : Infinity);
    conditionIdentity = (f) => [f.metric, f.direction, f.threshold, f.snapshot.definitionKey, f.snapshot.interval];
    additionIdentity = (rule) => !rule?.enabled ? [] : [
      rule.quantityMode === "calculator" ? "holding-add-after-half-2atr-balance-v3" : rule.quantityMode ? "holding-add-once-after-half-quantity-v2" : "holding-add-once-v1",
      rule.source,
      rule.source === "detector" ? rule.stricterPct : qualityAdditionConditions(rule)[0] && conditionIdentity(qualityAdditionConditions(rule)[0]),
      rule.quantityMode ?? rule.amountMode,
      ...rule.quantityMode === "calculator" ? [rule.repeat !== false] : [],
      rule.quantityMode ? rule.quantityMode === "fixed" ? rule.quantity : null : rule.amountMode === "fixed" ? rule.amountUsdt : null,
      ...rule.source === "custom" && qualityAdditionConditions(rule).length > 1 ? [["all-indicators-v1", ...qualityAdditionConditions(rule).slice(1).map(conditionIdentity)]] : [],
      ...rule.minGainPct != null ? [["closed-gain-gate-v1", rule.minGainPct, "real-average"]] : [],
      ...rule.maxRounds != null || rule.rounds?.length ? [["independent-addition-rounds-v1", rule.maxRounds ?? null, rule.rounds?.map((r) => [r.source, r.source === "detector" ? r.stricterPct : qualityAdditionConditions(r).map(conditionIdentity), r.minGainPct ?? null]) ?? null]] : [],
      ...rule.quantityMode === "calculator" && [rule, ...rule.rounds ?? []].some(customAtrSettings) ? [["addition-atr-settings-v1", atrIdentity(rule), rule.rounds?.map(atrIdentity) ?? null]] : []
    ];
    additionLabel = (rule) => rule?.enabled ? `${rule.maxRounds != null ? `最多加仓 ${rule.maxRounds} 次（逐轮独立条件）` : rule.quantityMode === "calculator" && rule.repeat !== false ? "多轮加仓" : "加仓一次"}：${rule.source === "detector" ? `原探测门槛严格 ${rule.stricterPct}%` : qualityAdditionConditions(rule).map((f) => `${f.label} ${f.direction} ${f.threshold}`).join(" 且 ")}${rule.minGainPct != null ? ` 且 相对当前持仓均价上涨 ≥ ${rule.minGainPct}%` : ""} · ${rule.quantityMode ? rule.quantityMode === "calculator" ? `半仓镜像后按余仓平衡定量 · ${additionFormulaLabel(rule)} · ${rule.repeat === false ? "一次" : "多轮"} · K止损` : rule.quantityMode === "entry" ? "与半仓镜像后余仓币数相同" : rule.quantity + " 枚" : rule.amountMode === "entry" ? "与开仓等额" : rule.amountUsdt + " USDT"}` : "";
  }
});

// src/lib/fish/qualityVeto.ts
function validateHoldingVeto(v) {
  if (![...Object.keys(holdingPriceLabels), "indicator", ADDITION_PROFIT_KIND].includes(v.kind)) throw new Error("未知的持仓否决指标");
  if (!Number.isFinite(v.threshold) || !["<", ">", "<=", ">="].includes(v.direction)) throw new Error("一票否决条件须设置有效方向和有限数字阈值");
  if (v.kind !== "indicator" && v.kind !== ADDITION_PROFIT_KIND && (!(v.threshold > 0 && v.threshold <= 100) || v.direction !== ">=")) throw new Error("回撤或跌幅阈值须大于 0 且不超过 100%，达到（≥）即触发");
  if (v.kind === ADDITION_PROFIT_KIND && (!(v.threshold >= 0) || !Number.isFinite(v.geometricMultiple ?? 100) || !((v.geometricMultiple ?? 100) > 0) || v.direction !== ">=")) throw new Error("加仓止盈须设置大于 0 的几何仓位倍数及不小于 0 的涨幅百分比");
  if (v.kind === "indicator" && (!v.snapshot || !v.metric)) throw new Error("一票否决指标缺少公式快照");
}
function holdingVetoIdentity(vetoes = []) {
  return activeHoldingVetoes(vetoes).map((v) => [v.kind, v.direction, v.threshold, v.metric ?? null, v.snapshot?.definitionKey ?? null, v.snapshot?.interval ?? null, ...v.kind === ADDITION_PROFIT_KIND ? [v.geometricMultiple ?? 100] : []]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function advanceQualityHolding(path, b) {
  const beforeLow = Math.max(path.peak, b.open), peak = Math.max(beforeLow, b.high);
  return { entry: path.entry, peak, minimum: Math.min(path.minimum, b.low), dynamic: Math.max(path.dynamic, 0, (beforeLow - b.low) / beforeLow * 100, (peak - b.close) / peak * 100) };
}
function qualityIntrabarStop(path, b, risk) {
  const touched = (price, level) => price <= level * (1 + 1e-12);
  const beforeLow = Math.max(path.peak, b.open);
  let best;
  for (const v of risk) {
    if (v.kind !== "static-drawdown" && v.kind !== "dynamic-drawdown") continue;
    const anchor = v.kind === "static-drawdown" ? path.entry : beforeLow, level = anchor * (1 - v.threshold / 100);
    if (touched(b.low, level) && (!best || level > best.price)) best = { veto: v, price: level, peak: beforeLow, reading: v.threshold };
  }
  if (best) return best;
  const peak = Math.max(beforeLow, b.high);
  for (const v of risk) {
    if (v.kind !== "dynamic-drawdown") continue;
    const level = peak * (1 - v.threshold / 100);
    if (touched(b.close, level) && (!best || level > best.price)) best = { veto: v, price: level, peak, reading: v.threshold };
  }
  return best;
}
function minuteDropReading(bars, minutes, entry, at2) {
  const start = Math.max(entry, at2 - minutes * 6e4), window = bars.filter((b) => b.openTime >= start && b.openTime < at2);
  if (!window.length || window.length !== (at2 - start) / 6e4 || window.some((b, i) => b.openTime !== start + i * 6e4)) return;
  const first = window[0].open, last = window.at(-1).close;
  if (!(first > 0 && last > 0 && Number.isFinite(first) && Number.isFinite(last))) throw new Error("短时跌幅缺少有效价格");
  return { reading: Math.max(0, (first - last) / first * 100), start };
}
var holdingPriceLabels, minuteDropWindow, ADDITION_PROFIT_KIND, activeHoldingVetoes, qualityConditionMet, holdingVetoReading;
var init_qualityVeto = __esm({
  "src/lib/fish/qualityVeto.ts"() {
    holdingPriceLabels = { "static-drawdown": "持仓过程静态最大回撤", "dynamic-drawdown": "持仓过程动态最大回撤", "drop-1m": "1分钟内跌幅", "drop-5m": "5分钟内跌幅" };
    minuteDropWindow = (kind) => kind === "drop-1m" ? 1 : kind === "drop-5m" ? 5 : 0;
    ADDITION_PROFIT_KIND = "addition-geometric-profit";
    activeHoldingVetoes = (conditions = []) => conditions.filter((v) => v.enabled);
    qualityConditionMet = (value, direction, threshold) => direction === "<" ? value < threshold : direction === ">" ? value > threshold : direction === "<=" ? value <= threshold : value >= threshold;
    holdingVetoReading = (path, kind) => kind === "static-drawdown" ? Math.max(0, (path.entry - path.minimum) / path.entry * 100) : path.dynamic;
  }
});

// src/lib/fish/qualityAdditionCalculator.ts
function atrReader(o) {
  let cursor = Math.floor(o.entry / STEP) * STEP - WARM * STEP, state;
  if (cursor < 0) throw Error("加仓支撑线的5分钟ATR历史不足");
  const values = /* @__PURE__ */ new Map();
  const plan = compileFishProgram({ id: "add-atr-prices", name: "加仓ATR", short: "ATR", definition: "", formula: "C", scale: 1, unit: "", positive: "1", control: "0", interval: "5m" }, { statistic: "结果", direction: ">", threshold: 0, constraints: [] });
  return async (at2) => {
    const cut = Math.floor(at2 / STEP) * STEP;
    while (cursor < cut) {
      if (o.signal.aborted) throw new DOMException("已暂停", "AbortError");
      const to = Math.min(cut, cursor + 500 * STEP), bars = await o.load(o.row, cursor, to, plan, o.signal);
      validateFishBars(bars, to, (to - cursor) / STEP, STEP);
      for (const bar of bars) {
        if (![bar.high, bar.low, bar.close].every(Number.isFinite) || !(bar.low > 0) || bar.high < bar.low) throw Error("加仓ATR行情读数无效");
        state = advanceChartAtr(state, bar, PERIOD);
        values.set(bar.openTime + STEP, state.value);
      }
      cursor = to;
      await fishDelay(0, o.signal);
    }
    return values.get(cut);
  };
}
async function findCalculatorAdditions(o) {
  const halfMirror = o.mirror;
  if (halfMirror?.fraction !== 0.5) return { fills: [] };
  const fills = [...o.previous], priceAt = new Map(o.prices.map((b) => [b.openTime, b.open]));
  let after = Math.max(o.entry, o.since - MINUTE2, halfMirror.at, fills.at(-1)?.at ?? o.entry);
  const readAtr = atrReader(o);
  const bars = o.prices.filter((b) => b.openTime < o.end);
  let size = 1;
  while (size < bars.length) size *= 2;
  const highTree = new Float64Array(size * 2).fill(-Infinity);
  const lowTree = new Float64Array(size * 2).fill(Infinity);
  bars.forEach((b, i) => {
    if (!(b.open > 0) || !(b.low > 0) || !Number.isFinite(b.open) || !Number.isFinite(b.low) || !Number.isFinite(b.high) || b.high < Math.max(b.open, b.low)) throw Error("加仓行情读数无效");
    lowTree[size + i] = b.low;
    highTree[size + i] = b.high;
  });
  for (let i = size - 1; i > 0; i--) {
    lowTree[i] = Math.min(lowTree[i * 2], lowTree[i * 2 + 1]);
    highTree[i] = Math.max(highTree[i * 2], highTree[i * 2 + 1]);
  }
  const findStop = (support, from) => {
    if (support == null) return;
    const first = Math.max(0, Math.ceil((from - (bars[0]?.openTime ?? from)) / MINUTE2));
    const search = (node, left, right) => {
      if (right <= first || lowTree[node] > support) return -1;
      if (right - left === 1) return left;
      const middle = left + right >>> 1, found = search(node * 2, left, middle);
      return found < 0 ? search(node * 2 + 1, middle, right) : found;
    };
    const index = search(1, 0, size), bar = bars[index];
    if (!bar) return;
    const exit = o.ordinaryExit;
    if (exit && bar.openTime === exit.at && (exit.atOpen || !exit.mirror && exit.price >= support)) return;
    const atOpen = bar.open <= support;
    return { at: bar.openTime, price: atOpen ? bar.open : support, support, atOpen };
  };
  const profitRules = activeHoldingVetoes(o.vetoes).filter((v) => v.kind === ADDITION_PROFIT_KIND).sort((a, b) => a.id.localeCompare(b.id));
  const findPositionExit = (support, from) => {
    const stop = findStop(support, from);
    if (!fills.length || support == null || !profitRules.length) return stop;
    const initialCoins = o.notional / o.entryPrice, heldCoins = initialCoins * (1 - halfMirror.fraction) + fills.reduce((n, a) => n + a.quantity, 0), multiple = heldCoins / initialCoins;
    const first = Math.max(0, Math.ceil((from - (bars[0]?.openTime ?? from)) / MINUTE2));
    let profit;
    for (const v of profitRules) {
      const required = v.geometricMultiple ?? 100;
      if (multiple + 32 * Number.EPSILON * Math.max(1, multiple, required) < required) continue;
      const target = support * (1 + v.threshold / 100);
      if (!(target > 0) || !Number.isFinite(target)) throw Error("加仓止盈目标价超出有效范围");
      const search = (node, left, right) => {
        if (right <= first || highTree[node] < target * (1 - 1e-12)) return -1;
        if (right - left === 1) return left;
        const middle = left + right >>> 1, found = search(node * 2, left, middle);
        return found < 0 ? search(node * 2 + 1, middle, right) : found;
      };
      const bar = bars[search(1, 0, size)];
      if (!bar) continue;
      const ordinary = o.ordinaryExit;
      if (ordinary && bar.openTime === ordinary.at && (ordinary.atOpen || !ordinary.mirror || ordinary.price <= target)) continue;
      const atOpen = bar.open >= target * (1 - 1e-12), hit = { at: bar.openTime, price: atOpen ? bar.open : target, support, atOpen, cause: { id: v.id, label: v.label, kind: v.kind, direction: v.direction, threshold: v.threshold, geometricMultiple: required, additionBasis: { geometricMultiple: multiple, equilibriumPrice: support, targetPrice: target } } };
      if (!profit || hit.at < profit.at || hit.at === profit.at && (hit.atOpen && !profit.atOpen || hit.atOpen === profit.atOpen && hit.price < profit.price)) profit = hit;
    }
    if (!stop) return profit;
    if (!profit) return stop;
    return profit.at < stop.at || profit.at === stop.at && profit.atOpen && !stop.atOpen ? profit : stop;
  };
  while (after < o.end) {
    if (o.signal.aborted) throw new DOMException("已暂停", "AbortError");
    const support = fills.at(-1)?.sizing?.support, stop = findPositionExit(support, Math.max(o.since, fills.at(-1)?.at ?? o.since));
    if (fills.length >= (o.maxRounds ?? (o.repeat ? Infinity : 1))) return { fills, stop };
    const round = o.roundRules?.[fills.length] ?? o;
    const scanEnd = stop ? Math.min(o.end, stop.at + (stop.atOpen ? 0 : MINUTE2)) : o.end;
    if (scanEnd <= after) return { fills, stop };
    const soldBefore = o.notional / o.entryPrice * halfMirror.fraction;
    const coinsBefore = o.notional / o.entryPrice + fills.reduce((n, f) => n + f.quantity, 0) - soldBefore;
    const realAverageBefore = (o.notional + fills.reduce((n, f) => n + f.notional, 0) - o.notional * halfMirror.fraction) / coinsBefore;
    const basis = "real-average", referencePrice = realAverageBefore;
    const hit = await findQualityAdditionTrigger({ ...o, candidates: round.candidates, required: round.required, after, end: scanEnd, priceAt, ...round.minGainPct != null ? { priceGate: { referencePrice, thresholdPct: round.minGainPct, basis } } : {} });
    if (!hit) return { fills, stop };
    const atrAt = Math.floor(hit.at / STEP) * STEP, atr = await readAtr(hit.at);
    if (!(atr > 0) || !Number.isFinite(atr)) throw Error("缺少加仓时已收盘的5分钟ATR读数");
    const { entryBufferAtr, supportOffsetAtr } = qualityAdditionAtrSettings(round);
    const K = hit.price - supportOffsetAtr * atr, S = support ?? o.entryPrice;
    after = hit.at;
    const buffer = hit.price - S, minimum = entryBufferAtr * atr;
    if (buffer + 8 * Number.EPSILON * Math.max(hit.price, S, minimum) < minimum || !(K > 0)) continue;
    const mirror = o.mirror && (o.mirror.at < hit.at || o.mirror.at === hit.at && o.mirror.atOpen) ? o.mirror : void 0;
    const sold = mirror ? o.notional / o.entryPrice * mirror.fraction : 0;
    const Q = o.notional / o.entryPrice + fills.reduce((n, f) => n + f.quantity, 0) - sold;
    const cost = o.notional + fills.reduce((n, f) => n + f.notional, 0) - (mirror ? o.notional * mirror.fraction : 0);
    const profit = mirror ? Math.max(0, sold * (mirror.price - o.entryPrice)) : 0, used = fills.reduce((n, f) => n + (f.sizing?.mirrorUsed ?? 0), 0);
    const state = { ...initialAddPositionState(S, Q, profit, cost / Q), mirrorProfitAllocated: used, mirrorProfitAvailable: Math.max(0, profit - used) };
    const sized = calculateAddPosition({ currentPrice: hit.price, support: K, state });
    after = hit.at;
    if (sized.error === "invalid_input") throw Error("加仓支撑线或持仓状态无效");
    if (sized.error || !(sized.addCoins > 0)) continue;
    const notional = sized.addCoins * hit.price;
    if (!Number.isFinite(notional) || !Number.isFinite(sized.addCoins)) throw Error("加仓币数超出可计算范围");
    fills.push({ ...hit, quantity: sized.addCoins, notional, sizing: { support: K, previousSupport: S, atr, atrAt, coinsBefore: Q, realAverageBefore: cost / Q, baseCoins: sized.baseCoins, mirrorCoins: sized.mirrorCoins, mirrorUsed: sized.mirrorUsed, mirrorAvailableBefore: state.mirrorProfitAvailable, costBufferAtr: buffer / atr, requiredBufferAtr: entryBufferAtr, supportOffsetAtr, coverageGap: sized.coverageGap } });
  }
  return { fills, stop: findPositionExit(fills.at(-1)?.sizing?.support, Math.max(o.since, fills.at(-1)?.at ?? o.since)) };
}
var MINUTE2, STEP, PERIOD, WARM;
var init_qualityAdditionCalculator = __esm({
  "src/lib/fish/qualityAdditionCalculator.ts"() {
    init_atr();
    init_addPositionCoverage();
    init_algorithm();
    init_shared();
    init_qualityAdditionScan();
    init_qualityAddition();
    init_qualityVeto();
    MINUTE2 = 6e4;
    STEP = 5 * MINUTE2;
    PERIOD = 14;
    WARM = PERIOD * 20 + 1;
  }
});

// src/lib/fish/qualityIntrabar.ts
function aggregateQualityMinute(previous, minute, step) {
  const openTime = Math.floor(minute.openTime / step) * step;
  if (!previous || previous.openTime !== openTime) {
    if (minute.openTime !== openTime) throw new Error("形成中指标 K 线缺少起始分钟，不能补造读数");
    return { ...minute, openTime };
  }
  return {
    ...previous,
    high: Math.max(previous.high, minute.high),
    low: Math.min(previous.low, minute.low),
    close: minute.close,
    volume: previous.volume + minute.volume,
    quoteVolume: sum(previous.quoteVolume, minute.quoteVolume),
    takerBuyVolume: sum(previous.takerBuyVolume, minute.takerBuyVolume),
    takerBuyQuoteVolume: sum(previous.takerBuyQuoteVolume, minute.takerBuyQuoteVolume),
    refClose: minute.refClose
  };
}
function minuteTransport(plan) {
  priceBase ?? (priceBase = compileFishProgram(
    { id: "quality-intrabar-price", name: "分钟行情", short: "分钟", definition: "", formula: "C", scale: 1, unit: "", positive: "1", control: "0", interval: "1m" },
    { statistic: "结果", direction: ">", threshold: 0, constraints: [] }
  ));
  return { ...priceBase, usesTaker: plan.usesTaker, compiled: { ...priceBase.compiled, usesBtc: plan.compiled.usesBtc, usesAmounts: plan.compiled.usesAmounts } };
}
async function findQualityIntrabarExit(o) {
  const { signal } = o;
  const inputs = [...[...o.conditions ?? []].sort((a, b) => (a.cause?.id ?? "").localeCompare(b.cause?.id ?? "")), ...o.rule ? [{ plan: o.plan, scale: o.scale, rule: o.rule, stage: o.ruleStage, closeOnly: o.ruleCloseOnly }] : []];
  const streams = [];
  for (const c of inputs) {
    if (!(c.plan.step >= MINUTE3) || c.plan.step % MINUTE3 !== 0) throw new Error("盘中复原要求指标周期为整数分钟");
    const start2 = Math.floor(o.since / c.plan.step) * c.plan.step, from = start2 - c.plan.warm * c.plan.step;
    if (from < 0) throw new Error("盘中复原的公式预热历史不足");
    const history = [...await o.load(o.row, from, start2, c.plan, signal)];
    validateFishBars(history, start2, c.plan.warm, c.plan.step);
    streams.push({ ...c, start: start2, history, cache: createFormulaEvaluationCache(), partial: void 0, previous: void 0 });
  }
  let holding = o.holding, mirrorFill = o.mirrorFill;
  if (o.switchPct != null && !holding) throw new Error("组合卖出缺少买入价和持仓路径");
  const switched = () => o.switchPct != null && !!holding && holding.peak >= holding.entry * (1 + o.switchPct / 100) * (1 - 1e-12);
  const enabled = activeHoldingVetoes(o.vetoes);
  const risk = enabled.filter((v) => v.kind === "static-drawdown" || v.kind === "dynamic-drawdown").sort((a, b) => a.id.localeCompare(b.id));
  const drops = enabled.filter((v) => minuteDropWindow(v.kind) > 0).sort((a, b) => a.id.localeCompare(b.id));
  const dropMinutes = [], dropPrevious = /* @__PURE__ */ new Map();
  const maxDropWindow = Math.max(0, ...drops.map((v) => minuteDropWindow(v.kind)));
  if (risk.length && !holding) throw new Error("持仓一票否决缺少买入价和回撤路径");
  const riskPrevious = new Map(risk.map((v) => [v.id, { at: o.since, reading: holdingVetoReading(holding, v.kind) }]));
  const checkFrom = o.resumed ? o.since + MINUTE3 : o.entry;
  const checkRisk = (at2, path) => {
    for (const v of risk) {
      const reading = holdingVetoReading(path, v.kind);
      if (reading >= v.threshold || Math.abs(reading - v.threshold) <= Number.EPSILON * 32 * Math.max(1, Math.abs(reading), Math.abs(v.threshold))) return { at: at2, reading, barOpenTime: at2 - MINUTE3, previous: riskPrevious.get(v.id), cause: { id: v.id, label: v.label, kind: v.kind, direction: v.direction, threshold: v.threshold } };
      riskPrevious.set(v.id, { at: at2, reading });
    }
  };
  const checkDrop = (at2) => {
    for (const v of drops) {
      const value = minuteDropReading(dropMinutes, minuteDropWindow(v.kind), o.entry, at2);
      if (!value) continue;
      const { reading, start: start2 } = value;
      if (at2 >= checkFrom && (reading >= v.threshold || Math.abs(reading - v.threshold) <= Number.EPSILON * 32 * Math.max(1, reading, v.threshold))) return { at: at2, reading, barOpenTime: start2, previous: dropPrevious.get(v.id), cause: { id: v.id, label: v.label, kind: v.kind, direction: v.direction, threshold: v.threshold } };
      dropPrevious.set(v.id, { at: at2, reading });
    }
  };
  const check2 = (at2) => {
    const drop = checkDrop(at2);
    if (at2 < (o.resumed ? o.since : o.entry)) return;
    if (at2 >= checkFrom) {
      const trigger = checkRisk(at2, holding);
      if (trigger) return trigger;
    }
    if (drop) return drop;
    let error;
    const after = switched();
    for (const s of streams) {
      if (s.stage === "before" && after || s.stage === "after" && !after) continue;
      if (s.closeOnly && (at2 <= o.entry || at2 % s.plan.step !== 0)) continue;
      const bars = s.partial ? [...s.history, s.partial] : s.history;
      const out = evaluateOnBars(bars, s.plan.compiled, s.plan.def, s.cache).vars.get(s.plan.averageName);
      const reading = (typeof out === "number" ? out : out?.[bars.length - 1] ?? NaN) * s.scale;
      if (!Number.isFinite(reading)) {
        error ?? (error = `盘中指标存在缺失读数：${o.row.symbol}，入场 ${formatUTC8(o.entry)}，观测 ${formatUTC8(at2)}；不能越过缺口判断成交`);
        continue;
      }
      if (at2 >= checkFrom && qualityConditionMet(reading, s.rule.direction, s.rule.threshold)) return { at: at2, reading, barOpenTime: s.partial?.openTime ?? s.history.at(-1).openTime, previous: s.previous, cause: s.cause, ...s.stage ? { stage: s.stage } : {} };
      s.previous = { at: at2, reading };
    }
    if (error) throw new Error(error);
  };
  const replayStart = streams.length ? Math.min(...streams.map((s) => s.start)) : o.since;
  const start = maxDropWindow ? Math.min(replayStart, Math.max(o.entry, o.since - maxDropWindow * MINUTE3)) : replayStart, prices = [];
  if (start === (o.resumed ? o.since : o.entry)) {
    const trigger = check2(start);
    if (trigger) return { trigger, prices, mirrorFill };
  }
  const mirrorAt = (minute, openingOnly) => {
    if (!o.mirror?.enabled || mirrorFill || !holding || minute.openTime < o.since) return;
    const target = holding.entry * (1 + o.mirror.gainPct / 100), observed = openingOnly ? minute.open : minute.high;
    if (!Number.isFinite(target)) throw new Error("镜像止盈价格超出可计算范围，请降低涨幅阈值");
    if (observed < target && Math.abs(observed - target) > target * 1e-12) return;
    const atOpen = minute.open >= target, price = atOpen ? minute.open : target;
    mirrorFill = { at: minute.openTime, price, fraction: o.mirror.sellPct / 100, gainPct: o.mirror.gainPct, atOpen };
    if (mirrorFill.fraction === 1) return {
      at: minute.openTime,
      reading: (price / holding.entry - 1) * 100,
      barOpenTime: minute.openTime,
      fillPrice: price,
      fillPeak: price,
      atOpen,
      cause: { id: "mirror-take-profit", label: "镜像止盈", kind: "mirror-take-profit", direction: ">=", threshold: o.mirror.gainPct }
    };
  };
  const transport = minuteTransport(o.plan);
  transport.usesTaker = streams.some((s) => s.plan.usesTaker);
  transport.compiled = { ...transport.compiled, usesBtc: streams.some((s) => s.plan.compiled.usesBtc), usesAmounts: streams.some((s) => s.plan.compiled.usesAmounts) };
  for (let cursor = start; cursor < o.end; ) {
    if (signal.aborted) throw new DOMException("已暂停", "AbortError");
    const cut = Math.min(o.end, cursor + 500 * MINUTE3), minutes = await o.load(o.row, cursor, cut, transport, signal);
    validateFishBars(minutes, cut, (cut - cursor) / MINUTE3, MINUTE3);
    for (let i = 0; i < minutes.length; i++) {
      if (signal.aborted) throw new DOMException("已暂停", "AbortError");
      const minute = minutes[i];
      if (o.mirror?.enabled && minute.openTime >= o.since && ![holding?.entry, minute.open, minute.high, minute.low, minute.close].every((n) => Number.isFinite(n) && n > 0)) throw new Error("镜像止盈缺少有效的分钟价格，不能越过缺失行情模拟成交");
      if (holding && minute.openTime >= o.since) {
        const opening = advanceQualityHolding(holding, { ...minute, high: minute.open, low: minute.open, close: minute.open });
        const trigger2 = checkRisk(minute.openTime, opening);
        if (trigger2) {
          prices.push(minute);
          return { trigger: { ...trigger2, barOpenTime: minute.openTime, atOpen: true }, prices, mirrorFill };
        }
        const openProfit = mirrorAt(minute, true);
        if (openProfit) {
          prices.push(minute);
          return { trigger: openProfit, prices, mirrorFill };
        }
        const stop = qualityIntrabarStop(holding, minute, risk);
        if (stop) {
          prices.push(minute);
          const v = stop.veto;
          return { trigger: {
            at: minute.openTime,
            reading: stop.reading,
            barOpenTime: minute.openTime,
            previous: riskPrevious.get(v.id),
            fillPrice: stop.price,
            fillPeak: stop.peak,
            cause: { id: v.id, label: v.label, kind: v.kind, direction: v.direction, threshold: v.threshold }
          }, prices, mirrorFill };
        }
      }
      const mirrorTrigger = mirrorAt(minute, false);
      if (mirrorTrigger) {
        prices.push(minute);
        return { trigger: mirrorTrigger, prices, mirrorFill };
      }
      for (const s of streams) if (minute.openTime >= s.start) s.partial = aggregateQualityMinute(s.partial, minute, s.plan.step);
      if (minute.openTime >= o.since) {
        prices.push(minute);
        if (holding) holding = advanceQualityHolding(holding, minute);
      }
      if (drops.length && minute.openTime >= o.entry) {
        dropMinutes.push(minute);
        while (dropMinutes.length > maxDropWindow) dropMinutes.shift();
      }
      const at2 = minute.openTime + MINUTE3, trigger = check2(at2);
      if (trigger) {
        if (minutes[i + 1]) prices.push(minutes[i + 1]);
        return { trigger, prices, mirrorFill };
      }
      for (const s of streams) if (s.partial && at2 % s.plan.step === 0) {
        s.history.push(s.partial);
        s.partial = void 0;
      }
      if (i % 20 === 19) await fishDelay(0, signal);
    }
    cursor = cut;
    for (const s of streams) if (s.history.length > s.plan.warm + 500) {
      s.history = s.history.slice(-s.plan.warm);
      s.cache = createFormulaEvaluationCache();
    }
    await fishDelay(0, signal);
  }
  return { prices, mirrorFill };
}
var MINUTE3, sum, priceBase;
var init_qualityIntrabar = __esm({
  "src/lib/fish/qualityIntrabar.ts"() {
    init_features();
    init_formula();
    init_algorithm();
    init_shared();
    init_timeFormat();
    init_qualityVeto();
    MINUTE3 = 6e4;
    sum = (a, b) => a != null && b != null && Number.isFinite(a) && Number.isFinite(b) ? a + b : null;
  }
});

// src/lib/fish/qualityMirror.ts
function validateQualityMirror(rule) {
  if (!rule?.enabled) return;
  if (!Number.isFinite(rule.gainPct) || rule.gainPct <= 0) throw new Error("镜像止盈的涨幅须为大于 0 的有限数字");
  if (!Number.isFinite(rule.sellPct) || rule.sellPct <= 0 || rule.sellPct > 100) throw new Error("镜像止盈的卖出比例须大于 0 且不超过 100%");
}
function mirrorExecutionIdentity(plan) {
  return plan.mirrorTakeProfit?.enabled && plan.execution !== "intrabar-1m" && !plan.holdingVetoes?.some((v) => v.enabled) && !plan.combo ? ["mirror-preserve-close-v2"] : [];
}
function mirrorPnlBreakdown(notional, entry, mark, fill) {
  const fraction = fill?.fraction ?? 0;
  const mirrorPnl = fill ? notional * fraction * (fill.price / entry - 1) : 0;
  const remainingPnl = notional * (1 - fraction) * (mark / entry - 1);
  const returnPct = fill ? (mirrorPnl + remainingPnl) / notional * 100 : (mark / entry - 1) * 100;
  return { mirrorPnl, remainingPnl, totalPnl: fill ? mirrorPnl + remainingPnl : notional * returnPct / 100, returnPct };
}
var mirrorIdentity;
var init_qualityMirror = __esm({
  "src/lib/fish/qualityMirror.ts"() {
    mirrorIdentity = (rule) => rule?.enabled ? ["mirror-limit-v1", rule.gainPct, rule.sellPct] : [];
  }
});

// src/lib/fish/quality.ts
function qualityMembers(s) {
  const f = s.fish;
  if (!f) return [];
  return f.algorithms?.length ? f.combination === "or" ? (f.hitAlgorithms ?? []).map((i) => f.algorithms[i - 1]).filter(Boolean) : f.algorithms : [f];
}
function qualityDefinition(f) {
  const saved = JSON.parse(f.definitionKey ?? "null");
  if (!Array.isArray(saved) || typeof saved[0] !== "string" || !saved[0].trim()) throw new Error("缺少捕获时的公式快照，请重新捕捞");
  const extra = saved.slice(4).filter((v) => typeof v === "string");
  const numeric = (prefix, fallback) => {
    const value = extra.find((v) => v.startsWith(prefix));
    const n = value ? Number(value.slice(prefix.length)) : fallback;
    if (!(n > 0) || !Number.isFinite(n)) throw new Error("捕获快照的周期参数无效");
    return n;
  };
  return {
    id: f.featureId ?? "captured",
    name: f.featureName ?? "捕获算法",
    short: f.featureShort ?? "捕获算法",
    definition: "",
    formula: saved[0],
    scale: f.scale ?? 1,
    unit: f.unit ?? "",
    positive: typeof saved[1] === "string" ? saved[1] : "1",
    control: typeof saved[2] === "string" ? saved[2] : "0",
    groupVars: 2,
    interval: f.interval ?? extra.find((v) => /^\d+[mhdwM]$/.test(v)) ?? "5m",
    halfLifeHours: numeric("hl=", 6),
    avgHours: numeric("avgh=", 24),
    chartTemplate: extra.find((v) => v.startsWith("chart="))?.slice(6),
    .../\bmbiz2\s*\(/.test(saved[0]) ? { MBI2_T_HOURS: numeric("MBI2_T_HOURS=", 25 * 5 / 60), MBI2_Z0: numeric("MBI2_Z0=", 1.25), MBI2_BAND: numeric("MBI2_BAND=", 0.2), MBI2_CONFIRM: numeric("MBI2_CONFIRM=", 0.8) } : {},
    ...f.featureId === "mbi" || /\bmbiz\s*\(/.test(saved[0]) ? { MBI_N: numeric("MBI_N=", 25), MBI_Z0: numeric("MBI_Z0=", 1.25) } : {}
  };
}
function qualityMetricPlan(f, metric = "capture") {
  let def = qualityDefinition(f), statistic = metric === "capture" ? f.statistic ?? "结果" : metric;
  if (metric === "capture" && f.H != null && f.H > 0) {
    const last = compileFeatureFormula(def.formula).program.statements.at(-1);
    const expression = last.name ?? `(${def.formula.split("\n")[last.line - 1]})`;
    let alias = "__qualityCapture";
    while (def.formula.includes(alias)) alias += "_";
    def = { ...def, formula: `${def.formula}
${alias} = avg(${statistic === "结果" ? expression : statistic}, ${f.H})` };
    statistic = alias;
  }
  const plan = compileFishProgram(def, { statistic, direction: ">", threshold: 0, constraints: [] });
  if (plan.unavailable) throw new Error(plan.unavailable);
  return { plan, scale: metric === "capture" ? f.scale ?? 1 : 1 };
}
async function evaluateQualitySample(sample, group, observeHours, now, load, signal, previous) {
  const key = qualityResultKey(sample, group, observeHours), base = { key, sampleId: sample.id, groupId: group.id, evaluatedAt: now };
  if (!sample.enteredAt) return { ...base, status: "error", reason: "缺少有效买入时间，不能可靠还原买入时点" };
  if (!(observeHours >= 0 && observeHours <= 24 * 366) || !Number.isFinite(observeHours)) return { ...base, status: "error", reason: "观察时长须在 0～8784 小时之间；0 为持续至卖出" };
  const entry = Math.ceil(sample.enteredAt / QUALITY_MINUTE) * QUALITY_MINUTE;
  const limit = observeHours === 0 ? Infinity : entry + Math.ceil(observeHours * 60) * QUALITY_MINUTE;
  const availableEnd = Math.floor(now / QUALITY_MINUTE) * QUALITY_MINUTE, end = Math.min(availableEnd, limit);
  if (end <= entry) return { ...base, status: "waiting", reason: "等待入场后的首根 1 分钟 K 线" };
  try {
    const row = { ...sample.source, timeMs: now }, pp = pricePlan();
    if (!hasQualityExit(group)) {
      const bars = await load(row, entry, entry + QUALITY_MINUTE, pp, signal);
      validateFishBars(bars, entry + QUALITY_MINUTE, 1, QUALITY_MINUTE);
      return { ...base, status: "waiting", entryTime: entry, entryPrice: bars[0].open, reason: "已登记买入，待选择卖出规则后评估收益" };
    }
    validateQualityMirror(group.mirrorTakeProfit);
    validateQualityAddition(group.addition);
    const prior = previous?.key === key && previous.status === "open" && previous.entryPrice > 0 && previous.endTime >= entry && previous.endTime <= end ? previous : void 0;
    const since = prior?.endTime ?? entry;
    if (since >= end && !prior?.pendingExit) return { ...prior, evaluatedAt: now };
    let trigger = prior?.pendingExit;
    let replayedPrices;
    let mirrorFill = prior?.mirrorFill;
    if (!trigger) {
      const rule = group.rule, combo = group.combo;
      if (rule && (!Number.isFinite(rule.threshold) || !["<", ">"].includes(rule.direction))) throw new Error("卖出规则无效");
      if (combo && (!rule || !(combo.switchPct > 0) || !Number.isFinite(combo.after.rule.threshold) || !["<", ">"].includes(combo.after.rule.direction))) throw new Error("组合卖出规则无效：前段、后段门槛与分水岭都要设置");
      const { plan, scale } = rule ? qualityMetricPlan(group.snapshot, rule.metric) : { plan: pp, scale: 1 };
      const vetoes = activeHoldingVetoes(group.holdingVetoes);
      vetoes.forEach(validateHoldingVeto);
      if (group.execution === "intrabar-1m" || vetoes.length || group.mirrorTakeProfit?.enabled || combo) {
        let holding;
        if (vetoes.some((v) => v.kind !== "indicator") || group.mirrorTakeProfit?.enabled || combo) {
          const initial = prior?.entryPrice ? void 0 : await load(row, entry, entry + QUALITY_MINUTE, pp, signal);
          if (initial) validateFishBars(initial, entry + QUALITY_MINUTE, 1, QUALITY_MINUTE);
          const entryPrice2 = prior?.entryPrice ?? initial[0].open;
          holding = { entry: entryPrice2, peak: entryPrice2 * (1 + (prior?.peakPct ?? 0) / 100), minimum: entryPrice2 * (1 + (prior?.adversePct ?? 0) / 100), dynamic: prior?.drawdownPct ?? 0 };
        }
        const conditions = vetoes.filter((v) => v.kind === "indicator").map((v) => ({ ...qualityMetricPlan(v.snapshot, v.metric), rule: { direction: v.direction, threshold: v.threshold }, cause: { id: v.id, label: v.label, kind: v.kind, direction: v.direction, threshold: v.threshold } }));
        if (combo) conditions.push({ ...qualityMetricPlan(combo.after.snapshot, combo.after.rule.metric), rule: { direction: combo.after.rule.direction, threshold: combo.after.rule.threshold }, stage: "after" });
        const replay = await findQualityIntrabarExit({
          row,
          plan,
          scale,
          rule,
          entry,
          since,
          end,
          resumed: !!prior,
          load,
          signal,
          conditions,
          vetoes,
          holding,
          mirror: group.mirrorTakeProfit,
          mirrorFill,
          ruleCloseOnly: group.execution !== "intrabar-1m" && !vetoes.length && !combo,
          ...combo ? { ruleStage: "before", switchPct: combo.switchPct } : {}
        });
        trigger = replay.trigger;
        replayedPrices = replay.prices;
        mirrorFill = replay.mirrorFill;
      } else if (rule) {
        let cursor = Math.floor(since / plan.step) * plan.step;
        const stop = Math.floor(end / plan.step) * plan.step;
        while (cursor < stop && !trigger) {
          abort(signal);
          const cut = Math.min(stop, cursor + 500 * plan.step), from = cursor - plan.warm * plan.step;
          if (from < 0) throw new Error("公式预热所需历史不足");
          const bars = await load(row, from, cut, plan, signal);
          validateFishBars(bars, cut, (cut - from) / plan.step, plan.step);
          const readings = evaluateFishProgram(bars, plan).average;
          for (let i = 0; i < bars.length; i++) {
            const at2 = bars[i].openTime + plan.step;
            if (at2 <= entry || at2 <= cursor || at2 > end) continue;
            const reading = readings[i] * scale;
            if (!Number.isFinite(reading)) throw new Error("卖出指标存在缺失读数，不能越过缺口判断成交");
            if (rule.direction === "<" ? reading < rule.threshold : reading > rule.threshold) {
              trigger = { at: at2, reading };
              break;
            }
          }
          cursor = cut;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }
    const priceEnd = trigger && trigger.at < availableEnd ? trigger.at + QUALITY_MINUTE : end;
    if (priceEnd <= since && prior) return { ...prior, evaluatedAt: now };
    let prices = replayedPrices?.filter((b) => b.openTime >= since && b.openTime < priceEnd);
    if (!prices || prices.length !== (priceEnd - since) / QUALITY_MINUTE) prices = await load(row, since, priceEnd, pp, signal);
    validateFishBars(prices, priceEnd, (priceEnd - since) / QUALITY_MINUTE, QUALITY_MINUTE);
    const entryPrice = prior?.entryPrice ?? prices[0].open;
    let exitBar = trigger ? prices.find((b) => b.openTime === trigger.at) : void 0;
    let closed = !!exitBar, finalTime = closed ? exitBar.openTime : end;
    let stopFill = closed && trigger?.fillPrice != null ? trigger.fillPrice : void 0;
    let finalPrice = closed ? stopFill ?? exitBar.open : prices.at(-1).close;
    let additionFill = prior?.additionFill, additionFills = [...qualityAdditionFills(prior ?? {})], additionNote;
    if (group.addition?.enabled && (!additionFill || group.addition.quantityMode === "calculator")) {
      const config = group.addition;
      if (config.quantityMode && mirrorFill?.fraction !== 0.5) {
        additionNote = group.mirrorTakeProfit?.enabled && group.mirrorTakeProfit.sellPct === 50 ? "等待半仓镜像实际成交后再加仓" : "首次加仓须先完成卖出 50% 初始币数的半仓镜像";
      } else {
        const buildAdditionCandidates = (condition) => {
          const candidates2 = [];
          const addCandidate = (snapshot, metric, direction, threshold, label, constraints = []) => {
            const base2 = qualityMetricPlan(snapshot, metric);
            const plan = compileFishProgram(base2.plan.def, { ...base2.plan.settings, direction, constraints: constraints.filter((text) => text !== FISH_STATE_HOLD_TEXT).map((text, i) => ({ id: "add-" + i, text, enabled: true })) });
            candidates2.push({ plan, scale: base2.scale, metric, label, direction, threshold, featureId: snapshot.featureId, definitionKey: snapshot.definitionKey });
          };
          if (condition.source === "custom") {
            for (const f of qualityAdditionConditions(condition)) addCandidate(f.snapshot, f.metric, f.direction, f.threshold, f.label);
          } else {
            const detectors = Object.values(sample.readings ?? Object.fromEntries(qualityMembers(sample.source).map((f) => [qualityGroupId(f), f])));
            for (const f of detectors) {
              const direction = f.direction ?? ">";
              addCandidate(f, "capture", direction, stricterAdditionThreshold(f.threshold, direction, condition.stricterPct), f.featureShort ?? f.featureName ?? "原探测算法", f.constraints);
            }
            if (!candidates2.length) additionNote = "没有原探测算法；可选择自定义加仓指标";
          }
          const required2 = condition.source === "custom" ? candidates2.splice(1) : void 0;
          return { candidates: candidates2, required: required2, minGainPct: condition.minGainPct, entryBufferAtr: condition.entryBufferAtr, supportOffsetAtr: condition.supportOffsetAtr };
        };
        const { candidates, required } = buildAdditionCandidates(config), roundRules = config.rounds?.map(buildAdditionCandidates);
        const additionEnd = closed && trigger?.fillPrice != null && !trigger.atOpen ? finalTime + QUALITY_MINUTE : finalTime;
        if (config.quantityMode === "calculator") {
          const calculated = await findCalculatorAdditions({
            candidates,
            required,
            roundRules,
            maxRounds: qualityAdditionRoundLimit(config),
            minGainPct: config.minGainPct,
            entryBufferAtr: config.entryBufferAtr,
            supportOffsetAtr: config.supportOffsetAtr,
            row,
            entry,
            entryPrice,
            notional: QUALITY_NOTIONAL,
            end: additionEnd,
            since,
            prices,
            previous: additionFills,
            mirror: mirrorFill,
            repeat: config.repeat !== false,
            vetoes: group.holdingVetoes,
            load,
            signal,
            ordinaryExit: closed ? { at: finalTime, price: finalPrice, atOpen: trigger?.fillPrice == null || !!trigger.atOpen, mirror: trigger?.cause?.kind === "mirror-take-profit" } : void 0
          });
          additionFills = calculated.fills;
          additionFill = additionFills[0];
          if (calculated.stop) {
            const stop = calculated.stop;
            closed = true;
            finalTime = stop.at;
            finalPrice = stop.price;
            stopFill = stop.price;
            exitBar = prices.find((b) => b.openTime === stop.at);
            trigger = { at: stop.at, reading: stop.cause ? (stop.price / stop.support - 1) * 100 : stop.support, fillPrice: stop.price, fillPeak: exitBar.open, barOpenTime: stop.at, atOpen: stop.atOpen, cause: stop.cause ?? { id: "addition-support", kind: "addition-support", label: "加仓支撑线 K", direction: "<=", threshold: stop.support } };
            if (mirrorFill && (mirrorFill.at > stop.at || mirrorFill.at === stop.at && (stop.atOpen || !mirrorFill.atOpen))) mirrorFill = void 0;
          }
        } else {
          additionFill = await findQualityAddition({ candidates, required, row, entry, end: additionEnd, ...config.minGainPct != null ? { priceGate: { referencePrice: entryPrice, thresholdPct: config.minGainPct, basis: "real-average" } } : {}, ...config.quantityMode ? { after: mirrorFill.at, quantity: config.quantityMode === "entry" ? QUALITY_NOTIONAL / entryPrice * (1 - mirrorFill.fraction) : config.quantity } : { notional: config.amountMode === "entry" ? QUALITY_NOTIONAL : config.amountUsdt }, load, signal });
          additionFills = additionFill ? [additionFill] : [];
        }
      }
    }
    const held = prices.filter((b) => b.openTime < finalTime);
    const klines = held.map((b) => ({ time: b.openTime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    const args = { klines, startMs: since, endMs: finalTime - 1, barMs: QUALITY_MINUTE };
    const priceReturnPct = (finalPrice / entryPrice - 1) * 100;
    const breakdown = mirrorPnlBreakdown(QUALITY_NOTIONAL, entryPrice, finalPrice, mirrorFill);
    const position = additionFills.length ? additionPosition(QUALITY_NOTIONAL, entryPrice, finalPrice, closed, additionFills, mirrorFill) : void 0;
    const returnPct = position?.returnPct ?? breakdown.returnPct;
    let peakPct = Math.max(prior?.peakPct ?? 0, priceReturnPct);
    for (let i = 0; i < klines.length; i += 5e3) peakPct = Math.max(peakPct, computePeakPriceChangePct({ ...args, klines: klines.slice(i, i + 5e3), side: "long", entryPrice }) ?? 0);
    const previousPeak = entryPrice * (1 + (prior?.peakPct ?? 0) / 100);
    const fillPeak = stopFill != null ? trigger.fillPeak ?? exitBar.open : 0;
    if (fillPeak) peakPct = Math.max(peakPct, (fillPeak / entryPrice - 1) * 100);
    let peak = previousPeak, exitDrawdown = 0;
    for (const b of held) peak = Math.max(peak, b.high);
    peak = Math.max(peak, fillPeak);
    exitDrawdown = Math.max(0, (peak - finalPrice) / peak * 100);
    const low = held.reduce((minimum, b) => Math.min(minimum, b.low), Math.min(entryPrice * (1 + (prior?.adversePct ?? 0) / 100), finalPrice));
    let vetoDynamic = 0;
    if (activeHoldingVetoes(group.holdingVetoes).length) {
      let path = { entry: entryPrice, peak: previousPeak, minimum: entryPrice * (1 + (prior?.adversePct ?? 0) / 100), dynamic: prior?.drawdownPct ?? 0 };
      for (const b of held) path = advanceQualityHolding(path, b);
      const top = Math.max(path.peak, finalPrice, fillPeak);
      vetoDynamic = Math.max(path.dynamic, 0, (top - finalPrice) / top * 100);
    }
    const drawdownBars = prior ? [{ time: since - QUALITY_MINUTE, open: previousPeak, high: previousPeak, low: previousPeak, close: previousPeak, volume: 0 }, ...klines] : klines;
    return {
      ...base,
      status: closed ? "closed" : "open",
      entryTime: entry,
      entryPrice,
      endTime: finalTime,
      endPrice: finalPrice,
      ...mirrorFill ? { mirrorFill, remainingFraction: closed ? 0 : 1 - mirrorFill.fraction, mirrorRealizedPnl: breakdown.mirrorPnl, remainingPnl: breakdown.remainingPnl, initialNotional: QUALITY_NOTIONAL, realizedPnl: breakdown.mirrorPnl + (closed ? breakdown.remainingPnl : 0) } : {},
      ...additionFill && position ? {
        additionFill,
        ...group.addition?.quantityMode === "calculator" ? { additionFills } : {},
        totalInvested: position.totalInvested,
        averageEntryPrice: position.averageEntryPrice,
        remainingQuantity: position.remainingQuantity,
        remainingCost: position.remainingCost,
        initialNotional: QUALITY_NOTIONAL,
        mirrorRealizedPnl: position.mirrorPnl,
        remainingPnl: position.remainingPnl,
        realizedPnl: position.realizedPnl,
        remainingFraction: closed ? 0 : position.remainingQuantity / position.totalQuantity
      } : {},
      ...additionNote ? { additionNote } : {},
      returnPct,
      pnl: position?.totalPnl ?? breakdown.totalPnl,
      peakPct,
      adversePct: (low / entryPrice - 1) * 100,
      drawdownPct: Math.max(prior?.drawdownPct ?? 0, exitDrawdown, vetoDynamic, computeHoldingDynamicMaxDrawdownPct({ ...args, klines: drawdownBars, startMs: prior ? since - QUALITY_MINUTE : since }) ?? 0),
      uncapturedPct: peakPct - returnPct,
      heldHours: (finalTime - entry) / 36e5,
      complete: closed || end >= limit && !trigger,
      exitReading: closed ? trigger.reading : void 0,
      pendingExit: !closed ? trigger : void 0,
      exitSnapshot: trigger?.barOpenTime != null ? { barOpenTime: trigger.barOpenTime, observedAt: trigger.at, previous: trigger.previous, cause: trigger.cause, atOpen: trigger.atOpen, ...trigger.stage ? { stage: trigger.stage } : {} } : void 0,
      reason: closed && trigger?.cause?.kind === "addition-geometric-profit" ? `加仓止盈：几何仓位 ${trigger.cause.additionBasis.geometricMultiple.toPrecision(8)}× ≥ ${trigger.cause.geometricMultiple}×，价格 ${finalPrice.toPrecision(8)} ≥ 均衡价 K ${trigger.cause.additionBasis.equilibriumPrice.toPrecision(8)} ×（1＋${trigger.cause.threshold}%）；${trigger.atOpen ? "开盘达标，按开盘价" : "盘中触价，按目标价"}卖出全部余仓与加仓` : closed && trigger?.cause?.kind === "addition-support" ? `加仓支撑线 K 止损：${trigger.cause.threshold}；${trigger.atOpen ? "开盘跳空越线，按开盘价卖出" : "盘中触线，按支撑价卖出"}` : closed && trigger?.cause?.kind === "mirror-take-profit" ? "镜像止盈：全部币数已按止盈价卖出" : closed && !trigger?.cause && trigger?.stage && group.combo ? trigger.stage === "after" ? `组合卖出：涨幅已达 ${group.combo.switchPct}%，按 ${group.combo.after.label} ${group.combo.after.rule.direction} ${group.combo.after.rule.threshold} 盘中复原达标，下一分钟开盘卖出` : `组合卖出：涨幅未达 ${group.combo.switchPct}%，按 ${group.combo.beforeLabel} ${group.rule.direction} ${group.rule.threshold} 盘中复原达标，下一分钟开盘卖出` : closed && trigger?.cause ? `一票否决：${trigger.cause.label} ${trigger.cause.direction} ${trigger.cause.threshold}${trigger.cause.kind === "indicator" ? "" : "%"}；${trigger.atOpen ? "开盘跳空越线，按当分钟开盘价卖出" : stopFill != null ? "盘中触及止损价，按止损价卖出" : "按下一分钟开盘价卖出"}` : closed ? group.execution === "intrabar-1m" ? "盘中指标按已完成分钟复原，首次达标时按下一分钟开盘价卖出" : "指标收盘确认，下一分钟开盘卖出" : trigger ? "指标已触发，等待下一分钟开盘数据" : end < limit ? mirrorFill ? `镜像止盈已卖出初始币数 ${mirrorFill.fraction * 100}%，剩余 ${(1 - mirrorFill.fraction) * 100}% 持有中` : "持有中" : "观察期结束仍持有，记录期末浮盈"
    };
  } catch (error) {
    abort(signal);
    return { ...base, status: "error", reason: error instanceof Error ? error.message : "行情读取失败" };
  }
}
var QUALITY_NOTIONAL, QUALITY_MINUTE, qualityComboIdentity, hasQualityExit, qualityVetoVersion, qualityGroupId, qualityResultKey, pricePlan, abort;
var init_quality = __esm({
  "src/lib/fish/quality.ts"() {
    init_qualityAdditionCalculator();
    init_qualityAddition();
    init_qualityAdditionScan();
    init_features();
    init_algorithm();
    init_shared();
    init_campaignMainPriceChange();
    init_qualityIntrabar();
    init_qualityVeto();
    init_qualityMirror();
    QUALITY_NOTIONAL = 100;
    QUALITY_MINUTE = 6e4;
    qualityComboIdentity = (g) => g.combo ? [
      "combo-v1",
      g.combo.switchPct,
      g.combo.after.metric,
      g.combo.after.snapshot.featureId,
      g.combo.after.snapshot.definitionKey,
      g.combo.after.snapshot.interval,
      g.combo.after.snapshot.scale,
      g.combo.after.rule.direction,
      g.combo.after.rule.threshold
    ] : null;
    hasQualityExit = (group) => !!group.addition?.enabled || (group.combo ? !!group.rule : !!group.rule || !!group.mirrorTakeProfit?.enabled || activeHoldingVetoes(group.holdingVetoes).length > 0);
    qualityVetoVersion = (g) => g.vetoFill === "stop" ? "holding-veto-v3" : "holding-veto-v2";
    qualityGroupId = (f) => shortFishHash(JSON.stringify([
      f.featureId,
      f.definitionKey,
      f.statistic,
      f.interval,
      f.H,
      f.scale,
      f.unit,
      f.direction,
      f.threshold,
      f.constraints
    ]));
    qualityResultKey = (s, g, hours) => {
      const identity = [s.signalId ?? s.id, s.enteredAt, g.id, g.rule ?? null, hours, g.snapshot.definitionKey, g.snapshot.statistic, g.snapshot.interval, g.snapshot.scale, g.snapshot.H];
      if (g.execution === "intrabar-1m") identity.push("intrabar-1m-v1");
      const combo = qualityComboIdentity(g);
      if (combo) identity.push(combo);
      const vetoes = holdingVetoIdentity(g.holdingVetoes);
      if (vetoes.length) identity.push([qualityVetoVersion(g), vetoes]);
      if (mirrorIdentity(g.mirrorTakeProfit).length) identity.push(mirrorIdentity(g.mirrorTakeProfit));
      if (mirrorExecutionIdentity(g).length) identity.push(mirrorExecutionIdentity(g));
      if (additionIdentity(g.addition).length) {
        identity.push(additionIdentity(g.addition));
        if (g.addition?.source === "detector") identity.push(Object.entries(s.readings ?? Object.fromEntries(qualityMembers(s.source).map((f) => [qualityGroupId(f), f]))).sort(([a], [b]) => a.localeCompare(b)).map(([id, f]) => [id, f.definitionKey, f.statistic, f.threshold, f.direction, f.H, f.constraints]));
      }
      return shortFishHash(JSON.stringify(identity));
    };
    pricePlan = () => compileFishProgram({ id: "quality-price", short: "价格", name: "价格", definition: "", formula: "C", scale: 1, unit: "", positive: "1", control: "0", interval: "1m" }, { statistic: "结果", direction: ">", threshold: 0, constraints: [] });
    abort = (signal) => {
      if (signal.aborted) throw new DOMException("已取消", "AbortError");
    };
  }
});

// legacy-entry.ts
init_quality();
init_qualityAddition();
export {
  additionLabel,
  evaluateQualitySample,
  qualityAdditionAtrSettings,
  qualityAdditionConditions
};
