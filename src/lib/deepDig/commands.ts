/**
 * Deep dig 推断统计的「命令」：一行一个方法，运行前就能看到、能改，也能自己写。
 *
 * 【用户要求】2026-10-16「“推断统计”运行之前，也要给出命令行，也需要有可选择方法的选项（比如 t 检验、回归分析、多元线性回归、
 * 方差分析、RSA、机器学习），并且新增可以人为设计方法的命令窗口」。
 *
 * 每个事件（描述统计数据里的一行）可用的变量：
 *   X        因变量：默认是公式最后一句（特征值），一行 X = 名字 换成公式里别的变量；按定义的显示倍数（如 × 10000）
 *   公式里起了名的变量（N、F、V…）  原值，可以直接写进命令
 *   vol      观察窗波动率（%）
 *   endRet / maxUp / maxDown   进场后 24h 期末收益 / 最大涨幅 / 最大跌幅（%）
 *   实验组 / 对照组 / 其他 / 随机   是否属于该组（1 / 0）
 * 变量可以写成式子（同特征值公式的写法），如 X^2、ln(abs(X))。组可以用 + 合并：实验组+对照组；全部 = 四组。
 * regress / ml 的「~」右边、rsa 的第一个参数里，顶层的 + 分隔多个变量；要相加请加括号 (a + b)。
 *
 * 【用户要求】2026-10-17「推断统计的时候，需要让我选择因变量…我不知道是不是选中了 VV 还是误选成了别的。因变量要源自那个公式框中」：
 * 因变量写在命令里（X = VV），界面上点选也是改这一行；结果上方写明 X 是谁。
 */
import { mulberry32 } from '@/lib/deepRsa/grouping';
import {
  auc, clusterBootstrapCi, DEEP_DIVE_ALPHA, fUpperP, partialSpearman, permutationP, studentCritical, studentTwoSidedP, welchTTest,
  type Tail, type WelchResult,
} from '@/lib/deepRsa/deepDive';
import { holmAdjust, ranks, spearman } from '@/lib/deepRsa/rsa';
import { evaluateProgram, FormulaError, parseFormula, type Program } from '@/lib/deepDig/formula';
import type { DeepDigData, DeepDigRow, DeepDigRowGroup, DefinitionSnapshot } from '@/lib/deepDig/analysis';
import { RESULT_VAR } from '@/lib/deepDig/features';

// ===================== 方法清单与默认命令 =====================

export type MethodKey = 'ttest' | 'mannwhitney' | 'spearman' | 'quintiles' | 'regress' | 'mregress' | 'anova' | 'rsa' | 'ml';

export const METHOD_PRESETS: readonly { key: MethodKey; label: string; line: string; help: string }[] = [
  { key: 'ttest', label: 't 检验', line: 'ttest(X, 实验组, 对照组)', help: 'ttest(变量, 组A, 组B)：Welch t 检验，比较两组均值' },
  { key: 'mannwhitney', label: '排名比较', line: 'mannwhitney(X, 实验组, 对照组)', help: 'mannwhitney(变量, 组A, 组B, perm=1999)：Mann–Whitney / AUC，只看排名' },
  { key: 'spearman', label: '相关', line: 'spearman(X, endRet, maxUp, maxDown)', help: 'spearman(变量, 结果…, control=vol)：发现集 Spearman + 月内置换 + Holm，控制波动的偏相关，确认集复核' },
  { key: 'quintiles', label: '五分位', line: 'quintiles(X, endRet, maxUp, maxDown)', help: 'quintiles(变量, 结果…)：按变量分五档（切点取发现集），看每档结果均值' },
  { key: 'regress', label: '回归分析', line: 'regress(endRet ~ X)', help: 'regress(y ~ x, in=组)：一元线性回归（最小二乘）' },
  { key: 'mregress', label: '多元线性回归', line: 'regress(endRet ~ X + vol)', help: 'regress(y ~ x1 + x2 + …, in=组)：多元线性回归，系数、t、p、R²、整体 F 检验' },
  { key: 'anova', label: '方差分析', line: 'anova(X, 实验组, 对照组, 其他, 随机)', help: 'anova(变量, 组…)：单因素方差分析，F、p、η²' },
  { key: 'rsa', label: 'RSA', line: 'rsa(X, 组别)', help: 'rsa(变量 + …, 组别 或 结果, perm=199)：表征相似性分析，两两比较「特征相近」与「组别 / 结果相近」' },
  { key: 'ml', label: '机器学习', line: 'ml(实验组 ~ X + vol, model=logistic, cv=5)', help: 'ml(组 ~ 变量 + …, model=logistic|knn, cv=5, k=15, in=组, perm=199)：分类模型，按折交叉验证的样本外 AUC' },
];

export const DEFAULT_COMMANDS = [
  '# 一行一个方法；勾选上面的方法会自动加一行，也可以直接改、自己写。# 后面是注释',
  ...METHOD_PRESETS.filter(m => ['ttest', 'mannwhitney', 'spearman', 'quintiles'].includes(m.key)).map(m => m.line),
].join('\n');

export const ROW_VARIABLES: readonly { name: string; label: string }[] = [
  { name: 'X', label: '因变量（上面选的；默认公式最后一句，按显示倍数）' },
  { name: 'vol', label: '观察窗波动率（%）' },
  { name: 'endRet', label: '24h 期末收益（%）' },
  { name: 'maxUp', label: '24h 最大涨幅（%）' },
  { name: 'maxDown', label: '24h 最大跌幅（%）' },
  { name: '实验组', label: '属于实验组 = 1，否则 0（对照组 / 其他 / 随机 同理）' },
];

const GROUP_ALIASES: Record<string, DeepDigRowGroup[]> = {
  实验组: ['positive'], pos: ['positive'],
  对照组: ['control'], ctl: ['control'],
  其他: ['other'], 其他战役: ['other'], other: ['other'],
  随机: ['background'], 随机时点: ['background'], bg: ['background'],
  全部: ['positive', 'control', 'other', 'background'], all: ['positive', 'control', 'other', 'background'],
};
const GROUP_NAME: Record<DeepDigRowGroup, string> = { positive: '实验组', control: '对照组', other: '其他', background: '随机' };
const INDICATORS: Record<string, DeepDigRowGroup> = { 实验组: 'positive', 对照组: 'control', 其他: 'other', 随机: 'background', pos: 'positive', ctl: 'control', bg: 'background' };
const KNOWN = new Set(['X', 'vol', 'endRet', 'maxUp', 'maxDown', ...Object.keys(INDICATORS)]);
/** 这次解析认得的变量：固定的 + 公式里起了名的（与固定名重名的不收）。 */
let known: ReadonlySet<string> = KNOWN;
const formulaNames = (variables: readonly string[]) => variables.filter(v => v !== RESULT_VAR && !KNOWN.has(v));
/** 一行「X = 名字」：指定因变量。 */
const TARGET_LINE = /^X\s*=(?!=)\s*(\S+)$/u;
const stripComment = (raw: string) => raw.replace(/(#|\/\/).*$/, '').trim();

// ===================== 结果结构 =====================

interface BlockBase { line: number; call: string; title: string }
export interface SpearmanTargetRow {
  target: string; n: number; rho: number; ci: [number, number] | null; p: number; pHolm: number;
  rhoPartial: number | null; pPartial: number | null;
  confirmation: { n: number; rho: number; p: number; pHolm: number; verdict: '已验证' | '检验未获支持'; survivesControl: boolean | null } | null;
}
export interface RegressTerm { term: string; beta: number; se: number; t: number; p: number; ci: [number, number] }
export interface MlFold { model: 'logistic' | 'knn'; cv: number; auc: number; p: number; balancedAccuracy: number; nPos: number; nNeg: number; coefficients: { term: string; beta: number }[] | null }

export type InferenceBlock = BlockBase & (
  | { kind: 'ttest'; a: string; b: string; result: WelchResult; byPeriod: { discovery: WelchResult; confirmation: WelchResult } }
  | { kind: 'mannwhitney'; a: string; b: string; nA: number; nB: number; auc: number; ci: [number, number] | null; p: number; medianA: number | null; medianB: number | null; permutations: number }
  | { kind: 'spearman'; x: string; control: string | null; discovery: number; confirmation: number; rows: SpearmanTargetRow[]; permutations: number }
  | { kind: 'quintiles'; x: string; targets: string[]; bins: { q: number; n: number; lo: number | null; hi: number | null; means: (number | null)[] }[] }
  | { kind: 'regress'; y: string; subset: string; n: number; terms: RegressTerm[]; r2: number; adjR2: number; f: number; df1: number; df2: number; pF: number }
  | { kind: 'anova'; x: string; groups: { name: string; n: number; mean: number | null; sd: number | null }[]; f: number; df1: number; df2: number; p: number; eta2: number }
  | { kind: 'rsa'; features: string[]; target: string; subset: string; n: number; pairs: number; r: number; p: number; permutations: number }
  | ({ kind: 'ml'; target: string; features: string[]; subset: string } & MlFold)
  | { kind: 'error'; message: string }
);

export interface DeepDigInference {
  /** 推断实际使用的相对进场时点；旧结果未指定 = 0。 */
  sampleOffsetMs?: number;
  /** 用的是哪一次描述统计（DeepDigData.finishedAt）：描述统计重跑后提示推断统计也要重跑。 */
  dataFinishedAt: number;
  /** 运行时删掉的行（exclusionKey）。 */
  excludedKey?: string;
  /** 运行时的命令原文：命令改了也提示重跑。 */
  commands: string;
  /** 因变量 X 是公式里的哪个变量；null = 公式最后一句。 */
  target?: string | null;
  startedAt: number;
  finishedAt: number;
  blocks: InferenceBlock[];
}

// ===================== 解析 =====================

interface Ctx {
  rows: readonly DeepDigRow[];
  inputs: Record<string, Float64Array>;
  months: string[];
  symbols: string[];
  seed: number;
}

interface Prepared { line: number; call: string; key: MethodKey; run: (ctx: Ctx) => InferenceBlock }
export interface ParsedCommands {
  commands: Prepared[];
  errors: { line: number; message: string }[];
  /** 「X = 名字」那一行；没有 = 公式最后一句。 */
  target: { line: number; name: string } | null;
}

/** 顶层逗号 / 加号切分（括号里的不切）。 */
function splitTop(src: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of src) {
    if (ch === '(' || ch === '（') depth++;
    if (ch === ')' || ch === '）') depth--;
    if (depth === 0 && ch === sep) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

class CmdError extends Error {}

function expr(src: string, what = '变量'): { src: string; program: Program } {
  if (!src.trim()) throw new CmdError(`缺${what}`);
  try {
    return { src: src.trim(), program: parseFormula(src, known) };
  } catch (e) {
    throw new CmdError(e instanceof FormulaError ? `「${src.trim()}」${e.message.replace(/^第 \d+ 行：/, '：')}` : String(e));
  }
}

function groups(src: string): { label: string; set: Set<DeepDigRowGroup> } {
  const set = new Set<DeepDigRowGroup>();
  for (const part of splitTop(src, '+')) {
    const g = GROUP_ALIASES[part.trim()];
    if (!g) throw new CmdError(`不认识组名「${part.trim()}」：可写 实验组 / 对照组 / 其他 / 随机 / 全部，用 + 合并`);
    g.forEach(x => set.add(x));
  }
  if (!set.size) throw new CmdError('缺组名');
  return { label: set.size === 4 ? '全部' : [...set].map(g => GROUP_NAME[g]).join('+'), set };
}

function intArg(named: Record<string, string>, key: string, def: number, min: number, max: number): number {
  if (named[key] == null) return def;
  const v = Number(named[key]);
  if (!Number.isInteger(v) || v < min || v > max) throw new CmdError(`${key} 要是 ${min}–${max} 的整数`);
  return v;
}

function seriesOf(e: { program: Program }, ctx: Ctx): Float64Array {
  const v = evaluateProgram(e.program, ctx.inputs);
  const n = ctx.rows.length;
  if (typeof v === 'number') return new Float64Array(n).fill(Number.isFinite(v) ? v : Number.NaN);
  return v;
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const meanOf = (xs: readonly number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

type BlockBody = InferenceBlock extends infer B ? (B extends unknown ? Omit<B, keyof BlockBase> : never) : never;

const METHODS: Record<string, (pos: string[], named: Record<string, string>) => { key: MethodKey; title: string; run: (ctx: Ctx) => BlockBody }> = {
  ttest(pos) {
    const x = expr(pos[0] ?? 'X');
    const A = groups(pos[1] ?? '实验组');
    const B = groups(pos[2] ?? '对照组');
    return {
      key: 'ttest', title: 't 检验',
      run: ctx => {
        const v = seriesOf(x, ctx);
        const pick = (set: Set<DeepDigRowGroup>, period?: DeepDigRow['period']) =>
          ctx.rows.flatMap((r, i) => (set.has(r.group) && finite(v[i]) && (!period || r.period === period) ? [v[i]] : []));
        return {
          kind: 'ttest', a: A.label, b: B.label, result: welchTTest(pick(A.set), pick(B.set)),
          byPeriod: { discovery: welchTTest(pick(A.set, 'discovery'), pick(B.set, 'discovery')), confirmation: welchTTest(pick(A.set, 'confirmation'), pick(B.set, 'confirmation')) },
        };
      },
    };
  },
  mannwhitney(pos, named) {
    const x = expr(pos[0] ?? 'X');
    const A = groups(pos[1] ?? '实验组');
    const B = groups(pos[2] ?? '对照组');
    const perm = intArg(named, 'perm', 1999, 0, 20000);
    return {
      key: 'mannwhitney', title: 'Mann–Whitney 排名比较',
      run: ctx => {
        const v = seriesOf(x, ctx);
        const rows = ctx.rows.flatMap((r, i) => (finite(v[i]) && (A.set.has(r.group) || B.set.has(r.group)) ? [{ v: v[i], a: A.set.has(r.group), symbol: ctx.symbols[i] }] : []));
        const a = rows.filter(r => r.a).map(r => r.v);
        const b = rows.filter(r => !r.a).map(r => r.v);
        const values = rows.map(r => r.v);
        const stat = (f: readonly number[]) => auc(values.filter((_, i) => f[i] === 1), values.filter((_, i) => f[i] === 0)) - 0.5;
        const p = permutationP(stat, rows.map(r => (r.a ? 1 : 0)), rows.map(() => ''), { permutations: perm, seed: ctx.seed });
        const ci = clusterBootstrapCi(idx => auc(idx.filter(i => rows[i].a).map(i => rows[i].v), idx.filter(i => !rows[i].a).map(i => rows[i].v)), rows.map(r => r.symbol), { reps: 499, seed: ctx.seed + 1 });
        return { kind: 'mannwhitney', a: A.label, b: B.label, nA: a.length, nB: b.length, auc: auc(a, b), ci, p, medianA: median(a), medianB: median(b), permutations: perm };
      },
    };
  },
  spearman(pos, named) {
    const x = expr(pos[0] ?? 'X');
    const targets = (pos.length > 1 ? pos.slice(1) : ['endRet', 'maxUp', 'maxDown']).map(t => expr(t, '结果'));
    const control = named.control === 'none' || named.control === '无' ? null : expr(named.control ?? 'vol', 'control');
    const perm = intArg(named, 'perm', 1999, 0, 20000);
    return {
      key: 'spearman', title: 'Spearman 相关',
      run: ctx => {
        const xv = seriesOf(x, ctx);
        const zv = control ? seriesOf(control, ctx) : null;
        let step = 0;
        const seed = () => ctx.seed + 7919 * ++step;
        const paired = (yv: Float64Array, period: DeepDigRow['period']) => {
          const idx = ctx.rows.flatMap((r, i) => (r.period === period && finite(xv[i]) && finite(yv[i]) && (!zv || finite(zv[i])) ? [i] : []));
          return { x: idx.map(i => xv[i]), y: idx.map(i => yv[i]), z: zv ? idx.map(i => zv[i]) : null, blocks: idx.map(i => ctx.months[i]), symbols: idx.map(i => ctx.symbols[i]) };
        };
        const disc = targets.map(t => {
          const yv = seriesOf(t, ctx);
          const d = paired(yv, 'discovery');
          const rho = spearman(d.x, d.y);
          const p = permutationP(y => spearman(d.x, y), d.y, d.blocks, { permutations: perm, seed: seed() });
          const ci = clusterBootstrapCi(idx => spearman(idx.map(i => d.x[i]), idx.map(i => d.y[i])), d.symbols, { reps: 499, seed: seed() });
          const rhoPartial = d.z ? partialSpearman(d.x, d.y, d.z) : null;
          const pPartial = d.z ? permutationP(y => partialSpearman(d.x, y, d.z!), d.y, d.blocks, { permutations: perm, seed: seed() }) : null;
          return { target: t.src, yv, n: d.x.length, rho, ci, p, rhoPartial, pPartial };
        });
        const holm = holmAdjust(disc.map(r => r.p));
        const passed = disc.map((r, i) => Number.isFinite(holm[i]) && holm[i] < DEEP_DIVE_ALPHA && Number.isFinite(r.rho) && r.rho !== 0);
        const confRaw = disc.map((r, i) => {
          if (!passed[i]) return null;
          const d = paired(r.yv, 'confirmation');
          const tail: Tail = r.rho > 0 ? 'greater' : 'less';
          const rho = spearman(d.x, d.y);
          const p = permutationP(y => spearman(d.x, y), d.y, d.blocks, { permutations: perm, seed: seed(), tail });
          const rp = d.z ? partialSpearman(d.x, d.y, d.z) : null;
          const pp = d.z ? permutationP(y => partialSpearman(d.x, y, d.z!), d.y, d.blocks, { permutations: perm, seed: seed(), tail }) : null;
          return { n: d.x.length, rho, p, rp, pp };
        });
        const confP = confRaw.filter(Boolean).map(c => c!.p);
        const confHolm = holmAdjust(confP);
        let k = 0;
        const rows: SpearmanTargetRow[] = disc.map((r, i) => {
          const c = confRaw[i];
          const ph = c ? confHolm[k++] : Number.NaN;
          return {
            target: r.target, n: r.n, rho: r.rho, ci: r.ci, p: r.p, pHolm: holm[i], rhoPartial: r.rhoPartial, pPartial: r.pPartial,
            confirmation: c ? {
              n: c.n, rho: c.rho, p: c.p, pHolm: ph,
              verdict: Number.isFinite(c.rho) && Math.sign(c.rho) === Math.sign(r.rho) && ph < DEEP_DIVE_ALPHA ? '已验证' : '检验未获支持',
              survivesControl: c.rp == null ? null : Number.isFinite(c.rp) && Math.sign(c.rp) === Math.sign(r.rho) && (c.pp ?? 1) < DEEP_DIVE_ALPHA,
            } : null,
          };
        });
        return {
          kind: 'spearman', x: x.src, control: control?.src ?? null, rows, permutations: perm,
          discovery: ctx.rows.filter(r => r.period === 'discovery').length, confirmation: ctx.rows.filter(r => r.period === 'confirmation').length,
        };
      },
    };
  },
  quintiles(pos) {
    const x = expr(pos[0] ?? 'X');
    const targets = (pos.length > 1 ? pos.slice(1) : ['endRet', 'maxUp', 'maxDown']).map(t => expr(t, '结果'));
    return {
      key: 'quintiles', title: '五分位分档',
      run: ctx => {
        const xv = seriesOf(x, ctx);
        const ys = targets.map(t => seriesOf(t, ctx));
        const ref = ctx.rows.flatMap((r, i) => (r.period === 'discovery' && finite(xv[i]) ? [xv[i]] : [])).sort((a, b) => a - b);
        const q = (p: number) => { const pos2 = (ref.length - 1) * p; const lo = Math.floor(pos2); const hi = Math.ceil(pos2); return ref[lo] + (ref[hi] - ref[lo]) * (pos2 - lo); };
        const cuts = ref.length >= 5 ? [0.2, 0.4, 0.6, 0.8].map(q) : [];
        const bins = cuts.length ? [0, 1, 2, 3, 4].map(b => {
          const idx = ctx.rows.flatMap((_, i) => (finite(xv[i]) && cuts.filter(c => xv[i] >= c).length === b ? [i] : []));
          const vals = idx.map(i => xv[i]);
          return { q: b + 1, n: idx.length, lo: vals.length ? Math.min(...vals) : null, hi: vals.length ? Math.max(...vals) : null, means: ys.map(y => meanOf(idx.map(i => y[i]).filter(finite))) };
        }) : [];
        return { kind: 'quintiles', x: x.src, targets: targets.map(t => t.src), bins };
      },
    };
  },
  regress(pos, named) {
    const [lhs, rhs] = (pos[0] ?? '').split('~');
    if (rhs == null) throw new CmdError('写成 regress(y ~ x1 + x2)');
    const y = expr(lhs, '因变量');
    const terms = splitTop(rhs, '+').map(t => expr(t, '自变量'));
    const subset = groups(named.in ?? '全部');
    return {
      key: terms.length > 1 ? 'mregress' : 'regress', title: terms.length > 1 ? '多元线性回归' : '回归分析',
      run: ctx => {
        const yv = seriesOf(y, ctx);
        const xs = terms.map(t => seriesOf(t, ctx));
        const idx = ctx.rows.flatMap((r, i) => (subset.set.has(r.group) && finite(yv[i]) && xs.every(x => finite(x[i])) ? [i] : []));
        const fit = ols(idx.map(i => yv[i]), idx.map(i => xs.map(x => x[i])));
        if (!fit) return { kind: 'error', message: `样本不够或变量共线，算不出（n = ${idx.length}）` };
        const names = ['截距', ...terms.map(t => t.src)];
        return { kind: 'regress', y: y.src, subset: subset.label, n: idx.length, ...fit, terms: fit.terms.map((t, i) => ({ ...t, term: names[i] })) };
      },
    };
  },
  anova(pos) {
    const x = expr(pos[0] ?? 'X');
    const gs = (pos.length > 1 ? pos.slice(1) : ['实验组', '对照组', '其他', '随机']).map(groups);
    if (gs.length < 2) throw new CmdError('方差分析至少要两个组');
    return {
      key: 'anova', title: '方差分析',
      run: ctx => {
        const v = seriesOf(x, ctx);
        const vals = gs.map(g => ctx.rows.flatMap((r, i) => (g.set.has(r.group) && finite(v[i]) ? [v[i]] : [])));
        const all = vals.flat();
        const N = all.length; const k = vals.filter(xs => xs.length).length;
        const grand = meanOf(all) ?? 0;
        let ssb = 0; let ssw = 0;
        const groupsOut = gs.map((g, gi) => {
          const xs = vals[gi]; const m = meanOf(xs);
          if (m != null) { ssb += xs.length * (m - grand) ** 2; ssw += xs.reduce((s, x2) => s + (x2 - m) ** 2, 0); }
          const sd = m != null && xs.length > 1 ? Math.sqrt(xs.reduce((s, x2) => s + (x2 - m) ** 2, 0) / (xs.length - 1)) : null;
          return { name: g.label, n: xs.length, mean: m, sd };
        });
        const df1 = k - 1; const df2 = N - k;
        const f = df1 > 0 && df2 > 0 && ssw > 0 ? (ssb / df1) / (ssw / df2) : Number.NaN;
        return { kind: 'anova', x: x.src, groups: groupsOut, f, df1, df2, p: fUpperP(f, df1, df2), eta2: ssb + ssw > 0 ? ssb / (ssb + ssw) : Number.NaN };
      },
    };
  },
  rsa(pos, named) {
    const feats = splitTop(pos[0] ?? 'X', '+').map(t => expr(t));
    const targetSrc = (pos[1] ?? '组别').trim();
    const byGroup = targetSrc === '组别' || targetSrc === 'group';
    const target = byGroup ? null : expr(targetSrc, '对照');
    const subset = groups(named.in ?? (byGroup ? '实验组+对照组' : '全部'));
    const perm = intArg(named, 'perm', 199, 0, 5000);
    return {
      key: 'rsa', title: 'RSA 表征相似性分析',
      run: ctx => {
        const xs = feats.map(f => seriesOf(f, ctx));
        const tv = target ? seriesOf(target, ctx) : null;
        const idx = ctx.rows.flatMap((r, i) => (subset.set.has(r.group) && xs.every(x => finite(x[i])) && (!tv || finite(tv[i])) ? [i] : []));
        const n = idx.length;
        if (n < 6) return { kind: 'error', message: `样本太少（n = ${n}）` };
        const z = xs.map(x => { const v = idx.map(i => x[i]); const m = meanOf(v)!; const sd = Math.sqrt(v.reduce((s, a) => s + (a - m) ** 2, 0) / Math.max(1, v.length - 1)) || 1; return v.map(a => (a - m) / sd); });
        const fd: number[] = [];
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) fd.push(Math.sqrt(z.reduce((s, col) => s + (col[i] - col[j]) ** 2, 0)));
        const values = tv ? idx.map(i => tv[i]) : idx.map(i => (ctx.rows[i].group === 'positive' ? 1 : ctx.rows[i].group === 'control' ? 0 : ctx.rows[i].group === 'other' ? 2 : 3));
        const targetDist = (vals: readonly number[]) => {
          const out: number[] = [];
          for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push(tv ? Math.abs(vals[i] - vals[j]) : vals[i] === vals[j] ? 0 : 1);
          return out;
        };
        const rf = ranks(fd);
        const stat = (vals: readonly number[]) => pearsonOf(rf, ranks(targetDist(vals)));
        const r = stat(values);
        const rand = mulberry32(ctx.seed);
        let atLeast = 0;
        for (let t = 0; t < perm; t++) {
          const shuffled = [...values];
          for (let k = shuffled.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]]; }
          if (stat(shuffled) >= r - 1e-12) atLeast++;
        }
        return { kind: 'rsa', features: feats.map(f => f.src), target: byGroup ? '组别' : target!.src, subset: subset.label, n, pairs: fd.length, r, p: perm > 0 ? (1 + atLeast) / (1 + perm) : Number.NaN, permutations: perm };
      },
    };
  },
  ml(pos, named) {
    const [lhs, rhs] = (pos[0] ?? '').split('~');
    if (rhs == null) throw new CmdError('写成 ml(实验组 ~ X + vol)');
    const target = groups(lhs.trim());
    const feats = splitTop(rhs, '+').map(t => expr(t));
    const model = (named.model ?? 'logistic').trim();
    if (model !== 'logistic' && model !== 'knn') throw new CmdError('model 只能是 logistic 或 knn');
    const cv = intArg(named, 'cv', 5, 2, 20);
    const k = intArg(named, 'k', 15, 1, 200);
    const perm = intArg(named, 'perm', 199, 0, 2000);
    const subset = groups(named.in ?? '实验组+对照组');
    return {
      key: 'ml', title: model === 'knn' ? '机器学习 · k 近邻' : '机器学习 · 逻辑回归',
      run: ctx => {
        const xs = feats.map(f => seriesOf(f, ctx));
        const idx = ctx.rows.flatMap((r, i) => (subset.set.has(r.group) && xs.every(x => finite(x[i])) ? [i] : []));
        const X = idx.map(i => xs.map(x => x[i]));
        const y: number[] = idx.map(i => (target.set.has(ctx.rows[i].group) ? 1 : 0));
        const nPos = y.filter(v => v === 1).length;
        if (nPos < cv || y.length - nPos < cv) return { kind: 'error', message: `两类都至少要 ${cv} 个（现在 ${nPos} / ${y.length - nPos}）` };
        const run = (labels: number[], seed: number) => crossValidate(X, labels, { model: model as 'logistic' | 'knn', cv, k, seed });
        const obs = run(y, ctx.seed);
        const rand = mulberry32(ctx.seed + 17);
        let atLeast = 0;
        for (let t = 0; t < perm; t++) {
          const s = [...y];
          for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }
          if (run(s, ctx.seed + 31 * (t + 1)).auc >= obs.auc - 1e-12) atLeast++;
        }
        const coef = model === 'logistic' ? logisticFit(standardize(X).z, y) : null;
        return {
          kind: 'ml', target: target.label, features: feats.map(f => f.src), subset: subset.label, model: model as 'logistic' | 'knn', cv,
          auc: obs.auc, balancedAccuracy: obs.balancedAccuracy, p: perm > 0 ? (1 + atLeast) / (1 + perm) : Number.NaN, nPos, nNeg: y.length - nPos,
          coefficients: coef ? feats.map((f, i) => ({ term: f.src, beta: coef[i + 1] })) : null,
        };
      },
    };
  },
};

const NAMED_ALLOWED: Record<string, string[]> = {
  ttest: [], mannwhitney: ['perm'], spearman: ['control', 'perm'], quintiles: [], regress: ['in'], anova: [], rsa: ['in', 'perm'], ml: ['model', 'cv', 'k', 'perm', 'in'],
};

/**
 * 解析命令。variables = 公式里可选的变量（formulaVariables 的 names）：给了就检查「X = 名字」是不是其中之一，
 * 并且命令里可以直接写这些变量；不给（旧调用）只认固定变量。
 */
export function parseCommands(text: string, options: { variables?: readonly string[] } = {}): ParsedCommands {
  const prev = known;
  if (options.variables) known = new Set([...KNOWN, ...formulaNames(options.variables)]);
  try {
    return parseCommandsWith(text, options.variables);
  } finally {
    known = prev;
  }
}

function parseCommandsWith(text: string, variables: readonly string[] | undefined): ParsedCommands {
  const commands: Prepared[] = [];
  const errors: { line: number; message: string }[] = [];
  let target: ParsedCommands['target'] = null;
  text.split('\n').forEach((raw, li) => {
    const line = li + 1;
    const src = stripComment(raw);
    if (!src) return;
    const t = TARGET_LINE.exec(src);
    if (t) {
      if (target) { errors.push({ line, message: `因变量已在第 ${target.line} 行指定过` }); return; }
      if (variables && !variables.includes(t[1])) { errors.push({ line, message: `公式里没有「${t[1]}」：可选 ${variables.join(' / ')}` }); return; }
      target = { line, name: t[1] };
      return;
    }
    const m = /^([A-Za-z_]+)\s*[(（](.*)[)）]$/.exec(src);
    if (!m) { errors.push({ line, message: '写成 方法名(参数, …)，如 ttest(X, 实验组, 对照组)' }); return; }
    const name = m[1];
    const make = METHODS[name];
    if (!make) { errors.push({ line, message: `没有「${name}」这个方法：可用 ${Object.keys(METHODS).join(' / ')}` }); return; }
    const pos: string[] = [];
    const named: Record<string, string> = {};
    for (const arg of m[2].trim() ? splitTop(m[2], ',').flatMap(a => splitTop(a, '，')) : []) {
      const kv = /^([A-Za-z_]+)\s*=(?!=)\s*(.+)$/.exec(arg);
      if (kv) {
        if (!NAMED_ALLOWED[name].includes(kv[1])) { errors.push({ line, message: `${name} 没有 ${kv[1]}= 这个选项` }); return; }
        named[kv[1]] = kv[2].trim();
      } else pos.push(arg);
    }
    try {
      const p = make(pos, named);
      commands.push({
        line, call: src, key: p.key,
        run: ctx => {
          try { return { line, call: src, title: p.title, ...p.run(ctx) } as InferenceBlock; } catch (e) { return { line, call: src, title: p.title, kind: 'error', message: e instanceof Error ? e.message : String(e) }; }
        },
      });
    } catch (e) {
      errors.push({ line, message: e instanceof Error ? e.message : String(e) });
    }
  });
  return { commands, errors, target };
}

/** 命令里指定的因变量（没指定 = null，即公式最后一句）。 */
export function targetOf(text: string): string | null {
  for (const raw of text.split('\n')) {
    const t = TARGET_LINE.exec(stripComment(raw));
    if (t) return t[1];
  }
  return null;
}

/** 点选因变量：改「X = 名字」那一行；选公式最后一句（null）= 删掉这一行。插在开头的注释后面。 */
export function setTarget(text: string, name: string | null): string {
  const lines = text.split('\n').filter(raw => !TARGET_LINE.test(stripComment(raw)));
  if (name == null) return lines.join('\n');
  let at = 0;
  while (at < lines.length && lines[at].trim().startsWith('#')) at++;
  lines.splice(at, 0, `X = ${name}`);
  return lines.join('\n');
}

/** 勾选框的状态：命令里有哪些方法（一元 / 多元回归按自变量个数区分）。 */
export function methodsIn(text: string): Set<MethodKey> {
  return new Set(parseCommands(text).commands.map(c => c.key));
}

/** 勾上：加一行默认写法；取消：删掉这个方法的所有行。 */
export function toggleMethod(text: string, key: MethodKey, on: boolean): string {
  if (on) {
    const preset = METHOD_PRESETS.find(m => m.key === key)!;
    return `${text.replace(/\s+$/, '')}\n${preset.line}`;
  }
  const lines = text.split('\n');
  const drop = new Set(parseCommands(text).commands.filter(c => c.key === key).map(c => c.line));
  return lines.filter((_, i) => !drop.has(i + 1)).join('\n');
}

// ===================== 运行 =====================

/** 描述统计数据里有哪些公式变量（每行 vars 的键）。 */
export function dataVariables(rows: readonly DeepDigRow[]): string[] {
  const names = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.vars ?? {})) names.add(k);
  return [...names];
}

export function rowInputs(rows: readonly DeepDigRow[], def: Pick<DefinitionSnapshot, 'scale'>, target: string | null = null): Record<string, Float64Array> {
  const f = (g: (r: DeepDigRow) => number | null | undefined) => Float64Array.from(rows, r => { const v = g(r); return v != null && Number.isFinite(v) ? v : Number.NaN; });
  const y = (r: DeepDigRow) => (target == null || target === RESULT_VAR ? r.v : r.vars?.[target]);
  const out: Record<string, Float64Array> = {
    X: f(r => { const v = y(r); return v == null ? null : v * def.scale; }),
    vol: f(r => (r.vol == null ? null : r.vol * 100)),
    endRet: f(r => (r.endRet == null ? null : r.endRet * 100)),
    maxUp: f(r => (r.maxUp == null ? null : r.maxUp * 100)),
    maxDown: f(r => (r.maxDown == null ? null : r.maxDown * 100)),
  };
  for (const [name, g] of Object.entries(INDICATORS)) out[name] = f(r => (r.group === g ? 1 : 0));
  for (const name of formulaNames(dataVariables(rows))) out[name] = f(r => r.vars?.[name]);
  return out;
}

/** 推断统计（纯计算，不联网）：按命令逐行算。 */
export function runInference(
  data: Pick<DeepDigData, 'rows' | 'definition' | 'finishedAt' | 'sampleOffsetMs'>,
  commands: string,
  options: { excludedKey?: string; seed?: number } = {},
): DeepDigInference {
  const startedAt = Date.now();
  const variables = [...dataVariables(data.rows), RESULT_VAR];
  // 指定的因变量数据里没有（公式改过、或数据是旧版）：不悄悄换成别的，整份不算
  const wanted = targetOf(commands);
  if (wanted != null && !variables.includes(wanted)) {
    const line = commands.split('\n').findIndex(raw => TARGET_LINE.test(stripComment(raw))) + 1;
    return {
      dataFinishedAt: data.finishedAt, sampleOffsetMs: data.sampleOffsetMs ?? 0, excludedKey: options.excludedKey ?? '', commands, target: wanted, startedAt, finishedAt: Date.now(),
      blocks: [{ line, call: `X = ${wanted}`, title: '因变量', kind: 'error', message: `描述统计的数据里没有「${wanted}」（有：${variables.join(' / ')}）：公式改过或数据是旧版，先重新运行描述统计` }],
    };
  }
  const parsed = parseCommands(commands, { variables });
  const target = parsed.target?.name ?? null;
  const ctx: Ctx = {
    rows: data.rows,
    inputs: rowInputs(data.rows, data.definition, target),
    months: data.rows.map(r => new Date(r.anchorMs).toISOString().slice(0, 7)),
    symbols: data.rows.map(r => r.symbol),
    seed: options.seed ?? 20261016,
  };
  const blocks: InferenceBlock[] = [
    ...parsed.errors.map(e => ({ line: e.line, call: commands.split('\n')[e.line - 1]?.trim() ?? '', title: '命令写错了', kind: 'error' as const, message: e.message })),
    ...parsed.commands.map(c => c.run({ ...ctx, seed: ctx.seed + 104729 * c.line })),
  ].sort((a, b) => a.line - b.line);
  return { dataFinishedAt: data.finishedAt, sampleOffsetMs: data.sampleOffsetMs ?? 0, excludedKey: options.excludedKey ?? '', commands, target, startedAt, finishedAt: Date.now(), blocks };
}

// ===================== 统计小工具 =====================

function pearsonOf(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  if (n < 3) return Number.NaN;
  let mx = 0; let my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx; const b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : Number.NaN;
}

/** 解 A·x = b（高斯消元，部分主元）；奇异返回 null。也顺带求逆（b 取单位阵的各列）。 */
function invert(a: number[][]): number[][] | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    const d = m[c][c];
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map(row => row.slice(n));
}

/** 最小二乘（带截距）：系数、标准误、t、p、95% 区间、R²、整体 F。 */
export function ols(y: readonly number[], xs: readonly (readonly number[])[]) {
  const n = y.length;
  const p = (xs[0]?.length ?? 0) + 1;
  if (n <= p) return null;
  const X = xs.map(r => [1, ...r]);
  const xtx = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  const inv = invert(xtx);
  if (!inv) return null;
  const xty = Array.from({ length: p }, (_, i) => X.reduce((s, r, k) => s + r[i] * y[k], 0));
  const beta = inv.map(row => row.reduce((s, v, j) => s + v * xty[j], 0));
  const fitted = X.map(r => r.reduce((s, v, j) => s + v * beta[j], 0));
  const ssr = y.reduce((s, v, i) => s + (v - fitted[i]) ** 2, 0);
  const my = y.reduce((s, v) => s + v, 0) / n;
  const sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const df2 = n - p;
  const sigma2 = ssr / df2;
  const crit = studentCritical(df2);
  const terms = beta.map((b, i) => {
    const se = Math.sqrt(Math.max(0, sigma2 * inv[i][i]));
    const t = se > 0 ? b / se : Number.NaN;
    return { term: '', beta: b, se, t, p: studentTwoSidedP(t, df2), ci: [b - crit * se, b + crit * se] as [number, number] };
  });
  const r2 = sst > 0 ? 1 - ssr / sst : Number.NaN;
  const df1 = p - 1;
  const f = df1 > 0 && ssr > 0 ? ((sst - ssr) / df1) / sigma2 : Number.NaN;
  return { terms, r2, adjR2: 1 - (1 - r2) * (n - 1) / df2, f, df1, df2, pF: fUpperP(f, df1, df2) };
}

function standardize(X: readonly (readonly number[])[], ref: readonly (readonly number[])[] = X) {
  const d = X[0]?.length ?? 0;
  const mu = Array.from({ length: d }, (_, j) => ref.reduce((s, r) => s + r[j], 0) / ref.length);
  const sd = Array.from({ length: d }, (_, j) => Math.sqrt(ref.reduce((s, r) => s + (r[j] - mu[j]) ** 2, 0) / Math.max(1, ref.length - 1)) || 1);
  return { z: X.map(r => r.map((v, j) => (v - mu[j]) / sd[j])), apply: (rows: readonly (readonly number[])[]) => rows.map(r => r.map((v, j) => (v - mu[j]) / sd[j])) };
}

/** 逻辑回归（牛顿法 + 很小的 L2，保证收敛）：返回 [截距, 系数…]。 */
function logisticFit(X: readonly (readonly number[])[], y: readonly number[], lambda = 1e-3): number[] {
  const p = (X[0]?.length ?? 0) + 1;
  let w = new Array(p).fill(0);
  for (let iter = 0; iter < 50; iter++) {
    const g = new Array(p).fill(0);
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    X.forEach((r, i) => {
      const x = [1, ...r];
      const pr = 1 / (1 + Math.exp(-x.reduce((s, v, j) => s + v * w[j], 0)));
      const wt = pr * (1 - pr);
      for (let a = 0; a < p; a++) {
        g[a] += (y[i] - pr) * x[a];
        for (let b = 0; b < p; b++) H[a][b] += wt * x[a] * x[b];
      }
    });
    for (let a = 1; a < p; a++) { g[a] -= lambda * w[a]; H[a][a] += lambda; }
    const inv = invert(H);
    if (!inv) break;
    const step = inv.map(row => row.reduce((s, v, j) => s + v * g[j], 0));
    w = w.map((v, j) => v + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return w;
}

function crossValidate(X: readonly (readonly number[])[], y: readonly number[], o: { model: 'logistic' | 'knn'; cv: number; k: number; seed: number }) {
  const rand = mulberry32(o.seed);
  const fold = new Array(y.length).fill(0);
  for (const cls of [0, 1]) {
    const idx = y.flatMap((v, i) => (v === cls ? [i] : []));
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    idx.forEach((i, r) => { fold[i] = r % o.cv; });
  }
  const prob = new Array(y.length).fill(0.5);
  const thr = new Array(y.length).fill(0.5);
  for (let f = 0; f < o.cv; f++) {
    const tr = y.flatMap((_, i) => (fold[i] !== f ? [i] : []));
    const te = y.flatMap((_, i) => (fold[i] === f ? [i] : []));
    const s = standardize(tr.map(i => X[i]));
    const zte = s.apply(te.map(i => X[i]));
    const ytr = tr.map(i => y[i]);
    const prevalence = ytr.reduce((a, b) => a + b, 0) / ytr.length;
    if (o.model === 'logistic') {
      const w = logisticFit(s.z, ytr);
      zte.forEach((r, k) => { prob[te[k]] = 1 / (1 + Math.exp(-[1, ...r].reduce((a, v, j) => a + v * w[j], 0))); thr[te[k]] = prevalence; });
    } else {
      zte.forEach((r, k) => {
        const d = s.z.map((q, i) => ({ d: q.reduce((a, v, j) => a + (v - r[j]) ** 2, 0), y: ytr[i] })).sort((a, b) => a.d - b.d).slice(0, o.k);
        prob[te[k]] = d.reduce((a, v) => a + v.y, 0) / d.length;
        thr[te[k]] = prevalence;
      });
    }
  }
  const pos = prob.filter((_, i) => y[i] === 1);
  const neg = prob.filter((_, i) => y[i] === 0);
  const tpr = y.filter((v, i) => v === 1 && prob[i] >= thr[i]).length / Math.max(1, pos.length);
  const tnr = y.filter((v, i) => v === 0 && prob[i] < thr[i]).length / Math.max(1, neg.length);
  return { auc: auc(pos, neg), balancedAccuracy: (tpr + tnr) / 2 };
}
