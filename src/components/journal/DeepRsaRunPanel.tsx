/**
 * Deep RSA「运行分析」：第 3–5 步的入口、进度与结果（纯展示，运行由页面外壳负责）。
 * 【用户要求】左对齐紧凑、名字和数字挨着；每个结论标「已验证 / 待验证 / 检验未获支持」。
 */
import { Download, Loader2, Play, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBeijingTime } from '@/lib/timeFormat';
import { FEATURE_DEFINITIONS, type FeatureFamily } from '@/lib/deepRsa/features';
import type { DeepRsaRunResult, RunProgress, RunStage, RsaTarget, Verdict } from '@/lib/deepRsa/pipeline';
import { HALF_LIFE_CANDIDATES_H } from '@/lib/deepRsa/window';

export type RunStatus = 'idle' | 'running' | 'error' | 'cancelled';

export interface DeepRsaRunPanelProps {
  status: RunStatus;
  progress: RunProgress | null;
  result: DeepRsaRunResult | null;
  error: string | null;
  /** 预计要取行情的事件数（簇代表 + 背景时点）。 */
  plannedItems: number;
  canRun: boolean;
  onRun: () => void;
  onCancel: () => void;
  onDownload: () => void;
}

const STAGE_LABEL: Record<RunStage, string> = {
  events: '整理事件', fetch: '拉取 K 线', features: '计算特征', rsa: 'RSA 训练集检验', oos: '测试集检验',
  backtest_fetch: '拉取回测行情', backtest: '扫描与回测', done: '完成',
};

export const REP_LABEL: Record<FeatureFamily, string> = { price: '价格', orderFlow: '订单流', schelling: '谢林候选' };
export const TARGET_LABEL: Record<RsaTarget, string> = { label: '正 / 对照标签', outcome: '24h 最大涨幅' };

export const VERDICT_TONE: Record<Verdict, string> = {
  已验证: 'text-[#0B9F66] dark:text-[#0ECB81]',
  待验证: 'text-muted-foreground',
  检验未获支持: 'text-[#F6465D]',
};

const FEATURE_LABEL = Object.fromEntries(FEATURE_DEFINITIONS.map(d => [d.key, d.label]));

function num(value: number | null | undefined, digits = 3): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function pct(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function pValue(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return '—';
  return p < 0.001 ? '<0.001' : p.toFixed(3);
}

function N({ children }: { children: React.ReactNode }) {
  return <span className="font-mono tabular-nums text-foreground">{children}</span>;
}

function Sub({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-[12px] font-medium">{title}</h3>
        {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
      </div>
      {children}
    </div>
  );
}

const TH = 'py-1 pr-3 text-left font-normal whitespace-nowrap sm:pr-4';
const TD = 'py-1 pr-3 whitespace-nowrap sm:pr-4';

export function DeepRsaRunPanel({ status, progress, result, error, plannedItems, canRun, onRun, onCancel, onDownload }: DeepRsaRunPanelProps) {
  const running = status === 'running';
  return (
    <div className="space-y-4 text-[11.5px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {running ? (
          <button
            type="button"
            data-testid="deep-rsa-cancel"
            onClick={onCancel}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] hover:bg-muted"
          >
            <Square className="h-3 w-3" />取消
          </button>
        ) : (
          <button
            type="button"
            data-testid="deep-rsa-run"
            disabled={!canRun}
            onClick={onRun}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#F0B90B] px-2.5 text-[12px] font-medium text-black hover:bg-[#F0B90B]/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play className="h-3 w-3" />{result ? '重新运行' : '开始运行'}
          </button>
        )}
        {running && progress && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground" data-testid="deep-rsa-progress">
            <Loader2 className="h-3 w-3 animate-spin" />
            {STAGE_LABEL[progress.stage]}
            {progress.total > 0 && <> <N>{progress.done}</N> / <N>{progress.total}</N></>}
          </span>
        )}
        {!running && status === 'cancelled' && <span className="text-muted-foreground">已取消，结果未更新</span>}
        {!running && status === 'error' && <span className="text-[#F6465D]">运行失败：{error}</span>}
        {result && !running && (
          <>
            <span className="text-muted-foreground">
              上次运行 <span className="font-mono tabular-nums">{formatBeijingTime(result.finishedAt).slice(0, 16)}</span>
              <span className="max-sm:hidden"> · 用时 <N>{Math.round((result.finishedAt - result.startedAt) / 1000)}</N> 秒 · {result.codeVersion}</span>
            </span>
            <button type="button" onClick={onDownload} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <Download className="h-3 w-3" />下载结果 JSON
            </button>
          </>
        )}
      </div>

      {!result && !running && (
        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
          <li>在你的浏览器里直接取币安公开行情（与主图同一个接口），不需要币安账号或密钥；不写任何数据、不下单。</li>
          <li>约 <N>{plannedItems}</N> 个事件（去重后的战役簇 + 随机背景时点），每个取 t₀ 前 48h 至 t₀ 后 24h 的 5m K 线。</li>
          <li>一般 1–3 分钟；运行时别关这个页面，可以随时取消。</li>
        </ul>
      )}

      {result && <RunResult result={result} />}
    </div>
  );
}

function RunResult({ result }: { result: DeepRsaRunResult }) {
  const c = result.coverage;
  const s = result.split;
  return (
    <div className="space-y-5">
      <Sub title="数据">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          <span>战役 <N>{c.campaigns}</N> → 簇 <N>{c.clusters}</N></span>
          <span>标签：正 <N>{c.labeled.positive}</N> · 对照 <N>{c.labeled.control}</N></span>
          <span>背景时点 <N>{c.background}</N></span>
          <span>K 线拉取失败 <N>{c.failed.length}</N></span>
          <span>窗口覆盖率不足 <N>{c.lowCoverage}</N></span>
          <span>缺 24h 结果 <N>{c.outcomeMissing}</N></span>
          {c.missingTakerEvents > 0 && <span>缺主动买入量 <N>{c.missingTakerEvents}</N></span>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          <span>训练 <N>{s.train}</N></span>
          <span>验证 <N>{s.val}</N></span>
          <span>测试 <N>{s.test}</N></span>
          <span>隔离带剔除 <N>{s.embargoed}</N></span>
          {s.valCut != null && <span>验证起 <span className="font-mono tabular-nums">{formatBeijingTime(s.valCut).slice(0, 10)}</span></span>}
          {s.testCut != null && <span>测试起 <span className="font-mono tabular-nums">{formatBeijingTime(s.testCut).slice(0, 10)}</span></span>}
        </div>
        {c.failed.length > 0 && (
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">失败明细</summary>
            <ul className="mt-1 space-y-0.5 pl-4">
              {c.failed.slice(0, 50).map(f => <li key={f.id}><span className="text-foreground">{f.symbol}</span> {f.reason}</li>)}
              {c.failed.length > 50 && <li>…另 {c.failed.length - 50} 条见下载的 JSON</li>}
            </ul>
          </details>
        )}
      </Sub>

      <Sub title="第 3 步 · 特征对比" note={`训练集 · h = ${result.featureContrast.halfLifeHours} 小时 · 仅描述，未检验`}>
        <div className="max-w-full overflow-x-auto">
          <table>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className={TH}>特征</th><th className={TH}>正样本均值</th><th className={TH}>对照均值</th><th className={TH}>标准化差</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {result.featureContrast.rows.map(r => (
                <tr key={r.key} className="border-b border-border/40">
                  <td className={cn(TD, 'font-sans max-sm:whitespace-normal')}>{FEATURE_LABEL[r.key]}</td>
                  <td className={TD}>{num(r.posMean, 4)}</td>
                  <td className={TD}>{num(r.ctlMean, 4)}</td>
                  <td className={cn(TD, r.smd != null && Math.abs(r.smd) >= 0.5 && 'font-medium')}>{num(r.smd, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sub>

      <Sub title="第 4 步 · RSA（训练集）" note={`ρ 与 Holm 校正 p · ${result.permutations} 次置换 · 方框 = 验证集选定的 h`}>
        <div className="max-w-full overflow-x-auto">
          <table>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className={TH}>表征</th><th className={TH}>目标</th>
                {HALF_LIFE_CANDIDATES_H.map(h => <th key={h} className={TH}>h = {h}</th>)}
                <th className={TH}>结果</th>
              </tr>
            </thead>
            <tbody>
              {result.selection.map(sel => (
                <tr key={`${sel.representation}-${sel.target}`} className="border-b border-border/40">
                  <td className={TD}>{REP_LABEL[sel.representation]}</td>
                  <td className={cn(TD, 'text-muted-foreground')}>{TARGET_LABEL[sel.target]}</td>
                  {HALF_LIFE_CANDIDATES_H.map(h => {
                    const row = result.panel.find(r => r.representation === sel.representation && r.target === sel.target && r.halfLifeHours === h);
                    return (
                      <td key={h} className={TD}>
                        <span className={cn('inline-block rounded px-1 font-mono tabular-nums', sel.selectedH === h && 'ring-1 ring-border')}>
                          {num(row?.rho, 3)} <span className="text-muted-foreground">p {pValue(row?.pHolm)}</span>
                        </span>
                      </td>
                    );
                  })}
                  <td className={cn(TD, sel.trainPassed ? 'text-muted-foreground' : VERDICT_TONE['检验未获支持'])}>
                    {sel.trainPassed ? '通过 → 测试集' : sel.selectedH == null ? '验证集算不出' : '检验未获支持'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sub>

      <Sub title="第 5 步 · 样本外与回测">
        {result.oos.length === 0 ? (
          <div className="text-muted-foreground">训练集没有通过 Holm 校正的项：按事先约定不做测试集检验和交易回测。</div>
        ) : (
          <table>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className={TH}>表征</th><th className={TH}>目标</th><th className={TH}>h</th><th className={TH}>测试集 ρ</th><th className={TH}>Holm p</th><th className={TH}>事件</th><th className={TH}>结论</th>
              </tr>
            </thead>
            <tbody>
              {result.oos.map(r => (
                <tr key={`${r.representation}-${r.target}`} className="border-b border-border/40">
                  <td className={TD}>{REP_LABEL[r.representation]}</td>
                  <td className={cn(TD, 'text-muted-foreground')}>{TARGET_LABEL[r.target]}</td>
                  <td className={cn(TD, 'font-mono tabular-nums')}>{r.halfLifeHours}</td>
                  <td className={cn(TD, 'font-mono tabular-nums')}>{num(r.rho)}</td>
                  <td className={cn(TD, 'font-mono tabular-nums')}>{pValue(r.pHolm)}</td>
                  <td className={cn(TD, 'font-mono tabular-nums')}>{r.nEvents}</td>
                  <td className={cn(TD, VERDICT_TONE[r.verdict])}>{r.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {result.oos.length > 0 && <Backtest result={result} />}
      </Sub>
    </div>
  );
}

function Backtest({ result }: { result: DeepRsaRunResult }) {
  const b = result.backtest;
  if (b.skippedReason) return <div className="text-muted-foreground">回测：{b.skippedReason}</div>;
  const main = b.scenarios!.find(s => s.slippage === 0.0005)!;
  const others = b.scenarios!.filter(s => s.slippage !== 0.0005);
  return (
    <div className="space-y-1.5 pt-1">
      <div className="text-muted-foreground">
        回测：{REP_LABEL[b.representation!]}表征 · h = {b.halfLifeHours} · {formatBeijingTime(b.fromMs!).slice(0, 10)} 至 {formatBeijingTime(b.toMs!).slice(0, 10)}
        · 标的 <N>{b.symbols!.length}</N>{b.droppedSymbols!.length > 0 && <>（另 {b.droppedSymbols!.length} 个超出上限未测）</>}
        · 真实资金费 <N>{b.fundingReal}</N> 个标的 · 24h 到期出场 · 每边手续费 0.05% · 滑点 5 个基点
      </div>
      <div className="max-w-full overflow-x-auto">
        <table>
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className={TH}>策略</th><th className={TH}>交易</th><th className={TH}>平均净收益</th><th className={TH}>95% 区间</th>
              <th className={TH}>胜率</th><th className={TH}>盈亏因子</th><th className={TH}>最大回撤</th>
              {others.map(o => <th key={o.slippage} className={TH}>滑点 {o.slippage * 10000} 基点</th>)}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {main.strategies.map(st => (
              <tr key={st.name} className="border-b border-border/40">
                <td className={cn(TD, 'font-sans')}>{st.name}</td>
                <td className={TD}>{st.summary.n}{st.skipped > 0 && <span className="text-muted-foreground"> / {st.signals}</span>}</td>
                <td className={cn(TD, st.summary.meanNet > 0 ? 'text-[#0ECB81]' : st.summary.meanNet < 0 ? 'text-[#F6465D]' : '')}>{pct(st.summary.meanNet)}</td>
                <td className={TD}>{pct(st.summary.meanNetCi95[0])} ~ {pct(st.summary.meanNetCi95[1])}</td>
                <td className={TD}>{pct(st.summary.winRate, 1)}</td>
                <td className={TD}>{num(st.summary.profitFactor, 2)}</td>
                <td className={TD}>{pct(st.summary.maxDrawdown)}</td>
                {others.map(o => <td key={o.slippage} className={TD}>{pct(o.strategies.find(x => x.name === st.name)?.summary.meanNet)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-muted-foreground">
        回测结论（5 个基点：模型平均净收益 95% 区间下限 &gt; 0，且高于两条基线）：
        <span className={VERDICT_TONE[b.verdict!]}>{b.verdict}</span>
      </div>
    </div>
  );
}
