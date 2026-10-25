/**
 * 「捕捞过程」：点开一条鱼，看它凭什么被击中、这一轮其它币为什么没进来。
 * 【用户要求】2026-10-20「在捕捉到的信号后面加一列（捕捞过程），点开之后要能够看到凭什么击中到了信号、以及为什么能避开其他噪音」。
 * 命中依据来自鱼自己的读数快照（越线前一根、起点、截止、这一轮的极值与轨迹）；
 * 避开噪音来自本轮摘要（只存本机）：其余币分别卡在哪一步、本币读数在本轮排第几、本币此前越线过几次。
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { FishSnapshot } from '@/lib/fish/algorithm';
import { fishRoundIdentity, readFishRound, type FishRoundSummary } from '@/lib/fish/roundSummary';
import { formatUTC8 } from '@/lib/timeFormat';
import { intervalMs } from '@/lib/deepRsa/marketData';

/** 快照记录的周期（缺省 5 分钟）对应的毫秒数。 */
const stepOf = (fish: FishSnapshot) => { try { return intervalMs((fish.interval ?? '5m') as Parameters<typeof intervalMs>[0]); } catch { return 300000; } };

const num = (v: number | undefined | null) => v == null || !Number.isFinite(v) ? '—' : Number(v.toPrecision(5)).toString();
const t = (ms: number | undefined) => ms == null || !Number.isFinite(ms) ? '—' : formatUTC8(ms).slice(5, 16);
const pct = (a: number, b: number) => b > 0 ? `${((a / b) * 100).toFixed(a / b < 0.01 ? 2 : 1)}%` : '—';
const OUTCOME: Record<string, string> = { hit: '命中', wick: '出现向下大插针，已过滤', below: '截止时没达到门槛', unknown: '早已在门槛之上、找不到这一轮的起点（不入库）', blocked: '主条件满足但被附加约束挡下', readings: '截止读数不全', gap: 'K 线有缺口', history: '当时未上市 / 历史不足', failed: '请求失败', skipped: '交易所整家跳过' };
const ORDER = ['wick', 'below', 'unknown', 'blocked', 'readings', 'gap', 'history', 'failed', 'skipped'];

/** 读数轨迹：门槛虚线、起点竖线、截止点。 */
function Trace({ fish }: { fish: FishSnapshot }) {
  const tr = fish.trace;
  if (!tr || tr.values.length < 2) return null;
  const scale = fish.scale ?? 1, raw = fish.thresholdRaw ?? (fish.threshold / scale);
  const values = tr.values.map(v => v * scale), thr = raw * scale;
  const finite = [...values.filter(Number.isFinite), thr];
  const lo = Math.min(...finite), hi = Math.max(...finite), span = hi - lo || 1;
  const W = 520, H = 72, x = (i: number) => (i / (values.length - 1)) * W, y = (v: number) => H - 4 - ((v - lo) / span) * (H - 8);
  const path = values.map((v, i) => Number.isFinite(v) ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null).filter(Boolean).join(' ');
  // 第 j 个点对应截止往前 (len − 1 − j) × every 根；起点往前 (截止 − 起点) 根
  const every = Math.max(1, Math.round(tr.dt / stepOf(fish)));
  const startI = fish.startIndex != null && fish.cutoffIndex != null ? Math.round(values.length - 1 - (fish.cutoffIndex - fish.startIndex) / every) : -1;
  return <figure className="space-y-0.5">
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[72px] w-full overflow-visible" role="img" aria-label="读数轨迹">
      <line x1={0} x2={W} y1={y(thr)} y2={y(thr)} className="stroke-muted-foreground/60" strokeDasharray="3 3" strokeWidth={1} />
      {startI >= 0 && startI < values.length && <line x1={x(startI)} x2={x(startI)} y1={0} y2={H} className="stroke-primary/50" strokeWidth={1} />}
      <polyline points={path} fill="none" className="stroke-primary" strokeWidth={1.5} />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.5} className="fill-primary" />
    </svg>
    <figcaption className="flex justify-between text-[9.5px] text-muted-foreground"><span>{t(tr.t0)}</span><span>虚线 = 门槛 {num(thr)} · 竖线 = 起点</span><span>{t(tr.t0 + tr.dt * (tr.values.length - 1))}</span></figcaption>
  </figure>;
}

/** 一个算法的命中依据。 */
function HitEvidence({ fish, signalTime }: { fish: FishSnapshot; signalTime?: number }) {
  const scale = fish.scale ?? 1, dir = fish.direction ?? '>', thr = fish.threshold;
  const step = stepOf(fish);
  const start = signalTime ?? (fish.trace && fish.startIndex != null && fish.cutoffIndex != null ? fish.cutoffMs - (fish.cutoffIndex - fish.startIndex) * step : undefined);
  const bars = fish.aboveBars ?? (fish.startIndex != null && fish.cutoffIndex != null ? fish.cutoffIndex - fish.startIndex + 1 : undefined);
  const margin = Number.isFinite(fish.average) ? (fish.average * scale - thr) * (dir === '<' ? -1 : 1) : NaN;
  if ((fish as { outcome?: string }).outcome === 'unknown') return <p className="text-muted-foreground">这一算法在截止时满足（{dir} {num(thr)}），但从可用区间开头起就一直满足，找不到这一轮的起点。</p>;
  return <div className="space-y-1">
    <ol className="list-decimal space-y-0.5 pl-4">
      <li>越线：{start != null ? <>前一根（{t(start - step)}）读数 <b>{num(fish.previousAverage * scale)}</b>，{fish.stateHold?'尚未同时满足当前门槛与持续时间条件':`还${dir === '>' ? '不到' : '不低于'}门槛`}；{t(start)} 这一根读数 <b>{num(fish.startAverage * scale)}</b>，{fish.stateHold?'开始同时满足两项条件':<>越过门槛 {dir} {num(thr)}</>}。</> : '—'}</li>
      <li>保持：{bars != null ? <>此后连续 {bars} 根（约 {((bars * step) / 3600000).toFixed(1)} 小时）一直满足，这一轮里{dir === '>' ? '最低' : '最高'} {num((fish.runExtreme ?? NaN) * scale)}，没有回落到门槛另一侧。</> : '—'}</li>
      <li>截止：{t(fish.cutoffMs)} 读数 <b>{num(fish.average * scale)}</b>{Number.isFinite(margin) && <>，比门槛{dir === '>' ? '高' : '低'} {num(margin)}</>}。</li>
      {fish.stateHold&&<li>持续核验：{t(fish.stateHold.fromMs)} 至截止，S 连续高于 <b>{num(fish.stateHold.threshold)}</b> 已覆盖 <b>{num(fish.stateHold.verifiedHours)} 小时</b>，期间最低 <b>{num(fish.stateHold.minimum)}</b>；要求至少 {num(fish.stateHold.requiredHours)} 小时。</li>}
      {!!fish.constraints?.length && <li>附加约束：{fish.constraints.map((c, i) => `${c}（起点 ${fish.startConstraints?.[i] ? '满足' : '—'} / 截止 ${fish.cutoffConstraints?.[i] ? '满足' : '—'}）`).join('；')}</li>}
    </ol>
    <Trace fish={fish} />
  </div>;
}

/** 本轮为什么只进来这几个：其余币卡在哪一步、本币排第几、本币此前越线次数。 */
function NoiseEvidence({ fish, round, identity, label }: { fish: FishSnapshot; round: FishRoundSummary | null; identity: string; label?: string }) {
  const scale = fish.scale ?? 1;
  const crossings = fish.crossings;
  return <div className="space-y-1">
    {round ? <>
      <p>{label ?? '本轮'}共判定 <b>{round.total}</b> 个币，只有 <b>{round.counts.hit ?? 0}</b> 个命中（{pct(round.counts.hit ?? 0, round.total)}）{round.partial && '（这一轮中途取消，只覆盖了一部分币）'}。其余：</p>
      <ul className="list-disc space-y-0.5 pl-4">{ORDER.filter(k => round.counts[k]).map(k => <li key={k}>{OUTCOME[k]}：{round.counts[k]} 个</li>)}</ul>
      {round.quantiles && Number.isFinite(round.threshold) && <p>本轮截止读数（{round.valid} 个可读）：中位数 {num(round.quantiles.p50 * scale)}、P90 {num(round.quantiles.p90 * scale)}、P99 {num(round.quantiles.p99 * scale)}、{round.direction === '>' ? '最高' : '最低'} {num((round.direction === '>' ? round.quantiles.max : round.quantiles.min) * scale)}；门槛 {num(round.threshold)} 在大多数币的读数之{round.direction === '>' ? '上' : '下'}。</p>}
      {round.ranks[identity] != null && <p>本币截止读数在 {round.valid} 个可读的币里排第 <b>{round.ranks[identity]}</b>（前 {pct(round.ranks[identity], round.valid)}）。</p>}
      {!!round.top.length && Number.isFinite(round.threshold) && <details><summary className="cursor-pointer text-muted-foreground">本轮读数最靠前的 {round.top.length} 个币</summary>
        <table className="mt-1 w-full text-left font-mono text-[10px] tabular-nums"><tbody>{round.top.map(r => <tr key={fishRoundIdentity(r)} className={fishRoundIdentity(r) === identity ? 'text-primary' : ''}><td className="pr-2">{r.symbol}{r.exchange && r.exchange !== 'binance' ? ` · ${r.exchange}` : ''}</td><td className="pr-2">{num(r.reading * scale)}</td><td className="font-sans">{OUTCOME[r.outcome] ?? r.outcome}</td></tr>)}</tbody></table>
        <p className="mt-1 text-muted-foreground">读数更靠前却没进来的币，多半是「早已在门槛之上、找不到起点」——它们不是这一轮刚越线的。</p>
      </details>}
    </> : <p className="text-muted-foreground">没有找到这一轮的记录（本机只保存最近 40 轮；更早的捕捞或换了浏览器时看不到）。</p>}
    {crossings != null && <p>本币在可用区间里越线 {crossings} 次：{crossings <= 1 ? '只有这一次，不是在门槛附近来回穿越。' : `此前还越线过 ${crossings - 1} 次又回落，记的是最近、并且一直保持到截止的这一次。`}</p>}
  </div>;
}

export function FishProcessDetail({ signal, hideTitle = false }: { signal: TradeSignal; hideTitle?: boolean }) {
  const fish = signal.fish;
  if (!fish) return <p>旧记录，没有读数快照。</p>;
  const identity = fishRoundIdentity({ exchange: signal.exchange, market: signal.market, symbol: signal.symbol });
  const members = fish.algorithms ?? [];
  const multi = members.length > 0;
  const round = readFishRound(fish.algorithmKey, fish.cutoffMs);
  const old = !multi && !fish.trace;
  return <div className="space-y-3 text-[11px] leading-relaxed" data-testid="fish-process-detail">
    {!hideTitle && <p className="font-medium">{signal.symbol} · 信号时间 {formatUTC8(signal.timeMs)}</p>}
    {old && <p className="text-muted-foreground">这条是较早捕到的，当时没有记下过程数据；下面只列快照里有的读数。重新捕捞后会有完整过程。</p>}
    {!multi ? <>
      <section className="space-y-1.5 border-t border-border/50 pt-3 first:border-t-0 first:pt-0"><h4 className="text-xs font-medium">凭什么击中</h4>
        <p className="text-muted-foreground">规则：{fish.featureShort ?? 'CBI-2'} 的「{fish.statistic && fish.statistic !== '结果' ? fish.statistic : '结果'}」{fish.direction ?? '>'} {fish.threshold}{fish.unit ? ` ${fish.unit}` : ''}；截止时满足，并且是在可用区间里刚越线、一直保持到截止的这一轮。</p>
        <HitEvidence fish={fish} signalTime={signal.timeMs} />
      </section>
      <section className="space-y-1.5 border-t border-border/50 pt-3 first:border-t-0 first:pt-0"><h4 className="text-xs font-medium">为什么避开了其他噪音</h4><NoiseEvidence fish={fish} round={round} identity={identity} /></section>
    </> : <>
      <section className="space-y-1.5 border-t border-border/50 pt-3 first:border-t-0 first:pt-0"><h4 className="text-xs font-medium">凭什么击中（{fish.combination === 'or' ? '并集：满足任一' : '交集：同时满足'}）</h4>
        <p className="text-muted-foreground">{fish.combination === 'or' ? `命中的是算法 ${(fish.hitAlgorithms ?? []).join('、')}；信号时间取命中算法里最早的起点。` : '每个算法都在截止时满足；信号时间取各算法起点里最晚的那个（从那一刻起全部同时成立）。'}</p>
        {members.map((m, i) => <div key={i} className="space-y-1 border-l border-border/60 pl-2">
          <p className="font-medium">算法 {i + 1} · {m.featureShort ?? m.featureName ?? ''} {m.direction ?? '>'} {num(m.threshold)}{fish.combination === 'or' && !(fish.hitAlgorithms ?? []).includes(i + 1) ? <span className="ml-1 font-normal text-muted-foreground">（这一算法没命中：{OUTCOME[(m as { outcome?: string }).outcome ?? ''] ?? '—'}）</span> : null}</p>
          {(fish.combination !== 'or' || (fish.hitAlgorithms ?? []).includes(i + 1)) && <HitEvidence fish={m} />}
        </div>)}
      </section>
      <section className="space-y-1.5 border-t border-border/50 pt-3 first:border-t-0 first:pt-0"><h4 className="text-xs font-medium">为什么避开了其他噪音</h4>
        {round ? <p>本轮组合判定 <b>{round.total}</b> 个币，命中 <b>{round.counts.hit ?? 0}</b> 个；各算法单独命中：{(round.members ?? []).map((x, i) => `算法 ${i + 1} ${x.hits} 个`).join('、')}。{fish.combination === 'or' ? '并集只是把各算法单独命中的币合在一起，每个币留一条。' : '交集要求每个算法都命中，所以比任何一个算法单独命中的都少。'}</p> : <p className="text-muted-foreground">没有找到这一轮的组合记录（本机只保存最近 40 轮）。</p>}
        {members.map((m, i) => <details key={i}><summary className="cursor-pointer text-muted-foreground">算法 {i + 1} 本轮的筛选</summary><NoiseEvidence fish={m} round={readFishRound(m.algorithmKey, m.cutoffMs)} identity={identity} label={`算法 ${i + 1} 本轮`} /></details>)}
      </section>
    </>}
  </div>;
}

/** 列表里的「捕捞过程」入口：点开才读本轮记录。 */
/**
 * 列表里的「捕捞过程」入口：点开是屏幕正中的对话框（不贴着按钮弹出），点开才读本轮记录。
 * 【用户要求】2026-10-20「捕捞过程点开之后的卡片，位置有问题、不美观、不和谐。要保证美观、居中对齐」。
 */
export function FishProcessButton({ signal }: { signal: TradeSignal }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="min-w-0 truncate text-left text-[10px] text-muted-foreground hover:text-foreground hover:underline" data-testid="fish-process-open" onClick={() => setOpen(true)}>捕捞过程</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl flex-col gap-3 overflow-hidden p-0" data-testid="fish-process-dialog">
        <DialogHeader className="border-b border-border/60 px-5 pb-3 pt-5 text-left">
          <DialogTitle className="font-mono text-sm">{signal.symbol}<span className="ml-2 font-sans text-xs font-normal text-muted-foreground">捕捞过程</span></DialogTitle>
          <DialogDescription className="text-[11px]">信号时间 {formatUTC8(signal.timeMs)}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-5 pb-5">{open && <FishProcessDetail signal={signal} hideTitle />}</div>
      </DialogContent>
    </Dialog>
  </>;
}
