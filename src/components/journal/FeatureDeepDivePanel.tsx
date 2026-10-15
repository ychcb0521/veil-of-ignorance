/**
 * Deep RSA 第 6 步「特征深挖」：加权主动买卖失衡 · 失衡的近期偏移 · 谢林候选。
 * 【用户要求】「给我定义、分析方案、统计方法、操作流程，让我一步一步点击即可」：
 * 上面是定义与步骤；跑完后结果按 A → G 一节一节点开，每节先写「怎么读」。
 */
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, Play, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBeijingTime } from '@/lib/timeFormat';
import {
  DEEP_DIVE_ALPHA, DEEP_DIVE_FEATURES, DEEP_DIVE_PRIMARY_H, DEEP_DIVE_TARGETS,
  type DeepDiveFeatureKey, type DeepDiveTargetKey, type FeatureDeepDiveResult,
} from '@/lib/deepRsa/deepDive';
import type { RunProgress, RunStage } from '@/lib/deepRsa/pipeline';
import { VERDICT_TONE, type RunStatus } from '@/components/journal/DeepRsaRunPanel';

const FEATURE_NAME = Object.fromEntries(DEEP_DIVE_FEATURES.map(f => [f.key, f.name])) as Record<DeepDiveFeatureKey, string>;
const TARGET_NAME = Object.fromEntries(DEEP_DIVE_TARGETS.map(t => [t.key, t.name])) as Record<DeepDiveTargetKey, string>;

const STAGE_LABEL: Partial<Record<RunStage, string>> = {
  events: '整理事件', fetch: '拉取 K 线', features: '计算特征', rsa: '统计检验', done: '完成',
};

const GROUP_LABEL = { all: '全部', campaign: '战役时点', background: '随机背景', positive: '正样本', control: '对照' } as const;

const TH = 'py-1 pr-3 text-left font-normal whitespace-nowrap sm:pr-4';
const TD = 'py-1 pr-3 whitespace-nowrap sm:pr-4';

function num(v: number | null | undefined, d = 3): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(d);
}
/** 对数收益按百分数读（ln 近似涨跌幅）。 */
function pctLog(v: number | null | undefined, d = 2): string {
  return v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`;
}
function pv(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return '—';
  return p < 0.001 ? '<0.001' : p.toFixed(3);
}
function ci(v: [number, number] | null, d = 2, f: (x: number, d: number) => string = num): string {
  return v ? `${f(v[0], d)} ~ ${f(v[1], d)}` : '—';
}
const N = ({ children }: { children: React.ReactNode }) => <span className="font-mono tabular-nums text-foreground">{children}</span>;
const rhoTone = (v: number, p: number) => (p < DEEP_DIVE_ALPHA ? (v > 0 ? 'text-[#0B9F66] dark:text-[#0ECB81]' : 'text-[#F6465D]') : 'text-foreground/80');

const SECTIONS = [
  { id: 'A', title: '数据与分布', how: '先看样本够不够、各组的特征大致在什么范围。正样本太少时后面的标签比较只能当描述。' },
  { id: 'B', title: '与 24h 客观结果的关系（发现集）', how: '主检验。ρ > 0 = 特征越高，结果越大。Holm 校正后 p < 0.05 才算通过；看「控制波动率后」那一列判断是不是只是波动率。最大跌幅是阴性对照：如果它也明显「相关」，多半只是波动率。' },
  { id: 'C', title: '样本外确认（确认集，只读一次）', how: '发现集通过的项，在最后 20% 的时间段按同一方向再检验一次。同方向且校正后 p < 0.05 → 已验证。' },
  { id: 'D', title: '五分位分档', how: '把特征从低到高分五档（切点取发现集），看每档之后 24h 的平均结果。看是否单调、差距是否大于区间宽度。描述，不做判定。' },
  { id: 'E', title: '能否分开你的正 / 对照战役', how: 'AUC = 随机挑一个正样本和一个对照，正样本特征更高的概率。0.5 = 分不开，> 0.5 = 正样本偏高，< 0.5 = 偏低。正样本少，区间会很宽。' },
  { id: 'F', title: '稳健性', how: '同一个关系在战役时点、随机背景里分别是否同向；加权特征换半衰期（2 / 6 / 12 小时）是否同向。方向乱跳就说明不稳。' },
  { id: 'G', title: '谢林 × 失衡交叉', how: '现价在 12h VWAP 上方 / 下方 × 近期主动买 / 卖占优，四格各自之后 24h 的平均结果，以及你的正 / 对照战役落在哪一格。描述，用来提出下一轮假设。' },
] as const;

export interface FeatureDeepDivePanelProps {
  status: RunStatus;
  progress: RunProgress | null;
  result: FeatureDeepDiveResult | null;
  error: string | null;
  canRun: boolean;
  /** 战役分组读完没有（步骤 ① 的状态）。 */
  groupingReady: boolean;
  onRun: () => void;
  onCancel: () => void;
  onDownload: () => void;
}

export function FeatureDeepDivePanel({ status, progress, result, error, canRun, groupingReady, onRun, onCancel, onDownload }: FeatureDeepDivePanelProps) {
  const running = status === 'running';
  const [section, setSection] = useState(0);
  const step = (n: number, done: boolean, active: boolean, children: React.ReactNode) => (
    <li className="flex items-start gap-2">
      <span className={cn('mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] tabular-nums',
        done ? 'border-[#0B9F66] bg-[#0B9F66]/10 text-[#0B9F66] dark:border-[#0ECB81] dark:text-[#0ECB81]' : active ? 'border-[#F0B90B] text-[#B7860B] dark:text-[#F0B90B]' : 'border-border text-muted-foreground')}>{n}</span>
      <div className="min-w-0">{children}</div>
    </li>
  );

  return (
    <div className="space-y-4 text-[11.5px]" data-testid="deep-dive-panel">
      {/* 定义 */}
      <div className="space-y-1.5">
        <h3 className="text-[12px] font-medium">三个特征的定义</h3>
        <div className="space-y-2">
          {DEEP_DIVE_FEATURES.map(f => (
            <div key={f.key} className="space-y-0.5" data-testid={`deep-dive-def-${f.key}`}>
              <div><span className="font-medium text-foreground">{f.name}</span> <span className="font-mono text-[10.5px] text-muted-foreground">{f.key}</span></div>
              <div className="text-foreground/80">{f.definition}</div>
              <div className="font-mono text-[10.5px] text-muted-foreground">{f.formula}</div>
              <div className="text-muted-foreground">{f.reading}{f.weighted ? `；主分析半衰期 h = ${DEEP_DIVE_PRIMARY_H} 小时` : ''}</div>
            </div>
          ))}
          <div className="text-muted-foreground">谢林候选 c（偏离人工兜底价）：战役样本没有兜底价，只报可用场数。</div>
        </div>
        <div className="pt-1 text-muted-foreground">
          客观结果（与你的操作无关，从 t₀ 后第一根 5m K 线开盘价进场）：
          {DEEP_DIVE_TARGETS.map((t, i) => <span key={t.key}>{i ? '；' : ''}<span className="text-foreground/85">{t.name}</span> = {t.reading}</span>)}。
        </div>
      </div>

      {/* 步骤 */}
      <div className="space-y-1.5">
        <h3 className="text-[12px] font-medium">操作步骤</h3>
        <ol className="space-y-1.5">
          {step(1, groupingReady, !groupingReady, <>等「暂定分组」读完（战役列表读完前按钮是灰的）。{groupingReady ? <span className="text-[#0B9F66] dark:text-[#0ECB81]"> 已读完</span> : <span className="text-muted-foreground"> 读取中…</span>}</>)}
          {step(2, !!result && !running, groupingReady && !result, (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>点</span>
              {running ? (
                <button type="button" data-testid="deep-dive-cancel" onClick={onCancel}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] hover:bg-muted">
                  <Square className="h-3 w-3" />取消
                </button>
              ) : (
                <button type="button" data-testid="deep-dive-run" disabled={!canRun} onClick={onRun}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#F0B90B] px-2.5 text-[12px] font-medium text-black hover:bg-[#F0B90B]/90 disabled:cursor-not-allowed disabled:opacity-40">
                  <Play className="h-3 w-3" />{result ? '重新深挖' : '开始深挖'}
                </button>
              )}
              <span className="text-muted-foreground">拉行情、算特征、做统计，一般 1–3 分钟；可随时取消，点进战役再回来也会继续。</span>
              {running && progress && (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground" data-testid="deep-dive-progress">
                  <Loader2 className="h-3 w-3 animate-spin" />{STAGE_LABEL[progress.stage] ?? progress.stage}
                  {progress.total > 0 && progress.stage !== 'done' && <> <N>{progress.done}</N> / <N>{progress.total}</N></>}
                </span>
              )}
              {!running && status === 'cancelled' && <span className="text-muted-foreground">已取消，结果未更新</span>}
              {!running && status === 'error' && <span className="text-[#F6465D]">运行失败：{error}</span>}
            </div>
          ))}
          {step(3, false, !!result && !running, <>按顺序点开下面的 A → G，每一节先看「怎么读」。</>)}
          {step(4, false, !!result && !running, (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <button type="button" disabled={!result} onClick={onDownload} data-testid="deep-dive-download"
                className="inline-flex items-center gap-1 text-foreground/85 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
                <Download className="h-3 w-3" />下载结果 JSON
              </button>
              <span className="text-muted-foreground">发给我，我据此写第 6 步的报告。</span>
              {result && <span className="text-muted-foreground">上次运行 <span className="font-mono tabular-nums">{formatBeijingTime(result.finishedAt).slice(0, 16)}</span> · {result.codeVersion}</span>}
            </span>
          ))}
        </ol>
      </div>

      {result && !running && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="特征深挖结果">
            {SECTIONS.map((s, i) => (
              <button key={s.id} type="button" role="tab" aria-selected={section === i} data-testid={`deep-dive-tab-${s.id}`}
                onClick={() => setSection(i)}
                className={cn('h-7 rounded-md border px-2 text-[11.5px]', section === i ? 'border-[#F0B90B]/60 bg-[#F0B90B]/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
                {s.id} {s.title.replace(/（.*）/, '')}
              </button>
            ))}
          </div>
          <div className="space-y-2 rounded-lg border border-border p-3" data-testid={`deep-dive-section-${SECTIONS[section].id}`}>
            <h3 className="text-[12px] font-medium">{SECTIONS[section].id} · {SECTIONS[section].title}</h3>
            <p className="text-muted-foreground"><span className="text-foreground/85">怎么读：</span>{SECTIONS[section].how}</p>
            <div className="overflow-x-auto">
              <SectionBody id={SECTIONS[section].id} result={result} />
            </div>
            <div className="flex items-center justify-between pt-1">
              <button type="button" disabled={section === 0} onClick={() => setSection(section - 1)}
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" />上一节</button>
              <button type="button" disabled={section === SECTIONS.length - 1} onClick={() => setSection(section + 1)} data-testid="deep-dive-next"
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">下一节<ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <Conclusion result={result} />
        </div>
      )}
    </div>
  );
}

function SectionBody({ id, result }: { id: string; result: FeatureDeepDiveResult }) {
  const c = result.coverage;
  if (id === 'A') return (
    <div className="space-y-2">
      <div className="text-muted-foreground">
        战役 <N>{c.campaigns}</N> 场 → 去重 <N>{c.clusters}</N> 簇；有效事件 <N>{c.events}</N>（战役时点 <N>{c.campaignEvents}</N>、随机背景 <N>{c.background}</N>）；
        正样本 <N>{c.labeled.positive}</N>、对照 <N>{c.labeled.control}</N>；发现集 <N>{c.discovery}</N>、确认集 <N>{c.confirmation}</N>、隔离带剔除 <N>{c.embargoed}</N>；
        观察窗覆盖不足剔除 <N>{c.lowCoverage}</N>、拉取失败 <N>{c.failed.length}</N>、缺主动买入量 <N>{c.missingTakerEvents}</N>；兜底价可用 <N>{c.fallbackAvailable}</N>。
      </div>
      <table className="w-full"><thead className="text-muted-foreground"><tr>
        <th className={TH}>特征</th><th className={TH}>组</th><th className={TH}>n</th><th className={TH}>中位数</th><th className={TH}>四分位区间</th><th className={TH}>大于 0 的比例</th>
      </tr></thead><tbody>
        {result.distribution.map(r => (
          <tr key={`${r.feature}-${r.group}`} className="border-t border-border/50">
            <td className={TD}>{r.group === 'all' ? FEATURE_NAME[r.feature] : ''}</td>
            <td className={TD}>{GROUP_LABEL[r.group]}</td>
            <td className={TD}><N>{r.n}</N></td>
            <td className={TD}><N>{num(r.median, 4)}</N></td>
            <td className={TD}><N>{num(r.q25, 4)} ~ {num(r.q75, 4)}</N></td>
            <td className={TD}><N>{r.sharePositive == null ? '—' : `${(r.sharePositive * 100).toFixed(0)}%`}</N></td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
  if (id === 'B') return (
    <table className="w-full"><thead className="text-muted-foreground"><tr>
      <th className={TH}>特征</th><th className={TH}>结果</th><th className={TH}>n</th><th className={TH}>ρ</th><th className={TH}>95% 区间（按标的重抽样）</th>
      <th className={TH}>p</th><th className={TH}>Holm p</th><th className={TH}>控制波动率后 ρ</th><th className={TH}>其 p</th>
    </tr></thead><tbody>
      {result.association.map(r => (
        <tr key={`${r.feature}-${r.target}`} className={cn('border-t border-border/50', r.pHolm < DEEP_DIVE_ALPHA && 'bg-[#F0B90B]/[0.06]')} data-testid={`deep-dive-assoc-${r.feature}-${r.target}`}>
          <td className={TD}>{r.target === 'endRet' ? FEATURE_NAME[r.feature] : ''}</td>
          <td className={TD}>{TARGET_NAME[r.target]}</td>
          <td className={TD}><N>{r.n}</N></td>
          <td className={cn(TD, 'font-mono tabular-nums', rhoTone(r.rho, r.pHolm))}>{num(r.rho)}</td>
          <td className={TD}><N>{ci(r.ci)}</N></td>
          <td className={TD}><N>{pv(r.p)}</N></td>
          <td className={TD}><N>{pv(r.pHolm)}</N></td>
          <td className={cn(TD, 'font-mono tabular-nums', rhoTone(r.rhoPartialVol, r.pPartialVol))}>{num(r.rhoPartialVol)}</td>
          <td className={TD}><N>{pv(r.pPartialVol)}</N></td>
        </tr>
      ))}
    </tbody></table>
  );
  if (id === 'C') return result.confirmation.length === 0 ? (
    <div className="text-muted-foreground">发现集没有通过 Holm 的项，按事先约定不上确认集：这三个特征与 24h 客观结果的关系「检验未获支持」。</div>
  ) : (
    <div className="space-y-2">
      <table className="w-full"><thead className="text-muted-foreground"><tr>
        <th className={TH}>特征</th><th className={TH}>结果</th><th className={TH}>发现集 ρ</th><th className={TH}>n</th><th className={TH}>确认集 ρ</th>
        <th className={TH}>单侧 p</th><th className={TH}>Holm p</th><th className={TH}>判定</th><th className={TH}>控制波动率后</th>
      </tr></thead><tbody>
        {result.confirmation.map(r => (
          <tr key={`${r.feature}-${r.target}`} className="border-t border-border/50" data-testid={`deep-dive-conf-${r.feature}-${r.target}`}>
            <td className={TD}>{FEATURE_NAME[r.feature]}</td><td className={TD}>{TARGET_NAME[r.target]}</td>
            <td className={TD}><N>{num(r.discoveryRho)}</N></td><td className={TD}><N>{r.n}</N></td><td className={TD}><N>{num(r.rho)}</N></td>
            <td className={TD}><N>{pv(r.p)}</N></td><td className={TD}><N>{pv(r.pHolm)}</N></td>
            <td className={cn(TD, VERDICT_TONE[r.verdict])}>{r.verdict}</td>
            <td className={TD}>{r.survivesVolControl ? '仍成立' : <span className="text-muted-foreground">不成立（ρ {num(r.rhoPartialVol)}，p {pv(r.pPartialVol)}）</span>}</td>
          </tr>
        ))}
      </tbody></table>
      <div className="text-muted-foreground">确认集与第 3–5 步的测试集是同一段时间；其中「谢林 → 24h 最大涨幅」那一类关系上次已经在这段时间看过一次，这一项不算完全独立的确认。</div>
    </div>
  );
  if (id === 'D') return (
    <div className="space-y-3">
      {result.quintiles.map(qt => (
        <div key={qt.feature} className="space-y-1">
          <div className="text-foreground/85">{FEATURE_NAME[qt.feature]}</div>
          {qt.bins.length === 0 ? <div className="text-muted-foreground">有效值太少，分不出五档。</div> : (
            <table className="w-full"><thead className="text-muted-foreground"><tr>
              <th className={TH}>档</th><th className={TH}>特征范围</th><th className={TH}>n</th>
              {DEEP_DIVE_TARGETS.map(t => <th key={t.key} className={TH}>{t.name}（95% 区间）</th>)}
            </tr></thead><tbody>
              {qt.bins.map(b => (
                <tr key={b.q} className="border-t border-border/50">
                  <td className={TD}>Q{b.q}</td>
                  <td className={TD}><N>{num(b.lo, 4)} ~ {num(b.hi, 4)}</N></td>
                  <td className={TD}><N>{b.n}</N></td>
                  {DEEP_DIVE_TARGETS.map(t => (
                    <td key={t.key} className={TD}><N>{pctLog(b.means[t.key])}</N> <span className="text-muted-foreground">({ci(b.ci[t.key], 2, (x, d) => pctLog(x, d))})</span></td>
                  ))}
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      ))}
    </div>
  );
  if (id === 'E') return (
    <table className="w-full"><thead className="text-muted-foreground"><tr>
      <th className={TH}>特征</th><th className={TH}>正 / 对照</th><th className={TH}>AUC</th><th className={TH}>95% 区间</th><th className={TH}>p</th><th className={TH}>Holm p</th>
      <th className={TH}>正样本中位数</th><th className={TH}>对照中位数</th>
    </tr></thead><tbody>
      {result.labels.map(r => (
        <tr key={r.feature} className="border-t border-border/50" data-testid={`deep-dive-label-${r.feature}`}>
          <td className={TD}>{FEATURE_NAME[r.feature]}</td>
          <td className={TD}><N>{r.nPos}</N> / <N>{r.nCtl}</N></td>
          <td className={cn(TD, 'font-mono tabular-nums', rhoTone(r.auc - 0.5, r.pHolm))}>{num(r.auc)}</td>
          <td className={TD}><N>{ci(r.ci)}</N></td>
          <td className={TD}><N>{pv(r.p)}</N></td>
          <td className={TD}><N>{pv(r.pHolm)}</N></td>
          <td className={TD}><N>{num(r.posMedian, 4)}</N></td>
          <td className={TD}><N>{num(r.ctlMedian, 4)}</N></td>
        </tr>
      ))}
    </tbody></table>
  );
  if (id === 'F') {
    const sub = (f: DeepDiveFeatureKey, t: DeepDiveTargetKey, s: 'campaign' | 'background') => result.robustness.bySubset.find(r => r.feature === f && r.target === t && r.subset === s);
    const hl = (f: DeepDiveFeatureKey, t: DeepDiveTargetKey, h: number) => result.robustness.byHalfLife.find(r => r.feature === f && r.target === t && r.h === h);
    return (
      <table className="w-full"><thead className="text-muted-foreground"><tr>
        <th className={TH}>特征</th><th className={TH}>结果</th><th className={TH}>只看战役时点 ρ（n）</th><th className={TH}>只看随机背景 ρ（n）</th>
        <th className={TH}>h = 2</th><th className={TH}>h = 6</th><th className={TH}>h = 12</th>
      </tr></thead><tbody>
        {DEEP_DIVE_FEATURES.flatMap(f => DEEP_DIVE_TARGETS.map(t => {
          const a = sub(f.key, t.key, 'campaign');
          const b = sub(f.key, t.key, 'background');
          return (
            <tr key={`${f.key}-${t.key}`} className="border-t border-border/50">
              <td className={TD}>{t.key === 'endRet' ? f.name : ''}</td><td className={TD}>{t.name}</td>
              <td className={TD}><N>{num(a?.rho)}</N> <span className="text-muted-foreground">({a?.n ?? 0})</span></td>
              <td className={TD}><N>{num(b?.rho)}</N> <span className="text-muted-foreground">({b?.n ?? 0})</span></td>
              {[2, 6, 12].map(h => <td key={h} className={TD}>{f.weighted ? <N>{num(hl(f.key, t.key, h)?.rho)}</N> : <span className="text-muted-foreground">不随 h 变</span>}</td>)}
            </tr>
          );
        }))}
      </tbody></table>
    );
  }
  return (
    <table className="w-full"><thead className="text-muted-foreground"><tr>
      <th className={TH}>现价 vs 12h VWAP</th><th className={TH}>近期主动买卖</th><th className={TH}>n</th>
      {DEEP_DIVE_TARGETS.map(t => <th key={t.key} className={TH}>{t.name}均值</th>)}
      <th className={TH}>其中正 / 对照</th>
    </tr></thead><tbody>
      {result.interaction.map(cell => (
        <tr key={`${cell.price}-${cell.flow}`} className="border-t border-border/50">
          <td className={TD}>{cell.price === 'above' ? '上方' : '下方（或相等）'}</td>
          <td className={TD}>{cell.flow === 'buy' ? '买盘占优' : '卖盘占优（或持平）'}</td>
          <td className={TD}><N>{cell.n}</N></td>
          {DEEP_DIVE_TARGETS.map(t => <td key={t.key} className={TD}><N>{pctLog(cell.means[t.key])}</N></td>)}
          <td className={TD}><N>{cell.nPos}</N> / <N>{cell.nCtl}</N></td>
        </tr>
      ))}
    </tbody></table>
  );
}

function Conclusion({ result }: { result: FeatureDeepDiveResult }) {
  const verified = result.conclusions.verified;
  return (
    <div className="space-y-1 rounded-lg border border-border bg-muted/30 p-3" data-testid="deep-dive-conclusion">
      <h3 className="text-[12px] font-medium">结论</h3>
      {verified.length === 0 ? (
        <div><span className={VERDICT_TONE['检验未获支持']}>检验未获支持</span>：四个特征与三个 24h 客观结果之间，没有在发现集与确认集上都成立的关系。</div>
      ) : verified.map(v => (
        <div key={`${v.feature}-${v.target}`}>
          <span className={VERDICT_TONE['已验证']}>已验证</span>：{FEATURE_NAME[v.feature]} → {TARGET_NAME[v.target]}
          {v.survivesVolControl ? '，控制波动率后仍成立' : '，但控制波动率后不成立（多半是在说波动大小，不是方向）'}。
        </div>
      ))}
      <div className="text-muted-foreground">标签（正 / 对照）比较只作描述，看 E 节；分档、稳健性、交叉表都不做判定。</div>
    </div>
  );
}
