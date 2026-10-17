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
  { name: 'abs', min: 1, max: 1, usage: 'abs(x)', help: '绝对值' },
  { name: 'sqrt', min: 1, max: 1, usage: 'sqrt(x)', help: '平方根' },
  { name: 'sign', min: 1, max: 1, usage: 'sign(x)', help: '正 1、负 −1、零 0' },
  { name: 'max', min: 2, max: 2, usage: 'max(a, b)', help: '逐根取较大的' },
  { name: 'min', min: 2, max: 2, usage: 'min(a, b)', help: '逐根取较小的' },
  { name: 'prev', min: 1, max: 2, usage: 'prev(x, k)', help: '前 k 根的值（k 默认 1）；开头没有前 k 根的记空' },
  { name: 'ema', min: 2, max: 3, usage: 'ema(x, h, 初值)', help: '指数平滑，半衰期 h 小时（h 可写 hl = 上面选的半衰期）：yₜ = ρ·yₜ₋₁ + (1 − ρ)·xₜ，ρ = 2^(−周期 ÷ h)，周期 = 上面选的 K 线周期；x 为空的那根跳过；不给初值时从第一个非空值起算' },
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
    case 'avg': {
      const h = scalarArg(y, 'avg', '时长', line);
      if (!(h > 0)) throw new FormulaError('avg 的时长要大于 0（单位：小时）', line);
      if (!isSeries(x)) return x;
      // 过去 h 小时 = n 根（含当根），滑动求和；空值不计
      const n = Math.max(1, Math.round((h * 60) / barMinutes));
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
