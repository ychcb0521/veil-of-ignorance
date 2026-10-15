/**
 * Deep RSA · 第 4 步：表征相似性分析（RSA）。只在训练集上拟合与检验。
 *
 * 做法：
 * 1. 每类表征（价格 / 订单流 / 谢林候选）各得一个事件 × 事件的表征差异矩阵（RDM）：
 *    特征用训练集的均值、标准差标准化后算欧氏距离（只用两边都有值的维度，按维度数缩放）。
 * 2. 目标 RDM：分组标签（正 / 对照，同组 0、异组 1）与独立未来结果（|y_i − y_j|）各一个。
 * 3. RSA 统计量 = 两个 RDM 上三角的 Spearman 相关。
 * 4. 显著性用 Mantel 置换：同时打乱目标 RDM 的行和列——事件对之间并不独立
 *    （同一个事件出现在 n−1 对里），所以不能把事件对当独立样本算 p 值。
 * 5. 多重比较：表征 × 半衰期 × 目标的全部检验一起做 Holm 校正，另给 BH-FDR 供参考。
 *
 * RSA 相关只说明「表征几何与标签几何是否同构」，不是盈利概率，也不是胜率。
 * 相似案例检索（nearestByDistance）只作补充复盘材料，不能代替 RSA。
 */
import { mulberry32 } from '@/lib/deepRsa/grouping';

export type Row = Readonly<Record<string, number | null>>;

export interface Standardizer {
  keys: string[];
  mean: Record<string, number>;
  sd: Record<string, number>;
  /** 训练集里有效值不足或标准差为 0 而被弃用的特征。 */
  dropped: string[];
}

/** 只用训练集拟合；验证 / 测试集复用这里的均值和标准差，避免信息泄漏。 */
export function fitStandardizer(trainRows: readonly Row[], keys: readonly string[], minCount = 3): Standardizer {
  const out: Standardizer = { keys: [], mean: {}, sd: {}, dropped: [] };
  for (const key of keys) {
    const xs = trainRows.map(r => r[key]).filter((v): v is number => v != null && Number.isFinite(v));
    if (xs.length < minCount) { out.dropped.push(key); continue; }
    const m = xs.reduce((s, v) => s + v, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
    if (!(sd > 0)) { out.dropped.push(key); continue; }
    out.keys.push(key);
    out.mean[key] = m;
    out.sd[key] = sd;
  }
  return out;
}

export function standardize(rows: readonly Row[], s: Standardizer): (number | null)[][] {
  return rows.map(r => s.keys.map(k => {
    const v = r[k];
    return v != null && Number.isFinite(v) ? (v - s.mean[k]) / s.sd[k] : null;
  }));
}

/** 方阵，对角为 0；无法比较的事件对为 NaN。 */
export type Rdm = number[][];

/** 两边都有值的维度少于 minDims → NaN；否则 √(Σ d² · D / d_common)。 */
export function euclideanRdm(z: readonly (number | null)[][], minDims = 2): Rdm {
  const n = z.length;
  const rdm: Rdm = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = z[i];
      const b = z[j];
      let ss = 0;
      let common = 0;
      for (let k = 0; k < a.length; k++) {
        if (a[k] == null || b[k] == null) continue;
        ss += (a[k]! - b[k]!) ** 2;
        common++;
      }
      const d = common >= Math.max(1, minDims) ? Math.sqrt((ss * a.length) / common) : Number.NaN;
      rdm[i][j] = d;
      rdm[j][i] = d;
    }
  }
  return rdm;
}

/** 分类标签：同类 0，异类 1，任一缺失 NaN。 */
export function categoricalRdm(labels: readonly (string | null)[]): Rdm {
  return labels.map((a, i) => labels.map((b, j) => (i === j ? 0 : a == null || b == null ? Number.NaN : a === b ? 0 : 1)));
}

/** 连续结果：|y_i − y_j|，任一缺失 NaN。 */
export function absDiffRdm(values: readonly (number | null)[]): Rdm {
  return values.map((a, i) => values.map((b, j) => (i === j ? 0
    : a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) ? Number.NaN : Math.abs(a - b))));
}

/** 平均秩（并列取平均）。 */
export function ranks(xs: readonly number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : Number.NaN;
}

export function spearman(x: readonly number[], y: readonly number[]): number {
  return x.length >= 3 ? pearson(ranks(x), ranks(y)) : Number.NaN;
}

/** 两个 RDM 上三角里两边都有限的事件对。perm 把目标 RDM 的事件重新编号（置换检验用）。 */
function pairedUpper(a: Rdm, b: Rdm, perm?: readonly number[]): [number[], number[]] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const x = a[i][j];
      const y = perm ? b[perm[i]][perm[j]] : b[i][j];
      if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
    }
  }
  return [xs, ys];
}

export interface RsaResult {
  rho: number;
  /** 单侧 p：H₁ 为「表征越相似，目标越相似」（ρ > 0）。 */
  p: number;
  nEvents: number;
  nPairs: number;
  permutations: number;
}

export interface MantelOptions {
  permutations?: number;
  seed?: number;
  /**
   * 可交换块：只在同块内打乱（例如按月份），控制市场状态等块内共同因素。
   * 不传则全体打乱。
   */
  blocks?: readonly string[];
}

export function rsaMantel(featureRdm: Rdm, targetRdm: Rdm, options: MantelOptions = {}): RsaResult {
  const n = featureRdm.length;
  const permutations = options.permutations ?? 2000;
  const [xs, ys] = pairedUpper(featureRdm, targetRdm);
  const rho = spearman(xs, ys);
  if (!Number.isFinite(rho)) return { rho, p: Number.NaN, nEvents: n, nPairs: xs.length, permutations: 0 };
  const random = mulberry32(options.seed ?? 1);
  const groups = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = options.blocks?.[i] ?? '';
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  let atLeast = 0;
  const perm = Array.from({ length: n }, (_, i) => i);
  const shuffle = () => {
    for (const idx of groups.values()) {
      const shuffled = [...idx];
      for (let k = shuffled.length - 1; k > 0; k--) {
        const r = Math.floor(random() * (k + 1));
        [shuffled[k], shuffled[r]] = [shuffled[r], shuffled[k]];
      }
      idx.forEach((orig, k) => { perm[orig] = shuffled[k]; });
    }
  };
  const fast = rankStatistic(featureRdm, targetRdm);
  if (fast) {
    // 快速路径：秩只算一次，每次置换只重排目标秩（浏览器里一次检验约十万对 × 上千次置换）
    const observed = fast(perm);
    for (let t = 0; t < permutations; t++) {
      shuffle();
      const r = fast(perm);
      if (Number.isFinite(r) && r >= observed - 1e-12) atLeast++;
    }
  } else {
    for (let t = 0; t < permutations; t++) {
      shuffle();
      const [px, py] = pairedUpper(featureRdm, targetRdm, perm);
      const r = spearman(px, py);
      if (Number.isFinite(r) && r >= rho) atLeast++;
    }
  }
  return { rho, p: (1 + atLeast) / (1 + permutations), nEvents: n, nPairs: xs.length, permutations };
}

/**
 * 目标 RDM 上三角全部有限时可用的秩统计量：表征一侧对有效事件对取秩，目标一侧对全体事件对取秩，
 * 置换只是重新编号目标秩。表征 RDM 没有不可比的事件对时，它与 Spearman 完全相同；有时略有差别，
 * 但观测值与置换值用的是同一个统计量，置换 p 值仍然有效（报告的 ρ 照旧是精确 Spearman）。
 */
function rankStatistic(featureRdm: Rdm, targetRdm: Rdm): ((perm: readonly number[]) => number) | null {
  const n = featureRdm.length;
  const tVals: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!Number.isFinite(targetRdm[i][j])) return null;
      tVals.push(targetRdm[i][j]);
    }
  }
  const tRanks = ranks(tVals);
  const RT = new Float64Array(n * n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) { RT[i * n + j] = tRanks[k]; RT[j * n + i] = tRanks[k]; k++; }
  }
  const I: number[] = [];
  const J: number[] = [];
  const X: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Number.isFinite(featureRdm[i][j])) { I.push(i); J.push(j); X.push(featureRdm[i][j]); }
    }
  }
  const m = X.length;
  if (m < 3) return null;
  const rx = ranks(X);
  const mx = rx.reduce((s, v) => s + v, 0) / m;
  const xc = Float64Array.from(rx, v => v - mx);
  const sxx = xc.reduce((s, v) => s + v * v, 0);
  if (!(sxx > 0)) return null;
  return perm => {
    let sy = 0; let syy = 0; let sxy = 0;
    for (let q = 0; q < m; q++) {
      const y = RT[perm[I[q]] * n + perm[J[q]]];
      sy += y; syy += y * y; sxy += xc[q] * y;
    }
    const vy = syy - (sy * sy) / m;
    return vy > 0 ? sxy / Math.sqrt(sxx * vy) : Number.NaN;
  };
}

/** Holm 逐步校正（控制族错误率）。NaN 保持 NaN、不计入族。 */
export function holmAdjust(ps: readonly number[]): number[] {
  const valid = ps.map((p, i) => [p, i] as const).filter(([p]) => Number.isFinite(p)).sort((a, b) => a[0] - b[0]);
  const m = valid.length;
  const out = ps.map(() => Number.NaN);
  let running = 0;
  valid.forEach(([p, i], k) => {
    running = Math.max(running, Math.min(1, (m - k) * p));
    out[i] = running;
  });
  return out;
}

/** Benjamini–Hochberg（控制错误发现率），仅供参考。 */
export function bhAdjust(ps: readonly number[]): number[] {
  const valid = ps.map((p, i) => [p, i] as const).filter(([p]) => Number.isFinite(p)).sort((a, b) => a[0] - b[0]);
  const m = valid.length;
  const out = ps.map(() => Number.NaN);
  let running = 1;
  for (let k = m - 1; k >= 0; k--) {
    const [p, i] = valid[k];
    running = Math.min(running, (m * p) / (k + 1));
    out[i] = Math.min(1, running);
  }
  return out;
}

/**
 * 偏 Mantel（稳健性检验用）：表征 RDM 与目标 RDM 的 Spearman，剔除控制 RDM（例如 |Δ 波动率|）的单调影响。
 * 三个 RDM 都有限的事件对取秩，表征秩与目标秩各自对控制秩回归取残差，再求相关；
 * 置换与 rsaMantel 相同（在块内重新编号目标 RDM 的事件），单侧 H₁：剔除后仍 ρ > 0。
 */
export function rsaPartialMantel(featureRdm: Rdm, targetRdm: Rdm, controlRdm: Rdm, options: MantelOptions = {}): RsaResult {
  const n = featureRdm.length;
  const permutations = options.permutations ?? 2000;
  const I: number[] = [];
  const J: number[] = [];
  const X: number[] = [];
  const Z: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Number.isFinite(featureRdm[i][j]) && Number.isFinite(controlRdm[i][j]) && Number.isFinite(targetRdm[i][j])) {
        I.push(i); J.push(j); X.push(featureRdm[i][j]); Z.push(controlRdm[i][j]);
      }
    }
  }
  const m = X.length;
  if (m < 4) return { rho: Number.NaN, p: Number.NaN, nEvents: n, nPairs: m, permutations: 0 };
  const rz = ranks(Z);
  const mz = rz.reduce((s, v) => s + v, 0) / m;
  const zc = rz.map(v => v - mz);
  const szz = zc.reduce((s, v) => s + v * v, 0);
  const rx = ranks(X);
  const mx = rx.reduce((s, v) => s + v, 0) / m;
  let szx = 0;
  for (let q = 0; q < m; q++) szx += zc[q] * (rx[q] - mx);
  const betaX = szz > 0 ? szx / szz : 0;
  // 表征秩对控制秩的残差：均值 0、与控制秩正交
  const resX = Float64Array.from(rx, (v, q) => v - mx - betaX * zc[q]);
  const sxx = resX.reduce((s, v) => s + v * v, 0);
  // 目标一侧对全体有限事件对取秩一次，置换只重新编号（与 rankStatistic 同一个做法，观测值与置换值用同一个统计量）
  const tVals: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) tVals.push(Number.isFinite(targetRdm[i][j]) ? targetRdm[i][j] : 0);
  const tRanks = ranks(tVals);
  const RT = new Float64Array(n * n);
  let k0 = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { RT[i * n + j] = tRanks[k0]; RT[j * n + i] = tRanks[k0]; k0++; }
  // resX 与常数、控制秩都正交，所以 corr(resX, resY) = Σ resX·y ÷ √(Σ resX² · 残差平方和(y))，一遍扫完、不分配数组
  const partialAt = (perm: readonly number[]) => {
    let sy = 0; let syy = 0; let sxy = 0; let szy = 0;
    for (let q = 0; q < m; q++) {
      const y = RT[perm[I[q]] * n + perm[J[q]]];
      sy += y; syy += y * y; sxy += resX[q] * y; szy += zc[q] * y;
    }
    const vy = syy - (sy * sy) / m - (szz > 0 ? (szy * szy) / szz : 0);
    return sxx > 0 && vy > 1e-9 ? sxy / Math.sqrt(sxx * vy) : Number.NaN;
  };
  const identity = Array.from({ length: n }, (_, i) => i);
  const rho = partialAt(identity);
  if (!Number.isFinite(rho)) return { rho, p: Number.NaN, nEvents: n, nPairs: m, permutations: 0 };
  const random = mulberry32(options.seed ?? 1);
  const groups = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = options.blocks?.[i] ?? '';
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const perm = [...identity];
  let atLeast = 0;
  for (let t = 0; t < permutations; t++) {
    for (const idx of groups.values()) {
      const shuffled = [...idx];
      for (let k = shuffled.length - 1; k > 0; k--) {
        const r = Math.floor(random() * (k + 1));
        [shuffled[k], shuffled[r]] = [shuffled[r], shuffled[k]];
      }
      idx.forEach((orig, k) => { perm[orig] = shuffled[k]; });
    }
    const r = partialAt(perm);
    if (Number.isFinite(r) && r >= rho - 1e-12) atLeast++;
  }
  return { rho, p: (1 + atLeast) / (1 + permutations), nEvents: n, nPairs: m, permutations };
}

// ===================== 检验面板 =====================

export interface RsaEvent {
  id: string;
  /** 每个半衰期一套特征（键 = 半衰期小时数）。 */
  featuresByH: Readonly<Record<number, Row>>;
  /** 'positive' | 'control'；其余组别（冲突、中间、待判定、背景）传 null，不进标签 RDM。 */
  label: string | null;
  /** 独立未来结果（例如 forwardOutcome().maxUp）；缺失 null。 */
  outcome: number | null;
  block?: string;
}

export interface RepresentationSpec {
  name: string;
  keys: readonly string[];
}

export interface PanelRow extends RsaResult {
  representation: string;
  halfLifeHours: number;
  target: 'label' | 'outcome';
  usedKeys: string[];
  droppedKeys: string[];
  pHolm: number;
  pBh: number;
}

/**
 * 训练集上的完整检验面板：表征 × 半衰期 × 目标。
 * 标签目标只用有正 / 对照标签的事件；结果目标用有结果值的事件（可含背景时点）。
 * 置换块取各事件自带的 block（筛选后逐事件对应）。
 */
export function runRsaPanel(
  train: readonly RsaEvent[],
  representations: readonly RepresentationSpec[],
  halfLives: readonly number[],
  options: Omit<MantelOptions, 'blocks'> & { minDims?: number } = {},
): PanelRow[] {
  const rows: Omit<PanelRow, 'pHolm' | 'pBh'>[] = [];
  for (const rep of representations) {
    for (const h of halfLives) {
      for (const target of ['label', 'outcome'] as const) {
        const events = train.filter(e => (target === 'label' ? e.label != null : e.outcome != null));
        const featRows = events.map(e => e.featuresByH[h] ?? {});
        const std = fitStandardizer(featRows, rep.keys);
        const fRdm = euclideanRdm(standardize(featRows, std), options.minDims ?? 2);
        const tRdm = target === 'label' ? categoricalRdm(events.map(e => e.label)) : absDiffRdm(events.map(e => e.outcome));
        const blocks = events.some(e => e.block) ? events.map(e => e.block ?? '') : undefined;
        rows.push({
          ...rsaMantel(fRdm, tRdm, { ...options, blocks }),
          representation: rep.name, halfLifeHours: h, target, usedKeys: std.keys, droppedKeys: std.dropped,
        });
      }
    }
  }
  const holm = holmAdjust(rows.map(r => r.p));
  const bh = bhAdjust(rows.map(r => r.p));
  return rows.map((r, i) => ({ ...r, pHolm: holm[i], pBh: bh[i] }));
}

/**
 * 在验证集上选半衰期：给定每个 h 的验证集 RSA ρ，取最大者；并列取候选表里靠前的。
 * 选定后冻结，测试集不再比较。全部 NaN → null（不选，不硬凑）。
 */
export function selectHalfLife(candidates: readonly { halfLifeHours: number; rho: number }[]): number | null {
  let best: { halfLifeHours: number; rho: number } | null = null;
  for (const c of candidates) {
    if (!Number.isFinite(c.rho)) continue;
    if (!best || c.rho > best.rho) best = c;
  }
  return best?.halfLifeHours ?? null;
}

/** 补充复盘：在表征空间里离 query 最近的 k 个候选（例如「长得像的失败案例」）。不代替 RSA。 */
export function nearestByDistance(rdm: Rdm, query: number, candidates: readonly number[], k: number): { index: number; distance: number }[] {
  return candidates
    .filter(c => c !== query && Number.isFinite(rdm[query][c]))
    .map(c => ({ index: c, distance: rdm[query][c] }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, k);
}

/**
 * 用 fitEvents（训练集）拟合标准化，在 evalEvents（验证 / 测试集）上做一次 RSA。
 * 标签目标只用有正 / 对照标签的事件，结果目标只用有结果值的事件；permutations = 0 时只要 ρ。
 */
export function rsaEvaluate(
  fitEvents: readonly RsaEvent[],
  evalEvents: readonly RsaEvent[],
  rep: RepresentationSpec,
  halfLifeHours: number,
  target: 'label' | 'outcome',
  options: Omit<MantelOptions, 'blocks'> & { minDims?: number } = {},
): RsaResult & { usedKeys: string[] } {
  const keep = (e: RsaEvent) => (target === 'label' ? e.label != null : e.outcome != null);
  const fit = fitEvents.filter(keep);
  const evals = evalEvents.filter(keep);
  const std = fitStandardizer(fit.map(e => e.featuresByH[halfLifeHours] ?? {}), rep.keys);
  const fRdm = euclideanRdm(standardize(evals.map(e => e.featuresByH[halfLifeHours] ?? {}), std), options.minDims ?? 2);
  const tRdm = target === 'label' ? categoricalRdm(evals.map(e => e.label)) : absDiffRdm(evals.map(e => e.outcome));
  const blocks = evals.some(e => e.block) ? evals.map(e => e.block ?? '') : undefined;
  return { ...rsaMantel(fRdm, tRdm, { ...options, blocks }), usedKeys: std.keys };
}
