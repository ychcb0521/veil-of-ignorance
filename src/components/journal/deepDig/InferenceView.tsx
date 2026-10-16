/**
 * Deep dig 推断统计：运行前的「方法 + 命令」窗口，以及按命令逐行出来的结果。
 * 【用户要求】2026-10-16「“推断统计”运行之前，也要给出命令行，也需要有可选择方法的选项（比如 t 检验、回归分析、多元线性回归、
 * 方差分析、RSA、机器学习），并且新增可以人为设计方法的命令窗口」。
 *   - 方法：勾上 = 命令里加一行默认写法，取消 = 删掉这个方法的行；
 *   - 命令：一行一个方法，可直接改、自己写；写错的行即时标出来；
 *   - 结果：每行一张卡片，先写「过程」，再给数字。
 */
import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEEP_DIVE_ALPHA, type WelchResult } from '@/lib/deepRsa/deepDive';
import { DEFAULT_COMMANDS, methodsIn, METHOD_PRESETS, parseCommands, ROW_VARIABLES, toggleMethod, type InferenceBlock } from '@/lib/deepDig/commands';
import { pText } from '@/lib/deepDig/analysis';

const GREEN = 'text-[#0B9F66] dark:text-[#0ECB81]';
const RED = 'text-[#F6465D]';
const TH = 'py-1 pr-4 text-left font-normal whitespace-nowrap';
const TD = 'py-1 pr-4 whitespace-nowrap';
const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const f2 = (v: number | null | undefined, d = 2) => (finite(v) ? (Number(v.toFixed(d)) === 0 ? (0).toFixed(d) : v.toFixed(d)) : '—');
const N = ({ children, className }: { children: React.ReactNode; className?: string }) => <span className={cn('font-mono tabular-nums text-foreground', className)}>{children}</span>;
const Code = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-muted px-1 py-px font-mono text-[11px] text-foreground">{children}</code>;
const signTone = (v: number | null | undefined, p?: number) => (!finite(v) || v === 0 || (p != null && !(p < DEEP_DIVE_ALPHA)) ? undefined : v > 0 ? GREEN : RED);
/** 结果变量是百分数的，加上 %。 */
const PCT_VARS = new Set(['endRet', 'maxUp', 'maxDown', 'vol']);
const VAR_NAME: Record<string, string> = { endRet: '24h 期末收益', maxUp: '24h 最大涨幅', maxDown: '24h 最大跌幅', vol: '观察窗波动率', X: 'X' };

// ===================== 方法 + 命令 =====================

export function CommandPanel({ commands, onChange }: { commands: string; onChange: (text: string) => void }) {
  const [help, setHelp] = useState(false);
  const parsed = useMemo(() => parseCommands(commands), [commands]);
  const on = useMemo(() => methodsIn(commands), [commands]);
  return (
    <div className="max-w-[720px] space-y-2 text-[11.5px]" data-testid="deep-dig-commands">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-[32px] shrink-0 text-muted-foreground">方法</span>
        {METHOD_PRESETS.map(m => {
          const active = on.has(m.key);
          return (
            <button
              key={m.key}
              type="button"
              aria-pressed={active}
              title={m.help}
              data-testid={`deep-dig-method-${m.key}`}
              onClick={() => onChange(toggleMethod(commands, m.key, !active))}
              className={cn('inline-flex h-6 items-center gap-1 rounded-full border px-2 transition-colors',
                active ? 'border-foreground/25 bg-card font-medium text-foreground' : 'border-border/70 text-muted-foreground hover:text-foreground')}
            >
              {active && <Check className="h-3 w-3" />}{m.label}
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        <span className="w-[32px] shrink-0 pt-1.5 text-muted-foreground">命令</span>
        <div className="min-w-0 flex-1 space-y-1">
          <textarea
            value={commands}
            onChange={e => onChange(e.target.value)}
            rows={Math.min(16, Math.max(4, commands.split('\n').length + 1))}
            spellCheck={false}
            wrap="off"
            aria-label="推断统计命令"
            data-testid="deep-dig-commands-input"
            className="w-full overflow-x-auto whitespace-pre rounded-md border border-border bg-muted/30 px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed outline-none focus:border-foreground/40"
          />
          {parsed.errors.length > 0 && (
            <ul className={cn('space-y-0.5', RED)} data-testid="deep-dig-commands-errors">
              {parsed.errors.map(e => <li key={e.line}>第 {e.line} 行：{e.message}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            <button type="button" onClick={() => setHelp(h => !h)} className="inline-flex items-center gap-0.5 hover:text-foreground" data-testid="deep-dig-commands-help-toggle">
              {help ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}可用写法
            </button>
            {commands !== DEFAULT_COMMANDS && (
              <button type="button" onClick={() => onChange(DEFAULT_COMMANDS)} className="inline-flex items-center gap-1 hover:text-foreground" data-testid="deep-dig-commands-default">
                <RotateCcw className="h-3 w-3" />恢复默认命令
              </button>
            )}
            <span>{parsed.commands.length} 个方法 · 命令跟账号走</span>
          </div>
          {help && <CommandHelp />}
        </div>
      </div>
    </div>
  );
}

function CommandHelp() {
  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed" data-testid="deep-dig-commands-help">
      <div>
        <span className="text-muted-foreground">变量（每个事件一个值）：</span>
        {ROW_VARIABLES.map((v, i) => <span key={v.name}>{i ? '；' : ''}<Code>{v.name}</Code> {v.label}</span>)}。
        可以写成式子，如 <Code>X^2</Code>、<Code>ln(abs(X))</Code>（写法同特征值公式）。
      </div>
      <div>
        <span className="text-muted-foreground">组：</span><Code>实验组</Code> <Code>对照组</Code> <Code>其他</Code> <Code>随机</Code> <Code>全部</Code>，可用 + 合并，如 <Code>实验组+对照组</Code>。
        <Code>~</Code> 右边与 rsa 的第一个参数里，顶层的 + 分隔多个变量，要相加请加括号 <Code>(a + b)</Code>。<Code>#</Code> 后面是注释。
      </div>
      <table>
        <tbody>
          {METHOD_PRESETS.filter(m => m.key !== 'mregress').map(m => (
            <tr key={m.key} className="align-top">
              <td className="whitespace-nowrap py-0.5 pr-3 text-foreground">{m.key === 'regress' ? '回归 / 多元回归' : m.label}</td>
              <td className="py-0.5 text-muted-foreground">{m.help}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-muted-foreground">
        <span>例：</span>
        {['ttest(X, 实验组, 随机)', 'regress(endRet ~ X + vol + 实验组)', 'anova(X^2, 实验组, 对照组)', 'rsa(X + vol, endRet)', 'ml(实验组 ~ X, model=knn, k=9)'].map(e => <Code key={e}>{e}</Code>)}
      </div>
    </div>
  );
}

// ===================== 结果 =====================

const PROCESS: Record<Exclude<InferenceBlock['kind'], 'error'>, (b: InferenceBlock) => string> = {
  ttest: b => (b.kind === 'ttest' ? `Welch t 检验（不假定两组方差相等），双侧，α = 0.05。均值差 = ${b.a} − ${b.b}；Hedges g 是效应量（约 0.2 小、0.5 中、0.8 大）。` : ''),
  mannwhitney: b => (b.kind === 'mannwhitney' ? `只看排名、不看具体数值，不怕极端值。AUC = 随机挑一个${b.a}事件和一个${b.b}事件，前者的值更高的概率；0.5 = 分不开。p：打乱组别 ${b.permutations} 次；区间：按币整簇重抽样。` : ''),
  spearman: b => (b.kind === 'spearman' ? `发现集 = 时间上前 80%：算 ρ，按月内打乱 ${b.permutations} 次求 p，几个结果一起 Holm 校正；${b.control ? `「控制」= 扣掉 ${b.control} 后的偏相关，回答是不是只是它的影响；` : ''}发现集通过的项，到确认集（最后 20%）按同一方向复核，同向且 p < 0.05 → 已验证。` : ''),
  quintiles: () => '把变量从低到高分五档（切点取发现集），看每档之后的平均结果：看是否单调、差距是否大于噪声。描述，不做判定。',
  regress: () => '最小二乘：y = β₀ + β₁x₁ + …。β = 自变量增加 1 个单位时 y 平均变化多少；t、p 检验 β 是否为 0；R² = 自变量能解释 y 变化的比例；F 检验所有自变量是否一起有用。',
  anova: () => '单因素方差分析：几组的均值是否都相等。F = 组间差异 ÷ 组内差异；η² = 组别能解释的差异比例（约 0.01 小、0.06 中、0.14 大）。',
  rsa: b => (b.kind === 'rsa' ? `表征相似性分析：两两比较事件，算「特征距离」与「${b.target === '组别' ? '组别是否相同' : '结果距离'}」两张表的 Spearman 相关 r；r > 0 = 特征越相近的事件，${b.target === '组别' ? '越可能同组' : '结果越相近'}。p：打乱对应关系 ${b.permutations} 次（单侧）。` : ''),
  ml: b => (b.kind === 'ml' ? `${b.model === 'knn' ? 'k 近邻' : '逻辑回归'}分类，${b.cv} 折交叉验证：每次用其余各折训练、预测留出的一折，全部预测完算样本外 AUC（0.5 = 瞎猜）。平衡准确率 = 两类各自猜对比例的平均。p：打乱标签重做一遍，看样本外 AUC 有多常见。` : ''),
};

function Verdict({ p, yes = '差异显著', no = '差异不显著' }: { p: number; yes?: string; no?: string }) {
  if (!finite(p)) return null;
  const ok = p < DEEP_DIVE_ALPHA;
  return <span className={cn('rounded px-1.5 py-px text-[10.5px]', ok ? 'bg-[#0ECB81]/10 text-[#0B9F66] dark:text-[#0ECB81]' : 'bg-muted text-muted-foreground')}>{ok ? yes : no}</span>;
}

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[11.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="whitespace-nowrap text-muted-foreground">{k}</dt>
          <dd className="font-mono tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const welchRows = (t: WelchResult, a: string, b: string): [string, React.ReactNode][] => [
  [a, <><N>{t.nA}</N> 个 · 均值 <N>{f2(t.meanA)}</N> ± <N>{f2(t.sdA)}</N></>],
  [b, <><N>{t.nB}</N> 个 · 均值 <N>{f2(t.meanB)}</N> ± <N>{f2(t.sdB)}</N></>],
  ['均值差', <><N className={signTone(t.diff, t.p)}>{f2(t.diff)}</N> <span className="text-muted-foreground">95% 区间 {t.ci95 ? `${f2(t.ci95[0])} ~ ${f2(t.ci95[1])}` : '—'}</span></>],
  ['t（自由度）', <>{f2(t.t)}（{finite(t.df) ? t.df.toFixed(0) : '—'}）</>],
  ['p', <N>{pText(t.p)}</N>],
  ['Hedges g', <>{f2(t.hedgesG)}</>],
];

const varLabel = (src: string) => VAR_NAME[src] ?? src;
const unitOf = (src: string) => (PCT_VARS.has(src) ? '%' : '');

export function InferenceResults({ blocks }: { blocks: readonly InferenceBlock[] }) {
  if (!blocks.length) return <div className="text-[11.5px] text-muted-foreground">命令里没有方法。</div>;
  return (
    <div className="space-y-6" data-testid="deep-dig-infer">
      {blocks.map((b, i) => (
        <section key={`${b.line}-${i}`} className="space-y-2" data-testid={`deep-dig-block-${b.kind}`}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-[12.5px] font-medium">{i + 1}. {b.title}</h3>
            <code className="font-mono text-[11px] text-muted-foreground">{b.call}</code>
            {b.kind === 'ttest' && <Verdict p={b.result.p} />}
            {b.kind === 'mannwhitney' && <Verdict p={b.p} />}
            {b.kind === 'regress' && <Verdict p={b.pF} yes="整体显著" no="整体不显著" />}
            {b.kind === 'anova' && <Verdict p={b.p} />}
            {b.kind === 'rsa' && <Verdict p={b.p} yes="有对应" no="看不出对应" />}
            {b.kind === 'ml' && <Verdict p={b.p} yes="样本外能区分" no="样本外分不开" />}
          </div>
          {b.kind !== 'error' && <p className="max-w-[720px] text-[11.5px] leading-relaxed text-muted-foreground">{PROCESS[b.kind](b)}</p>}
          <BlockBody b={b} />
        </section>
      ))}
    </div>
  );
}

function BlockBody({ b }: { b: InferenceBlock }) {
  switch (b.kind) {
    case 'error':
      return <div className={cn('text-[11.5px]', RED)} data-testid="deep-dig-block-error-message">第 {b.line} 行：{b.message}</div>;
    case 'ttest':
      return (
        <KV rows={[...welchRows(b.result, b.a, b.b),
          ['分期', <span className="font-sans text-muted-foreground">发现期均值差 <N>{f2(b.byPeriod.discovery.diff)}</N>（p {pText(b.byPeriod.discovery.p)}）· 确认期 <N>{f2(b.byPeriod.confirmation.diff)}</N>（p {pText(b.byPeriod.confirmation.p)}）</span>]]} />
      );
    case 'mannwhitney':
      return (
        <KV rows={[
          ['AUC', <><N>{f2(b.auc, 3)}</N> <span className="text-muted-foreground">95% 区间 {b.ci ? `${b.ci[0].toFixed(2)} ~ ${b.ci[1].toFixed(2)}` : '—'}</span></>],
          ['中位数', <>{b.a} <N>{f2(b.medianA)}</N> · {b.b} <N>{f2(b.medianB)}</N></>],
          ['样本', <>{b.a} <N>{b.nA}</N> · {b.b} <N>{b.nB}</N></>],
          ['p', <N>{pText(b.p)}</N>],
        ]} />
      );
    case 'spearman':
      return (
        <>
          <table className="text-[11.5px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className={TH}>结果</th><th className={TH}>ρ</th><th className={TH}>Holm p</th>{b.control && <th className={TH}>控制 {b.control}</th>}<th className={cn(TH, 'pr-0')}>确认集</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {b.rows.map(r => (
                <tr key={r.target} className="border-t border-border/40">
                  <td className={cn(TD, 'font-sans')}>{varLabel(r.target)}</td>
                  <td className={cn(TD, signTone(r.rho, r.pHolm))}>
                    {f2(r.rho)}{r.ci && <span className="ml-1 text-[10.5px] text-muted-foreground max-sm:hidden">[{r.ci[0].toFixed(2)}, {r.ci[1].toFixed(2)}]</span>}
                  </td>
                  <td className={TD}>{pText(r.pHolm)}</td>
                  {b.control && <td className={cn(TD, 'text-muted-foreground')}>{f2(r.rhoPartial)}{finite(r.rhoPartial) && <span className="max-sm:hidden">（p {pText(r.pPartial)}）</span>}</td>}
                  <td className={cn(TD, 'pr-0 font-sans')}>
                    {r.confirmation ? (
                      <span className={r.confirmation.verdict === '已验证' ? GREEN : RED}>
                        {r.confirmation.verdict}
                        <span className="ml-1 font-mono text-[10.5px] text-muted-foreground max-sm:hidden">ρ {f2(r.confirmation.rho)}{r.confirmation.verdict === '已验证' && r.confirmation.survivesControl === false ? ` · 控制 ${b.control} 后不成立` : ''}</span>
                      </span>
                    ) : <span className="text-muted-foreground">未进入</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[11px] text-muted-foreground">发现集 <N>{b.discovery}</N> · 确认集 <N>{b.confirmation}</N></div>
        </>
      );
    case 'quintiles':
      return b.bins.length ? (
        <table className="text-[11.5px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className={TH}>档</th><th className={TH}>{b.x} 范围</th><th className={TH}>n</th>
              {b.targets.map((t, k) => <th key={t} className={cn(TH, k === b.targets.length - 1 && 'pr-0')}>{varLabel(t).replace('24h ', '')}</th>)}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {b.bins.map(bin => (
              <tr key={bin.q} className="border-t border-border/40">
                <td className={TD}>Q{bin.q}</td>
                <td className={cn(TD, 'text-muted-foreground')}>{f2(bin.lo, 1)} ~ {f2(bin.hi, 1)}</td>
                <td className={TD}>{bin.n}</td>
                {bin.means.map((m, k) => <td key={k} className={cn(TD, k === bin.means.length - 1 && 'pr-0', signTone(finite(m) && Math.abs(m) >= 0.05 ? m : 0))}>{f2(m, unitOf(b.targets[k]) ? 1 : 2)}{finite(m) ? unitOf(b.targets[k]) : ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="text-[11.5px] text-muted-foreground">样本不够分档</div>;
    case 'regress':
      return (
        <>
          <div className="text-[11.5px] text-muted-foreground">
            因变量 {varLabel(b.y)}{unitOf(b.y) ? '（%）' : ''} · 样本 {b.subset} <N>{b.n}</N> · R² <N>{f2(b.r2, 3)}</N> · 调整 R² <N>{f2(b.adjR2, 3)}</N> · F(<N>{b.df1}</N>, <N>{b.df2}</N>) = <N>{f2(b.f)}</N> · p <N>{pText(b.pF)}</N>
          </div>
          <table className="text-[11.5px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className={TH}>项</th><th className={TH}>β</th><th className={TH}>标准误</th><th className={TH}>t</th><th className={TH}>p</th><th className={cn(TH, 'pr-0 max-sm:hidden')}>95% 区间</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {b.terms.map(t => (
                <tr key={t.term} className="border-t border-border/40">
                  <td className={cn(TD, 'font-sans')}>{t.term}</td>
                  <td className={cn(TD, t.term !== '截距' ? signTone(t.beta, t.p) : undefined)}>{f2(t.beta, 3)}</td>
                  <td className={cn(TD, 'text-muted-foreground')}>{f2(t.se, 3)}</td>
                  <td className={TD}>{f2(t.t)}</td>
                  <td className={TD}>{pText(t.p)}</td>
                  <td className={cn(TD, 'pr-0 text-muted-foreground max-sm:hidden')}>{f2(t.ci[0], 3)} ~ {f2(t.ci[1], 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
    case 'anova':
      return (
        <>
          <table className="text-[11.5px]">
            <thead>
              <tr className="text-muted-foreground"><th className={TH}>组</th><th className={TH}>n</th><th className={TH}>均值</th><th className={cn(TH, 'pr-0')}>标准差</th></tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {b.groups.map(g => (
                <tr key={g.name} className="border-t border-border/40">
                  <td className={cn(TD, 'font-sans')}>{g.name}</td><td className={TD}>{g.n}</td><td className={TD}>{f2(g.mean)}</td><td className={cn(TD, 'pr-0')}>{f2(g.sd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[11.5px] text-muted-foreground">F(<N>{b.df1}</N>, <N>{b.df2}</N>) = <N>{f2(b.f)}</N> · p <N>{pText(b.p)}</N> · η² <N>{f2(b.eta2, 3)}</N></div>
        </>
      );
    case 'rsa':
      return (
        <KV rows={[
          ['特征', <span className="font-sans">{b.features.join(' + ')}</span>],
          ['对照', <span className="font-sans">{b.target === '组别' ? '组别是否相同' : varLabel(b.target)}</span>],
          ['样本', <>{b.subset} <N>{b.n}</N> 个 · <N>{b.pairs}</N> 对</>],
          ['r', <N className={signTone(b.r, b.p)}>{f2(b.r, 3)}</N>],
          ['p', <N>{pText(b.p)}</N>],
        ]} />
      );
    case 'ml':
      return (
        <KV rows={[
          ['任务', <span className="font-sans">{b.features.join(' + ')} → 是否{b.target}（样本 {b.subset}）</span>],
          ['样本', <>{b.target} <N>{b.nPos}</N> · 其余 <N>{b.nNeg}</N></>],
          ['样本外 AUC', <N>{f2(b.auc, 3)}</N>],
          ['平衡准确率', <N>{finite(b.balancedAccuracy) ? `${(b.balancedAccuracy * 100).toFixed(0)}%` : '—'}</N>],
          ['p', <N>{pText(b.p)}</N>],
          ...(b.coefficients ? [['系数（标准化）', <span className="font-sans">{b.coefficients.map((c, k) => <span key={c.term}>{k ? '；' : ''}{c.term} <N className={signTone(c.beta)}>{f2(c.beta)}</N></span>)}</span>] as [string, React.ReactNode]] : []),
        ]} />
      );
  }
}
