/**
 * Deep dig 的小公式语言：特征值公式（逐根 K 线的序列）与分组标准（每场战役的读数）共用。
 *
 * 【用户要求】2026-10-16「每个特征值……都可以人为输入定义概念、公式、分组标准，然后运行的时候，就按照这里的公式提取因变量，
 * 按分组标准进行划分组别」。不用 eval：自己解析、自己算，写错了给出「第几行、哪里不对」。
 *
 * 写法：
 *   - 一行一句，或用「;」隔开；「名字 = 式子」给中间量起名，最后一句的值就是结果；「#」或「//」后面是注释。
 *   - 运算：+ − × ÷ ^（乘方），比较 > < >= <= == !=（真 = 1、假 = 0），and / or / not，括号。
 *     从文档里复制来的 × ÷ − （ ） ， 也认。
 *   - 值可以是一个数，也可以是一串（每根 K 线一个）：一串和一个数相加 = 每个都加上它。
 *   - 算不出来（除以 0、ln 负数、序列开头没有前一根……）记为「空」：空参与运算结果还是空，nz() 可以把空换成 0。
 */

export type Value = number | Float64Array;

export interface FunctionSpec {
  name: string;
  /** 参数个数的下限 / 上限。 */
  min: number;
  max: number;
  /** 界面帮助里的写法与说明。 */
  usage: string;
  help: string;
}

/** 默认 5m K 线：ema 的半衰期按小时给，按 K 线周期换算成每根的衰减（evaluateProgram 的 barMinutes）。 */
export const FORMULA_BAR_MINUTES = 5;

export const FUNCTIONS: readonly FunctionSpec[] = [
  { name: 'ln', min: 1, max: 1, usage: 'ln(x)', help: '自然对数（也可写 log）' },
  { name: 'log', min: 1, max: 1, usage: 'log(x)', help: '同 ln' },
  { name: 'exp', min: 1, max: 1, usage: 'exp(x)', help: 'e 的 x 次方' },
  { name: 'tanh', min: 1, max: 1, usage: 'tanh(x)', help: '双曲正切：把任意数平滑压到 −1 ~ 1（0 → 0，±1 → ±0.76，±2 → ±0.96）' },
  { name: 'abs', min: 1, max: 1, usage: 'abs(x)', help: '绝对值' },
  { name: 'sqrt', min: 1, max: 1, usage: 'sqrt(x)', help: '平方根' },
  { name: 'sign', min: 1, max: 1, usage: 'sign(x)', help: '正 1、负 −1、零 0' },
  { name: 'max', min: 2, max: 2, usage: 'max(a, b)', help: '逐根取较大的' },
  { name: 'min', min: 2, max: 2, usage: 'min(a, b)', help: '逐根取较小的' },
  { name: 'prev', min: 1, max: 2, usage: 'prev(x, k)', help: '前 k 根的值（k 默认 1）；开头没有前 k 根的记空' },
  { name: 'ema', min: 2, max: 3, usage: 'ema(x, h, 初值)', help: '指数平滑，半衰期 h 小时（h 可写 hl = 上面选的半衰期）：yₜ = ρ·yₜ₋₁ + (1 − ρ)·xₜ，ρ = 2^(−周期 ÷ h)，周期 = 上面选的 K 线周期；x 为空的那根跳过；不给初值时从第一个非空值起算' },
  { name: 'ago', min: 2, max: 2, usage: 'ago(x, h)', help: 'h 小时以前那根的值（按 K 线周期换算成根数；开头不够 h 小时的记空）' },
  { name: 'zscore', min: 2, max: 2, usage: 'zscore(x, h)', help: '滚动标准化：(当根 − 过去 h 小时的平均) ÷ 过去 h 小时的标准差（含当根，样本标准差）；空值跳过，开头不满 h 小时用已有的，少于 2 个或标准差为 0 记空' },
  { name: 'sd', min: 2, max: 2, usage: 'sd(x, h)', help: '过去 h 小时的标准差（含当根，样本标准差）：空值跳过，开头不满 h 小时用已有的，少于 2 个记空。例：R / sd(R, avgh) = 按自身波动标准化的涨跌（Z 分数，均值按 0）' },
  { name: 'retain', min: 4, max: 5, usage: 'retain(K, P, E0, h, W)', help: '保留加权和（CBA 用）：Σ wᵢ·Kᵢ·ln(Pₜ ÷ E0ᵢ) ÷ (t − i + 1)，i 取过去 W 小时（默认 48）里的每一根，wᵢ = 2^(−距今小时 ÷ h) 归一化（权重合计 1）；Kᵢ 或 E0ᵢ 为空的那根这一项记 0' },
  { name: 'full', min: 2, max: 2, usage: 'full(x, n)', help: '最近 n 根全部存在且有效时返回当根 x，否则记空（不补零）' },
  { name: 'peak', min: 2, max: 2, usage: 'peak(x, n)', help: '最近 n 根最大值，必须满 n 根且没有缺值' },
  { name: 'wsum', min: 3, max: 3, usage: 'wsum(x, h, n)', help: '时间衰减加权和：最近 n 根（含当根），第 i 根权重 2^(−(t − i) ÷ h)，h、n 都以根计；空值跳过，一个都没有记空' },
  { name: 'rsum', min: 2, max: 2, usage: 'rsum(x, h)', help: '过去 h 小时的和（含当根）：空值跳过，一个都没有记空' },
  { name: 'median', min: 2, max: 2, usage: 'median(x, h)', help: '过去 h 小时的中位数（含当根）：空值跳过，一个都没有记空' },
  { name: 'mad', min: 2, max: 2, usage: 'mad(x, h)', help: '过去 h 小时的中位数绝对偏差 median(|x − 中位数|)（含当根）：空值跳过；稳健 z = (x − 中性点) ÷ (1.4826 × mad)' },
  { name: 'rscale', min: 2, max: 2, usage: 'rscale(x, h)', help: '稳健尺度：过去 h 小时（含当根）的 1.4826 × MAD；一半以上的值相同、MAD = 0 时改用 1.2533 × 平均绝对偏差（离中位数）；稳健 z = (x − 中性点) ÷ rscale' },
  { name: 'highest', min: 2, max: 2, usage: 'highest(x, n)', help: '最近 n 根（含当根）的最大值：空值跳过' },
  { name: 'lowest', min: 2, max: 2, usage: 'lowest(x, n)', help: '最近 n 根（含当根）的最小值：空值跳过' },
  { name: 'msum', min: 2, max: 2, usage: 'msum(x, n)', help: '最近 n 根（含当根）的和：空值跳过，一个都没有记空（sum 要求 n 根都有值）' },
  { name: 'beta', min: 3, max: 3, usage: 'beta(y, x, h)', help: '过去 h 小时（含当根）y 对 x 的回归斜率：两个都有值的根才算，少于 2 根记空' },
  { name: 'clip', min: 3, max: 3, usage: 'clip(x, lo, hi)', help: '截断到 lo ~ hi' },
  { name: 'atr', min: 4, max: 4, usage: 'atr(H, L, C, n)', help: '平均真实波幅：真实波幅 = max(H − L, |H − 前收|, |L − 前收|)，Wilder 平滑 n 根（前 n 根的平均起算，不满 n 根记空）' },
  { name: 'avg', min: 2, max: 2, usage: 'avg(x, h)', help: '过去 h 小时的平均（含当根；h 可写 avgh = 上面选的平均时长）：按 K 线周期换算成根数，周期变了时长不变；x 为空的那根跳过；开头不满 h 小时的用已有的' },
  { name: 'sma', min: 2, max: 2, usage: 'sma(x, n)', help: '最近 n 根的平均（不满 n 根记空）' },
  { name: 'sum', min: 2, max: 2, usage: 'sum(x, n)', help: '最近 n 根的和（不满 n 根记空）' },
  { name: 'nz', min: 1, max: 2, usage: 'nz(x, v)', help: '空换成 v（默认 0）' },
  { name: 'if', min: 3, max: 3, usage: 'if(条件, a, b)', help: '条件成立取 a，否则取 b' },
  { name: 'has', min: 1, max: 1, usage: 'has(x)', help: 'x 不是空 → 1，否则 0' },
];
const FN = new Map(FUNCTIONS.map(f => [f.name, f]));

// ===================== 词法 =====================

type Tok =
  | { t: 'num'; v: number; line: number }
  | { t: 'id'; v: string; line: number }
  | { t: 'op'; v: string; line: number }
  | { t: 'sep'; line: number }
  | { t: 'end'; line: number };

export class FormulaError extends Error {
  constructor(message: string, readonly line: number) {
    super(`第 ${line} 行：${message}`);
  }
}

const NORMALIZE: Record<string, string> = { '×': '*', '·': '*', '÷': '/', '−': '-', '（': '(', '）': ')', '，': ',', '；': ';', '＝': '=', '＋': '+', '＞': '>', '＜': '<' };
const KEYWORDS: Record<string, string> = { and: 'and', or: 'or', not: 'not' };

function tokenize(src: string): Tok[] {
  const text = [...src].map(ch => NORMALIZE[ch] ?? ch).join('');
  const out: Tok[] = [];
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n') { out.push({ t: 'sep', line }); line++; i++; continue; }
    if (ch === ';') { out.push({ t: 'sep', line }); i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '#' || (ch === '/' && text[i + 1] === '/')) { while (i < text.length && text[i] !== '\n') i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]), line }); i += num[0].length; continue; }
    const id = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(text.slice(i));
    if (id) {
      const kw = KEYWORDS[id[0]];
      out.push(kw ? { t: 'op', v: kw, line } : { t: 'id', v: id[0], line });
      i += id[0].length;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) {
      out.push({ t: 'op', v: two === '&&' ? 'and' : two === '||' ? 'or' : two, line });
      i += 2;
      continue;
    }
    if ('+-*/^()<>=,!'.includes(ch)) { out.push({ t: 'op', v: ch === '!' ? 'not' : ch, line }); i++; continue; }
    throw new FormulaError(`看不懂「${ch}」`, line);
  }
  out.push({ t: 'end', line });
  return out;
}

// ===================== 语法 =====================

type Node =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string; line: number }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[]; line: number };

interface Statement { name: string | null; expr: Node; line: number }

export interface Program {
  statements: Statement[];
  /** 用到的外部变量（不含自己起名的中间量）。 */
  inputs: Set<string>;
}

class Parser {
  private i = 0;
  constructor(private readonly toks: Tok[]) {}
  private peek(): Tok { return this.toks[this.i]; }
  private next(): Tok { return this.toks[this.i++]; }
  private isOp(v: string): boolean { const t = this.peek(); return t.t === 'op' && t.v === v; }
  private expectOp(v: string) {
    const t = this.next();
    if (t.t !== 'op' || t.v !== v) throw new FormulaError(`这里应该是「${v}」`, t.line);
  }

  program(): Statement[] {
    const out: Statement[] = [];
    while (this.peek().t !== 'end') {
      if (this.peek().t === 'sep') { this.next(); continue; }
      const start = this.peek();
      let name: string | null = null;
      const after = this.toks[this.i + 1];
      if (start.t === 'id' && after?.t === 'op' && after.v === '=') { name = start.v; this.i += 2; }
      const expr = this.or();
      const t = this.peek();
      if (t.t !== 'sep' && t.t !== 'end') throw new FormulaError(t.t === 'op' && t.v === '=' ? '「=」左边只能是一个名字' : '式子没写完整，或少了运算符', t.line);
      out.push({ name, expr, line: start.line });
    }
    return out;
  }

  private or(): Node { let a = this.and(); while (this.isOp('or')) { this.next(); a = { k: 'bin', op: 'or', a, b: this.and() }; } return a; }
  private and(): Node { let a = this.not(); while (this.isOp('and')) { this.next(); a = { k: 'bin', op: 'and', a, b: this.not() }; } return a; }
  private not(): Node { if (this.isOp('not')) { this.next(); return { k: 'un', op: 'not', a: this.not() }; } return this.cmp(); }
  private cmp(): Node {
    const a = this.add();
    const t = this.peek();
    if (t.t === 'op' && ['>', '<', '>=', '<=', '==', '!='].includes(t.v)) { this.next(); return { k: 'bin', op: t.v, a, b: this.add() }; }
    if (t.t === 'op' && t.v === '=') throw new FormulaError('比较相等请写「==」', t.line);
    return a;
  }
  private add(): Node {
    let a = this.mul();
    for (;;) {
      const t = this.peek();
      if (t.t === 'op' && (t.v === '+' || t.v === '-')) { this.next(); a = { k: 'bin', op: t.v, a, b: this.mul() }; } else return a;
    }
  }
  private mul(): Node {
    let a = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.t === 'op' && (t.v === '*' || t.v === '/')) { this.next(); a = { k: 'bin', op: t.v, a, b: this.unary() }; } else return a;
    }
  }
  private unary(): Node {
    if (this.isOp('-')) { this.next(); return { k: 'un', op: '-', a: this.unary() }; }
    if (this.isOp('+')) { this.next(); return this.unary(); }
    return this.pow();
  }
  private pow(): Node {
    const a = this.primary();
    if (this.isOp('^')) { this.next(); return { k: 'bin', op: '^', a, b: this.unary() }; }
    return a;
  }
  private primary(): Node {
    const t = this.next();
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'id') {
      if (this.isOp('(')) {
        this.next();
        const args: Node[] = [];
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.or());
            if (this.isOp(',')) { this.next(); continue; }
            break;
          }
        }
        this.expectOp(')');
        return { k: 'call', name: t.v, args, line: t.line };
      }
      return { k: 'var', name: t.v, line: t.line };
    }
    if (t.t === 'op' && t.v === '(') { const e = this.or(); this.expectOp(')'); return e; }
    if (t.t === 'sep' || t.t === 'end') throw new FormulaError('式子没写完整', t.line);
    throw new FormulaError(`这里不应该出现「${t.t === 'op' ? t.v : ''}」`, t.line);
  }
}

/**
 * 解析并检查：名字是否都认识（外部变量或前面起过的名）、函数是否存在、参数个数是否对。
 * known = 允许用的外部变量名。
 */
export function parseFormula(src: string, known: ReadonlySet<string>): Program {
  const statements = new Parser(tokenize(src)).program();
  if (!statements.length) throw new FormulaError('还没写公式', 1);
  const defined = new Set<string>();
  const inputs = new Set<string>();
  const check = (n: Node) => {
    if (n.k === 'var') {
      if (defined.has(n.name)) return;
      if (known.has(n.name)) { inputs.add(n.name); return; }
      throw new FormulaError(`不认识「${n.name}」：可用的名字见「可用写法」，中间量要先「${n.name} = …」再用`, n.line);
    }
    if (n.k === 'un') check(n.a);
    else if (n.k === 'bin') { check(n.a); check(n.b); }
    else if (n.k === 'call') {
      const spec = FN.get(n.name);
      if (!spec) throw new FormulaError(`没有「${n.name}」这个函数`, n.line);
      if (n.args.length < spec.min || n.args.length > spec.max) throw new FormulaError(`${spec.usage} 的参数个数不对`, n.line);
      n.args.forEach(check);
    }
  };
  for (const s of statements) {
    check(s.expr);
    if (s.name) {
      if (FN.has(s.name)) throw new FormulaError(`「${s.name}」是函数名，换个名字`, s.line);
      defined.add(s.name);
    }
  }
  return { statements, inputs };
}

// ===================== 计算 =====================

const isSeries = (v: Value): v is Float64Array => typeof v !== 'number';

function lengthOf(...vs: Value[]): number {
  let n = -1;
  for (const v of vs) if (isSeries(v)) n = Math.max(n, v.length);
  return n;
}
const at = (v: Value, i: number) => (isSeries(v) ? (i < v.length ? v[i] : Number.NaN) : v);

function map1(a: Value, f: (x: number) => number): Value {
  if (!isSeries(a)) return f(a);
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = f(a[i]);
  return out;
}
/** 两个参数逐根算（一个数自动铺开）。直接循环，不在每根上建数组——公式在几百个事件 × 上千根 K 线上跑，这里是热点。 */
function map2(a: Value, b: Value, f: (x: number, y: number) => number): Value {
  const sa = isSeries(a);
  const sb = isSeries(b);
  if (!sa && !sb) return f(a as number, b as number);
  const n = lengthOf(a, b);
  const out = new Float64Array(n);
  if (sa && sb) {
    const A = a as Float64Array;
    const B = b as Float64Array;
    if (A.length === n && B.length === n) for (let i = 0; i < n; i++) out[i] = f(A[i], B[i]);
    else for (let i = 0; i < n; i++) out[i] = f(at(A, i), at(B, i));
  } else if (sa) {
    const A = a as Float64Array;
    const y = b as number;
    for (let i = 0; i < n; i++) out[i] = f(A[i], y);
  } else {
    const x = a as number;
    const B = b as Float64Array;
    for (let i = 0; i < n; i++) out[i] = f(x, B[i]);
  }
  return out;
}
function map3(a: Value, b: Value, c: Value, f: (x: number, y: number, z: number) => number): Value {
  const n = lengthOf(a, b, c);
  if (n < 0) return f(a as number, b as number, c as number);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = f(at(a, i), at(b, i), at(c, i));
  return out;
}

/** 过去 h 小时 = 多少根（含当根），至少 1 根。 */
export const barsForHours = (h: number, barMinutes: number) => Math.max(1, Math.round((h * 60) / barMinutes));

/** 最近 n 根（含当根）的平均：空值不计，开头不满 n 根用已有的；一个都没有记空。 */
export function rollingMean(x: Float64Array, n: number): Float64Array {
  const out = new Float64Array(x.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isFinite(x[i])) { sum += x[i]; count++; }
    const drop = i - n;
    if (drop >= 0 && Number.isFinite(x[drop])) { sum -= x[drop]; count--; }
    out[i] = count > 0 ? clean(sum / count) : Number.NaN;
  }
  return out;
}

/** 往前数 k 根的值；开头不够 k 根记空。 */
export function shiftBars(x: Float64Array, k: number): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = i >= k ? x[i - k] : Number.NaN;
  return out;
}

/**
 * 滚动标准化：(当根 − 最近 n 根的平均) ÷ 最近 n 根的样本标准差（含当根）。空值不计，开头不满 n 根用已有的；
 * 少于 2 个值、标准差为 0、当根为空 → 空。
 */
export function rollingZScore(x: Float64Array, n: number): Float64Array {
  const out = new Float64Array(x.length);
  let sum = 0;
  let sq = 0;
  let count = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isFinite(x[i])) { sum += x[i]; sq += x[i] * x[i]; count++; }
    const drop = i - n;
    if (drop >= 0 && Number.isFinite(x[drop])) { sum -= x[drop]; sq -= x[drop] * x[drop]; count--; }
    if (!Number.isFinite(x[i]) || count < 2) { out[i] = Number.NaN; continue; }
    const mean = sum / count;
    const variance = (sq - count * mean * mean) / (count - 1);
    const sd = variance > 0 ? Math.sqrt(variance) : 0;
    // 滑动求和的舍入误差：标准差小到相对均值可以忽略时当作 0
    out[i] = sd > 1e-12 * Math.max(1, Math.abs(mean)) ? clean((x[i] - mean) / sd) : Number.NaN;
  }
  return out;
}

/** 滚动样本标准差（最近 n 根，含当根）；空值跳过，少于 2 个记空。 */
export function rollingSd(x: Float64Array, n: number): Float64Array {
  const out = new Float64Array(x.length);
  let sum = 0;
  let sq = 0;
  let count = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isFinite(x[i])) { sum += x[i]; sq += x[i] * x[i]; count++; }
    const drop = i - n;
    if (drop >= 0 && Number.isFinite(x[drop])) { sum -= x[drop]; sq -= x[drop] * x[drop]; count--; }
    if (count < 2) { out[i] = Number.NaN; continue; }
    const mean = sum / count;
    const variance = (sq - count * mean * mean) / (count - 1);
    out[i] = variance > 0 ? Math.sqrt(variance) : 0;
  }
  return out;
}

/**
 * 保留加权和（CBA 买方定价优势指数的核心，Deep dig 的 retain 与 K 线图的 computeCba 共用）：
 *   outₜ = Σ_{k=0}^{n−1} w_k · K_{t−k} · ln(Pₜ ÷ E0_{t−k}) ÷ (k + 1)，w_k = ρ^k ÷ Σ_j ρ^j（窗口内、t − k ≥ 0 的根），
 * ρ = 每根的时间衰减，n = 窗口根数。K、E0 为空（或 E0 ≤ 0）的那一根这一项记 0、权重照算；Pₜ 为空 → 空。
 */
export function retainSum(k: Float64Array, p: Float64Array, e0: Float64Array, rho: number, n: number): Float64Array {
  const N = p.length;
  const out = new Float64Array(N);
  const lnE0 = Float64Array.from(e0, v => (v > 0 ? Math.log(v) : Number.NaN));
  // c_k = ρ^k ÷ (k + 1)，预先算好
  const c = new Float64Array(n);
  for (let j = 0, r = 1; j < n; j++, r *= rho) c[j] = r / (j + 1);
  for (let t = 0; t < N; t++) {
    const pt = p[t];
    if (!(pt > 0)) { out[t] = Number.NaN; continue; }
    const lnP = Math.log(pt);
    const m = Math.min(n, t + 1);
    let sum = 0;
    for (let j = 0; j < m; j++) {
      const kk = k[t - j];
      const le = lnE0[t - j];
      if (Number.isFinite(kk) && Number.isFinite(le)) sum += c[j] * kk * (lnP - le);
    }
    // 归一化：Σ_{j<m} ρ^j
    const z = rho === 1 ? m : (1 - rho ** m) / (1 - rho);
    out[t] = clean(sum / z);
  }
  return out;
}

/** 最近 n 根（含当根）里有值的数，按大小排好；每根调用 fn(排好的数组) 得这一根的结果，一个都没有记空。 */
function rollingSorted(x: Float64Array, n: number, fn: (sorted: number[]) => number): Float64Array {
  const out = new Float64Array(x.length);
  const win: number[] = [];
  const lowerBound = (v: number) => {
    let lo = 0;
    let hi = win.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (win[mid] < v) lo = mid + 1; else hi = mid; }
    return lo;
  };
  for (let i = 0; i < x.length; i++) {
    if (Number.isFinite(x[i])) win.splice(lowerBound(x[i]), 0, x[i]);
    const drop = i - n;
    if (drop >= 0 && Number.isFinite(x[drop])) win.splice(lowerBound(x[drop]), 1);
    out[i] = win.length ? fn(win) : Number.NaN;
  }
  return out;
}
const medianOfSorted = (s: readonly number[]) => {
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
/** 最近 n 根的中位数（含当根）：空值跳过。 */
export const rollingMedian = (x: Float64Array, n: number) => rollingSorted(x, n, medianOfSorted);
/** 最近 n 根的中位数绝对偏差 median(|x − 中位数|)（含当根）：空值跳过。排好的两半各自按偏差从小到大，合并取中间。 */
function madOfSorted(s: readonly number[]): number {
  const m = medianOfSorted(s);
  const len = s.length;
  // 第一个 ≥ 中位数的位置 p：左边偏差 a(i) = m − s[p − 1 − i]、右边 b(j) = s[p + j] − m，各自从小到大
  let lo = 0;
  let hi = len;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid] < m) lo = mid + 1; else hi = mid; }
  const p = lo;
  const aAt = (i: number) => m - s[p - 1 - i];
  const bAt = (j: number) => s[p + j] - m;
  // 两个有序数列合起来的第 k 小（从 0 数）：每次各扔掉一半，O(log n)
  const kth = (k: number) => {
    let aOff = 0;
    let bOff = 0;
    const aLen = p;
    const bLen = len - p;
    for (;;) {
      if (aOff === aLen) return bAt(bOff + k);
      if (bOff === bLen) return aAt(aOff + k);
      if (k === 0) return Math.min(aAt(aOff), bAt(bOff));
      const half = (k + 1) >> 1;
      const ai = Math.min(aOff + half, aLen) - 1;
      const bi = Math.min(bOff + half, bLen) - 1;
      if (aAt(ai) <= bAt(bi)) { k -= ai - aOff + 1; aOff = ai + 1; } else { k -= bi - bOff + 1; bOff = bi + 1; }
    }
  };
  const h = len >> 1;
  return len % 2 ? kth(h) : (kth(h - 1) + kth(h)) / 2;
}
export const rollingMad = (x: Float64Array, n: number) => rollingSorted(x, n, madOfSorted);
/**
 * 稳健尺度（最近 n 根，含当根）：1.4826 × MAD；一半以上的值相同、MAD = 0 时改用 1.2533 × 平均绝对偏差（离中位数）——
 * 稳健 z 的常用补充规则（CBI 的吸收分量 A 常常正好等于 ±1，单边行情里 MAD 会是 0）。全都相同 → 0（z 记空）。
 */
export const rollingRobustScale = (x: Float64Array, n: number) => rollingSorted(x, n, s => {
  const madV = madOfSorted(s);
  if (madV > 0) return 1.4826 * madV;
  const m = medianOfSorted(s);
  let sum = 0;
  for (const v of s) sum += Math.abs(v - m);
  return 1.2533 * (sum / s.length);
});
/** 最近 n 根的和（含当根）：空值跳过，一个都没有记空。 */
export function rollingSum(x: Float64Array, n: number): Float64Array {
  const out = new Float64Array(x.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isFinite(x[i])) { sum += x[i]; count++; }
    const drop = i - n;
    if (drop >= 0 && Number.isFinite(x[drop])) { sum -= x[drop]; count--; }
    out[i] = count > 0 ? clean(sum) : Number.NaN;
  }
  return out;
}
/** 最近 n 根（含当根）的最大 / 最小值：空值跳过，一个都没有记空。 */
export function rollingExtreme(x: Float64Array, n: number, max: boolean): Float64Array {
  const out = new Float64Array(x.length);
  for (let t = 0; t < x.length; t++) {
    let best = Number.NaN;
    for (let k = 0; k < n && k <= t; k++) {
      const v = x[t - k];
      if (Number.isFinite(v) && (Number.isNaN(best) || (max ? v > best : v < best))) best = v;
    }
    out[t] = best;
  }
  return out;
}
/** 最近 n 根（含当根）y 对 x 的最小二乘斜率：两个都有值的根才算，少于 2 根或 x 没有变化记空。 */
export function rollingBeta(y: Float64Array, x: Float64Array, n: number): Float64Array {
  const out = new Float64Array(y.length);
  let sx = 0, sy = 0, sxy = 0, sxx = 0, c = 0;
  const ok = (i: number) => Number.isFinite(x[i]) && Number.isFinite(y[i]);
  for (let i = 0; i < y.length; i++) {
    if (ok(i)) { sx += x[i]; sy += y[i]; sxy += x[i] * y[i]; sxx += x[i] * x[i]; c++; }
    const drop = i - n;
    if (drop >= 0 && ok(drop)) { sx -= x[drop]; sy -= y[drop]; sxy -= x[drop] * y[drop]; sxx -= x[drop] * x[drop]; c--; }
    const den = c * sxx - sx * sx;
    out[i] = c >= 2 && den > 1e-18 * Math.max(1, c * sxx) ? clean((c * sxy - sx * sy) / den) : Number.NaN;
  }
  return out;
}
/** 时间衰减加权和：Σ_{k<n} 2^(−k ÷ h)·x_{t−k}（h、n 以根计）；空值跳过，一个都没有记空。 */
export function wsumBars(x: Float64Array, h: number, n: number): Float64Array {
  const out = new Float64Array(x.length);
  const w = Float64Array.from({ length: n }, (_, k) => 2 ** (-k / h));
  for (let t = 0; t < x.length; t++) {
    let sum = 0;
    let any = false;
    for (let k = 0; k < n && k <= t; k++) {
      const v = x[t - k];
      if (Number.isFinite(v)) { sum += w[k] * v; any = true; }
    }
    out[t] = any ? clean(sum) : Number.NaN;
  }
  return out;
}
/** 平均真实波幅（Wilder）：前 n 个真实波幅的平均起算，之后 ATRₜ = (ATRₜ₋₁·(n − 1) + TRₜ) ÷ n；缺值那根沿用上一根。 */
export function atrSeries(h: Float64Array, l: Float64Array, c: Float64Array, n: number): Float64Array {
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

const truthy = (x: number) => Number.isFinite(x) && x !== 0;
const clean = (x: number) => (Number.isFinite(x) ? x : Number.NaN);
const scalarArg = (v: Value, fn: string, what: string, line: number): number => {
  if (isSeries(v) || !Number.isFinite(v)) throw new FormulaError(`${fn} 的${what}要写一个具体的数`, line);
  return v;
};

function binary(op: string, a: Value, b: Value): Value {
  switch (op) {
    case '+': return map2(a, b, (x, y) => clean(x + y));
    case '-': return map2(a, b, (x, y) => clean(x - y));
    case '*': return map2(a, b, (x, y) => clean(x * y));
    case '/': return map2(a, b, (x, y) => clean(x / y));
    case '^': return map2(a, b, (x, y) => clean(x ** y));
    case '>': return map2(a, b, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x > y ? 1 : 0));
    case '<': return map2(a, b, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x < y ? 1 : 0));
    case '>=': return map2(a, b, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x >= y ? 1 : 0));
    case '<=': return map2(a, b, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x <= y ? 1 : 0));
    case '==': return map2(a, b, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x === y ? 1 : 0));
    case '!=': return map2(a, b, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x !== y ? 1 : 0));
    case 'and': return map2(a, b, (x, y) => (truthy(x) && truthy(y) ? 1 : 0));
    case 'or': return map2(a, b, (x, y) => (truthy(x) || truthy(y) ? 1 : 0));
    default: throw new Error(op);
  }
}

function call(name: string, args: Value[], line: number, barMinutes: number): Value {
  const [x, y, z] = args;
  switch (name) {
    case 'ln': case 'log': return map1(x, v => clean(Math.log(v)));
    case 'exp': return map1(x, v => clean(Math.exp(v)));
    case 'abs': return map1(x, Math.abs);
    case 'tanh': return map1(x, v => clean(Math.tanh(v)));
    case 'sqrt': return map1(x, v => clean(Math.sqrt(v)));
    case 'sign': return map1(x, v => (Number.isNaN(v) ? Number.NaN : Math.sign(v)));
    case 'max': return map2(x, y, (a, b) => (Number.isNaN(a) || Number.isNaN(b) ? Number.NaN : Math.max(a, b)));
    case 'min': return map2(x, y, (a, b) => (Number.isNaN(a) || Number.isNaN(b) ? Number.NaN : Math.min(a, b)));
    case 'nz': { const v = y == null ? 0 : scalarArg(y, 'nz', '替换值', line); return map1(x, a => (Number.isFinite(a) ? a : v)); }
    case 'has': return map1(x, a => (Number.isFinite(a) ? 1 : 0));
    case 'if': return map3(x, y, z, (c, a, b) => (Number.isNaN(c) ? Number.NaN : truthy(c) ? a : b));
    case 'prev': {
      const k = y == null ? 1 : scalarArg(y, 'prev', '根数', line);
      if (!Number.isInteger(k) || k < 0) throw new FormulaError('prev 的根数要是 0 或正整数', line);
      if (!isSeries(x)) return x;
      const out = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) out[i] = i >= k ? x[i - k] : Number.NaN;
      return out;
    }
    case 'ema': {
      const h = scalarArg(y, 'ema', '半衰期', line);
      if (!(h > 0)) throw new FormulaError('ema 的半衰期要大于 0（单位：小时）', line);
      const init = z == null ? null : scalarArg(z, 'ema', '初值', line);
      const rho = 2 ** (-barMinutes / (h * 60));
      if (!isSeries(x)) return x;
      const out = new Float64Array(x.length);
      let s: number | null = init;
      for (let i = 0; i < x.length; i++) {
        const v = x[i];
        if (Number.isFinite(v)) s = s == null ? v : rho * s + (1 - rho) * v;
        out[i] = s == null ? Number.NaN : s;
      }
      return out;
    }
    case 'median': case 'mad': case 'rsum': case 'rscale': {
      const h = scalarArg(y, name, '时长', line);
      if (!(h > 0)) throw new FormulaError(`${name} 的时长要大于 0（单位：小时）`, line);
      const n = barsForHours(h, barMinutes);
      if (!isSeries(x)) return name === 'median' ? x : name === 'mad' || name === 'rscale' ? 0 : x * n;
      return name === 'median' ? rollingMedian(x, n) : name === 'mad' ? rollingMad(x, n) : name === 'rscale' ? rollingRobustScale(x, n) : rollingSum(x, n);
    }
    case 'full': case 'peak': {
      const n = scalarArg(y, name, '根数', line);
      if (!Number.isInteger(n) || n < 1) throw new FormulaError(`${name} 的根数要是正整数`, line);
      if (!isSeries(x)) return x;
      const out = new Float64Array(x.length).fill(Number.NaN);
      let count = 0;
      for (let i = 0; i < x.length; i++) {
        if (Number.isFinite(x[i])) count++;
        if (i >= n && Number.isFinite(x[i - n])) count--;
        if (i >= n - 1 && count === n) {
          let v = x[i];
          if (name === 'peak') for (let j = i - n + 1; j < i; j++) v = Math.max(v, x[j]);
          out[i] = v;
        }
      }
      return out;
    }
    case 'highest': case 'lowest': case 'msum': {
      const n = scalarArg(y, name, '根数', line);
      if (!Number.isInteger(n) || n < 1) throw new FormulaError(`${name} 的根数要是正整数`, line);
      if (!isSeries(x)) return name === 'msum' ? x * n : x;
      return name === 'msum' ? rollingSum(x, n) : rollingExtreme(x, n, name === 'highest');
    }
    case 'beta': {
      const h = scalarArg(z, 'beta', '时长', line);
      if (!(h > 0)) throw new FormulaError('beta 的时长要大于 0（单位：小时）', line);
      const len = [x, y].find(isSeries)?.length;
      if (len == null) return Number.NaN;
      const asSeries = (v: Value) => (isSeries(v) ? v : new Float64Array(len).fill(v));
      return rollingBeta(asSeries(x), asSeries(y), barsForHours(h, barMinutes));
    }
    case 'clip': {
      const lo = scalarArg(y, 'clip', '下限', line);
      const hi = scalarArg(z, 'clip', '上限', line);
      return map1(x, v => (Number.isNaN(v) ? Number.NaN : Math.min(hi, Math.max(lo, v))));
    }
    case 'wsum': {
      const h = scalarArg(y, 'wsum', '半衰期', line);
      const n = scalarArg(z, 'wsum', '根数', line);
      if (!(h > 0)) throw new FormulaError('wsum 的半衰期要大于 0（单位：根）', line);
      if (!Number.isInteger(n) || n < 1) throw new FormulaError('wsum 的根数要是正整数', line);
      if (!isSeries(x)) { let t = 0; for (let j = 0; j < n; j++) t += 2 ** (-j / h); return x * t; }
      return wsumBars(x, h, n);
    }
    case 'atr': {
      const n = scalarArg(args[3], 'atr', '根数', line);
      if (!Number.isInteger(n) || n < 1) throw new FormulaError('atr 的根数要是正整数', line);
      const len = [x, y, z].find(isSeries)?.length;
      if (len == null) return Number.NaN;
      const asSeries = (v: Value) => (isSeries(v) ? v : new Float64Array(len).fill(v));
      return atrSeries(asSeries(x), asSeries(y), asSeries(z), n);
    }
    case 'avg': case 'ago': case 'zscore': case 'sd': {
      const h = scalarArg(y, name, '时长', line);
      if (!(h > 0)) throw new FormulaError(`${name} 的时长要大于 0（单位：小时）`, line);
      if (!isSeries(x)) return name === 'zscore' || name === 'sd' ? Number.NaN : x;
      const n = barsForHours(h, barMinutes);
      return name === 'avg' ? rollingMean(x, n) : name === 'ago' ? shiftBars(x, n) : name === 'sd' ? rollingSd(x, n) : rollingZScore(x, n);
    }
    case 'retain': {
      const [k, pr, e0, hArg, wArg] = args;
      const h = scalarArg(hArg, 'retain', '半衰期', line);
      if (!(h > 0)) throw new FormulaError('retain 的半衰期要大于 0（单位：小时）', line);
      const wHours = wArg == null ? 48 : scalarArg(wArg, 'retain', '窗口时长', line);
      if (!(wHours > 0)) throw new FormulaError('retain 的窗口时长要大于 0（单位：小时）', line);
      const len = [k, pr, e0].find(isSeries)?.length ?? 1;
      const asSeries = (v: Value) => (isSeries(v) ? v : new Float64Array(len).fill(v));
      const out = retainSum(asSeries(k), asSeries(pr), asSeries(e0), 2 ** (-barMinutes / (h * 60)), barsForHours(wHours, barMinutes));
      return [k, pr, e0].some(isSeries) ? out : out[0];
    }
    case 'sma': case 'sum': {
      const n = scalarArg(y, name, '根数', line);
      if (!Number.isInteger(n) || n < 1) throw new FormulaError(`${name} 的根数要是正整数`, line);
      if (!isSeries(x)) return name === 'sum' ? x * n : x;
      const out = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) {
        if (i < n - 1) { out[i] = Number.NaN; continue; }
        let s = 0;
        for (let j = i - n + 1; j <= i; j++) s += x[j];
        out[i] = clean(name === 'sum' ? s : s / n);
      }
      return out;
    }
    default: throw new FormulaError(`没有「${name}」这个函数`, line);
  }
}

function evaluateNode(n: Node, env: Map<string, Value>, barMinutes: number): Value {
  switch (n.k) {
    case 'num': return n.v;
    case 'var': {
      const v = env.get(n.name);
      if (v === undefined) throw new FormulaError(`不认识「${n.name}」`, n.line);
      return v;
    }
    case 'un': {
      const a = evaluateNode(n.a, env, barMinutes);
      return n.op === '-' ? map1(a, x => -x) : map1(a, x => (Number.isNaN(x) ? Number.NaN : truthy(x) ? 0 : 1));
    }
    case 'bin': return binary(n.op, evaluateNode(n.a, env, barMinutes), evaluateNode(n.b, env, barMinutes));
    case 'call': return call(n.name, n.args.map(a => evaluateNode(a, env, barMinutes)), n.line, barMinutes);
  }
}

/** 按顺序算完所有句子，返回最后一句的值。 */
export function evaluateProgram(program: Program, inputs: Readonly<Record<string, Value>>, options: { barMinutes?: number } = {}): Value {
  return evaluateProgramVars(program, inputs, options).last;
}

/** 同上，另外带回每个起了名的中间量（推断统计可以拿它们当因变量）。 */
export function evaluateProgramVars(program: Program, inputs: Readonly<Record<string, Value>>, options: { barMinutes?: number } = {}): { last: Value; vars: Map<string, Value> } {
  const env = new Map<string, Value>(Object.entries(inputs));
  const vars = new Map<string, Value>();
  const barMinutes = options.barMinutes ?? FORMULA_BAR_MINUTES;
  let last: Value = Number.NaN;
  for (const s of program.statements) {
    last = evaluateNode(s.expr, env, barMinutes);
    if (s.name) { env.set(s.name, last); vars.set(s.name, last); }
  }
  return { last, vars };
}

/** 公式里起了名的变量（按出现顺序，不重复），以及最后一句的名字（没起名为 null）。 */
export function programVariables(program: Program): { names: string[]; result: string | null } {
  const names: string[] = [];
  for (const st of program.statements) if (st.name && !names.includes(st.name)) names.push(st.name);
  return { names, result: program.statements.at(-1)?.name ?? null };
}

/** 结果取「最后一根」：序列取末尾，一个数就是它本身；空 → null。 */
export function lastValue(v: Value): number | null {
  const x = isSeries(v) ? (v.length ? v[v.length - 1] : Number.NaN) : v;
  return Number.isFinite(x) ? x : null;
}
